import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { runDatabaseMigrations } from "../scripts/migrate-database.mjs";
import { verifyDatabase } from "../scripts/verify-database.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { baselineBeforeDailyPaperPin, temporaryDatabase } from "./helpers.mjs";

test("daily-paper group pin migration is default-false, constrained, and replayable", async (context) => {
  const schema = baselineBeforeDailyPaperPin(fs.readFileSync(baselineFilename, "utf8"));
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

  assert.deepEqual((await runDatabaseMigrations(options)).applied, [50, 51, 52]);
  await verifyDatabase(database);
  assert.deepEqual(database.prepare(`
    SELECT name, daily_paper_pinned FROM todo_groups ORDER BY todo_group_id
  `).all(), [
    { name: "Inbox", daily_paper_pinned: 0 },
    { name: "Development", daily_paper_pinned: 0 },
  ]);
  assert.throws(
    () => database.prepare("UPDATE todo_groups SET daily_paper_pinned = 2 WHERE todo_group_id = 1").run(),
    /CONSTRAINT|constraint/iu,
  );

  database.exec("UPDATE todo_groups SET daily_paper_pinned = 1 WHERE todo_group_id = 1");
  database.exec("UPDATE database_meta SET schema_version = 49 WHERE singleton = 1");
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [50, 51, 52]);
  assert.equal(database.prepare(`
    SELECT daily_paper_pinned FROM todo_groups WHERE todo_group_id = 1
  `).get().daily_paper_pinned, 1);
});
