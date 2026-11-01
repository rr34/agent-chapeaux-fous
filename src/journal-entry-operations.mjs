export class JournalEntryOperationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "JournalEntryOperationError";
    this.statusCode = statusCode;
  }
}

function entryId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new JournalEntryOperationError("Journal entry id must be a positive integer.");
  }
  return id;
}

function requiredText(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new JournalEntryOperationError("Journal content is required.");
  }
  if (value.trim().length > 10_000) {
    throw new JournalEntryOperationError("Journal content cannot exceed 10000 characters.");
  }
  return value.trim();
}

function finiteNumber(value) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new JournalEntryOperationError("Journal number must be a finite number or null.");
  }
  return value;
}

function instant(value) {
  if (typeof value !== "string" || !value) {
    throw new JournalEntryOperationError("Journal occurrence time is required.");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new JournalEntryOperationError("Journal occurrence time must be an ISO-8601 date and time.");
  }
  return parsed.toISOString();
}

export function journalEntryRow(database, idValue) {
  const id = entryId(idValue);
  return database.prepare(`
    SELECT entry.*, tracker.name AS tracker_name, tracker.journal_group_id,
           tracker.unit AS tracker_unit,
           journal_group.name AS group_name
    FROM journal3_entries AS entry
    JOIN journal2_trackers AS tracker USING (tracker_id)
    JOIN journal1_groups AS journal_group USING (journal_group_id)
    WHERE entry.journal_entry_id = ?
  `).get(id);
}

export function updateJournalEntry(database, {
  entryId: idValue,
  contentText = undefined,
  numberValue = undefined,
  occurredAtUtc = undefined,
  expectedVersion = null,
} = {}) {
  const id = entryId(idValue);
  if (expectedVersion !== null && (typeof expectedVersion !== "string" || !expectedVersion)) {
    throw new JournalEntryOperationError("version is required when updating a journal entry.");
  }
  const before = journalEntryRow(database, id);
  if (!before) throw new JournalEntryOperationError(`Journal entry ${id} does not exist.`, 404);

  const values = {};
  if (contentText !== undefined) values.content_text = requiredText(contentText);
  if (numberValue !== undefined) values.number_value = finiteNumber(numberValue);
  if (occurredAtUtc !== undefined) values.occurred_at_utc = instant(occurredAtUtc);
  if (Object.keys(values).length === 0) {
    throw new JournalEntryOperationError("No journal entry changes were supplied.");
  }
  if (values.number_value != null && String(before.tracker_unit).toLowerCase() === "set me") {
    throw new JournalEntryOperationError(`Set the canonical unit for tracker ${before.tracker_name} before changing its number.`);
  }

  const currentVersion = before.updated_at_utc ?? before.created_at_utc;
  const currentTime = new Date(currentVersion).getTime();
  const now = Date.now();
  values.updated_at_utc = new Date(Number.isFinite(currentTime) && now <= currentTime ? currentTime + 1 : now).toISOString();
  const assignments = Object.keys(values).map((column) => `\`${column}\` = ?`).join(", ");
  const versionClause = expectedVersion === null ? "" : " AND COALESCE(updated_at_utc, created_at_utc) = ?";
  const result = database.prepare(`
    UPDATE journal3_entries SET ${assignments}
    WHERE journal_entry_id = ?${versionClause}
  `).run(...Object.values(values), id, ...(expectedVersion === null ? [] : [expectedVersion]));
  if (result.changes !== 1) {
    throw new JournalEntryOperationError("This journal entry changed while you were saving it. Refresh and try again.", 409);
  }
  return { before, entry: journalEntryRow(database, id) };
}
