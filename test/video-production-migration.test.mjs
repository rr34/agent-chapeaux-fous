import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

test("migration 0023 links scripts to render jobs and permits only one active attempt", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "video-production-migration-"));
  const filename = path.join(directory, "agent.sqlite");
  const database = new DatabaseSync(filename);
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE database_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        schema_version INTEGER NOT NULL,
        description TEXT
      ) STRICT;
      INSERT INTO database_meta VALUES (1, 22, 'migration test');
      CREATE TABLE activity_events (event_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE files (file_id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE content_items (content_id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE personal_tasks (personal_task_id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE video_scripts (
        video_script_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL
      ) STRICT;
      CREATE TABLE video_jobs (
        video_job_id INTEGER PRIMARY KEY,
        request_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
        source_turn_id TEXT,
        content_id INTEGER REFERENCES content_items(content_id) ON DELETE SET NULL,
        renderer TEXT NOT NULL DEFAULT 'remotion',
        template TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        input_json TEXT NOT NULL DEFAULT '{}',
        output_file_id INTEGER REFERENCES files(file_id) ON DELETE SET NULL,
        error_text TEXT,
        created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        started_at_utc TEXT,
        completed_at_utc TEXT,
        updated_at_utc TEXT,
        personal_task_id INTEGER REFERENCES personal_tasks(personal_task_id) ON DELETE SET NULL
      ) STRICT;
      INSERT INTO video_scripts (title) VALUES ('Grounded production');
    `);
    const migration = readMigrationLedger(path.resolve("db/migrations.sql"))
      .find(({ version }) => version === 23);
    assert.ok(migration);
    database.exec(migration.sql);

    database.prepare(`
      INSERT INTO video_jobs (template, status, video_script_id)
      VALUES ('agent-ui-story', 'queued', 1)
    `).run();
    assert.throws(
      () => database.prepare(`
        INSERT INTO video_jobs (template, status, video_script_id)
        VALUES ('agent-ui-story', 'rendering', 1)
      `).run(),
      /UNIQUE constraint failed/,
    );
    database.prepare("UPDATE video_jobs SET status = 'complete' WHERE video_job_id = 1").run();
    database.prepare(`
      INSERT INTO video_jobs (template, status, video_script_id)
      VALUES ('agent-ui-story', 'queued', 1)
    `).run();
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM video_jobs").get().count, 2);
    database.prepare("DELETE FROM video_scripts WHERE video_script_id = 1").run();
    assert.equal(database.prepare(
      "SELECT COUNT(*) AS count FROM video_jobs WHERE video_script_id IS NULL",
    ).get().count, 2);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
