import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readMigrationLedger(path.join(root, "db", "migrations.sql"))
  .find(({ version }) => version === 16);

test("migration 16 makes automatic to-do sequence assignment opt-in by group", () => {
  assert.ok(migration);
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE todo_groups (
        todo_group_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        archived_at_utc TEXT,
        created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at_utc TEXT,
        sort_position INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE personal_tasks (
        personal_task_id INTEGER PRIMARY KEY,
        todo_group_id INTEGER NOT NULL REFERENCES todo_groups(todo_group_id),
        sequence INTEGER CHECK (sequence IS NULL OR sequence > 0),
        text TEXT NOT NULL,
        sort_position INTEGER NOT NULL DEFAULT 0,
        UNIQUE (todo_group_id, sequence)
      ) STRICT;
      INSERT INTO todo_groups (todo_group_id, name) VALUES (1, 'Ordinary'), (2, 'Sequenced');
    `);
    database.exec(migration.sql);
    database.prepare("UPDATE todo_groups SET uses_sequence = 1 WHERE todo_group_id = 2").run();

    database.prepare(`
      INSERT INTO personal_tasks (todo_group_id, text) VALUES (1, 'No number')
    `).run();
    database.prepare(`
      INSERT INTO personal_tasks (todo_group_id, sequence, text) VALUES (2, 4, 'Existing four')
    `).run();
    database.prepare(`
      INSERT INTO personal_tasks (todo_group_id, text) VALUES (2, 'Gets five')
    `).run();
    database.prepare(`
      INSERT INTO personal_tasks (todo_group_id, text) VALUES (2, 'Gets six')
    `).run();

    assert.deepEqual(
      database.prepare("SELECT sequence FROM personal_tasks ORDER BY personal_task_id")
        .all().map(({ sequence }) => sequence),
      [null, 4, 5, 6],
    );
    assert.throws(
      () => database.prepare(`
        INSERT INTO personal_tasks (todo_group_id, sequence, text) VALUES (2, 6, 'Duplicate')
      `).run(),
      /UNIQUE constraint failed/,
    );
  } finally {
    database.close();
  }
});
