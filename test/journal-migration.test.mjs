import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { runDatabaseMigrations, migrationsFilename } from "../scripts/migrate-database.mjs";
import { readMigrationLedger, splitMariaDbStatements } from "../scripts/database-migrations.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { inspectDatabase } from "../src/database.mjs";
import { temporaryDatabase } from "./helpers.mjs";

// Reconstruct the pre-rename schema to exercise the upgrade with existing data.
const previousSchema = fs.readFileSync(baselineFilename, "utf8")
  .replaceAll("journal_", "log_")
  .replaceAll("numeric journal entries", "numeric log entries")
  .replace("VALUES (1, 32,", "VALUES (1, 31,");

test("the Journal upgrade and replay preserve existing IDs, import provenance, and numeric-unit invariants", async (context) => {
  const temporary = temporaryDatabase({ schema: previousSchema });
  context.after(temporary.cleanup);
  const database = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => database.close());
  database.exec("INSERT INTO log_groups (log_group_id, name) VALUES (41, 'Health')");
  database.exec("INSERT INTO trackers (tracker_id, log_group_id, name, unit) VALUES (42, 41, 'Weight', 'kg')");
  database.exec(`INSERT INTO log_entries (
    log_entry_id, tracker_id, occurred_at_utc, content_text, number_value, source, external_id
  ) VALUES (43, 42, '2026-09-01T12:00:00.000Z', 'Weight 80 kg', 80, 'legacy-import', 'weight-1')`);
  const settings = {
    connectionSettings: temporary.target.connection,
    backupConfirmed: true,
    writersStopped: true,
    output: { write() {} },
  };
  const result = await runDatabaseMigrations(settings);
  assert.deepEqual(result.applied, [32]);
  const assertPreserved = () => {
    assert.equal(inspectDatabase(database).ready, true);
    const row = database.prepare(`SELECT entry.journal_entry_id, tracker.tracker_id,
      tracker.journal_group_id, entry.content_text, entry.number_value, entry.source, entry.external_id
      FROM journal_entries entry JOIN trackers tracker USING (tracker_id)`).get();
    assert.deepEqual(row, {
      journal_entry_id: 43, tracker_id: 42, journal_group_id: 41,
      content_text: "Weight 80 kg", number_value: 80, source: "legacy-import", external_id: "weight-1",
    });
    assert.throws(() => database.exec("UPDATE trackers SET unit = 'lb' WHERE tracker_id = 42"), /cannot change after numeric entries/u);
    assert.throws(() => database.exec("UPDATE trackers SET journal_group_id = 999 WHERE tracker_id = 42"), /foreign key constraint/iu);
    assert.throws(() => database.exec(`INSERT INTO journal_entries
      (tracker_id, content_text, source, external_id) VALUES (42, 'Duplicate', 'legacy-import', 'weight-1')`), /Duplicate entry/iu);
  };
  assertPreserved();
  // Replay the DDL itself, as recovery does after a partial implicit commit.
  const migration = readMigrationLedger(migrationsFilename).find(({ version }) => version === 32);
  for (const statement of splitMariaDbStatements(migration.sql)) database.exec(statement);
  assertPreserved();
  assert.deepEqual((await runDatabaseMigrations(settings)).applied, []);
});
