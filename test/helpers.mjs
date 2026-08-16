import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-test-"));
  const filename = path.join(directory, "agent.sqlite");
  const database = new DatabaseSync(filename);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE database_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_version INTEGER NOT NULL,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      description TEXT
    ) STRICT;
    INSERT INTO database_meta (singleton, schema_version, description)
    VALUES (1, 9, 'Agent Slayer test database');
    CREATE TABLE files (
      file_id INTEGER PRIMARY KEY,
      storage_path TEXT NOT NULL UNIQUE,
      original_filename TEXT,
      media_kind TEXT NOT NULL DEFAULT 'other',
      mime_type TEXT,
      sha256 TEXT,
      byte_size INTEGER,
      duration_ms INTEGER,
      width INTEGER,
      height INTEGER,
      source_event_id TEXT,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
    CREATE TABLE activity_events (
      event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      occurred_at_ms INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
      recorded_at_ms INTEGER NOT NULL DEFAULT (CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
      occurred_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      event_type TEXT NOT NULL,
      event_phase TEXT NOT NULL DEFAULT 'point',
      status TEXT,
      actor_type TEXT NOT NULL,
      actor_name TEXT,
      source TEXT NOT NULL,
      channel TEXT,
      session_id TEXT,
      turn_id TEXT,
      trace_id TEXT,
      operation_id TEXT,
      span_id TEXT,
      parent_span_id TEXT,
      parent_event_id TEXT,
      name TEXT,
      content_text TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      primary_file_id INTEGER REFERENCES files(file_id),
      subject_type TEXT,
      subject_id TEXT,
      external_ref TEXT,
      error_text TEXT
    ) STRICT;
    CREATE TABLE todo_groups (
      todo_group_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      archived_at_utc TEXT,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT
    ) STRICT;
    CREATE TABLE personal_tasks (
      personal_task_id INTEGER PRIMARY KEY,
      todo_group_id INTEGER NOT NULL REFERENCES todo_groups(todo_group_id),
      todo_routine_id INTEGER,
      sequence INTEGER,
      related_contact_id INTEGER,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      sort_position INTEGER NOT NULL DEFAULT 0,
      scheduled_at_utc TEXT,
      due_at_utc TEXT,
      completed_at_utc TEXT,
      source TEXT,
      external_id TEXT,
      source_event_id TEXT REFERENCES activity_events(event_id),
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT
    ) STRICT;
    CREATE TABLE profile_facts (
      profile_fact_id INTEGER PRIMARY KEY,
      fact_type TEXT NOT NULL CHECK (length(trim(fact_type)) BETWEEN 1 AND 200),
      fact_text TEXT NOT NULL CHECK (length(trim(fact_text)) BETWEEN 1 AND 10000),
      fact_status TEXT NOT NULL DEFAULT 'active' CHECK (fact_status IN ('active', 'archived')),
      source_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
      archived_by_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT,
      archived_at_utc TEXT,
      CHECK (
        (fact_status = 'active' AND archived_at_utc IS NULL)
        OR (fact_status = 'archived' AND archived_at_utc IS NOT NULL)
      )
    ) STRICT;
    CREATE INDEX profile_facts_status_type
      ON profile_facts(fact_status, fact_type, profile_fact_id);
    INSERT INTO todo_groups (name) VALUES ('Inbox'), ('Development');
  `);
  database.close();
  return {
    filename,
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); },
  };
}
