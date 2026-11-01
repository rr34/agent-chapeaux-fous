import assert from "node:assert/strict";
import test from "node:test";
import {
  JournalEntryOperationError, updateJournalEntry,
} from "../src/journal-entry-operations.mjs";

function journalDatabase() {
  let row = {
    journal_entry_id: 41,
    tracker_id: 12,
    tracker_name: "Sleep",
    journal_group_id: 3,
    group_name: "Health",
    tracker_unit: "hours",
    content_text: "Slept 6 hours.",
    number_value: 6,
    occurred_at_utc: "2026-08-16T12:00:00.000Z",
    created_at_utc: "2026-08-16T12:01:00.000Z",
    updated_at_utc: "2026-08-16T12:01:00.000Z",
  };
  return {
    prepare(sql) {
      if (sql.includes("SELECT entry.*")) {
        return { get(id) { return Number(id) === row.journal_entry_id ? { ...row } : undefined; } };
      }
      if (sql.includes("UPDATE journal3_entries")) {
        return { run(contentText, numberValue, occurredAtUtc, updatedAtUtc, id, version) {
          if (Number(id) !== row.journal_entry_id || version !== row.updated_at_utc) return { changes: 0 };
          row = {
            ...row,
            content_text: contentText,
            number_value: numberValue,
            occurred_at_utc: occurredAtUtc,
            updated_at_utc: updatedAtUtc,
          };
          return { changes: 1 };
        } };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test("the shared journal-entry mutation updates the original row and rejects a stale version", () => {
  const database = journalDatabase();
  const version = "2026-08-16T12:01:00.000Z";
  const result = updateJournalEntry(database, {
    entryId: 41,
    contentText: "Slept 7.5 hours and woke rested.",
    numberValue: 7.5,
    occurredAtUtc: "2026-08-17T11:30:00Z",
    expectedVersion: version,
  });

  assert.equal(result.before.content_text, "Slept 6 hours.");
  assert.equal(result.entry.journal_entry_id, 41);
  assert.equal(result.entry.content_text, "Slept 7.5 hours and woke rested.");
  assert.equal(result.entry.number_value, 7.5);
  assert.equal(result.entry.occurred_at_utc, "2026-08-17T11:30:00.000Z");
  assert.notEqual(result.entry.updated_at_utc, version);
  assert.throws(
    () => updateJournalEntry(database, {
      entryId: 41,
      contentText: "Stale correction",
      expectedVersion: version,
    }),
    (error) => error instanceof JournalEntryOperationError && error.statusCode === 409,
  );
});
