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
  .find(({ version }) => version === 20);

test("structured-interaction migration adds ordered steps with object answers", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-structured-steps-"));
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
  `);
  database.exec(migration.sql);
  const guide = database.prepare(`
    INSERT INTO interaction_guides (name, guide_text, created_at_utc)
    VALUES ('Evening Brief', 'Build the brief efficiently.', '2026-08-27T20:00:00.000Z')
    RETURNING interaction_guide_id
  `).get();
  database.prepare(`
    INSERT INTO interaction_guide_steps (
      interaction_guide_id, step_number, name, opening_text,
      objective_text, instructions_text, completion_mode
    ) VALUES (?, 1, 'Outcome', '1. What must be done tonight?',
              'Capture the exact desired outcome.', 'Keep asking step 1 until it is concrete.',
              'response_valid')
  `).run(guide.interaction_guide_id);
  const step = database.prepare("SELECT * FROM interaction_guide_steps").get();
  assert.equal(step.answers_json, "{}");
  assert.equal(step.enabled, 1);
  assert.throws(
    () => database.prepare(`
      INSERT INTO interaction_guide_steps (
        interaction_guide_id, step_number, opening_text, objective_text, answers_json
      ) VALUES (?, 2, 'Question', 'Objective', '[]')
    `).run(guide.interaction_guide_id),
    /CHECK constraint failed/,
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO interaction_guide_steps (
        interaction_guide_id, step_number, opening_text, objective_text
      ) VALUES (?, 1, 'Duplicate', 'Duplicate')
    `).run(guide.interaction_guide_id),
    /UNIQUE constraint failed/,
  );
});
