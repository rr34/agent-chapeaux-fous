import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

test("migration 0028 consolidates exchange definition fields into contract_json", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-contract-migration-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = new DatabaseSync(path.join(directory, "agent.sqlite"));
  context.after(() => database.close());
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE interaction_guides (
      interaction_guide_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    ) STRICT;
    CREATE TABLE interaction_guide_steps (
      interaction_guide_step_id INTEGER PRIMARY KEY,
      interaction_guide_id INTEGER NOT NULL
        REFERENCES interaction_guides(interaction_guide_id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL CHECK (step_number > 0),
      opening_text TEXT NOT NULL,
      instructions_text TEXT,
      answers_json TEXT NOT NULL DEFAULT '{}',
      completion_mode TEXT NOT NULL DEFAULT 'response_valid',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT,
      progress_state TEXT NOT NULL DEFAULT 'pending',
      UNIQUE (interaction_guide_id, step_number)
    ) STRICT;
    CREATE INDEX interaction_guide_steps_guide_order
      ON interaction_guide_steps(interaction_guide_id, enabled, step_number);
    CREATE INDEX interaction_guide_steps_guide_progress
      ON interaction_guide_steps(interaction_guide_id, progress_state, enabled, step_number);
    INSERT INTO interaction_guides VALUES (1, 'Evening Briefing');
    INSERT INTO interaction_guide_steps (
      interaction_guide_step_id, interaction_guide_id, step_number, opening_text,
      instructions_text, answers_json, completion_mode, enabled, created_at_utc,
      progress_state
    ) VALUES (
      7, 1, 3, 'Please provide your exercise values.',
      'Call log_add for each supplied value.', '{"abs_reps":100}',
      'tool_receipt', 1, '2026-09-03T00:00:00.000Z', 'active'
    );
  `);

  const migration = readMigrationLedger(path.resolve("db/migrations.sql"))
    .find(({ version }) => version === 28);
  assert.ok(migration);
  database.exec(migration.sql);

  const columns = database.prepare("PRAGMA table_info(interaction_guide_steps)")
    .all().map(({ name }) => name);
  assert.deepEqual(columns, [
    "interaction_guide_step_id", "interaction_guide_id", "step_number",
    "opening_text", "contract_json", "answers_json", "enabled",
    "created_at_utc", "updated_at_utc", "progress_state",
  ]);
  const row = database.prepare("SELECT * FROM interaction_guide_steps").get();
  assert.equal(row.opening_text, "Please provide your exercise values.");
  assert.equal(row.answers_json, '{"abs_reps":100}');
  assert.equal(row.progress_state, "active");
  assert.deepEqual(JSON.parse(row.contract_json), {
    version: 1,
    instructions: "Call log_add for each supplied value.",
    inputs: [],
    operations: [],
    recoveryReads: [],
    completion: { mode: "tool_receipt" },
  });
  assert.deepEqual(
    database.prepare("PRAGMA foreign_key_check").all().map((item) => ({ ...item })),
    [],
  );
});
