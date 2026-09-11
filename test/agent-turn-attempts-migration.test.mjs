import assert from "node:assert/strict";
import test from "node:test";
import { runDatabaseMigrations } from "../scripts/migrate-database.mjs";
import { verifyDatabase } from "../scripts/verify-database.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("migration removes populated legacy agent turn attempts and safely replays", async context => {
  const temporary = temporaryDatabase();
  context.after(temporary.cleanup);
  const database = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => database.close());

  database.exec(`CREATE TABLE agent_turn_attempts (
    attempt_id BIGINT UNSIGNED NOT NULL PRIMARY KEY
  ) ENGINE=InnoDB`);
  for (let attemptId = 1; attemptId <= 36; attemptId += 1) {
    database.prepare("INSERT INTO agent_turn_attempts (attempt_id) VALUES (?)").run(attemptId);
  }
  database.exec("UPDATE database_meta SET schema_version = 37 WHERE singleton = 1");

  const options = {
    connectionSettings: temporary.target.connection,
    backupConfirmed: true,
    writersStopped: false,
    output: { write() {} },
  };
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [38]);
  assert.deepEqual(database.prepare(`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'agent_turn_attempts'`).all(), []);
  await verifyDatabase(database);

  database.exec("UPDATE database_meta SET schema_version = 37 WHERE singleton = 1");
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [38]);
  await verifyDatabase(database);
});
