import { selectedFields } from "./record-fields.mjs";

const journalGroupRecordSchema = {
  type: ["object", "null"],
  description: "Defines broad named groups that organize the user's personal trackers.",
  properties: {
    journal_group_id: { description: "Stable local identifier for one personal-journal group." },
    name: { description: "Complete human-facing name of the group. Unique without regard to letter case." },
    archived_at_utc: { description: "UTC timestamp when this group was archived, or null while it is active." },
    created_at_utc: { description: "UTC timestamp when this group was created." },
    updated_at_utc: { description: "UTC timestamp of the most recent change to this group, when changed." },
  },
};

const trackerRecordSchema = {
  type: ["object", "null"],
  description: "Defines the reusable subjects under which the user records personal observations over time.",
  properties: {
    tracker_id: { description: "Stable local identifier for one personal tracker." },
    journal_group_id: { description: "Organizational group containing this tracker." },
    name: { description: "Complete human-facing name of the tracked subject. Unique globally without regard to letter case." },
    unit: { description: "Canonical unit shared by every numeric entry in this tracker's trend series. Required for every tracker; event-style trackers use an explicit count such as occurrence or dose. The set me value is a migration review marker, not a real measurement unit. After numeric entries exist, changing this unit would reinterpret history and is rejected unless the old value is set me." },
    archived_at_utc: { description: "UTC timestamp when tracking was archived, or null while the tracker is active." },
    created_at_utc: { description: "UTC timestamp when this tracker was first defined." },
    updated_at_utc: { description: "UTC timestamp of the most recent change to this tracker, when changed." },
    journal_groups: journalGroupRecordSchema,
  },
};

const journalEntryRecordSchema = {
  type: ["object", "null"],
  description: "Stores the user's authoritative time-stamped personal observations under reusable trackers.",
  properties: {
    journal_entry_id: { description: "Stable local identifier for one personal journal entry." },
    tracker_id: { description: "Tracker under which this observation is recorded." },
    occurred_at_utc: { description: "UTC instant when the recorded observation or event occurred. This may differ from created_at_utc when the user records something retrospectively." },
    content_text: { description: "Complete self-contained natural-language content of the observation. Preserve supporting context here instead of fragmenting it into a separate note field. When a numeric projection exists, this text still remains the complete readable entry." },
    number_value: { description: "Optional numeric projection extracted from the complete journal content for calculation, comparison, and trends. Null is valid for observations without a useful numeric component. Interpret this value using the parent tracker's canonical unit." },
    source_event_id: { description: "Optional activity event for the user request that caused this journal entry to be recorded." },
    created_at_utc: { description: "UTC timestamp when this journal row was created." },
    updated_at_utc: { description: "UTC timestamp of the most recent modification to this journal row, when modified." },
    source: { description: "Stable generic name of the application, export, or local path from which this journal entry originated. Use agent-slayer for ordinary native journal writes and a consistent source name for every page of one external import." },
    external_id: { description: "Optional stable record identifier assigned by source and used with source to make imports idempotent. Required by the generic import tool and null for ordinary native journal entries without an upstream identity. The pair of source and external_id is unique whenever external_id is present." },
    trackers: trackerRecordSchema,
    journal_groups: journalGroupRecordSchema,
  },
};

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

const trackerFields = [
  "tracker_id", "journal_group_id", "name", "unit", "archived_at_utc", "created_at_utc", "updated_at_utc",
];
const journalEntryFields = [
  "journal_entry_id", "tracker_id", "occurred_at_utc", "content_text", "number_value",
  "source_event_id", "created_at_utc", "updated_at_utc", "source", "external_id",
];

function databaseTracker(row) {
  if (!row) return null;
  return {
    ...selectedFields(row, trackerFields),
    journal_groups: {
      journal_group_id: row.journal_group_id,
      name: row.group_name ?? null,
      archived_at_utc: row.group_archived_at_utc ?? null,
    },
    ...(row.entry_count === undefined ? {} : { entry_count: Number(row.entry_count) }),
    ...(row.last_recorded_at_utc === undefined ? {} : { last_recorded_at_utc: row.last_recorded_at_utc }),
  };
}

function databaseEntry(row) {
  if (!row) return null;
  return {
    ...selectedFields(row, journalEntryFields),
    trackers: {
      tracker_id: row.tracker_id,
      journal_group_id: row.journal_group_id ?? null,
      name: row.tracker_name ?? null,
      unit: row.tracker_unit ?? null,
    },
    journal_groups: {
      journal_group_id: row.journal_group_id ?? null,
      name: row.group_name ?? null,
    },
  };
}

export function journalCapabilityContext(store, limit = 200) {
  const trackers = !store?.status?.ready ? [] : store.requireReady().prepare(`
    SELECT tracker.tracker_id, tracker.name, tracker.unit,
           journal_group.name AS group_name,
           COUNT(entry.journal_entry_id) AS entry_count,
           MAX(entry.occurred_at_utc) AS last_recorded_at_utc
    FROM trackers AS tracker
    JOIN journal_groups AS journal_group USING (journal_group_id)
    LEFT JOIN journal_entries AS entry USING (tracker_id)
    WHERE tracker.archived_at_utc IS NULL
      AND journal_group.archived_at_utc IS NULL
    GROUP BY tracker.tracker_id
    ORDER BY tracker.name
    LIMIT ?
  `).all(limit).map((row) => ({
    trackerId: Number(row.tracker_id),
    name: row.name,
    group: row.group_name,
    unit: row.unit,
    entryCount: Number(row.entry_count),
    lastRecordedAtUtc: row.last_recorded_at_utc,
  }));
  const rows = trackers.length
    ? trackers.map((tracker) => [
        `- [tracker ${tracker.trackerId}] name: ${tracker.name}`,
        `group: ${tracker.group}`,
        `entries: ${tracker.entryCount}`,
        `unit: ${tracker.unit}`,
      ].join(" | ")).join("\n")
    : "No active personal-journal trackers exist.";
  return {
    heading: "Active personal-journal trackers",
    text: [
      "These names are authoritative. Reuse the most plausible existing tracker verbatim when the user's wording is synonymous; do not create a paraphrased duplicate.",
      rows,
    ].join("\n"),
    data: { trackers },
  };
}

function joinedTracker(database, trackerId) {
  return database.prepare(`
    SELECT tracker.*, journal_group.name AS group_name,
           journal_group.archived_at_utc AS group_archived_at_utc
    FROM trackers AS tracker
    JOIN journal_groups AS journal_group USING (journal_group_id)
    WHERE tracker.tracker_id = ?
  `).get(trackerId);
}

function joinedEntry(database, entryId) {
  return database.prepare(`
    SELECT entry.*, tracker.name AS tracker_name, tracker.journal_group_id,
           tracker.unit AS tracker_unit,
           journal_group.name AS group_name
    FROM journal_entries AS entry
    JOIN trackers AS tracker USING (tracker_id)
    JOIN journal_groups AS journal_group USING (journal_group_id)
    WHERE entry.journal_entry_id = ?
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
    SELECT tracker.*, journal_group.name AS group_name,
           journal_group.archived_at_utc AS group_archived_at_utc,
           COUNT(entry.journal_entry_id) AS entry_count
    FROM trackers AS tracker
    JOIN journal_groups AS journal_group USING (journal_group_id)
    LEFT JOIN journal_entries AS entry USING (tracker_id)
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
    SELECT tracker.*, journal_group.name AS group_name,
           journal_group.archived_at_utc AS group_archived_at_utc
    FROM trackers AS tracker
    JOIN journal_groups AS journal_group USING (journal_group_id)
    WHERE tracker.name = ?
  `).get(name);
  return exact ? { row: exact, matchType: "exact" } : { row: null, matchType: "none" };
}

function ensureGroup(database, name, now) {
  const existing = database.prepare(`
    SELECT * FROM journal_groups WHERE name = ?
  `).get(name);
  if (!existing) {
    return {
      row: database.prepare(`
        INSERT INTO journal_groups (name, updated_at_utc) VALUES (?, ?) RETURNING *
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
      UPDATE journal_groups
      SET archived_at_utc = NULL, updated_at_utc = ?
      WHERE journal_group_id = ?
      RETURNING *
    `).get(now, existing.journal_group_id),
    created: false,
    reactivated: true,
  };
}

function normalizedJournalInput(argumentsObject, { requireOccurredAt = false } = {}) {
  const trackerName = requiredText(argumentsObject.tracker, "Tracker name", 200);
  const requestedGroupWasNull = argumentsObject.group === null;
  const requestedGroup = requestedGroupWasNull
    ? "General"
    : requiredText(argumentsObject.group, "Journal group name", 200);
  const content = requiredText(argumentsObject.content_text, "Journal content", 10000);
  const number = argumentsObject.number_value;
  if (number !== null && (typeof number !== "number" || !Number.isFinite(number))) {
    throw new Error("Journal number must be a finite number or null");
  }
  const trackerUnit = optionalUnit(argumentsObject.tracker_unit);
  if (requireOccurredAt && (argumentsObject.occurred_at_utc === null
    || argumentsObject.occurred_at_utc === undefined
    || argumentsObject.occurred_at_utc === "")) {
    throw new Error("Imported journal entries require an occurrence time");
  }
  const occurredAtUtc = normalizedInstant(argumentsObject.occurred_at_utc, {
    useNow: !requireOccurredAt,
    label: "Journal occurrence time",
  });
  return {
    trackerName,
    requestedGroup,
    requestedGroupWasNull,
    content,
    number,
    trackerUnit,
    occurredAtUtc,
  };
}

function normalizedExternalId(value) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error("External journal IDs supplied as numbers must be safe integers");
  }
  if (!["string", "number"].includes(typeof value)) {
    throw new Error("External journal ID must be a string or integer");
  }
  return requiredText(value, "External journal ID", 1000);
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
    if (input.trackerUnit === null) {
      throw new Error("New journal trackers require a canonical unit");
    }
    const selectedGroup = ensureGroup(database, input.requestedGroup, now);
    const row = database.prepare(`
      INSERT INTO trackers (journal_group_id, name, unit, updated_at_utc)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `).get(selectedGroup.row.journal_group_id, input.trackerName, input.trackerUnit, now);
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
    if (input.trackerUnit !== null && tracker.unit !== input.trackerUnit) {
      if (tracker.unit.toLowerCase() !== "set me") {
        throw new Error(
          `Tracker ${tracker.name} uses ${tracker.unit}; numeric entries cannot use ${input.trackerUnit}`,
        );
      }
      updates.push("unit = ?");
      values.push(input.trackerUnit);
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
        UPDATE journal_groups
        SET archived_at_utc = NULL, updated_at_utc = ?
        WHERE journal_group_id = ?
      `).run(now, tracker.journal_group_id);
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
  if (tracker.unit.toLowerCase() === "set me") {
    throw new Error(`Set the canonical unit for tracker ${tracker.name} before recording another entry`);
  }
  const row = database.prepare(`
    INSERT INTO journal_entries (
      tracker_id, occurred_at_utc, content_text, number_value,
      source_event_id, updated_at_utc, source, external_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `).get(
    tracker.tracker_id,
    input.occurredAtUtc,
    input.content,
    input.number,
    requestEventId,
    now,
    source,
    externalId,
  );
  return databaseEntry({
    ...row,
    tracker_name: tracker.name,
    tracker_unit: tracker.unit,
    journal_group_id: tracker.journal_group_id,
    group_name: tracker.group_name,
  });
}

function existingImportedEntry(database, source, externalId) {
  return database.prepare(`
    SELECT entry.*, tracker.name AS tracker_name, tracker.journal_group_id,
           tracker.unit AS tracker_unit,
           journal_group.name AS group_name
    FROM journal_entries AS entry
    JOIN trackers AS tracker USING (tracker_id)
    JOIN journal_groups AS journal_group USING (journal_group_id)
    WHERE entry.source = ? AND entry.external_id = ?
  `).get(source, externalId);
}

function sameImportedEntry(row, input) {
  return row.tracker_name.toLowerCase() === input.trackerName.toLowerCase()
    && row.occurred_at_utc === input.occurredAtUtc
    && row.content_text === input.content
    && (row.number_value === null ? null : Number(row.number_value)) === input.number
    && (input.trackerUnit === null || row.tracker_unit === input.trackerUnit);
}

export function registerJournalTools(registry, store, ledger) {
  const rootRegistry = registry;
  registry = registry.withCapability?.("journal") ?? registry;
  rootRegistry.registerContextView?.("journal", {
    id: "journal.active_trackers",
    title: "Active personal-journal trackers",
    description: "Active tracker names and IDs with their groups, units, and entry counts.",
    maximumItems: 200,
    execute: () => journalCapabilityContext(store),
  });
  registry.register({
    name: "journal_add",
    description: "Record one entry in the user's authoritative personal journal. The content must remain complete human-readable text; number_value is an optional trend projection whose canonical unit belongs to the tracker, never the entry. Supply tracker_unit when creating a tracker or replacing the migration marker; otherwise use null and the existing tracker unit remains authoritative. Reuse the most plausible existing tracker. If none matches and create_if_missing is false, return an unrecorded proposal for confirmation.",
    outputSchema: {
      type: "object",
      properties: { entry: journalEntryRecordSchema, tracker: trackerRecordSchema },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tracker: { type: "string", minLength: 1, maxLength: 200, description: "Name of the reusable subject under which this observation is recorded." },
        group: nullableString,
        content_text: { type: "string", minLength: 1, maxLength: 10000, description: "Complete self-contained natural-language content of the observation. Preserve supporting context here instead of fragmenting it into a separate note field. When a numeric projection exists, this text still remains the complete readable entry." },
        number_value: { type: ["number", "null"], description: "Optional numeric projection extracted from the complete journal content for calculation, comparison, and trends. Null is valid for observations without a useful numeric component. Interpret this value using the parent tracker's canonical unit." },
        tracker_unit: { ...nullableString, maxLength: 100, description: "Canonical unit shared by every numeric entry in this tracker's trend series. Required for every tracker; event-style trackers use an explicit count such as occurrence or dose. The set me value is a migration review marker, not a real measurement unit. After numeric entries exist, changing this unit would reinterpret history and is rejected unless the old value is set me." },
        occurred_at_utc: { ...nullableString, description: "UTC instant when the recorded observation or event occurred. This may differ from created_at_utc when the user records something retrospectively." },
        create_if_missing: { type: "boolean" },
      },
      required: ["tracker", "group", "content_text", "number_value", "tracker_unit", "occurred_at_utc", "create_if_missing"],
    },
    async execute(argumentsObject, context) {
      const input = normalizedJournalInput(argumentsObject);
      const database = store.requireReady();
      const now = new Date().toISOString();
      database.exec("START TRANSACTION");
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
              unit: input.trackerUnit,
            },
            proposed_entry: {
              occurred_at_utc: input.occurredAtUtc,
              content_text: input.content,
              number_value: input.number,
            },
          };
          database.exec("COMMIT");
          return result;
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
          type: "personal_journal.created", status: "complete", actorType: "tool", actorName: "journal_add",
          turnId: context.requestId, operationId: context.callId, name: "Personal journal recorded",
          content: entry.content_text, payload: result,
          subjectType: "journal_entry", subjectId: String(entry.journal_entry_id),
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
    name: "journal_import",
    description: "Import a bounded batch of 1 through 100 personal-journal entries from any external source. Each entry requires an occurrence time and a stable external_id supplied by the source or deterministically derived when the source has none. The pair of source and external_id is idempotent: exact replays are reported unchanged, while conflicting replays are reported and never overwrite the existing entry. New entries and any required groups or trackers are created in one transaction.",
    outputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { entry: journalEntryRecordSchema },
          },
        },
      },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: { type: "string", minLength: 1, maxLength: 200, description: "Stable generic name of the application, export, or local path from which this journal entry originated. Use agent-slayer for ordinary native journal writes and a consistent source name for every page of one external import." },
        entries: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              external_id: { type: ["string", "integer"], maxLength: 1000, description: "Optional stable record identifier assigned by source and used with source to make imports idempotent. Required by the generic import tool and null for ordinary native journal entries without an upstream identity. The pair of source and external_id is unique whenever external_id is present." },
              tracker: { type: "string", minLength: 1, maxLength: 200, description: "Name of the reusable subject under which this observation is recorded." },
              group: nullableString,
              content_text: { type: "string", minLength: 1, maxLength: 10000, description: "Complete self-contained natural-language content of the observation. Preserve supporting context here instead of fragmenting it into a separate note field. When a numeric projection exists, this text still remains the complete readable entry." },
              number_value: { type: ["number", "null"], description: "Optional numeric projection extracted from the complete journal content for calculation, comparison, and trends. Null is valid for observations without a useful numeric component. Interpret this value using the parent tracker's canonical unit." },
              tracker_unit: { ...nullableString, maxLength: 100, description: "Canonical unit shared by every numeric entry in this tracker's trend series. Required for every tracker; event-style trackers use an explicit count such as occurrence or dose. The set me value is a migration review marker, not a real measurement unit. After numeric entries exist, changing this unit would reinterpret history and is rejected unless the old value is set me." },
              occurred_at_utc: { type: "string", description: "UTC instant when the recorded observation or event occurred. This may differ from created_at_utc when the user records something retrospectively." },
            },
            required: [
              "external_id",
              "tracker",
              "group",
              "content_text",
              "number_value",
              "tracker_unit",
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
        throw new Error("Journal imports require between 1 and 100 entries");
      }
      const seenExternalIds = new Set();
      const inputs = entries.map((entry) => {
        const externalId = normalizedExternalId(entry.external_id);
        if (seenExternalIds.has(externalId)) {
          throw new Error(`Duplicate external journal ID in import batch: ${externalId}`);
        }
        seenExternalIds.add(externalId);
        return {
          externalId,
          journal: normalizedJournalInput(entry, { requireOccurredAt: true }),
        };
      });
      const database = store.requireReady();
      const now = new Date().toISOString();
      database.exec("START TRANSACTION");
      try {
        const items = [];
        for (const input of inputs) {
          const existingRow = existingImportedEntry(database, selectedSource, input.externalId);
          if (existingRow) {
            const unchanged = sameImportedEntry(existingRow, input.journal);
            items.push({
              status: unchanged ? "unchanged" : "conflict",
              entry: databaseEntry(existingRow),
              ...(unchanged ? {} : {
                reason: "The source and external ID already identify a different stored journal entry",
              }),
            });
            continue;
          }
          const trackerResult = resolveTracker(database, input.journal, now, { createIfMissing: true });
          const entry = insertEntry(database, input.journal, trackerResult.tracker, {
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
          type: "personal_journal.imported", status: "complete", actorType: "tool",
          actorName: "journal_import", turnId: context.requestId, operationId: context.callId,
          name: "Personal journal import processed",
          content: `${importedCount} imported, ${unchangedCount} unchanged, ${conflictCount} conflicting from ${selectedSource}`,
          payload: {
            source: selectedSource,
            total: items.length,
            importedCount,
            unchangedCount,
            conflictCount,
          },
          subjectType: "journal_import", subjectId: selectedSource,
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
    name: "journal_list",
    description: "List recent entries from the user's authoritative personal journal, optionally filtered by tracker, group, provenance source, or inclusive UTC occurrence-time bounds.",
    outputSchema: {
      type: "object",
      properties: {
        entries: { type: "array", items: journalEntryRecordSchema },
      },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tracker: { ...nullableString, description: "Name of the reusable subject under which this observation is recorded." },
        group: nullableString,
        source: { ...nullableString, description: "Stable generic name of the application, export, or local path from which this journal entry originated. Use agent-slayer for ordinary native journal writes and a consistent source name for every page of one external import." },
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
        conditions.push("tracker.name = ?");
        values.push(requiredText(tracker, "Tracker name", 200));
      }
      if (group !== null) {
        conditions.push("journal_group.name = ?");
        values.push(requiredText(group, "Journal group name", 200));
      }
      if (source !== null) {
        conditions.push("entry.source = ?");
        values.push(requiredText(source, "Journal source", 200));
      }
      const selectedFrom = normalizedInstant(fromUtc, { label: "Journal range start" });
      const selectedThrough = normalizedInstant(throughUtc, { label: "Journal range end" });
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
        SELECT entry.*, tracker.name AS tracker_name, tracker.journal_group_id,
               tracker.unit AS tracker_unit,
               journal_group.name AS group_name
        FROM journal_entries AS entry
        JOIN trackers AS tracker USING (tracker_id)
        JOIN journal_groups AS journal_group USING (journal_group_id)
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY entry.occurred_at_utc DESC, entry.journal_entry_id DESC
        LIMIT ?
      `).all(...values, boundedLimit).map(databaseEntry);
      return { count: rows.length, entries: rows };
    },
  });

  registry.register({
    name: "journal_update",
    description: "Correct one existing personal-journal entry by its exact journal_entry_id. Null leaves content_text, number_value, or occurred_at_utc unchanged. Set clear_number_value true to clear the optional numeric trend projection. The canonical unit belongs to the tracker and cannot be changed through an entry correction.",
    outputSchema: {
      type: "object",
      properties: { entry: journalEntryRecordSchema },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        journal_entry_id: { type: "integer", minimum: 1, description: "Stable local identifier for one personal journal entry." },
        content_text: { ...nullableString, description: "Complete self-contained natural-language content of the observation. Preserve supporting context here instead of fragmenting it into a separate note field. When a numeric projection exists, this text still remains the complete readable entry." },
        number_value: { type: ["number", "null"], description: "Optional numeric projection extracted from the complete journal content for calculation, comparison, and trends. Null is valid for observations without a useful numeric component. Interpret this value using the parent tracker's canonical unit." },
        clear_number_value: { type: "boolean" },
        occurred_at_utc: { ...nullableString, description: "UTC instant when the recorded observation or event occurred. This may differ from created_at_utc when the user records something retrospectively." },
      },
      required: [
        "journal_entry_id", "content_text", "number_value", "clear_number_value", "occurred_at_utc",
      ],
    },
    async execute({
      journal_entry_id: entryId,
      content_text: contentText,
      number_value: numberValue,
      clear_number_value: clearNumberValue,
      occurred_at_utc: occurredAtUtc,
    }, context) {
      const database = store.requireReady();
      database.exec("START TRANSACTION");
      try {
        const beforeRow = joinedEntry(database, entryId);
        if (!beforeRow) throw new Error(`Journal entry ${entryId} does not exist`);
        const values = {};
        if (contentText !== null) values.content_text = requiredText(contentText, "Journal content", 10000);
        if (clearNumberValue) {
          if (numberValue !== null) {
            throw new Error("clear_number_value cannot be combined with a new number_value");
          }
          values.number_value = null;
        } else {
          if (numberValue !== null) values.number_value = numberValue;
        }
        if (occurredAtUtc !== null) {
          const selectedOccurrence = normalizedInstant(occurredAtUtc, { label: "Journal occurrence time" });
          if (selectedOccurrence === null) throw new Error("Journal occurrence time cannot be empty");
          values.occurred_at_utc = selectedOccurrence;
        }
        if (Object.keys(values).length === 0) throw new Error("No journal entry changes were supplied");
        if (numberValue !== null && beforeRow.tracker_unit.toLowerCase() === "set me") {
          throw new Error(`Set the canonical unit for tracker ${beforeRow.tracker_name} before changing its number`);
        }
        values.updated_at_utc = new Date().toISOString();
        const assignments = Object.keys(values).map((column) => `\`${column}\` = ?`).join(", ");
        database.prepare(`UPDATE journal_entries SET ${assignments} WHERE journal_entry_id = ?`)
          .run(...Object.values(values), entryId);
        const entry = databaseEntry(joinedEntry(database, entryId));
        const result = { updated: true, before: databaseEntry(beforeRow), entry };
        ledger.append({
          type: "personal_journal.updated", status: "complete", actorType: "tool",
          actorName: "journal_update", turnId: context.requestId, operationId: context.callId,
          name: "Personal journal entry updated", content: entry.content_text, payload: result,
          subjectType: "journal_entry", subjectId: String(entry.journal_entry_id),
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
    name: "tracker_list",
    description: "List personal-journal trackers with their groups, canonical units, entry counts, and most recent occurrence times.",
    outputSchema: {
      type: "object",
      properties: {
        trackers: { type: "array", items: trackerRecordSchema },
      },
    },
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
        conditions.push("journal_group.archived_at_utc IS NULL");
      }
      if (group !== null) {
        conditions.push("journal_group.name = ?");
        values.push(requiredText(group, "Journal group name", 200));
      }
      const boundedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
      const rows = store.requireReady().prepare(`
        SELECT tracker.*, journal_group.name AS group_name,
               journal_group.archived_at_utc AS group_archived_at_utc,
               COUNT(entry.journal_entry_id) AS entry_count,
               MAX(entry.occurred_at_utc) AS last_recorded_at_utc
        FROM trackers AS tracker
        JOIN journal_groups AS journal_group USING (journal_group_id)
        LEFT JOIN journal_entries AS entry USING (tracker_id)
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        GROUP BY tracker.tracker_id
        ORDER BY journal_group.name, tracker.name
        LIMIT ?
      `).all(...values, boundedLimit).map(databaseTracker);
      return { count: rows.length, trackers: rows };
    },
  });

  registry.register({
    name: "tracker_update",
    description: "Update one personal-journal tracker by ID. Rename it, move it to a group, replace its migration marker with a canonical unit, or archive/reactivate it. A canonical unit cannot be cleared and cannot change after numeric entries exist.",
    outputSchema: {
      type: "object",
      properties: { tracker: trackerRecordSchema },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tracker_id: { type: "integer", minimum: 1, description: "Tracker under which this observation is recorded." },
        name: { ...nullableString, description: "Complete human-facing name of the tracked subject. Unique globally without regard to letter case." },
        group: nullableString,
        unit: { ...nullableString, description: "Canonical unit shared by every numeric entry in this tracker's trend series. Required for every tracker; event-style trackers use an explicit count such as occurrence or dose. The set me value is a migration review marker, not a real measurement unit. After numeric entries exist, changing this unit would reinterpret history and is rejected unless the old value is set me." },
        archived: { type: ["boolean", "null"] },
      },
      required: ["tracker_id", "name", "group", "unit", "archived"],
    },
    async execute({ tracker_id: trackerId, name, group, unit, archived }, context) {
      const database = store.requireReady();
      const beforeRow = joinedTracker(database, trackerId);
      if (!beforeRow) throw new Error(`Tracker ${trackerId} does not exist`);
      const now = new Date().toISOString();
      database.exec("START TRANSACTION");
      try {
        const values = {};
        if (name !== null) values.name = requiredText(name, "Tracker name", 200);
        if (group !== null) {
          const selectedGroup = ensureGroup(database, requiredText(group, "Journal group name", 200), now);
          values.journal_group_id = selectedGroup.row.journal_group_id;
        } else if (archived === false && beforeRow.group_archived_at_utc !== null) {
          database.prepare(`
            UPDATE journal_groups
            SET archived_at_utc = NULL, updated_at_utc = ?
            WHERE journal_group_id = ?
          `).run(now, beforeRow.journal_group_id);
        }
        if (unit !== null) values.unit = requiredText(unit, "Tracker unit", 100);
        if (archived !== null) values.archived_at_utc = archived ? now : null;
        if (Object.keys(values).length === 0) throw new Error("No tracker changes were supplied");
        values.updated_at_utc = now;
        const assignments = Object.keys(values).map((column) => `\`${column}\` = ?`).join(", ");
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
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });
}
