const nullableString = { type: ["string", "null"] };

function requiredText(value, label, maximumLength) {
  const selected = String(value ?? "").trim();
  if (!selected) throw new Error(`${label} cannot be empty`);
  if (selected.length > maximumLength) throw new Error(`${label} cannot exceed ${maximumLength} characters`);
  return selected;
}

function optionalUnit(value) {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, "Unit", 100);
}

function normalizedInstant(value, { useNow = false, label = "Timestamp" } = {}) {
  if (value === null || value === undefined || value === "") {
    if (useNow) return new Date().toISOString();
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date and time`);
  return date.toISOString();
}

function publicTracker(row) {
  if (!row) return null;
  return {
    id: Number(row.tracker_id),
    groupId: Number(row.log_group_id),
    groupName: row.group_name,
    name: row.name,
    defaultUnit: row.default_unit,
    archivedAtUtc: row.archived_at_utc,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    ...(row.entry_count === undefined ? {} : { entryCount: Number(row.entry_count) }),
    ...(row.last_logged_at_utc === undefined ? {} : { lastLoggedAtUtc: row.last_logged_at_utc }),
  };
}

function publicEntry(row) {
  if (!row) return null;
  return {
    id: Number(row.log_entry_id),
    trackerId: Number(row.tracker_id),
    trackerName: row.tracker_name,
    groupId: Number(row.log_group_id),
    groupName: row.group_name,
    occurredAtUtc: row.occurred_at_utc,
    content: row.content_text,
    number: row.number_value === null ? null : Number(row.number_value),
    unit: row.unit,
    source: row.source,
    externalId: row.external_id,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function joinedTracker(database, trackerId) {
  return database.prepare(`
    SELECT tracker.*, log_group.name AS group_name,
           log_group.archived_at_utc AS group_archived_at_utc
    FROM trackers AS tracker
    JOIN log_groups AS log_group USING (log_group_id)
    WHERE tracker.tracker_id = ?
  `).get(trackerId);
}

function findTracker(database, name) {
  return database.prepare(`
    SELECT tracker.*, log_group.name AS group_name,
           log_group.archived_at_utc AS group_archived_at_utc
    FROM trackers AS tracker
    JOIN log_groups AS log_group USING (log_group_id)
    WHERE tracker.name = ? COLLATE NOCASE
  `).get(name);
}

function ensureGroup(database, name, now) {
  const existing = database.prepare(`
    SELECT * FROM log_groups WHERE name = ? COLLATE NOCASE
  `).get(name);
  if (!existing) {
    return {
      row: database.prepare(`
        INSERT INTO log_groups (name, updated_at_utc) VALUES (?, ?) RETURNING *
      `).get(name, now),
      created: true,
      reactivated: false,
    };
  }
  if (existing.archived_at_utc === null) {
    return { row: existing, created: false, reactivated: false };
  }
  return {
    row: database.prepare(`
      UPDATE log_groups
      SET archived_at_utc = NULL, updated_at_utc = ?
      WHERE log_group_id = ?
      RETURNING *
    `).get(now, existing.log_group_id),
    created: false,
    reactivated: true,
  };
}

function normalizedLogInput(argumentsObject, { requireOccurredAt = false } = {}) {
  const trackerName = requiredText(argumentsObject.tracker, "Tracker name", 200);
  const requestedGroupWasNull = argumentsObject.group === null;
  const requestedGroup = requestedGroupWasNull
    ? "General"
    : requiredText(argumentsObject.group, "Log group name", 200);
  const content = requiredText(argumentsObject.content, "Log content", 10000);
  const number = argumentsObject.number;
  if (number !== null && (typeof number !== "number" || !Number.isFinite(number))) {
    throw new Error("Log number must be a finite number or null");
  }
  const suppliedUnit = optionalUnit(argumentsObject.unit);
  if (suppliedUnit !== null && number === null) throw new Error("A log unit requires a numeric value");
  if (requireOccurredAt && (argumentsObject.occurredAtUtc === null
    || argumentsObject.occurredAtUtc === undefined
    || argumentsObject.occurredAtUtc === "")) {
    throw new Error("Imported logs require an occurrence time");
  }
  const occurredAtUtc = normalizedInstant(argumentsObject.occurredAtUtc, {
    useNow: !requireOccurredAt,
    label: "Log occurrence time",
  });
  return {
    trackerName,
    requestedGroup,
    requestedGroupWasNull,
    content,
    number,
    suppliedUnit,
    occurredAtUtc,
  };
}

function normalizedExternalId(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("External log IDs supplied as numbers must be safe integers");
  }
  if (!["string", "number"].includes(typeof value)) {
    throw new Error("External log ID must be a string or integer");
  }
  return requiredText(value, "External log ID", 1000);
}

function resolveTracker(database, input, now) {
  let tracker = findTracker(database, input.trackerName);
  let trackerCreated = false;
  let trackerReactivated = false;
  let groupResolution;
  if (!tracker) {
    const selectedGroup = ensureGroup(database, input.requestedGroup, now);
    const row = database.prepare(`
      INSERT INTO trackers (log_group_id, name, default_unit, updated_at_utc)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `).get(selectedGroup.row.log_group_id, input.trackerName, input.suppliedUnit, now);
    tracker = {
      ...row,
      group_name: selectedGroup.row.name,
      group_archived_at_utc: selectedGroup.row.archived_at_utc,
    };
    trackerCreated = true;
    groupResolution = {
      requestedGroup: input.requestedGroup,
      actualGroup: selectedGroup.row.name,
      groupCreated: selectedGroup.created,
      groupReactivated: selectedGroup.reactivated,
    };
  } else {
    const groupReactivated = tracker.group_archived_at_utc !== null;
    const updates = [];
    const values = [];
    if (tracker.archived_at_utc !== null) {
      updates.push("archived_at_utc = NULL");
      trackerReactivated = true;
    }
    if (tracker.default_unit === null && input.suppliedUnit !== null) {
      updates.push("default_unit = ?");
      values.push(input.suppliedUnit);
    }
    if (updates.length) {
      updates.push("updated_at_utc = ?");
      values.push(now, tracker.tracker_id);
      database.prepare(`
        UPDATE trackers SET ${updates.join(", ")} WHERE tracker_id = ?
      `).run(...values);
    }
    if (tracker.group_archived_at_utc !== null) {
      database.prepare(`
        UPDATE log_groups
        SET archived_at_utc = NULL, updated_at_utc = ?
        WHERE log_group_id = ?
      `).run(now, tracker.log_group_id);
    }
    tracker = joinedTracker(database, tracker.tracker_id);
    groupResolution = {
      requestedGroup: input.requestedGroupWasNull ? null : input.requestedGroup,
      actualGroup: tracker.group_name,
      groupCreated: false,
      groupReactivated,
    };
  }
  return { tracker, trackerCreated, trackerReactivated, groupResolution };
}

function insertEntry(database, input, tracker, {
  source = "agent-slayer",
  externalId = null,
  requestEventId = null,
  now,
} = {}) {
  const effectiveUnit = input.number === null
    ? null
    : input.suppliedUnit ?? tracker.default_unit;
  const row = database.prepare(`
    INSERT INTO log_entries (
      tracker_id, occurred_at_utc, content_text, number_value, unit,
      source_event_id, updated_at_utc, source, external_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    tracker.tracker_id,
    input.occurredAtUtc,
    input.content,
    input.number,
    effectiveUnit,
    requestEventId,
    now,
    source,
    externalId,
  );
  return publicEntry({
    ...row,
    tracker_name: tracker.name,
    log_group_id: tracker.log_group_id,
    group_name: tracker.group_name,
  });
}

function existingImportedEntry(database, source, externalId) {
  return database.prepare(`
    SELECT entry.*, tracker.name AS tracker_name, tracker.log_group_id,
           log_group.name AS group_name
    FROM log_entries AS entry
    JOIN trackers AS tracker USING (tracker_id)
    JOIN log_groups AS log_group USING (log_group_id)
    WHERE entry.source = ? AND entry.external_id = ?
  `).get(source, externalId);
}

function sameImportedEntry(row, input) {
  const effectiveRequestedUnit = input.number === null ? null : input.suppliedUnit;
  return row.tracker_name.toLowerCase() === input.trackerName.toLowerCase()
    && row.occurred_at_utc === input.occurredAtUtc
    && row.content_text === input.content
    && (row.number_value === null ? null : Number(row.number_value)) === input.number
    && (effectiveRequestedUnit === null || row.unit === effectiveRequestedUnit);
}

export function registerLogTools(registry, store, ledger) {
  registry.register({
    name: "log_add",
    description: "Record one entry in the user's authoritative personal log. The content must remain a complete human-readable entry; number and unit are optional queryable projections, not replacements for that text. Reuse a tracker by case-insensitive name. On first use, create the tracker and its requested group atomically; use General when group is null. A supplied group never silently moves an existing tracker.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tracker: { type: "string", minLength: 1, maxLength: 200 },
        group: nullableString,
        content: { type: "string", minLength: 1, maxLength: 10000 },
        number: { type: ["number", "null"] },
        unit: { ...nullableString, maxLength: 100 },
        occurredAtUtc: nullableString,
      },
      required: ["tracker", "group", "content", "number", "unit", "occurredAtUtc"],
    },
    async execute(argumentsObject, context) {
      const input = normalizedLogInput(argumentsObject);
      const database = store.requireReady();
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const trackerResult = resolveTracker(database, input, now);
        const entry = insertEntry(database, input, trackerResult.tracker, {
          requestEventId: context.requestEventId || null,
          now,
        });
        const result = {
          created: true,
          trackerCreated: trackerResult.trackerCreated,
          trackerReactivated: trackerResult.trackerReactivated,
          groupResolution: trackerResult.groupResolution,
          tracker: publicTracker(trackerResult.tracker),
          entry,
        };
        ledger.append({
          type: "personal_log.created", status: "complete", actorType: "tool", actorName: "log_add",
          turnId: context.requestId, operationId: context.callId, name: "Personal log recorded",
          content: entry.content, payload: result,
          subjectType: "log_entry", subjectId: String(entry.id),
        });
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "log_import",
    description: "Import a bounded batch of 1 through 100 personal-log entries from any external source. Each entry requires an occurrence time and a stable externalId supplied by the source or deterministically derived when the source has none. The pair of source and externalId is idempotent: exact replays are reported unchanged, while conflicting replays are reported and never overwrite the existing entry. New entries and any required groups or trackers are created in one transaction.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: { type: "string", minLength: 1, maxLength: 200 },
        entries: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              externalId: { type: ["string", "integer"], maxLength: 1000 },
              tracker: { type: "string", minLength: 1, maxLength: 200 },
              group: nullableString,
              content: { type: "string", minLength: 1, maxLength: 10000 },
              number: { type: ["number", "null"] },
              unit: { ...nullableString, maxLength: 100 },
              occurredAtUtc: { type: "string" },
            },
            required: [
              "externalId",
              "tracker",
              "group",
              "content",
              "number",
              "unit",
              "occurredAtUtc",
            ],
          },
        },
      },
      required: ["source", "entries"],
    },
    async execute({ source, entries }, context) {
      const selectedSource = requiredText(source, "Import source", 200);
      if (!Array.isArray(entries) || entries.length < 1 || entries.length > 100) {
        throw new Error("Log imports require between 1 and 100 entries");
      }
      const seenExternalIds = new Set();
      const inputs = entries.map((entry) => {
        const externalId = normalizedExternalId(entry.externalId);
        if (seenExternalIds.has(externalId)) {
          throw new Error(`Duplicate external log ID in import batch: ${externalId}`);
        }
        seenExternalIds.add(externalId);
        return {
          externalId,
          log: normalizedLogInput(entry, { requireOccurredAt: true }),
        };
      });
      const database = store.requireReady();
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const items = [];
        for (const input of inputs) {
          const existingRow = existingImportedEntry(database, selectedSource, input.externalId);
          if (existingRow) {
            const unchanged = sameImportedEntry(existingRow, input.log);
            items.push({
              status: unchanged ? "unchanged" : "conflict",
              externalId: input.externalId,
              entry: publicEntry(existingRow),
              ...(unchanged ? {} : {
                reason: "The source and external ID already identify a different stored log entry",
              }),
            });
            continue;
          }
          const trackerResult = resolveTracker(database, input.log, now);
          const entry = insertEntry(database, input.log, trackerResult.tracker, {
            source: selectedSource,
            externalId: input.externalId,
            requestEventId: context.requestEventId || null,
            now,
          });
          items.push({
            status: "imported",
            externalId: input.externalId,
            trackerCreated: trackerResult.trackerCreated,
            groupResolution: trackerResult.groupResolution,
            entry,
          });
        }
        const importedCount = items.filter((item) => item.status === "imported").length;
        const unchangedCount = items.filter((item) => item.status === "unchanged").length;
        const conflictCount = items.filter((item) => item.status === "conflict").length;
        const result = {
          source: selectedSource,
          total: items.length,
          importedCount,
          unchangedCount,
          conflictCount,
          items,
        };
        ledger.append({
          type: "personal_logs.imported", status: "complete", actorType: "tool",
          actorName: "log_import", turnId: context.requestId, operationId: context.callId,
          name: "Personal log import processed",
          content: `${importedCount} imported, ${unchangedCount} unchanged, ${conflictCount} conflicting from ${selectedSource}`,
          payload: {
            source: selectedSource,
            total: items.length,
            importedCount,
            unchangedCount,
            conflictCount,
          },
          subjectType: "log_import", subjectId: selectedSource,
        });
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "log_list",
    description: "List recent entries from the user's authoritative personal log, optionally filtered by tracker, group, provenance source, or inclusive UTC occurrence-time bounds.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tracker: nullableString,
        group: nullableString,
        source: nullableString,
        fromUtc: nullableString,
        throughUtc: nullableString,
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["tracker", "group", "source", "fromUtc", "throughUtc", "limit"],
    },
    async execute({ tracker, group, source, fromUtc, throughUtc, limit }) {
      const conditions = [];
      const values = [];
      if (tracker !== null) {
        conditions.push("tracker.name = ? COLLATE NOCASE");
        values.push(requiredText(tracker, "Tracker name", 200));
      }
      if (group !== null) {
        conditions.push("log_group.name = ? COLLATE NOCASE");
        values.push(requiredText(group, "Log group name", 200));
      }
      if (source !== null) {
        conditions.push("entry.source = ?");
        values.push(requiredText(source, "Log source", 200));
      }
      const selectedFrom = normalizedInstant(fromUtc, { label: "Log range start" });
      const selectedThrough = normalizedInstant(throughUtc, { label: "Log range end" });
      if (selectedFrom) {
        conditions.push("entry.occurred_at_utc >= ?");
        values.push(selectedFrom);
      }
      if (selectedThrough) {
        conditions.push("entry.occurred_at_utc <= ?");
        values.push(selectedThrough);
      }
      const boundedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
      const rows = store.requireReady().prepare(`
        SELECT entry.*, tracker.name AS tracker_name, tracker.log_group_id,
               log_group.name AS group_name
        FROM log_entries AS entry
        JOIN trackers AS tracker USING (tracker_id)
        JOIN log_groups AS log_group USING (log_group_id)
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY entry.occurred_at_utc DESC, entry.log_entry_id DESC
        LIMIT ?
      `).all(...values, boundedLimit).map(publicEntry);
      return { count: rows.length, entries: rows };
    },
  });

  registry.register({
    name: "tracker_list",
    description: "List personal-log trackers with their groups, default units, entry counts, and most recent occurrence times.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        group: nullableString,
        includeArchived: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["group", "includeArchived", "limit"],
    },
    async execute({ group, includeArchived, limit }) {
      const conditions = [];
      const values = [];
      if (!includeArchived) {
        conditions.push("tracker.archived_at_utc IS NULL");
        conditions.push("log_group.archived_at_utc IS NULL");
      }
      if (group !== null) {
        conditions.push("log_group.name = ? COLLATE NOCASE");
        values.push(requiredText(group, "Log group name", 200));
      }
      const boundedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
      const rows = store.requireReady().prepare(`
        SELECT tracker.*, log_group.name AS group_name,
               COUNT(entry.log_entry_id) AS entry_count,
               MAX(entry.occurred_at_utc) AS last_logged_at_utc
        FROM trackers AS tracker
        JOIN log_groups AS log_group USING (log_group_id)
        LEFT JOIN log_entries AS entry USING (tracker_id)
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        GROUP BY tracker.tracker_id
        ORDER BY log_group.name COLLATE NOCASE, tracker.name COLLATE NOCASE
        LIMIT ?
      `).all(...values, boundedLimit).map(publicTracker);
      return { count: rows.length, trackers: rows };
    },
  });

  registry.register({
    name: "tracker_update",
    description: "Update one personal-log tracker by ID. Rename it, move it to a group (creating or reactivating that group), change or clear its default unit, or archive/reactivate it. Null leaves each field unchanged; an empty defaultUnit clears it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        trackerId: { type: "integer", minimum: 1 },
        name: nullableString,
        group: nullableString,
        defaultUnit: nullableString,
        archived: { type: ["boolean", "null"] },
      },
      required: ["trackerId", "name", "group", "defaultUnit", "archived"],
    },
    async execute({ trackerId, name, group, defaultUnit, archived }, context) {
      const database = store.requireReady();
      const beforeRow = joinedTracker(database, trackerId);
      if (!beforeRow) throw new Error(`Tracker ${trackerId} does not exist`);
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const values = {};
        if (name !== null) values.name = requiredText(name, "Tracker name", 200);
        if (group !== null) {
          const selectedGroup = ensureGroup(database, requiredText(group, "Log group name", 200), now);
          values.log_group_id = selectedGroup.row.log_group_id;
        } else if (archived === false && beforeRow.group_archived_at_utc !== null) {
          database.prepare(`
            UPDATE log_groups
            SET archived_at_utc = NULL, updated_at_utc = ?
            WHERE log_group_id = ?
          `).run(now, beforeRow.log_group_id);
        }
        if (defaultUnit !== null) values.default_unit = optionalUnit(defaultUnit);
        if (archived !== null) values.archived_at_utc = archived ? now : null;
        if (Object.keys(values).length === 0) throw new Error("No tracker changes were supplied");
        values.updated_at_utc = now;
        const assignments = Object.keys(values).map((column) => `"${column}" = ?`).join(", ");
        database.prepare(`UPDATE trackers SET ${assignments} WHERE tracker_id = ?`)
          .run(...Object.values(values), trackerId);
        const tracker = publicTracker(joinedTracker(database, trackerId));
        const result = { updated: true, before: publicTracker(beforeRow), tracker };
        ledger.append({
          type: "personal_tracker.updated", status: "complete", actorType: "tool",
          actorName: "tracker_update", turnId: context.requestId, operationId: context.callId,
          name: "Personal tracker updated", content: tracker.name, payload: result,
          subjectType: "tracker", subjectId: String(tracker.id),
        });
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });
}
