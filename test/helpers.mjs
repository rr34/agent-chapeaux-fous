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
    VALUES (1, 20, 'Agent Slayer test database');
    CREATE TABLE files (
      file_id INTEGER PRIMARY KEY,
      storage_path TEXT NOT NULL UNIQUE,
      original_filename TEXT,
      title TEXT,
      description TEXT,
      title_source TEXT NOT NULL DEFAULT 'original_filename',
      media_kind TEXT NOT NULL DEFAULT 'other',
      mime_type TEXT,
      sha256 TEXT,
      byte_size INTEGER,
      duration_ms INTEGER,
      width INTEGER,
      height INTEGER,
      source_event_id TEXT,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT
    ) STRICT;
    CREATE VIRTUAL TABLE files_fts USING fts5(
      title, description, original_filename,
      content = 'files', content_rowid = 'file_id'
    );
    CREATE TRIGGER files_fts_insert AFTER INSERT ON files BEGIN
      INSERT INTO files_fts(rowid, title, description, original_filename)
      VALUES (new.file_id, new.title, new.description, new.original_filename);
    END;
    CREATE TRIGGER files_fts_delete AFTER DELETE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, title, description, original_filename)
      VALUES ('delete', old.file_id, old.title, old.description, old.original_filename);
    END;
    CREATE TRIGGER files_fts_update AFTER UPDATE OF title, description, original_filename ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, title, description, original_filename)
      VALUES ('delete', old.file_id, old.title, old.description, old.original_filename);
      INSERT INTO files_fts(rowid, title, description, original_filename)
      VALUES (new.file_id, new.title, new.description, new.original_filename);
    END;
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
      sort_position INTEGER NOT NULL DEFAULT 0,
      uses_sequence INTEGER NOT NULL DEFAULT 0 CHECK (uses_sequence IN (0, 1)),
      archived_at_utc TEXT,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT
    ) STRICT;
    CREATE TABLE contacts (
      contact_id INTEGER PRIMARY KEY,
      contact_kind TEXT NOT NULL DEFAULT 'person',
      display_name TEXT NOT NULL,
      given_name TEXT,
      family_name TEXT,
      organization_name TEXT,
      is_self INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      birth_date TEXT,
      notes TEXT,
      source TEXT,
      external_id TEXT,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT
    ) STRICT;
    CREATE TABLE contact_methods (
      contact_method_id INTEGER PRIMARY KEY,
      contact_id INTEGER NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      method_kind TEXT NOT NULL,
      label TEXT,
      value TEXT NOT NULL,
      normalized_value TEXT,
      is_primary INTEGER NOT NULL DEFAULT 0,
      can_receive INTEGER NOT NULL DEFAULT 1,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE (contact_id, method_kind, value)
    ) STRICT;
    CREATE TABLE tags (
      tag_id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
    CREATE TABLE record_tags (
      tag_id INTEGER NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
      record_type TEXT NOT NULL,
      record_id TEXT NOT NULL,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (tag_id, record_type, record_id)
    ) STRICT, WITHOUT ROWID;
    CREATE TABLE content_groups (
      content_group_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      sort_position INTEGER NOT NULL DEFAULT 0,
      archived_at_utc TEXT,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT
    ) STRICT;
    CREATE TABLE content_items (
      content_id INTEGER PRIMARY KEY,
      content_group_id INTEGER NOT NULL REFERENCES content_groups(content_group_id),
      sequence INTEGER,
      content_type TEXT NOT NULL DEFAULT 'mobileUGC_tutorial',
      title TEXT NOT NULL,
      transcript TEXT,
      description TEXT,
      published_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      content_host TEXT NOT NULL DEFAULT 'youtube',
      content_status TEXT NOT NULL DEFAULT 'active',
      content_url TEXT,
      relationship_to_user TEXT NOT NULL DEFAULT 'mine',
      creator_contact_id INTEGER REFERENCES contacts(contact_id),
      personal_notes TEXT,
      external_id TEXT,
      primary_file_id INTEGER REFERENCES files(file_id),
      consumed_at_utc TEXT,
      source_event_id TEXT REFERENCES activity_events(event_id),
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT,
      UNIQUE (content_group_id, sequence)
    ) STRICT;
    CREATE TABLE calendar_events (
      calendar_event_id INTEGER PRIMARY KEY,
      ical_uid TEXT,
      ical_recurrence_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      location_text TEXT,
      starts_at_utc TEXT NOT NULL,
      ends_at_utc TEXT,
      time_zone TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'confirmed',
      recurrence_rule TEXT,
      source_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT
    ) STRICT;
    CREATE TABLE calendar_event_exclusions (
      calendar_event_id INTEGER NOT NULL REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE,
      excluded_starts_at_utc TEXT NOT NULL,
      PRIMARY KEY (calendar_event_id, excluded_starts_at_utc)
    ) STRICT, WITHOUT ROWID;
    CREATE TABLE interaction_guides (
      interaction_guide_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 200),
      guide_text TEXT NOT NULL CHECK (length(trim(guide_text)) BETWEEN 1 AND 50000),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT
    ) STRICT;
    CREATE INDEX interaction_guides_status_name
      ON interaction_guides(status, name, interaction_guide_id);
    CREATE TABLE interaction_guide_steps (
      interaction_guide_step_id INTEGER PRIMARY KEY,
      interaction_guide_id INTEGER NOT NULL
        REFERENCES interaction_guides(interaction_guide_id) ON DELETE CASCADE,
      step_number INTEGER NOT NULL CHECK (step_number > 0),
      name TEXT CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 200),
      opening_text TEXT NOT NULL CHECK (length(trim(opening_text)) BETWEEN 1 AND 10000),
      objective_text TEXT NOT NULL CHECK (length(trim(objective_text)) BETWEEN 1 AND 10000),
      instructions_text TEXT
        CHECK (instructions_text IS NULL OR length(trim(instructions_text)) BETWEEN 1 AND 50000),
      answers_json TEXT NOT NULL DEFAULT '{}'
        CHECK (
          length(answers_json) <= 100000
          AND json_valid(answers_json)
          AND json_type(answers_json) = 'object'
        ),
      completion_mode TEXT NOT NULL DEFAULT 'response_valid'
        CHECK (completion_mode IN ('response_valid', 'user_advances', 'tool_receipt')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT,
      UNIQUE (interaction_guide_id, step_number)
    ) STRICT;
    CREATE INDEX interaction_guide_steps_guide_order
      ON interaction_guide_steps(interaction_guide_id, enabled, step_number);
    CREATE TABLE todo_routines (
      todo_routine_id INTEGER PRIMARY KEY,
      todo_group_id INTEGER NOT NULL REFERENCES todo_groups(todo_group_id) ON DELETE RESTRICT,
      text TEXT NOT NULL,
      first_scheduled_at_utc TEXT NOT NULL,
      first_due_at_utc TEXT,
      time_zone TEXT NOT NULL,
      recurrence_rule TEXT NOT NULL,
      disabled_at_utc TEXT,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
      interaction_guide_id INTEGER REFERENCES interaction_guides(interaction_guide_id) ON DELETE SET NULL
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
      updated_at_utc TEXT,
      is_all_day INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1))
    ) STRICT;
    CREATE UNIQUE INDEX personal_tasks_group_sequence
      ON personal_tasks(todo_group_id, sequence)
      WHERE sequence IS NOT NULL;
    CREATE TRIGGER personal_tasks_assign_sequence_after_insert
    AFTER INSERT ON personal_tasks
    WHEN NEW.sequence IS NULL
     AND EXISTS (
       SELECT 1 FROM todo_groups
       WHERE todo_group_id = NEW.todo_group_id AND uses_sequence = 1
     )
    BEGIN
      UPDATE personal_tasks
      SET sequence = (
        SELECT COALESCE(MAX(sequence), 0) + 1
        FROM personal_tasks
        WHERE todo_group_id = NEW.todo_group_id
          AND personal_task_id <> NEW.personal_task_id
      )
      WHERE personal_task_id = NEW.personal_task_id;
    END;
    CREATE TRIGGER personal_tasks_assign_sequence_after_update
    AFTER UPDATE OF todo_group_id, sequence ON personal_tasks
    WHEN NEW.sequence IS NULL
     AND EXISTS (
       SELECT 1 FROM todo_groups
       WHERE todo_group_id = NEW.todo_group_id AND uses_sequence = 1
     )
    BEGIN
      UPDATE personal_tasks
      SET sequence = (
        SELECT COALESCE(MAX(sequence), 0) + 1
        FROM personal_tasks
        WHERE todo_group_id = NEW.todo_group_id
          AND personal_task_id <> NEW.personal_task_id
      )
      WHERE personal_task_id = NEW.personal_task_id;
    END;
    CREATE UNIQUE INDEX personal_tasks_routine_occurrence
      ON personal_tasks(todo_routine_id, scheduled_at_utc)
      WHERE todo_routine_id IS NOT NULL AND scheduled_at_utc IS NOT NULL;
    CREATE TABLE log_groups (
      log_group_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE
        CHECK (length(trim(name)) BETWEEN 1 AND 200),
      archived_at_utc TEXT,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT
    ) STRICT;
    CREATE TABLE trackers (
      tracker_id INTEGER PRIMARY KEY,
      log_group_id INTEGER NOT NULL REFERENCES log_groups(log_group_id) ON DELETE RESTRICT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE
        CHECK (length(trim(name)) BETWEEN 1 AND 200),
      default_unit TEXT
        CHECK (default_unit IS NULL OR length(trim(default_unit)) BETWEEN 1 AND 100),
      archived_at_utc TEXT,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT
    ) STRICT;
    CREATE INDEX trackers_group_name
      ON trackers(log_group_id, archived_at_utc, name);
    CREATE TABLE log_entries (
      log_entry_id INTEGER PRIMARY KEY,
      tracker_id INTEGER NOT NULL REFERENCES trackers(tracker_id) ON DELETE RESTRICT,
      occurred_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      content_text TEXT NOT NULL CHECK (length(trim(content_text)) BETWEEN 1 AND 10000),
      number_value REAL,
      unit TEXT CHECK (unit IS NULL OR length(trim(unit)) BETWEEN 1 AND 100),
      source_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
      created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at_utc TEXT,
      source TEXT NOT NULL DEFAULT 'agent-slayer'
        CHECK (length(trim(source)) BETWEEN 1 AND 200),
      external_id TEXT
        CHECK (external_id IS NULL OR length(trim(external_id)) BETWEEN 1 AND 1000),
      CHECK (unit IS NULL OR number_value IS NOT NULL)
    ) STRICT;
    CREATE INDEX log_entries_tracker_occurred
      ON log_entries(tracker_id, occurred_at_utc DESC, log_entry_id DESC);
    CREATE UNIQUE INDEX log_entries_source_external
      ON log_entries(source, external_id)
      WHERE external_id IS NOT NULL;
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
    INSERT INTO todo_groups (name, sort_position) VALUES ('Inbox', 20), ('Development', 10);
    INSERT INTO content_groups (name, sort_position) VALUES ('General', 10);
  `);
  database.close();
  return {
    filename,
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); },
  };
}
