import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readMigrationLedger(path.join(root, "db", "migrations.sql"))
  .find(({ version }) => version === 24);

test("migration 24 adds a nullable positive planned duration to personal tasks", () => {
  assert.ok(migration);
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE personal_tasks (
        personal_task_id INTEGER PRIMARY KEY,
        text TEXT NOT NULL
      ) STRICT;
    `);
    database.exec(migration.sql);
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM pragma_table_info('personal_tasks')
      WHERE name = 'duration_minutes'
    `).get().count, 1);
    database.prepare("INSERT INTO personal_tasks (text, duration_minutes) VALUES ('Timed', 90)").run();
    database.prepare("INSERT INTO personal_tasks (text, duration_minutes) VALUES ('Untimed', NULL)").run();
    assert.throws(
      () => database.prepare("INSERT INTO personal_tasks (text, duration_minutes) VALUES ('Invalid', 0)").run(),
      /CHECK constraint failed/,
    );
  } finally {
    database.close();
  }
});
