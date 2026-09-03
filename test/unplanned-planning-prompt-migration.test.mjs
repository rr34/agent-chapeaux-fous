import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

const migration = readMigrationLedger(new URL("../db/migrations.sql", import.meta.url))
  .find(({ version }) => version === 27);

test("migration 0027 preserves task dependents and adds unplanned planning prompts", () => {
  assert.ok(migration);
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  try {
    database.exec(`
      CREATE TABLE database_meta (singleton INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL) STRICT;
      INSERT INTO database_meta VALUES (1, 26);
      CREATE TABLE activity_events (event_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE contacts (contact_id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE files (file_id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE content_items (content_id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE video_scripts (video_script_id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE todo_groups (
        todo_group_id INTEGER PRIMARY KEY,
        uses_sequence INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      INSERT INTO todo_groups (todo_group_id, uses_sequence) VALUES (1, 1);
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
        is_all_day INTEGER NOT NULL DEFAULT 0,
        interaction_guide_id INTEGER
      ) STRICT;
      CREATE TABLE calendar_events (
        calendar_event_id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        starts_at_utc TEXT NOT NULL
      ) STRICT;
      INSERT INTO calendar_events VALUES (1, 'Kids time', '2026-09-05T20:00:00.000Z');
      CREATE TABLE personal_tasks (
        personal_task_id INTEGER PRIMARY KEY,
        todo_group_id INTEGER NOT NULL REFERENCES todo_groups(todo_group_id) ON DELETE RESTRICT,
        todo_routine_id INTEGER REFERENCES todo_routines(todo_routine_id) ON DELETE SET NULL,
        sequence INTEGER CHECK (sequence IS NULL OR sequence > 0),
        related_contact_id INTEGER REFERENCES contacts(contact_id) ON DELETE SET NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo'
          CHECK (status IN ('todo', 'complete', 'ignore', 'archive', 'ai_suggested')),
        sort_position INTEGER NOT NULL DEFAULT 0,
        scheduled_at_utc TEXT,
        due_at_utc TEXT,
        completed_at_utc TEXT,
        source TEXT,
        external_id TEXT,
        source_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
        created_at_utc TEXT NOT NULL,
        updated_at_utc TEXT,
        is_all_day INTEGER NOT NULL DEFAULT 0 CHECK (is_all_day IN (0, 1)),
        duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),
        UNIQUE (todo_group_id, sequence),
        UNIQUE (source, external_id)
      ) STRICT;
      INSERT INTO personal_tasks (
        personal_task_id, todo_group_id, text, status, created_at_utc
      ) VALUES (1, 1, 'Existing task', 'todo', '2026-09-01T00:00:00.000Z');
      CREATE UNIQUE INDEX personal_tasks_routine_occurrence
        ON personal_tasks(todo_routine_id, scheduled_at_utc)
        WHERE todo_routine_id IS NOT NULL AND scheduled_at_utc IS NOT NULL;
      CREATE INDEX personal_tasks_status_schedule
        ON personal_tasks(status, scheduled_at_utc, due_at_utc);
      CREATE INDEX personal_tasks_group_order
        ON personal_tasks(todo_group_id, sort_position, personal_task_id);
      CREATE INDEX personal_tasks_contact ON personal_tasks(related_contact_id, status);
      CREATE TRIGGER personal_tasks_assign_sequence_after_insert
      AFTER INSERT ON personal_tasks
      WHEN NEW.sequence IS NULL
      BEGIN
        UPDATE personal_tasks SET sequence = 2 WHERE personal_task_id = NEW.personal_task_id;
      END;
      CREATE TRIGGER personal_tasks_assign_sequence_after_update
      AFTER UPDATE OF todo_group_id, sequence ON personal_tasks
      WHEN NEW.sequence IS NULL
      BEGIN
        UPDATE personal_tasks SET sequence = 2 WHERE personal_task_id = NEW.personal_task_id;
      END;
      CREATE VIEW open_personal_tasks AS
        SELECT * FROM personal_tasks WHERE status IN ('todo', 'ai_suggested');
      CREATE TABLE reminders (
        reminder_id INTEGER PRIMARY KEY,
        calendar_event_id INTEGER REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE,
        personal_task_id INTEGER REFERENCES personal_tasks(personal_task_id) ON DELETE CASCADE,
        title TEXT,
        remind_at_utc TEXT NOT NULL,
        delivery_method TEXT NOT NULL DEFAULT 'agent'
          CHECK (delivery_method IN ('agent', 'webhook', 'notification', 'email', 'sms', 'other')),
        delivery_target TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'processing', 'delivered', 'snoozed', 'cancelled', 'error')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        last_attempt_at_utc TEXT,
        delivered_at_utc TEXT,
        error_text TEXT,
        created_at_utc TEXT NOT NULL,
        updated_at_utc TEXT
      ) STRICT;
      CREATE INDEX reminders_due ON reminders(status, remind_at_utc);
      CREATE VIEW due_reminders AS
        SELECT * FROM reminders
        WHERE status IN ('pending', 'error')
          AND remind_at_utc <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
      INSERT INTO reminders (
        reminder_id, personal_task_id, remind_at_utc, created_at_utc
      ) VALUES (1, 1, '2026-09-02T12:00:00.000Z', '2026-09-01T00:00:00.000Z');
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
        created_at_utc TEXT NOT NULL,
        started_at_utc TEXT,
        completed_at_utc TEXT,
        updated_at_utc TEXT,
        personal_task_id INTEGER REFERENCES personal_tasks(personal_task_id) ON DELETE SET NULL,
        video_script_id INTEGER REFERENCES video_scripts(video_script_id) ON DELETE SET NULL
      ) STRICT;
      CREATE INDEX video_jobs_script_created
        ON video_jobs(video_script_id, created_at_utc DESC, video_job_id DESC);
      CREATE UNIQUE INDEX video_jobs_one_active_script
        ON video_jobs(video_script_id)
        WHERE video_script_id IS NOT NULL AND status IN ('queued', 'preparing', 'rendering');
      INSERT INTO video_jobs (
        video_job_id, template, created_at_utc, personal_task_id
      ) VALUES (1, 'chat', '2026-09-01T00:00:00.000Z', 1);
    `);

    database.exec(`BEGIN IMMEDIATE; ${migration.sql} COMMIT;`);

    assert.deepEqual({ ...database.prepare(`
      SELECT personal_task_id, text, status, planning_prompt_text
      FROM personal_tasks WHERE personal_task_id = 1
    `).get() }, {
      personal_task_id: 1,
      text: "Existing task",
      status: "todo",
      planning_prompt_text: null,
    });
    assert.equal(database.prepare("SELECT personal_task_id FROM reminders WHERE reminder_id = 1").get().personal_task_id, 1);
    assert.equal(database.prepare("SELECT personal_task_id FROM video_jobs WHERE video_job_id = 1").get().personal_task_id, 1);
    database.prepare(`
      INSERT INTO personal_tasks (
        todo_group_id, text, status, planning_prompt_text, created_at_utc
      ) VALUES (1, 'Plan kids time', 'unplanned', 'What should we do?', '2026-09-01T00:00:00.000Z')
    `).run();
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM open_personal_tasks WHERE status = 'unplanned'
    `).get().count, 1);
    database.prepare("UPDATE calendar_events SET planning_prompt_text = 'What should fill this block?' WHERE calendar_event_id = 1").run();
    assert.equal(database.prepare("SELECT planning_prompt_text FROM calendar_events WHERE calendar_event_id = 1").get().planning_prompt_text, "What should fill this block?");
    assert.throws(
      () => database.prepare("UPDATE personal_tasks SET planning_prompt_text = '   ' WHERE personal_task_id = 1").run(),
      /CHECK constraint failed/,
    );
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    database.close();
  }
});
