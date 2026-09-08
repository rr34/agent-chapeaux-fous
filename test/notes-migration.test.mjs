import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { runDatabaseMigrations, migrationsFilename } from "../scripts/migrate-database.mjs";
import { readMigrationLedger, splitMariaDbStatements } from "../scripts/database-migrations.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { inspectDatabase } from "../src/database.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("removing a populated notes table preserves Journal and contact notes and supports recovery replay", async (context) => {
  const schema = fs.readFileSync(baselineFilename, "utf8").replace("VALUES (1, 33,", "VALUES (1, 32,");
  const temporary = temporaryDatabase({ schema });
  context.after(temporary.cleanup);
  const database = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => database.close());
  database.exec(`CREATE TABLE notes (
    note_id BIGINT UNSIGNED PRIMARY KEY, body_text LONGTEXT NOT NULL,
    source_event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    CONSTRAINT notes_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id)
  ) ENGINE=InnoDB`);
  database.exec("INSERT INTO notes (note_id, body_text) VALUES (1, 'Discard this note')");
  database.exec("INSERT INTO trackers (tracker_id, name) VALUES (42, 'Notes')");
  database.exec("INSERT INTO journal_entries (journal_entry_id, tracker_id, content_text) VALUES (43, 42, 'Keep this journal entry')");
  database.exec("INSERT INTO contacts (contact_id, display_name, notes) VALUES (44, 'Example contact', 'Keep this contact note')");
  const journal = database.prepare("SELECT * FROM journal_entries").all();
  const contacts = database.prepare("SELECT * FROM contacts").all();
  const settings = {
    connectionSettings: temporary.target.connection,
    backupConfirmed: true,
    writersStopped: false,
    output: { write() {} },
  };
  const assertPreserved = () => {
    assert.equal(inspectDatabase(database).ready, true);
    assert.deepEqual(database.prepare("SELECT * FROM journal_entries").all(), journal);
    assert.deepEqual(database.prepare("SELECT * FROM contacts").all(), contacts);
    assert.deepEqual(database.prepare(`SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notes'`).all(), []);
  };
  assert.deepEqual((await runDatabaseMigrations(settings)).applied, [33]);
  assertPreserved();
  assert.deepEqual((await runDatabaseMigrations(settings)).applied, []);
  // Simulate the drop committing before the durable version marker advances.
  database.exec("UPDATE database_meta SET schema_version = 32 WHERE singleton = 1");
  assert.deepEqual((await runDatabaseMigrations(settings)).applied, [33]);
  const migration = readMigrationLedger(migrationsFilename).find(({ version }) => version === 33);
  for (const statement of splitMariaDbStatements(migration.sql)) database.exec(statement);
  assertPreserved();
});
