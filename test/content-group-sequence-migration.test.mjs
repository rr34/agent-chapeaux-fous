import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { runDatabaseMigrations } from "../scripts/migrate-database.mjs";
import { verifyDatabase } from "../scripts/verify-database.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { baselineBeforeContentGroupSequence, temporaryDatabase } from "./helpers.mjs";

test("content-group sequence migration backfills existing numbered groups and is replayable", async (context) => {
  const schema = baselineBeforeContentGroupSequence(fs.readFileSync(baselineFilename, "utf8"));
  const temporary = temporaryDatabase({ schema });
  context.after(temporary.cleanup);
  const database = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => database.close());
  database.exec("INSERT INTO content_groups (name, sort_position) VALUES ('Numbered', 20), ('Manual', 30)");
  database.exec(`INSERT INTO content_items (content_group_id, sequence, title)
    SELECT content_group_id, 7, 'Existing sequence' FROM content_groups WHERE name = 'Numbered'`);
  const options = {
    connectionSettings: temporary.target.connection,
    backupConfirmed: true,
    writersStopped: true,
    output: { write() {} },
  };

  assert.deepEqual((await runDatabaseMigrations(options)).applied, [56]);
  await verifyDatabase(database);
  assert.deepEqual(database.prepare(`
    SELECT name, uses_sequence FROM content_groups ORDER BY content_group_id
  `).all(), [
    { name: "General", uses_sequence: 0 },
    { name: "Numbered", uses_sequence: 1 },
    { name: "Manual", uses_sequence: 0 },
  ]);
  assert.throws(
    () => database.prepare("UPDATE content_groups SET uses_sequence = 2 WHERE content_group_id = 1").run(),
    /CONSTRAINT|constraint/iu,
  );

  database.exec("UPDATE content_groups SET uses_sequence = 0 WHERE name = 'Numbered'");
  database.exec("UPDATE database_meta SET schema_version = 55 WHERE singleton = 1");
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [56]);
  assert.equal(database.prepare(`
    SELECT uses_sequence FROM content_groups WHERE name = 'Numbered'
  `).get().uses_sequence, 0);
});
