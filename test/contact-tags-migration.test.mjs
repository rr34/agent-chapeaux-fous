import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { runDatabaseMigrations } from "../scripts/migrate-database.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { inspectDatabase } from "../src/database.mjs";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { temporaryDatabase, baselineBeforeCatchUp } from "./helpers.mjs";

test("contact tag rename preserves assignments and contact operations across upgrade and recovery", async (context) => {
  const schema = baselineBeforeCatchUp(fs.readFileSync(baselineFilename, "utf8"))
    .replace("VALUES (1, 35,", "VALUES (1, 33,")
    .replaceAll("contacts_tags_join", "record_tags");
  const temporary = temporaryDatabase({ schema });
  context.after(temporary.cleanup);
  const database = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => database.close());
  database.exec("CREATE TABLE record_links (record_link_id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB");
  database.exec("INSERT INTO record_links VALUES (1)");
  database.exec("INSERT INTO contacts (contact_id, display_name) VALUES (41, 'Example contact')");
  database.exec("INSERT INTO tags (tag_id, slug, label) VALUES (42, 'family', 'Family')");
  database.exec(`INSERT INTO record_tags (tag_id, record_type, record_id)
    VALUES (42, 'contact', '41'), (42, 'future_record', 'example')`);
  const assignments = database.prepare("SELECT * FROM record_tags ORDER BY record_type, record_id").all();
  const settings = {
    connectionSettings: temporary.target.connection,
    backupConfirmed: true,
    writersStopped: true,
    output: { write() {} },
  };
  const assertMigrated = () => {
    assert.equal(inspectDatabase(database).ready, true);
    assert.deepEqual(database.prepare("SELECT * FROM contacts_tags_join ORDER BY record_type, record_id").all(), assignments);
    assert.deepEqual(database.prepare(`SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('record_tags', 'record_links')`).all(), []);
  };
  assert.deepEqual((await runDatabaseMigrations(settings)).applied, [34, 35, 36]);
  assertMigrated();
  assert.deepEqual((await runDatabaseMigrations(settings)).applied, []);
  // Recover after the rename committed but the drop and version update did not.
  database.exec("CREATE TABLE record_links (record_link_id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB");
  database.exec("UPDATE database_meta SET schema_version = 33 WHERE singleton = 1");
  assert.deepEqual((await runDatabaseMigrations(settings)).applied, [34, 35, 36]);
  assertMigrated();
  const organizer = new OrganizerStore(temporary.target);
  context.after(() => organizer.close());
  assert.deepEqual(organizer.getContact(41).tags, ["Family"]);
  organizer.renameContactTag({ currentTag: "Family", newTag: "Relatives" });
  assert.deepEqual(organizer.getContact(41).tags, ["Relatives"]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contacts_tags_join WHERE record_type = 'future_record'").get().count, 1);
});
