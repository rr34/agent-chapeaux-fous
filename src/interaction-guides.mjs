import { randomUUID } from "node:crypto";
import { localDateForInstant } from "./temporal-consistency.mjs";
import {
  contractArgumentsMatch,
  normalizeInteractionGuideContract,
} from "./interaction-guide-contract.mjs";

const guideStatuses = new Set(["active", "archived"]);
const staleRunActions = new Set(["ask", "resume"]);

export const defaultInteractionGuideName = "Exchange Inbox";

function identifier(value, label = "Briefing ID") {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`);
  return result;
}

function requiredText(value, label, maximum) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} cannot be empty`);
  if (result.length > maximum) throw new Error(`${label} cannot exceed ${maximum} characters`);
  return result;
}

function answersObject(value, label = "Step answers") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 100_000) throw new Error(`${label} cannot exceed 100000 JSON characters`);
  return { value: JSON.parse(serialized), serialized };
}

function publicStep(row) {
  if (!row) return null;
  return {
    id: Number(row.interaction_guide_step_id),
    guideId: Number(row.interaction_guide_id),
    stepNumber: Number(row.step_number),
    openingText: row.opening_text,
    contract: JSON.parse(row.contract_json),
    answers: JSON.parse(row.answers_json),
    progressState: row.progress_state,
    enabled: Boolean(row.enabled),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function publicGuide(row, { steps = null, activeRun = null } = {}) {
  if (!row) return null;
  return {
    id: Number(row.interaction_guide_id),
    name: row.name,
    status: row.status,
    version: Number(row.version),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    ...(steps === null ? {} : { steps: steps.map(publicStep) }),
    ...(activeRun === null ? {} : { activeRun }),
  };
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function ledgerActor(context, toolName) {
  if (context.actorType === "user") {
    return { actorType: "user", actorName: context.actorName ?? "web" };
  }
  return { actorType: "tool", actorName: toolName };
}

export class InteractionGuides {
  constructor({ store, ledger, clock = () => new Date(), timeZone = () => "UTC" }) {
    if (typeof clock !== "function") throw new Error("Briefing clock must be a function");
    if (typeof timeZone !== "function") throw new Error("Briefing time-zone provider must be a function");
    this.store = store;
    this.ledger = ledger;
    this.clock = clock;
    this.timeZone = timeZone;
  }

  #currentTiming() {
    const now = this.clock();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error("Briefing clock must return a valid Date");
    }
    const timeZone = String(this.timeZone() ?? "").trim();
    const currentLocalDate = localDateForInstant(now, timeZone);
    return { now, timeZone, currentLocalDate };
  }

  #runTiming(database, startedRow, started) {
    const current = this.#currentTiming();
    const startedAtUtc = started.startedAtUtc ?? startedRow.occurred_at_utc;
    const startedLocalDate = started.startedLocalDate
      ?? localDateForInstant(startedAtUtc, current.timeZone);
    const resumedRow = database.prepare(`
      SELECT payload_json
      FROM activity_events
      WHERE subject_type = 'interaction_guide_run' AND subject_id = ?
        AND event_type = 'interaction_guide.run_resumed'
      ORDER BY event_seq DESC
      LIMIT 1
    `).get(startedRow.subject_id);
    const resumed = resumedRow ? JSON.parse(resumedRow.payload_json) : null;
    const resumeAcknowledgedLocalDate = resumed?.localDate ?? null;
    return {
      startedAtUtc,
      startedLocalDate,
      timeZone: current.timeZone,
      currentLocalDate: current.currentLocalDate,
      resumeAcknowledgedLocalDate,
      requiresDailyChoice: startedLocalDate < current.currentLocalDate
        && resumeAcknowledgedLocalDate !== current.currentLocalDate,
    };
  }

  list({ status = "active", limit = 200 } = {}) {
    if (status !== "all" && !guideStatuses.has(status)) {
      throw new Error(`Unknown briefing status: ${status}`);
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error("Briefing limit must be an integer from 1 through 500");
    }
    const rows = this.store.requireReady().prepare(`
      SELECT interaction_guide_id, name, status, version, created_at_utc, updated_at_utc
      FROM interaction_guides
      ${status === "all" ? "" : "WHERE status = ?"}
      ORDER BY name, interaction_guide_id
      LIMIT ?
    `).all(...(status === "all" ? [limit] : [status, limit]));
    const database = this.store.requireReady();
    const guides = rows.map((row) => {
      const activeRun = this.#activeRun(database, Number(row.interaction_guide_id));
      const current = activeRun
        ? this.#currentRunStep(database, activeRun.id, Number(row.interaction_guide_id))
        : null;
      return publicGuide(row, {
        includeText: false,
        activeRun: activeRun ? {
          id: activeRun.id,
          guideVersion: Number(activeRun.guideVersion),
          status: "active",
          currentStepNumber: current ? Number(current.step_number) : null,
          startedAtUtc: activeRun.startedAtUtc,
          startedLocalDate: activeRun.startedLocalDate,
          currentLocalDate: activeRun.currentLocalDate,
          timeZone: activeRun.timeZone,
          requiresDailyChoice: activeRun.requiresDailyChoice,
        } : null,
      });
    });
    return { status, count: guides.length, guides };
  }

  #steps(database, guideId, { enabledOnly = false } = {}) {
    return database.prepare(`
      SELECT * FROM interaction_guide_steps
      WHERE interaction_guide_id = ?
        ${enabledOnly ? "AND enabled = 1" : ""}
      ORDER BY step_number, interaction_guide_step_id
    `).all(guideId);
  }

  #guideForDefinitionEdit(database, guideId, expectedVersion) {
    const selectedId = identifier(guideId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("Expected briefing version must be a positive integer");
    }
    const guide = database.prepare(
      "SELECT * FROM interaction_guides WHERE interaction_guide_id = ?",
    ).get(selectedId);
    if (!guide) throw new Error(`Briefing ${selectedId} does not exist`);
    if (guide.status !== "active") throw conflict("Archived briefings cannot be changed");
    if (Number(guide.version) !== expectedVersion) {
      throw conflict("This briefing changed after it was read. Fetch it again before updating it.");
    }
    const activeRun = this.#activeRun(database, selectedId);
    if (activeRun) {
      throw conflict("Finish or cancel the active briefing before changing its definition");
    }
    return guide;
  }

  #bumpGuideVersion(database, guideId, expectedVersion) {
    const guide = database.prepare(`
      UPDATE interaction_guides
      SET version = version + 1,
          updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
      WHERE interaction_guide_id = ? AND version = ?
      RETURNING *
    `).get(guideId, expectedVersion);
    if (!guide) throw conflict("This briefing changed while its exchanges were being updated");
    return guide;
  }

  #activeRun(database, guideId) {
    const row = database.prepare(`
      SELECT started.*
      FROM activity_events AS started
      WHERE started.event_type = 'interaction_guide.run_started'
        AND json_extract(started.payload_json, '$.interactionGuideId') = ?
        AND NOT EXISTS (
          SELECT 1 FROM activity_events AS terminal
          WHERE terminal.subject_type = 'interaction_guide_run'
            AND terminal.subject_id = started.subject_id
            AND terminal.event_type IN (
              'interaction_guide.run_completed', 'interaction_guide.run_cancelled'
            )
        )
      ORDER BY started.event_seq DESC
      LIMIT 1
    `).get(guideId);
    if (!row) return null;
    const started = JSON.parse(row.payload_json);
    return {
      id: row.subject_id,
      ...started,
      ...this.#runTiming(database, row, started),
    };
  }

  #currentRunStep(database, _runId, guideId) {
    return database.prepare(`
      SELECT * FROM interaction_guide_steps
      WHERE interaction_guide_id = ? AND enabled = 1 AND progress_state = 'active'
      ORDER BY step_number, interaction_guide_step_id
      LIMIT 1
    `).get(guideId) ?? null;
  }

  #resetRunState(database, guideId) {
    database.prepare(`
      UPDATE interaction_guide_steps
      SET answers_json = '{}', progress_state = 'pending',
          updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
      WHERE interaction_guide_id = ?
    `).run(guideId);
  }

  get({ guideId = null, name = null } = {}) {
    const hasId = guideId !== null && guideId !== undefined;
    const selectedName = name == null ? null : String(name).trim();
    if (hasId === Boolean(selectedName)) {
      throw new Error("Supply exactly one briefing ID or name");
    }
    const row = hasId
      ? this.store.requireReady().prepare(
          "SELECT * FROM interaction_guides WHERE interaction_guide_id = ?",
        ).get(identifier(guideId))
      : this.store.requireReady().prepare(
          "SELECT * FROM interaction_guides WHERE name = ?",
        ).get(selectedName);
    if (!row) return null;
    const database = this.store.requireReady();
    const selectedId = Number(row.interaction_guide_id);
    const activeRun = this.#activeRun(database, selectedId);
    const current = activeRun ? this.#currentRunStep(database, activeRun.id, selectedId) : null;
    return publicGuide(row, {
      steps: this.#steps(database, selectedId),
      activeRun: activeRun ? {
        id: activeRun.id,
        guideVersion: Number(activeRun.guideVersion),
        status: "active",
        currentStepNumber: current ? Number(current.step_number) : null,
        startedAtUtc: activeRun.startedAtUtc,
        startedLocalDate: activeRun.startedLocalDate,
        currentLocalDate: activeRun.currentLocalDate,
        timeZone: activeRun.timeZone,
        requiresDailyChoice: activeRun.requiresDailyChoice,
      } : null,
    });
  }

  activeRuns({ limit = 8 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      throw new Error("Active briefing run limit must be an integer from 1 through 20");
    }
    const database = this.store.requireReady();
    const activeRunCondition = `
      started.event_type = 'interaction_guide.run_started'
      AND started.subject_type = 'interaction_guide_run'
      AND json_extract(started.payload_json, '$.interactionGuideId') = guide.interaction_guide_id
      AND NOT EXISTS (
        SELECT 1 FROM activity_events AS terminal
        WHERE terminal.subject_type = 'interaction_guide_run'
          AND terminal.subject_id = started.subject_id
          AND terminal.event_type IN (
            'interaction_guide.run_completed', 'interaction_guide.run_cancelled'
          )
      )
    `;
    const totalCount = Number(database.prepare(`
      SELECT COUNT(*) AS count
      FROM interaction_guides AS guide
      WHERE guide.status = 'active'
        AND EXISTS (
          SELECT 1 FROM activity_events AS started
          WHERE ${activeRunCondition}
        )
    `).get().count);
    const rows = database.prepare(`
      SELECT guide.*
      FROM interaction_guides AS guide
      WHERE guide.status = 'active'
        AND EXISTS (
          SELECT 1 FROM activity_events AS started
          WHERE ${activeRunCondition}
        )
      ORDER BY (
        SELECT MAX(started.event_seq) FROM activity_events AS started
        WHERE ${activeRunCondition}
      ) DESC, guide.interaction_guide_id
      LIMIT ?
    `).all(limit);
    const runs = rows.map((row) => {
      const guideId = Number(row.interaction_guide_id);
      const activeRun = this.#activeRun(database, guideId);
      const current = activeRun ? this.#currentRunStep(database, activeRun.id, guideId) : null;
      return {
        guide: publicGuide(row),
        run: activeRun ? {
          id: activeRun.id,
          interactionGuideId: guideId,
          guideVersion: Number(activeRun.guideVersion),
          status: "active",
          currentStepNumber: current ? Number(current.step_number) : null,
          startedAtUtc: activeRun.startedAtUtc,
          startedLocalDate: activeRun.startedLocalDate,
          currentLocalDate: activeRun.currentLocalDate,
          timeZone: activeRun.timeZone,
          requiresDailyChoice: activeRun.requiresDailyChoice,
        } : null,
        currentStep: publicStep(current),
      };
    }).filter(({ run, currentStep }) => run && currentStep);
    return {
      runs,
      totalCount,
      omittedCount: Math.max(0, totalCount - runs.length),
    };
  }

  addStep({
    guideId, expectedVersion, stepNumber, openingText,
    contract, enabled = true,
  }, context = {}) {
    const useDefaultGuide = guideId == null;
    if (useDefaultGuide && (expectedVersion != null || stepNumber != null)) {
      throw new Error("Default briefing exchange additions require null briefing ID, version, and exchange number");
    }
    const selectedStepNumber = useDefaultGuide
      ? null
      : identifier(stepNumber, "Briefing exchange number");
    if (typeof enabled !== "boolean") throw new Error("Step enabled must be true or false");
    const values = {
      openingText: requiredText(openingText, "Briefing exchange opening", 10_000),
      contract: normalizeInteractionGuideContract(contract),
    };
    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      let defaultGuideCreated = false;
      let guideBefore;
      let assignedStepNumber = selectedStepNumber;
      if (useDefaultGuide) {
        guideBefore = database.prepare(
          "SELECT * FROM interaction_guides WHERE name = ?",
        ).get(defaultInteractionGuideName);
        if (!guideBefore) {
          guideBefore = database.prepare(`
            INSERT INTO interaction_guides (name)
            VALUES (?)
            RETURNING *
          `).get(defaultInteractionGuideName);
          defaultGuideCreated = true;
          const guide = publicGuide(guideBefore);
          this.ledger.append({
            type: "interaction_guide.created", status: "complete",
            ...ledgerActor(context, "interaction_guide_step_add"), turnId: context.requestId,
            operationId: context.callId, name: "Default briefing created",
            content: guide.name, payload: { guide }, subjectType: "interaction_guide",
            subjectId: String(guide.id),
          });
        } else if (guideBefore.status === "archived") {
          const archivedGuide = publicGuide(guideBefore);
          guideBefore = database.prepare(`
            UPDATE interaction_guides
            SET status = 'active',
                updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
            WHERE interaction_guide_id = ?
            RETURNING *
          `).get(guideBefore.interaction_guide_id);
          const guide = publicGuide(guideBefore);
          this.ledger.append({
            type: "interaction_guide.reactivated", status: "complete",
            ...ledgerActor(context, "interaction_guide_step_add"), turnId: context.requestId,
            operationId: context.callId, name: "Default briefing reactivated",
            content: guide.name, payload: { before: archivedGuide, guide },
            subjectType: "interaction_guide", subjectId: String(guide.id),
          });
        }
        if (this.#activeRun(database, Number(guideBefore.interaction_guide_id))) {
          throw conflict("Finish or cancel the active Exchange Inbox briefing before adding another exchange");
        }
        assignedStepNumber = Number(database.prepare(`
          SELECT COALESCE(MAX(step_number), 0) + 1 AS step_number
          FROM interaction_guide_steps
          WHERE interaction_guide_id = ?
        `).get(guideBefore.interaction_guide_id).step_number);
      } else {
        guideBefore = this.#guideForDefinitionEdit(database, guideId, expectedVersion);
      }
      const row = database.prepare(`
        INSERT INTO interaction_guide_steps (
          interaction_guide_id, step_number, opening_text, contract_json, enabled
        ) VALUES (?, ?, ?, ?, ?)
        RETURNING *
      `).get(
        guideBefore.interaction_guide_id, assignedStepNumber, values.openingText,
        values.contract.serialized, enabled ? 1 : 0,
      );
      const guide = publicGuide(this.#bumpGuideVersion(
        database, guideBefore.interaction_guide_id, Number(guideBefore.version),
      ));
      const step = publicStep(row);
      this.ledger.append({
        type: "interaction_guide.step_added", status: "complete",
        ...ledgerActor(context, "interaction_guide_step_add"), turnId: context.requestId,
        operationId: context.callId, name: "Briefing exchange added",
        content: `${guide.name} exchange ${step.stepNumber}`,
        payload: { guide, step }, subjectType: "interaction_guide", subjectId: String(guide.id),
      });
      database.exec("COMMIT");
      return { created: true, defaultGuide: useDefaultGuide, defaultGuideCreated, guide, step };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  reorderSteps({ guideId, expectedVersion, orderedStepIds }, context = {}) {
    const selectedGuideId = identifier(guideId);
    if (!Array.isArray(orderedStepIds) || orderedStepIds.length === 0) {
      throw new Error("Ordered briefing exchange IDs must be a nonempty array");
    }
    const selectedStepIds = orderedStepIds.map((stepId) => identifier(
      stepId,
      "Briefing exchange ID",
    ));
    if (new Set(selectedStepIds).size !== selectedStepIds.length) {
      throw new Error("Ordered briefing exchange IDs cannot contain duplicates");
    }

    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      const guideBefore = this.#guideForDefinitionEdit(
        database, selectedGuideId, expectedVersion,
      );
      const rowsBefore = this.#steps(database, selectedGuideId);
      const existingIds = new Set(rowsBefore.map((row) => Number(row.interaction_guide_step_id)));
      if (
        selectedStepIds.length !== rowsBefore.length
        || selectedStepIds.some((stepId) => !existingIds.has(stepId))
      ) {
        throw new Error("Ordered briefing exchange IDs must contain every exchange in this briefing exactly once");
      }
      const beforeOrder = rowsBefore.map((row) => Number(row.interaction_guide_step_id));
      if (beforeOrder.every((stepId, index) => stepId === selectedStepIds[index])) {
        database.exec("COMMIT");
        return {
          reordered: false,
          guide: publicGuide(guideBefore),
          steps: rowsBefore.map(publicStep),
        };
      }

      const maximumStepNumber = Math.max(...rowsBefore.map((row) => Number(row.step_number)));
      if (!Number.isSafeInteger(maximumStepNumber + rowsBefore.length)) {
        throw new Error("Briefing exchange numbers are too large to reorder safely");
      }
      const moveTemporarily = database.prepare(`
        UPDATE interaction_guide_steps
        SET step_number = ?,
            updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
        WHERE interaction_guide_step_id = ? AND interaction_guide_id = ?
      `);
      selectedStepIds.forEach((stepId, index) => {
        moveTemporarily.run(maximumStepNumber + index + 1, stepId, selectedGuideId);
      });
      const assignFinalNumber = database.prepare(`
        UPDATE interaction_guide_steps
        SET step_number = ?,
            updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
        WHERE interaction_guide_step_id = ? AND interaction_guide_id = ?
      `);
      selectedStepIds.forEach((stepId, index) => {
        assignFinalNumber.run(index + 1, stepId, selectedGuideId);
      });

      const guide = publicGuide(this.#bumpGuideVersion(
        database, selectedGuideId, expectedVersion,
      ));
      const rowsAfter = this.#steps(database, selectedGuideId);
      const steps = rowsAfter.map(publicStep);
      this.ledger.append({
        type: "interaction_guide.steps_reordered", status: "complete",
        ...ledgerActor(context, "interaction_guide_steps_reorder"), turnId: context.requestId,
        operationId: context.callId, name: "Briefing exchanges reordered",
        content: `${guide.name}: ${steps.length} exchanges reordered`,
        payload: {
          guide,
          beforeOrder: rowsBefore.map((row) => ({
            stepId: Number(row.interaction_guide_step_id),
            stepNumber: Number(row.step_number),
          })),
          afterOrder: steps.map((step) => ({ stepId: step.id, stepNumber: step.stepNumber })),
        },
        subjectType: "interaction_guide", subjectId: String(guide.id),
      });
      database.exec("COMMIT");
      return { reordered: true, guide, steps };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  updateStep({
    stepId, expectedVersion, stepNumber, openingText,
    contract, enabled,
    targetGuideId = null, expectedTargetVersion = null,
  }, context = {}) {
    const selectedStepId = identifier(stepId, "Briefing exchange ID");
    const selectedStepNumber = identifier(stepNumber, "Briefing exchange number");
    const selectedTargetGuideId = targetGuideId == null
      ? null
      : identifier(targetGuideId, "Destination briefing ID");
    if (typeof enabled !== "boolean") throw new Error("Step enabled must be true or false");
    const values = {
      openingText: requiredText(openingText, "Briefing exchange opening", 10_000),
      contract: normalizeInteractionGuideContract(contract),
    };
    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      const before = database.prepare(
        "SELECT * FROM interaction_guide_steps WHERE interaction_guide_step_id = ?",
      ).get(selectedStepId);
      if (!before) throw new Error(`Briefing exchange ${selectedStepId} does not exist`);
      const guideBefore = this.#guideForDefinitionEdit(
        database, before.interaction_guide_id, expectedVersion,
      );
      const sourceGuideId = Number(guideBefore.interaction_guide_id);
      const moving = selectedTargetGuideId !== null && selectedTargetGuideId !== sourceGuideId;
      const targetBefore = moving
        ? this.#guideForDefinitionEdit(database, selectedTargetGuideId, expectedTargetVersion)
        : null;
      const destinationStepNumber = moving
        ? Number(database.prepare(`
            SELECT COALESCE(MAX(step_number), 0) + 1 AS step_number
            FROM interaction_guide_steps
            WHERE interaction_guide_id = ?
          `).get(selectedTargetGuideId).step_number)
        : selectedStepNumber;
      const row = database.prepare(`
        UPDATE interaction_guide_steps
        SET interaction_guide_id = ?, step_number = ?, opening_text = ?, contract_json = ?,
            enabled = ?,
            answers_json = CASE WHEN ? THEN '{}' ELSE answers_json END,
            progress_state = CASE WHEN ? THEN 'pending' ELSE progress_state END,
            updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
        WHERE interaction_guide_step_id = ?
        RETURNING *
      `).get(
        moving ? selectedTargetGuideId : sourceGuideId,
        destinationStepNumber, values.openingText, values.contract.serialized,
        enabled ? 1 : 0, moving ? 1 : 0, moving ? 1 : 0, selectedStepId,
      );
      const sourceGuide = publicGuide(this.#bumpGuideVersion(
        database, sourceGuideId, expectedVersion,
      ));
      const targetGuide = moving ? publicGuide(this.#bumpGuideVersion(
        database, targetBefore.interaction_guide_id, expectedTargetVersion,
      )) : null;
      const guide = targetGuide ?? sourceGuide;
      const step = publicStep(row);
      this.ledger.append({
        type: moving ? "interaction_guide.step_moved" : "interaction_guide.step_updated",
        status: "complete",
        ...ledgerActor(context, moving ? "interaction_guide_step_move" : "interaction_guide_step_update"),
        turnId: context.requestId, operationId: context.callId,
        name: moving ? "Briefing exchange updated and moved" : "Briefing exchange updated",
        content: moving
          ? `${sourceGuide.name} → ${targetGuide.name}, exchange ${step.stepNumber}`
          : `${guide.name} exchange ${step.stepNumber}`,
        payload: moving
          ? { before: publicStep(before), sourceGuide, targetGuide, step }
          : { before: publicStep(before), guide, step },
        subjectType: "interaction_guide", subjectId: String(guide.id),
      });
      database.exec("COMMIT");
      return {
        updated: true,
        ...(moving ? { moved: true, sourceGuide, targetGuide } : {}),
        guide,
        step,
      };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  deleteStep({ stepId, expectedVersion }, context = {}) {
    const selectedStepId = identifier(stepId, "Briefing exchange ID");
    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      const before = database.prepare(
        "SELECT * FROM interaction_guide_steps WHERE interaction_guide_step_id = ?",
      ).get(selectedStepId);
      if (!before) throw new Error(`Briefing exchange ${selectedStepId} does not exist`);
      const guideBefore = this.#guideForDefinitionEdit(
        database, before.interaction_guide_id, expectedVersion,
      );
      database.prepare(
        "DELETE FROM interaction_guide_steps WHERE interaction_guide_step_id = ?",
      ).run(selectedStepId);
      const guide = publicGuide(this.#bumpGuideVersion(
        database, guideBefore.interaction_guide_id, expectedVersion,
      ));
      const step = publicStep(before);
      this.ledger.append({
        type: "interaction_guide.step_deleted", status: "complete",
        ...ledgerActor(context, "interaction_guide_step_delete"), turnId: context.requestId,
        operationId: context.callId, name: "Briefing exchange deleted",
        content: `${guide.name} exchange ${step.stepNumber}`,
        payload: { guide, step }, subjectType: "interaction_guide", subjectId: String(guide.id),
      });
      database.exec("COMMIT");
      return { deleted: true, guide, step };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  moveStep({
    stepId, expectedSourceVersion, targetGuideId, expectedTargetVersion,
  }, context = {}) {
    const selectedStepId = identifier(stepId, "Briefing exchange ID");
    const selectedTargetGuideId = identifier(targetGuideId, "Destination briefing ID");
    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      const before = database.prepare(
        "SELECT * FROM interaction_guide_steps WHERE interaction_guide_step_id = ?",
      ).get(selectedStepId);
      if (!before) throw new Error(`Briefing exchange ${selectedStepId} does not exist`);
      const sourceGuideId = Number(before.interaction_guide_id);
      if (sourceGuideId === selectedTargetGuideId) {
        throw conflict("The exchange is already in that briefing");
      }
      const sourceBefore = this.#guideForDefinitionEdit(
        database, sourceGuideId, expectedSourceVersion,
      );
      const targetBefore = this.#guideForDefinitionEdit(
        database, selectedTargetGuideId, expectedTargetVersion,
      );
      const targetStepNumber = Number(database.prepare(`
        SELECT COALESCE(MAX(step_number), 0) + 1 AS step_number
        FROM interaction_guide_steps
        WHERE interaction_guide_id = ?
      `).get(selectedTargetGuideId).step_number);
      const row = database.prepare(`
        UPDATE interaction_guide_steps
        SET interaction_guide_id = ?, step_number = ?, answers_json = '{}',
            progress_state = 'pending',
            updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
        WHERE interaction_guide_step_id = ?
        RETURNING *
      `).get(selectedTargetGuideId, targetStepNumber, selectedStepId);
      const sourceGuide = publicGuide(this.#bumpGuideVersion(
        database, sourceBefore.interaction_guide_id, expectedSourceVersion,
      ));
      const targetGuide = publicGuide(this.#bumpGuideVersion(
        database, targetBefore.interaction_guide_id, expectedTargetVersion,
      ));
      const step = publicStep(row);
      this.ledger.append({
        type: "interaction_guide.step_moved", status: "complete",
        ...ledgerActor(context, "interaction_guide_step_move"), turnId: context.requestId,
        operationId: context.callId, name: "Briefing exchange moved",
        content: `${sourceGuide.name} → ${targetGuide.name}, exchange ${step.stepNumber}`,
        payload: { before: publicStep(before), sourceGuide, targetGuide, step },
        subjectType: "interaction_guide", subjectId: String(targetGuide.id),
      });
      database.exec("COMMIT");
      return { moved: true, sourceGuide, targetGuide, step };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  begin({
    guideId = null, name = null, restart = false, staleRunAction = "ask",
  } = {}, context = {}) {
    if (typeof restart !== "boolean") throw new Error("Restart must be true or false");
    if (!staleRunActions.has(staleRunAction)) {
      throw new Error(`Unknown stale briefing action: ${staleRunAction}`);
    }
    const guide = this.get({ guideId, name });
    if (!guide) throw new Error("Briefing not found");
    if (guide.status !== "active") throw conflict("Archived briefings cannot be started");
    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      const activeRun = this.#activeRun(database, guide.id);
      if (activeRun && !restart) {
        if (Number(activeRun.guideVersion) !== guide.version) {
          throw conflict("The active briefing uses a different version and must be restarted");
        }
        if (activeRun.requiresDailyChoice && staleRunAction === "ask") {
          database.exec("COMMIT");
          return {
            started: false,
            resumed: false,
            choiceRequired: true,
            run: {
              ...activeRun,
              status: "active",
              currentStepNumber: guide.activeRun?.currentStepNumber ?? null,
            },
            guide,
            currentStep: null,
          };
        }
        if (activeRun.requiresDailyChoice && staleRunAction === "resume") {
          this.ledger.append({
            type: "interaction_guide.run_resumed", status: "processing",
            ...ledgerActor(context, "interaction_guide_start"), turnId: context.requestId,
            operationId: context.callId, name: "Earlier briefing resumed",
            content: guide.name,
            payload: {
              interactionGuideId: guide.id,
              startedLocalDate: activeRun.startedLocalDate,
              localDate: activeRun.currentLocalDate,
              timeZone: activeRun.timeZone,
            },
            subjectType: "interaction_guide_run", subjectId: activeRun.id,
          });
          activeRun.requiresDailyChoice = false;
          activeRun.resumeAcknowledgedLocalDate = activeRun.currentLocalDate;
        }
        const current = this.#currentRunStep(database, activeRun.id, guide.id);
        const resumedGuide = guide.activeRun ? {
          ...guide,
          activeRun: {
            ...guide.activeRun,
            currentLocalDate: activeRun.currentLocalDate,
            requiresDailyChoice: activeRun.requiresDailyChoice,
          },
        } : guide;
        database.exec("COMMIT");
        return {
          started: false, resumed: true, choiceRequired: false,
          run: { ...activeRun, status: "active", currentStepNumber: current?.step_number ?? null },
          guide: resumedGuide, currentStep: publicStep(current),
        };
      }
      if (activeRun) {
        this.ledger.append({
          type: "interaction_guide.run_cancelled", status: "cancelled",
          ...ledgerActor(context, "interaction_guide_start"), turnId: context.requestId,
          operationId: context.callId, name: "Briefing restarted",
          content: guide.name, payload: { interactionGuideId: guide.id, reason: "restart" },
          subjectType: "interaction_guide_run", subjectId: activeRun.id,
        });
      }
      const enabledSteps = this.#steps(database, guide.id, { enabledOnly: true });
      if (!enabledSteps.length) throw conflict("This briefing has no enabled exchanges");
      this.#resetRunState(database, guide.id);
      const timing = this.#currentTiming();
      const runId = randomUUID();
      const current = database.prepare(`
        UPDATE interaction_guide_steps
        SET progress_state = 'active',
            updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
        WHERE interaction_guide_step_id = ?
        RETURNING *
      `).get(enabledSteps[0].interaction_guide_step_id);
      const run = {
        id: runId, interactionGuideId: guide.id, guideVersion: guide.version,
        status: "active", currentStepNumber: Number(current.step_number),
        startedAtUtc: timing.now.toISOString(), startedLocalDate: timing.currentLocalDate,
        currentLocalDate: timing.currentLocalDate, timeZone: timing.timeZone,
        resumeAcknowledgedLocalDate: null, requiresDailyChoice: false,
      };
      this.ledger.append({
        type: "interaction_guide.run_started", status: "processing",
        ...ledgerActor(context, "interaction_guide_start"), turnId: context.requestId,
        operationId: context.callId, name: "Briefing started",
        content: guide.name,
        payload: {
          interactionGuideId: guide.id, guideVersion: guide.version,
          startedAtUtc: run.startedAtUtc,
          startedLocalDate: run.startedLocalDate,
          timeZone: run.timeZone,
          stepSnapshot: enabledSteps.map((row, index) => publicStep({
            ...row,
            answers_json: "{}",
            progress_state: index === 0 ? "active" : "pending",
          })),
        },
        subjectType: "interaction_guide_run", subjectId: runId,
      });
      database.exec("COMMIT");
      return {
        started: true, resumed: false, choiceRequired: false, run,
        guide: {
          ...guide,
          steps: guide.steps.map((step) => ({
            ...step,
            answers: {},
            progressState: step.id === Number(current.interaction_guide_step_id) ? "active" : "pending",
          })),
        },
        currentStep: publicStep(current),
      };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  answerStep({
    runId, stepNumber, answers, stepComplete,
    userConfirmedAdvance = false, completionReceiptEventSeqs = [],
  }, context = {}) {
    const selectedRunId = requiredText(runId, "Briefing run ID", 100);
    const selectedStepNumber = identifier(stepNumber, "Briefing exchange number");
    if (typeof stepComplete !== "boolean") throw new Error("Step complete must be true or false");
    if (typeof userConfirmedAdvance !== "boolean") throw new Error("User confirmed advance must be true or false");
    const suppliedAnswers = answersObject(answers).value;
    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      const startedRow = database.prepare(`
        SELECT * FROM activity_events
        WHERE event_type = 'interaction_guide.run_started'
          AND subject_type = 'interaction_guide_run' AND subject_id = ?
        ORDER BY event_seq DESC LIMIT 1
      `).get(selectedRunId);
      if (!startedRow) throw new Error(`Briefing run ${selectedRunId} does not exist`);
      const terminal = database.prepare(`
        SELECT event_type FROM activity_events
        WHERE subject_type = 'interaction_guide_run' AND subject_id = ?
          AND event_type IN ('interaction_guide.run_completed', 'interaction_guide.run_cancelled')
        ORDER BY event_seq DESC LIMIT 1
      `).get(selectedRunId);
      if (terminal) throw conflict("This structured-interaction run is no longer active");
      const started = JSON.parse(startedRow.payload_json);
      const guide = database.prepare(
        "SELECT * FROM interaction_guides WHERE interaction_guide_id = ?",
      ).get(started.interactionGuideId);
      if (!guide || Number(guide.version) !== Number(started.guideVersion)) {
        throw conflict("The briefing definition changed after this run started; restart it before continuing");
      }
      const runTiming = this.#runTiming(database, startedRow, started);
      if (runTiming.requiresDailyChoice) {
        throw conflict(
          `This unfinished briefing began on ${runTiming.startedLocalDate} in ${runTiming.timeZone}. Choose whether to resume it or start over before recording another answer.`,
        );
      }
      const current = this.#currentRunStep(database, selectedRunId, guide.interaction_guide_id);
      if (!current) throw conflict("This structured-interaction run has no remaining enabled step");
      if (Number(current.step_number) !== selectedStepNumber) {
        throw conflict(`The active step is ${current.step_number}, not ${selectedStepNumber}`);
      }
      const beforeAnswers = JSON.parse(current.answers_json);
      const mergedAnswers = { ...beforeAnswers, ...suppliedAnswers };
      const normalizedAnswers = answersObject(mergedAnswers);
      const contract = normalizeInteractionGuideContract(JSON.parse(current.contract_json)).value;
      const completionMode = contract.completion.mode;
      if (stepComplete) {
        const missing = contract.inputs.filter((input) => input.required && !(input.key in mergedAnswers));
        if (missing.length) throw conflict(`Required answers are missing: ${missing.map(({ key }) => key).join(", ")}`);
        for (const input of contract.inputs.filter(({ key }) => key in mergedAnswers)) {
          const value = mergedAnswers[input.key];
          const valid = input.type === "integer"
            ? Number.isSafeInteger(value)
            : input.type === "number"
              ? typeof value === "number" && Number.isFinite(value)
              : typeof value === input.type;
          if (!valid) throw conflict(`Answer ${input.key} must be a ${input.type}`);
        }
      }
      if (stepComplete && completionMode === "response_valid" && contract.inputs.length === 0 && Object.keys(mergedAnswers).length === 0) {
        throw conflict("A response-valid exchange needs at least one recorded answer before completion");
      }
      if (stepComplete && completionMode === "user_advances" && !userConfirmedAdvance) {
        throw conflict("This exchange advances only after the user explicitly says to continue");
      }
      let completionReceipts = [];
      if (stepComplete && completionMode === "tool_receipt") {
        if (!Array.isArray(completionReceiptEventSeqs) || completionReceiptEventSeqs.length === 0
          || completionReceiptEventSeqs.some((eventSeq) => !Number.isSafeInteger(eventSeq) || eventSeq < 1)
          || new Set(completionReceiptEventSeqs).size !== completionReceiptEventSeqs.length) {
          throw conflict("This exchange needs distinct successful tool-result event numbers that prove completion");
        }
        const receiptStatement = database.prepare(`
          SELECT event_seq, event_id, event_type, status, name, turn_id, operation_id
          FROM activity_events
          WHERE event_seq = ? AND event_type = 'tool.result' AND status = 'complete'
            AND (? IS NULL OR turn_id = ?)
        `);
        completionReceipts = completionReceiptEventSeqs.map((eventSeq) => receiptStatement.get(
          eventSeq, context.requestId ?? null, context.requestId ?? null,
        ));
        if (completionReceipts.some((receipt) => !receipt)) {
          throw conflict("A supplied event is not a successful current-request tool receipt");
        }
        if (contract.operations.length) {
          const receiptsWithArguments = completionReceipts.map((receipt) => {
            const call = database.prepare(`
              SELECT payload_json FROM activity_events
              WHERE event_type = 'tool.call' AND operation_id = ? AND name = ?
                AND (? IS NULL OR turn_id = ?)
              ORDER BY event_seq DESC LIMIT 1
            `).get(
              receipt.operation_id, receipt.name,
              context.requestId ?? null, context.requestId ?? null,
            );
            let callPayload = null;
            try { callPayload = call ? JSON.parse(call.payload_json) : null; } catch {}
            return { ...receipt, arguments: callPayload?.arguments ?? null };
          });
          const remainingReceipts = [...receiptsWithArguments];
          const missingOperations = contract.operations.filter((operation) => {
            const index = remainingReceipts.findIndex((receipt) => (
              receipt.name === operation.tool
              && contractArgumentsMatch(operation.arguments, receipt.arguments, mergedAnswers)
            ));
            if (index < 0) return true;
            remainingReceipts.splice(index, 1);
            return false;
          });
          if (missingOperations.length) {
            throw conflict(`Successful matching receipts are missing for contract operations: ${missingOperations.map(({ id }) => id).join(", ")}`);
          }
          completionReceipts = receiptsWithArguments;
        }
      }
      const saved = database.prepare(`
        UPDATE interaction_guide_steps
        SET answers_json = ?, progress_state = ?,
            updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
        WHERE interaction_guide_step_id = ?
        RETURNING *
      `).get(
        normalizedAnswers.serialized,
        stepComplete ? "completed" : "active",
        current.interaction_guide_step_id,
      );
      this.ledger.append({
        type: stepComplete ? "interaction_guide.step_completed" : "interaction_guide.step_progress",
        status: stepComplete ? "complete" : "processing",
        ...ledgerActor(context, "interaction_guide_step_answer"), turnId: context.requestId,
        operationId: context.callId,
        name: stepComplete ? "Briefing exchange completed" : "Briefing answers recorded",
        content: `${guide.name} exchange ${selectedStepNumber}`,
        payload: {
          interactionGuideId: Number(guide.interaction_guide_id), stepNumber: selectedStepNumber,
          answers: mergedAnswers, completionMode,
          completionReceipts,
        },
        subjectType: "interaction_guide_run", subjectId: selectedRunId,
      });
      const nextPending = stepComplete ? database.prepare(`
        SELECT * FROM interaction_guide_steps
        WHERE interaction_guide_id = ? AND enabled = 1 AND progress_state = 'pending'
        ORDER BY step_number, interaction_guide_step_id
        LIMIT 1
      `).get(guide.interaction_guide_id) : null;
      const next = nextPending ? database.prepare(`
        UPDATE interaction_guide_steps
        SET progress_state = 'active',
            updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
        WHERE interaction_guide_step_id = ?
        RETURNING *
      `).get(nextPending.interaction_guide_step_id) : (stepComplete ? null : saved);
      const runCompleted = stepComplete && !next;
      if (runCompleted) {
        this.ledger.append({
          type: "interaction_guide.run_completed", status: "complete",
          ...ledgerActor(context, "interaction_guide_step_answer"), turnId: context.requestId,
          operationId: context.callId, name: "Briefing completed",
          content: guide.name,
          payload: { interactionGuideId: Number(guide.interaction_guide_id), guideVersion: Number(guide.version) },
          subjectType: "interaction_guide_run", subjectId: selectedRunId,
        });
        this.#resetRunState(database, Number(guide.interaction_guide_id));
      }
      database.exec("COMMIT");
      return {
        recorded: true, stepComplete, runCompleted,
        run: {
          id: selectedRunId, interactionGuideId: Number(guide.interaction_guide_id),
          guideVersion: Number(guide.version), status: runCompleted ? "complete" : "active",
          currentStepNumber: next ? Number(next.step_number) : null,
        },
        step: publicStep(saved), currentStep: publicStep(next),
      };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  cancelRun({ runId, reason }, context = {}) {
    const selectedRunId = requiredText(runId, "Briefing run ID", 100);
    const selectedReason = requiredText(reason, "Briefing cancellation reason", 1_000);
    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      const startedRow = database.prepare(`
        SELECT * FROM activity_events
        WHERE event_type = 'interaction_guide.run_started'
          AND subject_type = 'interaction_guide_run' AND subject_id = ?
        ORDER BY event_seq DESC LIMIT 1
      `).get(selectedRunId);
      if (!startedRow) throw new Error(`Briefing run ${selectedRunId} does not exist`);
      const terminal = database.prepare(`
        SELECT event_type FROM activity_events
        WHERE subject_type = 'interaction_guide_run' AND subject_id = ?
          AND event_type IN ('interaction_guide.run_completed', 'interaction_guide.run_cancelled')
        ORDER BY event_seq DESC LIMIT 1
      `).get(selectedRunId);
      if (terminal) throw conflict("This structured-interaction run is already complete or cancelled");
      const started = JSON.parse(startedRow.payload_json);
      const guide = database.prepare(
        "SELECT * FROM interaction_guides WHERE interaction_guide_id = ?",
      ).get(started.interactionGuideId);
      this.ledger.append({
        type: "interaction_guide.run_cancelled", status: "cancelled",
        ...ledgerActor(context, "interaction_guide_run_cancel"), turnId: context.requestId,
        operationId: context.callId, name: "Briefing cancelled",
        content: guide?.name ?? selectedRunId,
        payload: { interactionGuideId: Number(started.interactionGuideId), reason: selectedReason },
        subjectType: "interaction_guide_run", subjectId: selectedRunId,
      });
      this.#resetRunState(database, Number(started.interactionGuideId));
      database.exec("COMMIT");
      return {
        cancelled: true,
        run: {
          id: selectedRunId,
          interactionGuideId: Number(started.interactionGuideId),
          guideVersion: Number(started.guideVersion),
          status: "cancelled",
          currentStepNumber: null,
        },
      };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  create({ name }, context = {}) {
    const selectedName = requiredText(name, "Briefing name", 200);
    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      const existing = database.prepare(
        "SELECT * FROM interaction_guides WHERE name = ?",
      ).get(selectedName);
      if (existing) throw conflict(`A briefing named "${selectedName}" already exists`);
      const row = database.prepare(`
        INSERT INTO interaction_guides (name)
        VALUES (?)
        RETURNING *
      `).get(selectedName);
      const guide = publicGuide(row);
      this.ledger.append({
        type: "interaction_guide.created", status: "complete",
        ...ledgerActor(context, "interaction_guide_create"), turnId: context.requestId,
        operationId: context.callId, name: "Briefing created",
        content: guide.name, payload: { guide }, subjectType: "interaction_guide",
        subjectId: String(guide.id),
      });
      database.exec("COMMIT");
      return { created: true, guide };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  update({ guideId, expectedVersion, name }, context = {}) {
    const selectedId = identifier(guideId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("Expected briefing version must be a positive integer");
    }
    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      const beforeRow = database.prepare(
        "SELECT * FROM interaction_guides WHERE interaction_guide_id = ?",
      ).get(selectedId);
      if (!beforeRow) throw new Error(`Briefing ${selectedId} does not exist`);
      if (Number(beforeRow.version) !== expectedVersion) {
        throw conflict("This briefing changed after it was read. Fetch it again before updating it.");
      }
      if (this.#activeRun(database, selectedId)) {
        throw conflict("Finish or cancel the active structured-interaction run before changing its definition");
      }
      const selectedName = requiredText(name, "Briefing name", 200);
      if (selectedName === beforeRow.name) {
        database.exec("COMMIT");
        return { updated: false, unchanged: true, guide: publicGuide(beforeRow) };
      }
      const duplicate = database.prepare(`
        SELECT interaction_guide_id FROM interaction_guides
        WHERE name = ? AND interaction_guide_id <> ?
      `).get(selectedName, selectedId);
      if (duplicate) throw conflict(`A briefing named "${selectedName}" already exists`);
      const row = database.prepare(`
        UPDATE interaction_guides
        SET name = ?, version = version + 1,
            updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
        WHERE interaction_guide_id = ? AND version = ?
        RETURNING *
      `).get(selectedName, selectedId, expectedVersion);
      if (!row) throw conflict("This briefing changed while it was being updated");
      const before = publicGuide(beforeRow);
      const guide = publicGuide(row);
      this.ledger.append({
        type: "interaction_guide.updated", status: "complete",
        ...ledgerActor(context, "interaction_guide_update"), turnId: context.requestId,
        operationId: context.callId, name: "Briefing updated",
        content: guide.name, payload: { before, guide }, subjectType: "interaction_guide",
        subjectId: String(guide.id),
      });
      database.exec("COMMIT");
      return { updated: true, unchanged: false, guide };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  archive({ guideId, expectedVersion }, context = {}) {
    const selectedId = identifier(guideId);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new Error("Expected briefing version must be a positive integer");
    }
    const database = this.store.requireReady();
    database.exec("START TRANSACTION");
    try {
      const before = database.prepare(
        "SELECT * FROM interaction_guides WHERE interaction_guide_id = ?",
      ).get(selectedId);
      if (!before) throw new Error(`Briefing ${selectedId} does not exist`);
      if (Number(before.version) !== expectedVersion) {
        throw conflict("This briefing changed after it was read. Fetch it again before archiving it.");
      }
      if (this.#activeRun(database, selectedId)) {
        throw conflict("Finish or cancel the active briefing before archiving it");
      }
      if (before.status === "archived") {
        database.exec("COMMIT");
        return { archived: false, alreadyArchived: true, guide: publicGuide(before) };
      }
      const linked = database.prepare(`
        SELECT COUNT(*) AS count FROM todo_routines
        WHERE interaction_guide_id = ? AND disabled_at_utc IS NULL
      `).get(selectedId);
      if (Number(linked.count) > 0) {
        throw conflict("Disable or unlink the active repeating to-dos that use this briefing before archiving it");
      }
      const row = database.prepare(`
        UPDATE interaction_guides
        SET status = 'archived', version = version + 1,
            updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
        WHERE interaction_guide_id = ? AND version = ?
        RETURNING *
      `).get(selectedId, expectedVersion);
      if (!row) throw conflict("This briefing changed while it was being archived");
      const guide = publicGuide(row);
      this.ledger.append({
        type: "interaction_guide.archived", status: "complete",
        ...ledgerActor(context, "interaction_guide_archive"), turnId: context.requestId,
        operationId: context.callId, name: "Briefing archived",
        content: guide.name, payload: { guide }, subjectType: "interaction_guide",
        subjectId: String(guide.id),
      });
      database.exec("COMMIT");
      return { archived: true, alreadyArchived: false, guide };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
