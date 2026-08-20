import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readMigrationLedger(path.join(root, "db", "migrations.sql"))
  .find(({ version }) => version === 18);

test("interaction-guide migration adds durable guides and an optional recurring-todo link", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-guide-migration-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = new DatabaseSync(path.join(directory, "agent.sqlite"));
  context.after(() => database.close());
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE todo_groups (todo_group_id INTEGER PRIMARY KEY) STRICT;
    CREATE TABLE todo_routines (
      todo_routine_id INTEGER PRIMARY KEY,
      todo_group_id INTEGER NOT NULL REFERENCES todo_groups(todo_group_id),
      text TEXT NOT NULL,
      first_scheduled_at_utc TEXT NOT NULL,
      first_due_at_utc TEXT,
      time_zone TEXT NOT NULL,
      recurrence_rule TEXT NOT NULL,
      disabled_at_utc TEXT,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0
    ) STRICT;
  `);
  database.exec(migration.sql);
  const guide = database.prepare(`
    INSERT INTO interaction_guides (name, guide_text)
    VALUES ('Morning Check-in', 'Ask what matters today.')
    RETURNING *
  `).get();
  database.prepare(`
    INSERT INTO todo_groups (todo_group_id) VALUES (1)
  `).run();
  database.prepare(`
    INSERT INTO todo_routines (
      todo_group_id, text, first_scheduled_at_utc, time_zone,
      recurrence_rule, created_at_utc, interaction_guide_id
    ) VALUES (1, 'Plan the day', '2026-08-21T12:00:00.000Z',
              'America/New_York', 'FREQ=DAILY', '2026-08-20T12:00:00.000Z', ?)
  `).run(guide.interaction_guide_id);
  assert.equal(database.prepare(`
    SELECT interaction_guide_id FROM todo_routines
  `).get().interaction_guide_id, guide.interaction_guide_id);
  assert.throws(
    () => database.prepare(`
      INSERT INTO interaction_guides (name, guide_text)
      VALUES ('morning check-in', 'Duplicate')
    `).run(),
    /UNIQUE constraint failed/,
  );
});
