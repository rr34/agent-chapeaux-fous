import { selectedFields, withSchemaProjection } from "./schema-result.mjs";

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

const logGroupFields = ["log_group_id", "name", "archived_at_utc"];
const trackerFields = [
  "tracker_id", "log_group_id", "name", "default_unit", "archived_at_utc", "created_at_utc", "updated_at_utc",
];
const logEntryFields = [
  "log_entry_id", "tracker_id", "occurred_at_utc", "content_text", "number_value", "unit",
  "source_event_id", "created_at_utc", "updated_at_utc", "source", "external_id",
];
const logProjection = {
  schemaObjects: ["log_entries", "trackers", "log_groups"],
  fields: {
    log_entries: logEntryFields,
    trackers: trackerFields,
    log_groups: logGroupFields,
  },
};
const logEntryProjection = {
  schemaObjects: ["log_entries", "trackers", "log_groups"],
  fields: {
    log_entries: logEntryFields,
    trackers: ["tracker_id", "log_group_id", "name"],
    log_groups: ["log_group_id", "name"],
  },
};
const trackerProjection = {
  schemaObjects: ["trackers", "log_groups", "log_entries"],
  fields: {
    trackers: trackerFields,
    log_groups: logGroupFields,
    log_entries: ["log_entry_id", "tracker_id", "occurred_at_utc"],
  },
};

function databaseTracker(row) {
  if (!row) return null;
  return {
    ...selectedFields(row, trackerFields),
    log_groups: {
      log_group_id: row.log_group_id,
      name: row.group_name ?? null,
      archived_at_utc: row.group_archived_at_utc ?? null,
    },
    ...(row.entry_count === undefined ? {} : { entry_count: Number(row.entry_count) }),
    ...(row.last_logged_at_utc === undefined ? {} : { last_logged_at_utc: row.last_logged_at_utc }),
  };
}

function databaseEntry(row) {
  if (!row) return null;
  return {
    ...selectedFields(row, logEntryFields),
    trackers: {
      tracker_id: row.tracker_id,
      log_group_id: row.log_group_id ?? null,
      name: row.tracker_name ?? null,
    },
    log_groups: {
      log_group_id: row.log_group_id ?? null,
      name: row.group_name ?? null,
    },
  };
}

function logResult(schemaSemantics, context, result, {
  name, purpose, trackersOnly = false, entriesOnly = false,
}) {
  return withSchemaProjection(schemaSemantics, context, result, {
    name,
    purpose,
    ...(trackersOnly ? trackerProjection : entriesOnly ? logEntryProjection : logProjection),
  });
}

export function logCapabilityContext(store, limit = 200) {
  const trackers = !store?.status?.ready ? [] : store.requireReady().prepare(`
    SELECT tracker.tracker_id, tracker.name, tracker.default_unit,
           log_group.name AS group_name,
           COUNT(entry.log_entry_id) AS entry_count,
           MAX(entry.occurred_at_utc) AS last_logged_at_utc
    FROM trackers AS tracker
    JOIN log_groups AS log_group USING (log_group_id)
    LEFT JOIN log_entries AS entry USING (tracker_id)
    WHERE tracker.archived_at_utc IS NULL
      AND log_group.archived_at_utc IS NULL
    GROUP BY tracker.tracker_id
    ORDER BY tracker.name COLLATE NOCASE
    LIMIT ?
  `).all(limit).map((row) => ({
    trackerId: Number(row.tracker_id),
    name: row.name,
    group: row.group_name,
    defaultUnit: row.default_unit,
    entryCount: Number(row.entry_count),
    lastLoggedAtUtc: row.last_logged_at_utc,
  }));
  const rows = trackers.length
    ? trackers.map((tracker) => [
        `- [tracker ${tracker.trackerId}] name: ${tracker.name}`,
        `group: ${tracker.group}`,
        `entries: ${tracker.entryCount}`,
        `default_unit: ${tracker.defaultUnit ?? "none"}`,
      ].join(" | ")).join("\n")
    : "No active personal-log trackers exist.";
  return {
    heading: "Active personal-log trackers",
    text: [
      "These names are authoritative. Reuse the most plausible existing tracker verbatim when the user's wording is synonymous; do not create a paraphrased duplicate.",
      rows,
    ].join("\n"),
    data: { trackers },
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

function joinedEntry(database, entryId) {
  return database.prepare(`
    SELECT entry.*, tracker.name AS tracker_name, tracker.log_group_id,
           log_group.name AS group_name
    FROM log_entries AS entry
    JOIN trackers AS tracker USING (tracker_id)
    JOIN log_groups AS log_group USING (log_group_id)
    WHERE entry.log_entry_id = ?
  `).get(entryId);
}

const trackerAliasFamilies = new Map([
  ["poop", "bowel_elimination"],
  ["poops", "bowel_elimination"],
  ["pooping", "bowel_elimination"],
  ["bowel movement", "bowel_elimination"],
  ["bowel movements", "bowel_elimination"],
  ["bm", "bowel_elimination"],
  ["bms", "bowel_elimination"],
  ["defecation", "bowel_elimination"],
  ["stool", "bowel_elimination"],
]);

function normalizedTrackerPhrase(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trackerAliasFamily(value) {
  return trackerAliasFamilies.get(normalizedTrackerPhrase(value)) ?? null;
}

function aliasTracker(database, name) {
  const family = trackerAliasFamily(name);
  if (!family) return null;
  const rows = database.prepare(`
    SELECT tracker.*, log_group.name AS group_name,
           log_group.archived_at_utc AS group_archived_at_utc,
           COUNT(entry.log_entry_id) AS entry_count
    FROM trackers AS tracker
    JOIN log_groups AS log_group USING (log_group_id)
    LEFT JOIN log_entries AS entry USING (tracker_id)
    GROUP BY tracker.tracker_id
  `).all().filter((row) => trackerAliasFamily(row.name) === family);
  rows.sort((left, right) => {
    const leftActive = left.archived_at_utc === null && left.group_archived_at_utc === null ? 1 : 0;
    const rightActive = right.archived_at_utc === null && right.group_archived_at_utc === null ? 1 : 0;
    if (leftActive !== rightActive) return rightActive - leftActive;
    const entryDifference = Number(right.entry_count) - Number(left.entry_count);
    if (entryDifference) return entryDifference;
    const ageDifference = Number(left.tracker_id) - Number(right.tracker_id);
    if (ageDifference) return ageDifference;
    const leftExact = normalizedTrackerPhrase(left.name) === normalizedTrackerPhrase(name) ? 1 : 0;
    const rightExact = normalizedTrackerPhrase(right.name) === normalizedTrackerPhrase(name) ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;
    return 0;
  });
  return rows[0] ?? null;
}

function findTracker(database, name) {
  const alias = aliasTracker(database, name);
  if (alias) {
    return {
      row: alias,
      matchType: normalizedTrackerPhrase(alias.name) === normalizedTrackerPhrase(name) ? "exact" : "alias",
    };
  }
  const exact = database.prepare(`
    SELECT tracker.*, log_group.name AS group_name,
           log_group.archived_at_utc AS group_archived_at_utc
    FROM trackers AS tracker
    JOIN log_groups AS log_group USING (log_group_id)
    WHERE tracker.name = ? COLLATE NOCASE
  `).get(name);
  return exact ? { row: exact, matchType: "exact" } : { row: null, matchType: "none" };
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
  const content = requiredText(argumentsObject.content_text, "Log content", 10000);
  const number = argumentsObject.number_value;
  if (number !== null && (typeof number !== "number" || !Number.isFinite(number))) {
    throw new Error("Log number must be a finite number or null");
  }
  const suppliedUnit = optionalUnit(argumentsObject.unit);
  if (suppliedUnit !== null && number === null) throw new Error("A log unit requires a numeric value");
  if (requireOccurredAt && (argumentsObject.occurred_at_utc === null
    || argumentsObject.occurred_at_utc === undefined
    || argumentsObject.occurred_at_utc === "")) {
    throw new Error("Imported logs require an occurrence time");
  }
  const occurredAtUtc = normalizedInstant(argumentsObject.occurred_at_utc, {
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

function resolveTracker(database, input, now, { createIfMissing = false } = {}) {
  const found = findTracker(database, input.trackerName);
  let tracker = found.row;
  let trackerCreated = false;
  let trackerReactivated = false;
  let groupResolution;
  if (!tracker) {
    if (!createIfMissing) {
      return {
        tracker: null,
        trackerCreated: false,
        trackerReactivated: false,
        trackerMatchType: "none",
        groupResolution: {
          requestedGroup: input.requestedGroupWasNull ? null : input.requestedGroup,
          actualGroup: null,
          groupCreated: false,
          groupReactivated: false,
        },
      };
    }
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
  return {
    tracker,
    trackerCreated,
    trackerReactivated,
    trackerMatchType: trackerCreated ? "created" : found.matchType,
    groupResolution,
  };
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
  return databaseEntry({
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

export function registerLogTools(registry, store, ledger, schemaSemantics = null) {
  const rootRegistry = registry;
  registry = registry.withCapability?.("logs") ?? registry;
  rootRegistry.registerContextView?.("logs", {
    id: "logs.active_trackers",
    title: "Active personal-log trackers",
    description: "Active tracker names and IDs with their groups, units, and entry counts.",
    maximumItems: 200,
    execute: () => logCapabilityContext(store),
  });
  registry.register({
    name: "log_add",
    description: "Record one entry in the user's authoritative personal log. The content must remain a complete human-readable entry; number and unit are optional queryable projections, not replacements for that text. Reuse the most plausible existing tracker for exact or synonymous wording. If none matches and create_if_missing is false, no tracker or log entry is written and the result proposes a tracker for user confirmation. Set create_if_missing true only after explicit user creation intent or confirmation. On confirmed first use, create the tracker and requested group atomically; use General when group is null. A supplied group never silently moves an existing tracker.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tracker: { type: "string", minLength: 1, maxLength: 200 },
        group: nullableString,
        content_text: { type: "string", minLength: 1, maxLength: 10000 },
        number_value: { type: ["number", "null"] },
        unit: { ...nullableString, maxLength: 100 },
        occurred_at_utc: nullableString,
        create_if_missing: { type: "boolean" },
      },
      required: ["tracker", "group", "content_text", "number_value", "unit", "occurred_at_utc", "create_if_missing"],
    },
    async execute(argumentsObject, context) {
      const input = normalizedLogInput(argumentsObject);
      const database = store.requireReady();
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const trackerResult = resolveTracker(database, input, now, {
          createIfMissing: argumentsObject.create_if_missing,
        });
        if (!trackerResult.tracker) {
          const result = {
            created: false,
            tracker_missing: true,
            confirmation_required: true,
            proposed_tracker: {
              name: input.trackerName,
              group: input.requestedGroup,
              default_unit: input.suppliedUnit,
            },
            proposed_entry: {
              occurred_at_utc: input.occurredAtUtc,
              content_text: input.content,
              number_value: input.number,
              unit: input.suppliedUnit,
            },
          };
          const semanticResult = logResult(schemaSemantics, context, result, {
            name: "log_add",
            purpose: "Report that no existing tracker matched and return the unrecorded proposed tracker and entry for confirmation.",
          });
          database.exec("COMMIT");
          return semanticResult;
        }
        const entry = insertEntry(database, input, trackerResult.tracker, {
          requestEventId: context.requestEventId || null,
          now,
        });
        const result = {
          created: true,
          tracker_created: trackerResult.trackerCreated,
          tracker_reactivated: trackerResult.trackerReactivated,
          tracker_resolution: {
            requested_name: input.trackerName,
            actual_name: trackerResult.tracker.name,
            match_type: trackerResult.trackerMatchType,
          },
          group_resolution: {
            requested_group: trackerResult.groupResolution.requestedGroup,
            actual_group: trackerResult.groupResolution.actualGroup,
            group_created: trackerResult.groupResolution.groupCreated,
            group_reactivated: trackerResult.groupResolution.groupReactivated,
          },
          tracker: databaseTracker(trackerResult.tracker),
          entry,
        };
        ledger.append({
          type: "personal_log.created", status: "complete", actorType: "tool", actorName: "log_add",
          turnId: context.requestId, operationId: context.callId, name: "Personal log recorded",
          content: entry.content_text, payload: result,
          subjectType: "log_entry", subjectId: String(entry.log_entry_id),
        });
        const semanticResult = logResult(schemaSemantics, context, result, {
          name: "log_add",
          purpose: "Return the stored log entry together with its tracker and log group database fields.",
        });
        database.exec("COMMIT");
        return semanticResult;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "log_import",
    description: "Import a bounded batch of 1 through 100 personal-log entries from any external source. Each entry requires an occurrence time and a stable external_id supplied by the source or deterministically derived when the source has none. The pair of source and external_id is idempotent: exact replays are reported unchanged, while conflicting replays are reported and never overwrite the existing entry. New entries and any required groups or trackers are created in one transaction.",
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
              external_id: { type: ["string", "integer"], maxLength: 1000 },
              tracker: { type: "string", minLength: 1, maxLength: 200 },
              group: nullableString,
              content_text: { type: "string", minLength: 1, maxLength: 10000 },
              number_value: { type: ["number", "null"] },
              unit: { ...nullableString, maxLength: 100 },
              occurred_at_utc: { type: "string" },
            },
            required: [
              "external_id",
              "tracker",
              "group",
              "content_text",
              "number_value",
              "unit",
              "occurred_at_utc",
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
        const externalId = normalizedExternalId(entry.external_id);
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
              entry: databaseEntry(existingRow),
              ...(unchanged ? {} : {
                reason: "The source and external ID already identify a different stored log entry",
              }),
            });
            continue;
          }
          const trackerResult = resolveTracker(database, input.log, now, { createIfMissing: true });
          const entry = insertEntry(database, input.log, trackerResult.tracker, {
            source: selectedSource,
            externalId: input.externalId,
            requestEventId: context.requestEventId || null,
            now,
          });
          items.push({
            status: "imported",
            tracker_created: trackerResult.trackerCreated,
            group_resolution: {
              requested_group: trackerResult.groupResolution.requestedGroup,
              actual_group: trackerResult.groupResolution.actualGroup,
              group_created: trackerResult.groupResolution.groupCreated,
              group_reactivated: trackerResult.groupResolution.groupReactivated,
            },
            entry,
          });
        }
        const importedCount = items.filter((item) => item.status === "imported").length;
        const unchangedCount = items.filter((item) => item.status === "unchanged").length;
        const conflictCount = items.filter((item) => item.status === "conflict").length;
        const result = {
          source: selectedSource,
          total: items.length,
          imported_count: importedCount,
          unchanged_count: unchangedCount,
          conflict_count: conflictCount,
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
        const semanticResult = logResult(schemaSemantics, context, result, {
          name: "log_import",
          purpose: "Return imported, unchanged, or conflicting stored log entries with their database field semantics.",
          entriesOnly: true,
        });
        database.exec("COMMIT");
        return semanticResult;
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
        from_utc: nullableString,
        through_utc: nullableString,
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["tracker", "group", "source", "from_utc", "through_utc", "limit"],
    },
    async execute({ tracker, group, source, from_utc: fromUtc, through_utc: throughUtc, limit }, context) {
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
      `).all(...values, boundedLimit).map(databaseEntry);
      return logResult(schemaSemantics, context, { count: rows.length, entries: rows }, {
        name: "log_list",
        purpose: "List stored personal log entries together with their tracker and log group database fields.",
        entriesOnly: true,
      });
    },
  });

  registry.register({
    name: "log_update",
    description: "Correct one existing personal-log entry by its exact log_entry_id. Null leaves content_text, number_value, unit, or occurred_at_utc unchanged. An empty unit clears only the unit. Set clear_number_value true to clear both the numeric projection and its unit. This updates the original entry without creating a replacement and preserves its tracker and provenance fields.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        log_entry_id: { type: "integer", minimum: 1 },
        content_text: nullableString,
        number_value: { type: ["number", "null"] },
        clear_number_value: { type: "boolean" },
        unit: nullableString,
        occurred_at_utc: nullableString,
      },
      required: [
        "log_entry_id", "content_text", "number_value", "clear_number_value", "unit", "occurred_at_utc",
      ],
    },
    async execute({
      log_entry_id: entryId,
      content_text: contentText,
      number_value: numberValue,
      clear_number_value: clearNumberValue,
      unit,
      occurred_at_utc: occurredAtUtc,
    }, context) {
      const database = store.requireReady();
      database.exec("BEGIN IMMEDIATE");
      try {
        const beforeRow = joinedEntry(database, entryId);
        if (!beforeRow) throw new Error(`Log entry ${entryId} does not exist`);
        const values = {};
        if (contentText !== null) values.content_text = requiredText(contentText, "Log content", 10000);
        if (clearNumberValue) {
          if (numberValue !== null) {
            throw new Error("clear_number_value cannot be combined with a new number_value");
          }
          if (unit !== null && optionalUnit(unit) !== null) {
            throw new Error("clear_number_value cannot be combined with a new unit");
          }
          values.number_value = null;
          values.unit = null;
        } else {
          if (numberValue !== null) values.number_value = numberValue;
          if (unit !== null) values.unit = optionalUnit(unit);
        }
        if (occurredAtUtc !== null) {
          const selectedOccurrence = normalizedInstant(occurredAtUtc, { label: "Log occurrence time" });
          if (selectedOccurrence === null) throw new Error("Log occurrence time cannot be empty");
          values.occurred_at_utc = selectedOccurrence;
        }
        if (Object.keys(values).length === 0) throw new Error("No log entry changes were supplied");
        const prospective = { ...beforeRow, ...values };
        if (prospective.unit !== null && prospective.number_value === null) {
          throw new Error("A log unit requires a numeric value");
        }
        values.updated_at_utc = new Date().toISOString();
        const assignments = Object.keys(values).map((column) => `"${column}" = ?`).join(", ");
        database.prepare(`UPDATE log_entries SET ${assignments} WHERE log_entry_id = ?`)
          .run(...Object.values(values), entryId);
        const entry = databaseEntry(joinedEntry(database, entryId));
        const result = { updated: true, before: databaseEntry(beforeRow), entry };
        ledger.append({
          type: "personal_log.updated", status: "complete", actorType: "tool",
          actorName: "log_update", turnId: context.requestId, operationId: context.callId,
          name: "Personal log entry updated", content: entry.content_text, payload: result,
          subjectType: "log_entry", subjectId: String(entry.log_entry_id),
        });
        const semanticResult = logResult(schemaSemantics, context, result, {
          name: "log_update",
          purpose: "Return the personal log entry before and after an exact-ID correction.",
          entriesOnly: true,
        });
        database.exec("COMMIT");
        return semanticResult;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
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
        include_archived: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["group", "include_archived", "limit"],
    },
    async execute({ group, include_archived: includeArchived, limit }, context) {
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
               log_group.archived_at_utc AS group_archived_at_utc,
               COUNT(entry.log_entry_id) AS entry_count,
               MAX(entry.occurred_at_utc) AS last_logged_at_utc
        FROM trackers AS tracker
        JOIN log_groups AS log_group USING (log_group_id)
        LEFT JOIN log_entries AS entry USING (tracker_id)
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        GROUP BY tracker.tracker_id
        ORDER BY log_group.name COLLATE NOCASE, tracker.name COLLATE NOCASE
        LIMIT ?
      `).all(...values, boundedLimit).map(databaseTracker);
      return logResult(schemaSemantics, context, { count: rows.length, trackers: rows }, {
        name: "tracker_list",
        purpose: "List stored trackers and log groups with computed entry counts and latest occurrence times.",
        trackersOnly: true,
      });
    },
  });

  registry.register({
    name: "tracker_update",
    description: "Update one personal-log tracker by ID. Rename it, move it to a group (creating or reactivating that group), change or clear its default unit, or archive/reactivate it. Null leaves each field unchanged; an empty default_unit clears it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tracker_id: { type: "integer", minimum: 1 },
        name: nullableString,
        group: nullableString,
        default_unit: nullableString,
        archived: { type: ["boolean", "null"] },
      },
      required: ["tracker_id", "name", "group", "default_unit", "archived"],
    },
    async execute({ tracker_id: trackerId, name, group, default_unit: defaultUnit, archived }, context) {
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
        const tracker = databaseTracker(joinedTracker(database, trackerId));
        const result = { updated: true, before: databaseTracker(beforeRow), tracker };
        ledger.append({
          type: "personal_tracker.updated", status: "complete", actorType: "tool",
          actorName: "tracker_update", turnId: context.requestId, operationId: context.callId,
          name: "Personal tracker updated", content: tracker.name, payload: result,
          subjectType: "tracker", subjectId: String(tracker.tracker_id),
        });
        const semanticResult = logResult(schemaSemantics, context, result, {
          name: "tracker_update",
          purpose: "Return the tracker before and after an update using stored database field names.",
          trackersOnly: true,
        });
        database.exec("COMMIT");
        return semanticResult;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });
}
