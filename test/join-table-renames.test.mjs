import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { joinTableRenames, runDatabaseMigrations } from "../scripts/migrate-database.mjs";
import { verifyDatabase } from "../scripts/verify-database.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { baselineBeforeJournalLevels, restorePre46JournalTableNames, temporaryDatabase } from "./helpers.mjs";

test("join table renames preserve populated non-correspondence relationships through partial recovery and replay", async context => {
  let schema = baselineBeforeJournalLevels(fs.readFileSync(baselineFilename, "utf8"))
    .replace("VALUES (1, 45,", "VALUES (1, 43,");
  for (const [previous, current] of Object.entries(joinTableRenames)) schema = schema.replaceAll(current, previous);
  const temporary = temporaryDatabase({ schema });
  context.after(temporary.cleanup);
  const db = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => db.close());
  db.exec("INSERT INTO activity_events (event_id, event_type, actor_type, source) VALUES ('request-1', 'request.received', 'user', 'test')");
  db.exec("INSERT INTO files (file_id, storage_path) VALUES (1, 'test/file')");
  db.exec("INSERT INTO contacts (contact_id, display_name) VALUES (1, 'Example contact')");
  db.exec("INSERT INTO calendar_events (calendar_event_id, title, starts_at_utc) VALUES (1, 'Example event', '2026-09-13 12:00:00.000')");
  db.exec("INSERT INTO video_scripts (video_script_id, title, script_json, script_text) VALUES (1, 'Example script', '{}', 'Example text')");
  db.exec("INSERT INTO activity_event_files (event_id, file_id, file_role, ordinal) VALUES ('request-1', 1, 'input', 2)");
  db.exec("INSERT INTO calendar_event_contacts (calendar_event_id, contact_id, response_status) VALUES (1, 1, 'accepted')");
  db.exec("INSERT INTO video_script_sources (video_script_id, request_event_id, source_order) VALUES (1, 'request-1', 1)");
  const preservedRenames = Object.keys(joinTableRenames).filter(name => name !== "correspondence_files");
  const snapshots = Object.fromEntries(preservedRenames.map(name => [name, db.prepare(`SELECT * FROM ${name}`).all()]));
  db.exec("RENAME TABLE activity_event_files TO activity_event_files_join");
  const options = { connectionSettings: temporary.target.connection, backupConfirmed: true, writersStopped: true, output: { write() {} } };
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [44, 45, 46]);
  const assertPreserved = async () => {
    for (const [previous, current] of Object.entries(joinTableRenames).filter(([name]) => preservedRenames.includes(name))) {
      assert.deepEqual(db.prepare(`SELECT * FROM ${current}`).all(), snapshots[previous]);
      assert.deepEqual(db.prepare("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?").all(previous), []);
    }
    await verifyDatabase(db);
  };
  await assertPreserved();
  restorePre46JournalTableNames(db);
  db.exec("UPDATE database_meta SET schema_version = 43 WHERE singleton = 1");
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [44, 45, 46]);
  await assertPreserved();
  assert.deepEqual((await runDatabaseMigrations(options)).applied, []);
  // Existing uniqueness, foreign keys and cascade rules still apply.
  db.exec("INSERT INTO correspondence (correspondence_id, medium, direction) VALUES (1, 'email', 'inbound')");
  db.exec("INSERT INTO correspondence_files_join (correspondence_id, file_id, attachment_role) VALUES (1, 1, 'inline')");
  assert.throws(() => db.exec("INSERT INTO correspondence_files_join (correspondence_id, file_id) VALUES (1, 1)"), /Duplicate entry/iu);
  assert.throws(() => db.exec("INSERT INTO correspondence_files_join (correspondence_id, file_id) VALUES (1, 999)"), /foreign key constraint/iu);
  db.exec("DELETE FROM video_scripts WHERE video_script_id = 1");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM video_script_sources_join").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_events").get().n, 1);
});
