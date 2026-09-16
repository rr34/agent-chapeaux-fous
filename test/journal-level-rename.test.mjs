import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { runDatabaseMigrations } from "../scripts/migrate-database.mjs";
import { verifyDatabase } from "../scripts/verify-database.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { baselineBeforeJournalLevels, temporaryDatabase } from "./helpers.mjs";

test("numbered Journal tables preserve entries, relationships, and numeric guards through replay", async (context) => {
  const schema = baselineBeforeJournalLevels(fs.readFileSync(baselineFilename, "utf8"));
  const temporary = temporaryDatabase({ schema });
  context.after(temporary.cleanup);
  const database = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => database.close());
  database.exec("INSERT INTO journal_groups (journal_group_id, name) VALUES (41, 'Exercise')");
  database.exec("INSERT INTO trackers (tracker_id, journal_group_id, name, unit) VALUES (42, 41, 'Push-ups', 'reps')");
  database.exec(`INSERT INTO journal_entries
    (journal_entry_id, tracker_id, occurred_at_utc, content_text, number_value)
    VALUES (43, 42, '2026-09-15 12:00:00.000', 'Did 30 push-ups', 30)`);
  const options = {
    connectionSettings: temporary.target.connection,
    backupConfirmed: true,
    writersStopped: true,
    output: { write() {} },
  };
  const preserved = () => {
    const row = database.prepare(`SELECT journal_group.name AS group_name,
      tracker.name AS tracker_name, entry.journal_entry_id, entry.content_text,
      entry.number_value
      FROM journal3_entries AS entry
      JOIN journal2_trackers AS tracker USING (tracker_id)
      JOIN journal1_groups AS journal_group USING (journal_group_id)`).get();
    assert.deepEqual(row, {
      group_name: "Exercise", tracker_name: "Push-ups", journal_entry_id: 43,
      content_text: "Did 30 push-ups", number_value: 30,
    });
    assert.throws(() => database.exec(
      "UPDATE journal2_trackers SET unit = 'sets' WHERE tracker_id = 42",
    ), /cannot change after numeric entries/u);
    assert.throws(() => database.exec(
      "INSERT INTO journal3_entries (tracker_id, content_text) VALUES (999, 'Orphan')",
    ), /foreign key constraint/iu);
  };
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [46]);
  await verifyDatabase(database);
  preserved();
  // Model a rename that committed before its trigger recreation and version mark.
  for (const name of [
    "journal_entries_require_tracker_unit_before_insert",
    "journal_entries_require_tracker_unit_before_update",
    "trackers_preserve_numeric_unit_before_update",
  ]) database.exec(`DROP TRIGGER ${name}`);
  database.exec("UPDATE database_meta SET schema_version = 45 WHERE singleton = 1");
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [46]);
  await verifyDatabase(database);
  preserved();
});
