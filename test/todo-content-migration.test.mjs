import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { runDatabaseMigrations } from "../scripts/migrate-database.mjs";
import { verifyDatabase } from "../scripts/verify-database.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { baselineBeforeTodoContentJoin, temporaryDatabase } from "./helpers.mjs";

test("to-do content migration adds a replayable cascading many-to-many relationship", async (context) => {
  const schema = baselineBeforeTodoContentJoin(fs.readFileSync(baselineFilename, "utf8"));
  const temporary = temporaryDatabase({ schema });
  context.after(temporary.cleanup);
  const database = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => database.close());
  const options = {
    connectionSettings: temporary.target.connection,
    backupConfirmed: true,
    writersStopped: true,
    output: { write() {} },
  };

  assert.deepEqual((await runDatabaseMigrations(options)).applied, [49, 50, 51]);
  await verifyDatabase(database);
  database.exec(`INSERT INTO todo_personal (personal_task_id, todo_group_id, text)
    VALUES (501, 1, 'Review content')`);
  database.exec(`INSERT INTO content_items (content_id, content_group_id, title)
    VALUES (601, 1, 'Reference content')`);
  database.exec(`INSERT INTO todo_content_join (personal_task_id, content_id)
    VALUES (501, 601)`);
  assert.throws(
    () => database.exec("INSERT INTO todo_content_join (personal_task_id, content_id) VALUES (501, 601)"),
    /Duplicate entry/iu,
  );

  database.exec("UPDATE database_meta SET schema_version = 48 WHERE singleton = 1");
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [49, 50, 51]);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM todo_content_join").get().count, 1);

  database.exec("DELETE FROM content_items WHERE content_id = 601");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM todo_content_join").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM todo_personal WHERE personal_task_id = 501").get().count, 1);
});
