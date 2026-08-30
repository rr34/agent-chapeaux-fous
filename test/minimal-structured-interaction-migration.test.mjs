import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

test("migration 0022 makes steps minimal and backfills resumable progress", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "minimal-interaction-migration-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = new DatabaseSync(path.join(directory, "agent.sqlite"));
  context.after(() => database.close());
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE interaction_guides (
      interaction_guide_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      guide_text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      version INTEGER NOT NULL DEFAULT 1,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT
    ) STRICT;
    CREATE TABLE interaction_guide_steps (
      interaction_guide_step_id INTEGER PRIMARY KEY,
      interaction_guide_id INTEGER NOT NULL REFERENCES interaction_guides(interaction_guide_id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL,
      name TEXT,
      opening_text TEXT NOT NULL,
      objective_text TEXT NOT NULL,
      instructions_text TEXT,
      answers_json TEXT NOT NULL DEFAULT '{}',
      completion_mode TEXT NOT NULL DEFAULT 'response_valid',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT,
      UNIQUE (interaction_guide_id, step_number)
    ) STRICT;
    CREATE INDEX interaction_guide_steps_guide_order
      ON interaction_guide_steps(interaction_guide_id, enabled, step_number);
    CREATE TABLE activity_events (
      event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      subject_type TEXT,
      subject_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;

    INSERT INTO interaction_guides
      (interaction_guide_id, name, guide_text, created_at_utc)
    VALUES
      (1, 'Interrupted', 'Old parent brief', '2026-08-30T10:00:00.000Z'),
      (2, 'Finished', 'Old finished brief', '2026-08-30T10:00:00.000Z');
    INSERT INTO interaction_guide_steps (
      interaction_guide_id, step_number, name, opening_text, objective_text,
      instructions_text, answers_json, created_at_utc
    ) VALUES
      (1, 1, 'First', 'First opening', 'First objective', 'First instructions', '{"first":"yes"}', '2026-08-30T10:00:00.000Z'),
      (1, 2, 'Second', 'Second opening', 'Second objective', 'Second instructions', '{}', '2026-08-30T10:00:00.000Z'),
      (1, 3, 'Third', 'Third opening', 'Third objective', NULL, '{}', '2026-08-30T10:00:00.000Z'),
      (2, 1, 'Only', 'Only opening', 'Only objective', NULL, '{"done":true}', '2026-08-30T10:00:00.000Z');
    INSERT INTO activity_events (event_type, subject_type, subject_id, payload_json) VALUES
      ('interaction_guide.run_started', 'interaction_guide_run', 'active-run', '{"interactionGuideId":1,"guideVersion":1}'),
      ('interaction_guide.step_completed', 'interaction_guide_run', 'active-run', '{"interactionGuideId":1,"stepNumber":1}'),
      ('interaction_guide.run_started', 'interaction_guide_run', 'finished-run', '{"interactionGuideId":2,"guideVersion":1}'),
      ('interaction_guide.step_completed', 'interaction_guide_run', 'finished-run', '{"interactionGuideId":2,"stepNumber":1}'),
      ('interaction_guide.run_completed', 'interaction_guide_run', 'finished-run', '{"interactionGuideId":2}');
  `);

  const migration = readMigrationLedger(path.resolve("db/migrations.sql"))
    .find(({ version }) => version === 22);
  assert.ok(migration);
  database.exec(migration.sql);

  assert.deepEqual(
    database.prepare("PRAGMA table_info(interaction_guides)").all().map(({ name }) => name),
    ["interaction_guide_id", "name", "status", "version", "created_at_utc", "updated_at_utc"],
  );
  assert.deepEqual(
    database.prepare("PRAGMA table_info(interaction_guide_steps)").all().map(({ name }) => name),
    [
      "interaction_guide_step_id", "interaction_guide_id", "step_number", "opening_text",
      "instructions_text", "answers_json", "completion_mode", "enabled", "created_at_utc",
      "updated_at_utc", "progress_state",
    ],
  );
  assert.deepEqual(
    database.prepare(`
      SELECT interaction_guide_id, step_number, progress_state
      FROM interaction_guide_steps ORDER BY interaction_guide_id, step_number
    `).all().map((row) => ({ ...row })),
    [
      { interaction_guide_id: 1, step_number: 1, progress_state: "completed" },
      { interaction_guide_id: 1, step_number: 2, progress_state: "active" },
      { interaction_guide_id: 1, step_number: 3, progress_state: "pending" },
      { interaction_guide_id: 2, step_number: 1, progress_state: "pending" },
    ],
  );
  assert.equal(
    database.prepare("SELECT answers_json FROM interaction_guide_steps WHERE interaction_guide_id = 1 AND step_number = 1").get().answers_json,
    '{"first":"yes"}',
  );
  assert.throws(
    () => database.prepare("UPDATE interaction_guide_steps SET progress_state = 'unknown' WHERE interaction_guide_step_id = 1").run(),
    /CHECK constraint failed/,
  );
});
