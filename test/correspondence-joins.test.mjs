import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { readMigrationLedger, splitMariaDbStatements } from "../scripts/database-migrations.mjs";
import { runDatabaseMigrations, migrationsFilename, assertMigrationSpecificIntegrity } from "../scripts/migrate-database.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { baselineBeforeNativeDateTime, temporaryDatabase } from "./helpers.mjs";

test("message joins support many-to-many links, reject invalid pairs, cascade only links, and preserve data on replay", async context => {
  const schema = baselineBeforeNativeDateTime(fs.readFileSync(baselineFilename, "utf8"))
    .replace(/CREATE TABLE (?:todo_correspondence_join|calendar_events_correspondence_join) \([\s\S]*?\n\) ENGINE=InnoDB[^\n]*;\n\n/gu, "")
    .replace("VALUES (1, 43,", "VALUES (1, 36,");
  const temporary = temporaryDatabase({ schema });
  context.after(temporary.cleanup);
  const db = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => db.close());
  const options = { connectionSettings: temporary.target.connection, backupConfirmed: true, writersStopped: true, output: { write() {} } };
  const migration = readMigrationLedger(migrationsFilename).find(item => item.version === 37);
  // Recover from a partial DDL commit with just the first table present.
  db.exec(splitMariaDbStatements(migration.sql)[0]);
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [37, 38, 39, 40, 41, 42, 43, 44, 45, 46]);
  db.exec("INSERT INTO correspondence (correspondence_id, medium, direction) VALUES (1, 'email', 'inbound'), (2, 'sms', 'outbound')");
  db.exec("INSERT INTO correspondence (correspondence_id, medium, direction, call_disposition, call_duration_seconds) VALUES (3, 'call', 'inbound', 'answered', 240)");
  assert.throws(() => db.exec("INSERT INTO correspondence (medium, direction) VALUES ('call', 'inbound')"), /constraint/iu);
  assert.throws(() => db.exec("INSERT INTO correspondence (medium, direction, call_disposition) VALUES ('sms', 'outbound', 'missed')"), /constraint/iu);
  assert.throws(() => db.exec("INSERT INTO correspondence (medium, direction, call_disposition, delivery_status) VALUES ('call', 'outbound', 'missed', 'sent')"), /constraint/iu);
  db.exec("INSERT INTO contacts (contact_id, contact_kind, display_name) VALUES (10, 'person', 'Watch Customer')");
  db.exec("INSERT INTO tags (tag_id, slug, label) VALUES (10, 'watch-customer', 'Watch Customer')");
  db.exec("INSERT INTO contacts_tags_join (tag_id, record_type, record_id) VALUES (10, 'contact', '10')");
  db.exec(`INSERT INTO correspondence_participants
    (correspondence_id, participant_role, contact_id, address_value, display_name)
    VALUES (2, 'sender', NULL, '+15550000000', 'Me'),
           (2, 'recipient', 10, '+15551112222', 'Watch Customer'),
           (2, 'recipient', NULL, '+15553334444', 'Other group participant')`);
  const watchMessages = db.prepare(`SELECT DISTINCT message.correspondence_id
    FROM correspondence AS message
    JOIN correspondence_participants AS participant USING (correspondence_id)
    JOIN contacts_tags_join AS assignment
      ON assignment.record_type = 'contact'
     AND assignment.record_id = CAST(participant.contact_id AS CHAR)
    JOIN tags AS tag USING (tag_id)
    WHERE message.medium IN ('sms', 'mms', 'rcs', 'imessage', 'whatsapp', 'chat')
      AND message.direction = 'outbound'
      AND message.occurred_at_utc >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 6 MONTH)
      AND tag.slug = 'watch-customer'`).all();
  assert.deepEqual(watchMessages, [{ correspondence_id: 2 }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM correspondence_participants WHERE correspondence_id = 2").get().count, 3);
  db.exec("INSERT INTO todo_personal (personal_task_id, todo_group_id, text) SELECT 1, todo_group_id, 'First task' FROM todo_groups WHERE name = 'Inbox'");
  db.exec("INSERT INTO todo_personal (personal_task_id, todo_group_id, text) SELECT 2, todo_group_id, 'Second task' FROM todo_groups WHERE name = 'Inbox'");
  const insertEvent = db.prepare("INSERT INTO calendar_events (calendar_event_id, title, starts_at_utc) VALUES (?, ?, ?)");
  insertEvent.run(1, "First event", "2026-09-10T12:00:00.000Z");
  insertEvent.run(2, "Second event", "2026-09-11T12:00:00.000Z");
  for (const [table, field] of [["todo_correspondence_join", "personal_task_id"], ["calendar_events_correspondence_join", "calendar_event_id"]]) {
    const insert = db.prepare(`INSERT INTO ${table} (${field}, correspondence_id) VALUES (?, ?)`);
    for (const pair of [[1, 1], [1, 2], [2, 1]]) insert.run(...pair);
    assert.throws(() => insert.run(1, 1), /Duplicate entry/iu);
    assert.throws(() => insert.run(999, 1), /foreign key constraint/iu);
    assert.throws(() => insert.run(1, 999), /foreign key constraint/iu);
    assert.match(db.prepare(`SELECT created_at_utc FROM ${table} LIMIT 1`).get().created_at_utc, /^\d{4}-.*Z$/u);
  }
  for (const statement of splitMariaDbStatements(migration.sql)) db.exec(statement);
  assert.deepEqual((await runDatabaseMigrations(options)).applied, []);
  for (const table of ["todo_correspondence_join", "calendar_events_correspondence_join"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 3);
  }
  db.exec("DELETE FROM todo_personal WHERE personal_task_id = 1");
  db.exec("DELETE FROM calendar_events WHERE calendar_event_id = 1");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM correspondence").get().count, 3);
  db.exec("DELETE FROM correspondence WHERE correspondence_id = 1");
  for (const table of ["todo_correspondence_join", "calendar_events_correspondence_join"]) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM todo_personal").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM calendar_events").get().count, 1);
  // An existing malformed table must fail validation instead of being silently accepted.
  db.exec("ALTER TABLE todo_correspondence_join DROP FOREIGN KEY todo_correspondence_join_message");
  const connection = { query: async (sql, parameters) => [db.prepare(sql).all(...parameters)] };
  await assert.rejects(assertMigrationSpecificIntegrity(connection, migration, temporary.target.connection.database), /missing cascading foreign key message/u);
});
