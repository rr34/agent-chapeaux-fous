import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readMigrationLedger(path.join(root, "db", "migrations.sql"))
  .find(({ version }) => version === 15);

function contentDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE contacts (contact_id INTEGER PRIMARY KEY) STRICT;
    CREATE TABLE files (file_id INTEGER PRIMARY KEY) STRICT;
    CREATE TABLE activity_events (event_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE personal_tasks (personal_task_id INTEGER PRIMARY KEY) STRICT;
    CREATE TABLE content_items (
      content_id INTEGER PRIMARY KEY,
      relationship_to_user TEXT NOT NULL DEFAULT 'mine'
        CHECK (relationship_to_user IN ('mine', 'reference')),
      content_kind TEXT NOT NULL DEFAULT 'other'
        CHECK (content_kind IN (
          'video', 'book', 'article', 'post', 'podcast',
          'image', 'document', 'course', 'website', 'other'
        )),
      creator_contact_id INTEGER REFERENCES contacts(contact_id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT,
      transcript TEXT,
      personal_notes TEXT,
      status TEXT NOT NULL DEFAULT 'reference'
        CHECK (status IN (
          'idea', 'draft', 'queued', 'published',
          'reference', 'consumed', 'obsolete', 'archived'
        )),
      host TEXT,
      source_url TEXT,
      external_id TEXT,
      primary_file_id INTEGER REFERENCES files(file_id) ON DELETE SET NULL,
      published_at_utc TEXT,
      consumed_at_utc TEXT,
      source_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT
    ) STRICT;
    CREATE INDEX content_items_creator
      ON content_items(creator_contact_id, published_at_utc DESC);
    CREATE INDEX content_items_kind_status
      ON content_items(relationship_to_user, content_kind, status);
    CREATE TABLE video_jobs (
      video_job_id INTEGER PRIMARY KEY,
      request_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
      source_turn_id TEXT,
      content_id INTEGER REFERENCES content_items(content_id) ON DELETE SET NULL,
      renderer TEXT NOT NULL DEFAULT 'remotion'
        CHECK (renderer IN ('remotion', 'adobe_premiere', 'other')),
      template TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'preparing', 'rendering', 'complete', 'error', 'cancelled')),
      input_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
      output_file_id INTEGER REFERENCES files(file_id) ON DELETE SET NULL,
      error_text TEXT,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      started_at_utc TEXT,
      completed_at_utc TEXT,
      updated_at_utc TEXT,
      personal_task_id INTEGER REFERENCES personal_tasks(personal_task_id) ON DELETE SET NULL
    ) STRICT;
    INSERT INTO content_items (
      content_id, relationship_to_user, content_kind, title, transcript,
      description, status, host, source_url
    ) VALUES (
      7, 'mine', 'video', 'Example title', 'Complete transcript',
      'Example description', 'queued', 'youtube', 'https://example.test/video'
    );
    INSERT INTO video_jobs (video_job_id, content_id, template)
    VALUES (3, 7, 'portrait');
  `);
  return database;
}

test("migration 15 gives content one ordered group while preserving content and video links", () => {
  assert.ok(migration);
  const database = contentDatabase();
  try {
    database.exec("BEGIN IMMEDIATE");
    database.exec(migration.sql);
    database.exec("COMMIT");

    assert.deepEqual(
      { ...database.prepare(`
        SELECT content_group_id, name, sort_position FROM content_groups
      `).get() },
      { content_group_id: 1, name: "General", sort_position: 10 },
    );
    assert.deepEqual(
      { ...database.prepare(`
        SELECT content_group_id, sequence, content_type, title, transcript, description,
               content_host, content_status, content_url
        FROM content_items WHERE content_id = 7
      `).get() },
      {
        content_group_id: 1,
        sequence: 7,
        content_type: "unknown",
        title: "Example title",
        transcript: "Complete transcript",
        description: "Example description",
        content_host: "youtube",
        content_status: "queued",
        content_url: "https://example.test/video",
      },
    );
    assert.equal(
      database.prepare("SELECT content_id FROM video_jobs WHERE video_job_id = 3").get().content_id,
      7,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    assert.throws(
      () => database.prepare("INSERT INTO content_items (title) VALUES ('Ungrouped')").run(),
      /NOT NULL constraint failed: content_items.content_group_id/,
    );
    assert.throws(
      () => database.prepare(`
        INSERT INTO content_items (content_group_id, sequence, title)
        VALUES (1, 7, 'Duplicate sequence')
      `).run(),
      /UNIQUE constraint failed/,
    );
  } finally {
    database.close();
  }
});
