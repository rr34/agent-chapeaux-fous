import { redactText } from "./redaction.mjs";

const requestTypes = ["request.received", "voice.request.received"];
const terminalTypes = [
  "request.complete", "request.error", "agent.turn.end", "agent.turn.error",
  "voice.request.interrupted", "voice.transcription.error",
];
const responseTypes = ["assistant.response", "agent.turn.end"];
const scriptStatuses = new Set(["draft", "archived", "all"]);
const aspectRatios = new Set(["9:16", "16:9", "1:1", "4:5"]);

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function positiveInteger(value, label, { maximum = null } = {}) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`);
  if (maximum !== null && result > maximum) throw new Error(`${label} cannot exceed ${maximum}`);
  return result;
}

function boundedArray(value, label, { minimum = 0, maximum }) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`${label} must contain from ${minimum} through ${maximum} items`);
  }
  return value;
}

function requiredText(value, label, maximum) {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} cannot be empty`);
  if (result.length > maximum) throw new Error(`${label} cannot exceed ${maximum} characters`);
  return result;
}

function optionalText(value, label, maximum) {
  if (value === null || value === undefined) return null;
  return requiredText(value, label, maximum);
}

function requestId(value) {
  const result = String(value ?? "").trim();
  if (!result || result.length > 64 || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new Error(`Invalid source request ID: ${value}`);
  }
  return result;
}

function sourceRequestIds(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 8) {
    throw new Error("Select from 1 through 8 source interactions");
  }
  const ids = values.map(requestId);
  if (new Set(ids).size !== ids.length) throw new Error("Source interaction IDs must be unique");
  return ids;
}

function parseJson(value, fallback = {}) {
  try { return JSON.parse(value || "{}"); } catch { return fallback; }
}

function boundedText(value, maximum) {
  const text = redactText(String(value ?? ""));
  if (text.length <= maximum) return { text, truncated: false, originalCharacters: text.length };
  const marker = "\n[private source text bounded; middle omitted]\n";
  const remaining = maximum - marker.length;
  const beginning = Math.ceil(remaining * 0.58);
  return {
    text: `${text.slice(0, beginning)}${marker}${text.slice(-(remaining - beginning))}`,
    truncated: true,
    originalCharacters: text.length,
  };
}

function markdownList(values, empty = "None specified.") {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : empty;
}

function scriptMarkdown(plan) {
  const lines = [
    `# ${plan.title}`,
    "",
    "## Production brief",
    "",
    `- **Concept:** ${plan.concept}`,
    `- **Audience:** ${plan.audience}`,
    `- **Target duration:** ${plan.durationSeconds} seconds`,
    `- **Aspect ratio:** ${plan.aspectRatio}`,
    `- **Visual style:** ${plan.visualStyle}`,
    "",
    "## Generator prompt",
    "",
    plan.generatorPrompt,
    "",
    "## Scene plan",
  ];
  for (const scene of plan.scenes) {
    lines.push(
      "",
      `### Scene ${scene.sceneNumber} · ${scene.durationSeconds} seconds`,
      "",
      `**Grounded in:** ${scene.sourceRequestIds.map((id) => `request ${id}`).join(", ")}`,
      "",
      `**Visual prompt:** ${scene.visualPrompt}`,
      "",
      `**Voiceover/dialogue:** ${scene.voiceover ?? "None."}`,
      "",
      "**On-screen text:**",
      markdownList(scene.onScreenText),
      "",
      `**Camera and motion:** ${scene.cameraMotion ?? "Not specified."}`,
      "",
      `**Audio:** ${scene.audioNotes ?? "Not specified."}`,
      "",
      `**Transition:** ${scene.transition ?? "Not specified."}`,
    );
  }
  lines.push(
    "",
    "## Continuity requirements",
    "",
    markdownList(plan.continuityNotes),
    "",
    "## Negative constraints",
    "",
    markdownList(plan.negativeConstraints),
  );
  return lines.join("\n");
}

function publicSource(row) {
  return {
    requestId: row.turn_id,
    requestEventId: row.request_event_id,
    order: Number(row.source_order),
    request: row.request_text || "Voice request",
    submittedAtUtc: row.submitted_at_utc,
  };
}

function publicScript(row, sources = []) {
  if (!row) return null;
  return {
    id: Number(row.video_script_id),
    title: row.title,
    status: row.status,
    schemaVersion: Number(row.schema_version),
    plan: parseJson(row.script_json),
    scriptText: row.script_text,
    sources: sources.map(publicSource),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    archivedAtUtc: row.archived_at_utc,
    version: Number(row.version),
  };
}

export class VideoScripts {
  constructor({ store, ledger }) {
    this.store = store;
    this.ledger = ledger;
  }

  #sourceRows(ids) {
    const selected = sourceRequestIds(ids);
    const rows = this.store.requireReady().prepare(`
      SELECT received.event_id AS request_event_id,
             received.event_seq AS request_event_seq,
             received.turn_id,
             received.occurred_at_utc AS submitted_at_utc,
             received.content_text AS request_text,
             received.payload_json
      FROM activity_events AS received
      WHERE received.turn_id IN (${placeholders(selected)})
        AND received.event_type IN (${placeholders(requestTypes)})
      ORDER BY received.event_seq
    `).all(...selected, ...requestTypes);
    const found = new Set(rows.map(({ turn_id: turnId }) => turnId));
    const missing = selected.filter((id) => !found.has(id));
    if (missing.length) throw Object.assign(
      new Error(`Source interactions were not found: ${missing.join(", ")}`),
      { statusCode: 404 },
    );
    const database = this.store.requireReady();
    for (const row of rows) {
      const sourceKind = parseJson(row.payload_json).requestKind ?? null;
      if (["video_script", "interaction_video"].includes(sourceKind)) {
        throw Object.assign(
          new Error(`Interaction ${row.turn_id} is production workflow state, not source material`),
          { statusCode: 409 },
        );
      }
      const terminal = database.prepare(`
        SELECT status FROM activity_events
        WHERE turn_id = ? AND event_type IN (${placeholders(terminalTypes)})
        ORDER BY event_seq DESC LIMIT 1
      `).get(row.turn_id, ...terminalTypes);
      if (!terminal) throw Object.assign(
        new Error(`Wait for source interaction ${row.turn_id} to finish`),
        { statusCode: 409 },
      );
      if (terminal.status !== "complete") throw Object.assign(
        new Error(`Source interaction ${row.turn_id} did not complete successfully`),
        { statusCode: 409 },
      );
    }
    return rows;
  }

  selectionForGenerationRequest(generationRequestId) {
    const row = this.store.requireReady().prepare(`
      SELECT payload_json FROM activity_events
      WHERE turn_id = ? AND event_type IN (${placeholders(requestTypes)})
      ORDER BY event_seq LIMIT 1
    `).get(generationRequestId, ...requestTypes);
    const payload = parseJson(row?.payload_json);
    if (payload.requestKind !== "video_script") {
      throw new Error("This request is not bound to a video-script source selection");
    }
    return this.#sourceRows(payload.sourceRequestIds);
  }

  validateSelection(ids) {
    return this.#sourceRows(ids).map((row) => ({
      requestId: row.turn_id,
      requestEventId: row.request_event_id,
      submittedAtUtc: row.submitted_at_utc,
    }));
  }

  selectedInteractionContext(generationRequestId) {
    const rows = this.selectionForGenerationRequest(generationRequestId);
    const database = this.store.requireReady();
    const perSourceBudget = Math.max(1_200, Math.min(5_000, Math.floor(13_000 / rows.length)));
    const sources = rows.map((row, index) => {
      const events = database.prepare(`
        SELECT event_seq, occurred_at_utc, event_type, status, name, content_text, error_text
        FROM activity_events WHERE turn_id = ? ORDER BY event_seq
      `).all(row.turn_id);
      const transcript = events.find(({ event_type: type }) => (
        type === "transcription.complete" || type === "voice.transcription.end"
      ));
      const response = [...events].reverse().find(({ event_type: type }) => responseTypes.includes(type));
      const terminal = [...events].reverse().find(({ event_type: type }) => terminalTypes.includes(type));
      const request = boundedText(transcript?.content_text || row.request_text || "Voice request", Math.floor(perSourceBudget * 0.4));
      const answer = boundedText(
        response?.content_text || terminal?.content_text || terminal?.error_text || "No assistant response was recorded.",
        Math.floor(perSourceBudget * 0.6),
      );
      const activity = events.filter(({ event_type: type }) => [
        "transcription.complete", "context.prepared", "model.request", "tool.call", "tool.result",
        "assistant.response", "request.error",
      ].includes(type)).slice(0, 12).map((event) => ({
        eventSeq: Number(event.event_seq),
        occurredAtUtc: event.occurred_at_utc,
        type: event.event_type,
        status: event.status,
        name: event.name,
        error: redactText(event.error_text),
      }));
      return {
        sourceOrder: index + 1,
        requestId: row.turn_id,
        requestEventId: row.request_event_id,
        requestEventSeq: Number(row.request_event_seq),
        submittedAtUtc: row.submitted_at_utc,
        request: request.text,
        response: answer.text,
        endedWithError: Boolean(terminal?.error_text || terminal?.status === "error"),
        activity,
        bounds: {
          requestTruncated: request.truncated,
          requestOriginalCharacters: request.originalCharacters,
          responseTruncated: answer.truncated,
          responseOriginalCharacters: answer.originalCharacters,
        },
      };
    });
    return {
      text: [
        "The user explicitly selected the following completed interactions for one portable AI-video script.",
        "Use every selected interaction, preserve their chronology, ground claims in this evidence, omit secrets and unrelated private details, and do not invent outcomes.",
        JSON.stringify(sources, null, 2),
      ].join("\n\n"),
      data: { sources },
      heading: "Selected source interactions for the AI-video script",
    };
  }

  #scriptSources(scriptId) {
    return this.store.requireReady().prepare(`
      SELECT source.request_event_id, source.source_order,
             request.turn_id, request.content_text AS request_text,
             request.occurred_at_utc AS submitted_at_utc
      FROM video_script_sources AS source
      JOIN activity_events AS request ON request.event_id = source.request_event_id
      WHERE source.video_script_id = ?
      ORDER BY source.source_order
    `).all(scriptId);
  }

  get(scriptId) {
    const id = positiveInteger(scriptId, "Video script ID");
    const row = this.store.requireReady().prepare(
      "SELECT * FROM video_scripts WHERE video_script_id = ?",
    ).get(id);
    return publicScript(row, row ? this.#scriptSources(id) : []);
  }

  list({ status = "draft", limit = 200 } = {}) {
    if (!scriptStatuses.has(status)) throw new Error(`Unknown video script status: ${status}`);
    const boundedLimit = positiveInteger(limit, "Video script limit");
    if (boundedLimit > 500) throw new Error("Video script limit cannot exceed 500");
    const rows = this.store.requireReady().prepare(`
      SELECT * FROM video_scripts
      ${status === "all" ? "" : "WHERE status = ?"}
      ORDER BY COALESCE(updated_at_utc, created_at_utc) DESC, video_script_id DESC
      LIMIT ?
    `).all(...(status === "all" ? [boundedLimit] : [status, boundedLimit]));
    const scripts = rows.map((row) => publicScript(row, this.#scriptSources(Number(row.video_script_id))));
    return { status, count: scripts.length, scripts };
  }

  create(input, context = {}) {
    if (!context.requestId || !context.requestEventId) {
      throw new Error("Video script creation requires the bound Agent Slayer request");
    }
    const selectedRows = this.selectionForGenerationRequest(context.requestId);
    const canonicalIds = selectedRows.map(({ turn_id: turnId }) => turnId);
    const suppliedIds = sourceRequestIds(input?.sourceRequestIds);
    if (JSON.stringify(canonicalIds) !== JSON.stringify(suppliedIds)) {
      throw new Error("source_request_ids must exactly match the selected interactions in chronological order");
    }
    const selectedSet = new Set(canonicalIds);
    const scenes = boundedArray(input?.scenes, "Scenes", { minimum: 1, maximum: 40 }).map((scene, index) => {
      const sceneSources = sourceRequestIds(scene.sourceRequestIds);
      if (sceneSources.some((id) => !selectedSet.has(id))) {
        throw new Error(`Scene ${index + 1} references an interaction outside the selected source set`);
      }
      return {
        sceneNumber: positiveInteger(scene.sceneNumber, `Scene ${index + 1} number`, { maximum: 40 }),
        durationSeconds: positiveInteger(scene.durationSeconds, `Scene ${index + 1} duration`, { maximum: 120 }),
        sourceRequestIds: sceneSources,
        visualPrompt: requiredText(scene.visualPrompt, `Scene ${index + 1} visual prompt`, 5_000),
        voiceover: optionalText(scene.voiceover, `Scene ${index + 1} voiceover`, 3_000),
        onScreenText: boundedArray(scene.onScreenText, `Scene ${index + 1} on-screen text`, { maximum: 10 })
          .map((value) => requiredText(value, `Scene ${index + 1} on-screen text`, 500)),
        cameraMotion: optionalText(scene.cameraMotion, `Scene ${index + 1} camera motion`, 1_000),
        audioNotes: optionalText(scene.audioNotes, `Scene ${index + 1} audio notes`, 1_000),
        transition: optionalText(scene.transition, `Scene ${index + 1} transition`, 1_000),
      };
    });
    if (scenes.some(({ sceneNumber }, index) => sceneNumber !== index + 1)) {
      throw new Error("Scene numbers must be consecutive and match scene order");
    }
    const durationSeconds = positiveInteger(input.durationSeconds, "Target duration", { maximum: 600 });
    if (scenes.reduce((total, scene) => total + scene.durationSeconds, 0) !== durationSeconds) {
      throw new Error("Target duration must equal the sum of all scene durations");
    }
    const usedSourceIds = new Set(scenes.flatMap(({ sourceRequestIds: ids }) => ids));
    if (canonicalIds.some((id) => !usedSourceIds.has(id))) {
      throw new Error("Every selected interaction must ground at least one scene");
    }
    if (!aspectRatios.has(input.aspectRatio)) throw new Error(`Unknown aspect ratio: ${input.aspectRatio}`);
    const plan = {
      schemaVersion: 1,
      title: requiredText(input.title, "Video script title", 200),
      concept: requiredText(input.concept, "Video concept", 3_000),
      audience: requiredText(input.audience, "Video audience", 1_000),
      durationSeconds,
      aspectRatio: input.aspectRatio,
      visualStyle: requiredText(input.visualStyle, "Visual style", 3_000),
      sourceRequestIds: canonicalIds,
      generatorPrompt: requiredText(input.generatorPrompt, "Generator prompt", 20_000),
      scenes,
      continuityNotes: boundedArray(input.continuityNotes, "Continuity notes", { maximum: 30 })
        .map((value) => requiredText(value, "Continuity note", 2_000)),
      negativeConstraints: boundedArray(input.negativeConstraints, "Negative constraints", { minimum: 1, maximum: 30 })
        .map((value) => requiredText(value, "Negative constraint", 2_000)),
    };
    const scriptText = scriptMarkdown(plan);
    const serialized = JSON.stringify(plan);
    if (serialized.length > 500_000 || scriptText.length > 500_000) {
      throw new Error("The generated video script exceeds the storage limit");
    }
    const database = this.store.requireReady();
    const existing = database.prepare(
      "SELECT video_script_id FROM video_scripts WHERE created_by_event_id = ?",
    ).get(context.requestEventId);
    if (existing) return { created: false, unchanged: true, script: this.get(existing.video_script_id) };
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = database.prepare(`
        INSERT INTO video_scripts (
          title, status, schema_version, script_json, script_text, created_by_event_id
        ) VALUES (?, 'draft', 1, ?, ?, ?)
      `).run(plan.title, serialized, scriptText, context.requestEventId);
      const scriptId = Number(result.lastInsertRowid);
      const insertSource = database.prepare(`
        INSERT INTO video_script_sources (video_script_id, request_event_id, source_order)
        VALUES (?, ?, ?)
      `);
      selectedRows.forEach((row, index) => insertSource.run(scriptId, row.request_event_id, index + 1));
      const script = this.get(scriptId);
      this.ledger.append({
        type: "video_script.created", status: "complete", actorType: "tool",
        actorName: "video_script_create", channel: context.channel,
        turnId: context.requestId, operationId: context.callId,
        name: "AI-video script created", content: plan.title,
        payload: { videoScriptId: scriptId, sourceRequestIds: canonicalIds, schemaVersion: 1 },
        subjectType: "video_script", subjectId: String(scriptId),
      });
      database.exec("COMMIT");
      return { created: true, unchanged: false, script };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  archive(scriptId, expectedVersion, context = {}) {
    const id = positiveInteger(scriptId, "Video script ID");
    const version = positiveInteger(expectedVersion, "Expected video script version");
    const database = this.store.requireReady();
    const current = this.get(id);
    if (!current) throw Object.assign(new Error("Video script not found"), { statusCode: 404 });
    if (current.status === "archived") return { archived: false, alreadyArchived: true, script: current };
    const now = new Date().toISOString();
    database.exec("BEGIN IMMEDIATE");
    try {
      const row = database.prepare(`
        UPDATE video_scripts
        SET status = 'archived', archived_at_utc = ?, updated_at_utc = ?, version = version + 1
        WHERE video_script_id = ? AND version = ?
        RETURNING video_script_id
      `).get(now, now, id, version);
      if (!row) throw Object.assign(
        new Error("This video script changed after it was read. Refresh and try again."),
        { statusCode: 409 },
      );
      this.ledger.append({
        type: "video_script.archived", status: "complete",
        actorType: context.actorType ?? "user", actorName: context.actorName ?? "web",
        channel: context.channel ?? "web", turnId: context.requestId ?? null,
        name: "AI-video script archived", content: current.title,
        payload: { videoScriptId: id }, subjectType: "video_script", subjectId: String(id),
      });
      database.exec("COMMIT");
      return { archived: true, alreadyArchived: false, script: this.get(id) };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
