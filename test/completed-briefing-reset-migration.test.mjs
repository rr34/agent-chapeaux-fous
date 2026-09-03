import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

test("migration 0026 resets completed briefings but preserves interrupted runs", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "completed-briefing-reset-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = new DatabaseSync(path.join(directory, "agent.sqlite"));
  context.after(() => database.close());
  database.exec(`
    CREATE TABLE interaction_guide_steps (
      interaction_guide_step_id INTEGER PRIMARY KEY,
      interaction_guide_id INTEGER NOT NULL,
      answers_json TEXT NOT NULL,
      progress_state TEXT NOT NULL,
      updated_at_utc TEXT
    ) STRICT;
    CREATE TABLE activity_events (
      event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      subject_type TEXT,
      subject_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;

    INSERT INTO interaction_guide_steps
      (interaction_guide_step_id, interaction_guide_id, answers_json, progress_state)
    VALUES
      (1, 1, '{"prior":"answer"}', 'completed'),
      (2, 1, '{"also":"done"}', 'completed'),
      (3, 2, '{"finished":"earlier"}', 'completed'),
      (4, 2, '{"current":"answer"}', 'active');
    INSERT INTO activity_events (event_type, subject_type, subject_id, payload_json) VALUES
      ('interaction_guide.run_started', 'interaction_guide_run', 'finished-run', '{"interactionGuideId":1}'),
      ('interaction_guide.run_completed', 'interaction_guide_run', 'finished-run', '{"interactionGuideId":1}'),
      ('interaction_guide.run_started', 'interaction_guide_run', 'older-finished-run', '{"interactionGuideId":2}'),
      ('interaction_guide.run_completed', 'interaction_guide_run', 'older-finished-run', '{"interactionGuideId":2}'),
      ('interaction_guide.run_started', 'interaction_guide_run', 'active-run', '{"interactionGuideId":2}');
  `);

  const migration = readMigrationLedger(path.resolve("db/migrations.sql"))
    .find(({ version }) => version === 26);
  assert.ok(migration);
  database.exec(migration.sql);

  assert.deepEqual(
    database.prepare(`
      SELECT interaction_guide_id, answers_json, progress_state
      FROM interaction_guide_steps
      ORDER BY interaction_guide_step_id
    `).all().map((row) => ({ ...row })),
    [
      { interaction_guide_id: 1, answers_json: "{}", progress_state: "pending" },
      { interaction_guide_id: 1, answers_json: "{}", progress_state: "pending" },
      { interaction_guide_id: 2, answers_json: '{"finished":"earlier"}', progress_state: "completed" },
      { interaction_guide_id: 2, answers_json: '{"current":"answer"}', progress_state: "active" },
    ],
  );
});
