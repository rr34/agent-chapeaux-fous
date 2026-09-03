-- Agent Slayer SQLite migration ledger.
--
-- Add each new migration directly below this header so the newest change stays
-- at the top. The runner validates newest-first file order and applies pending
-- migrations oldest-first. It owns transactions, backups, integrity checks,
-- schema-version updates, and schema-semantic synchronization.

-- migration 0028: structured-interaction-contracts
-- Consolidate reusable exchange instructions, inputs, destinations, recovery
-- reads, and completion requirements into one versioned contract document.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE interaction_guide_steps RENAME TO migration_0028_interaction_guide_steps;

CREATE TABLE interaction_guide_steps (
    interaction_guide_step_id INTEGER PRIMARY KEY,
    interaction_guide_id      INTEGER NOT NULL
                              REFERENCES interaction_guides(interaction_guide_id)
                              ON DELETE CASCADE,
    step_number               INTEGER NOT NULL CHECK (step_number > 0),
    opening_text              TEXT NOT NULL
                              CHECK (length(trim(opening_text)) BETWEEN 1 AND 10000),
    contract_json             TEXT NOT NULL
                              DEFAULT '{"version":1,"instructions":null,"inputs":[],"operations":[],"recoveryReads":[],"completion":{"mode":"response_valid"}}'
                              CHECK (
                                  length(contract_json) <= 200000
                                  AND json_valid(contract_json)
                                  AND json_type(contract_json) = 'object'
                                  AND json_extract(contract_json, '$.version') = 1
                                  AND json_type(contract_json, '$.inputs') = 'array'
                                  AND json_type(contract_json, '$.operations') = 'array'
                                  AND json_type(contract_json, '$.recoveryReads') = 'array'
                                  AND json_type(contract_json, '$.completion') = 'object'
                                  AND json_extract(contract_json, '$.completion.mode') IN (
                                      'response_valid', 'user_advances', 'tool_receipt'
                                  )
                              ),
    answers_json              TEXT NOT NULL DEFAULT '{}'
                              CHECK (
                                  length(answers_json) <= 100000
                                  AND json_valid(answers_json)
                                  AND json_type(answers_json) = 'object'
                              ),
    enabled                   INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at_utc            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc            TEXT,
    progress_state            TEXT NOT NULL DEFAULT 'pending'
                              CHECK (progress_state IN ('pending', 'active', 'completed')),
    UNIQUE (interaction_guide_id, step_number)
) STRICT;

INSERT INTO interaction_guide_steps (
    interaction_guide_step_id, interaction_guide_id, step_number, opening_text,
    contract_json, answers_json, enabled, created_at_utc, updated_at_utc,
    progress_state
)
SELECT
    interaction_guide_step_id, interaction_guide_id, step_number, opening_text,
    json_object(
        'version', 1,
        'instructions', instructions_text,
        'inputs', json('[]'),
        'operations', json('[]'),
        'recoveryReads', json('[]'),
        'completion', json_object('mode', completion_mode)
    ),
    answers_json, enabled, created_at_utc, updated_at_utc, progress_state
FROM migration_0028_interaction_guide_steps;

DROP TABLE migration_0028_interaction_guide_steps;

CREATE INDEX interaction_guide_steps_guide_order
    ON interaction_guide_steps(interaction_guide_id, enabled, step_number);

CREATE INDEX interaction_guide_steps_guide_progress
    ON interaction_guide_steps(interaction_guide_id, progress_state, enabled, step_number);

-- end migration 0028

-- migration 0027: unplanned-planning-prompts
-- Distinguish active work that still needs a plan and preserve the exact
-- question the Agent should ask on tasks, routine definitions, and events.

PRAGMA defer_foreign_keys = ON;

DROP VIEW due_reminders;
DROP VIEW open_personal_tasks;

ALTER TABLE reminders RENAME TO migration_0027_reminders;
ALTER TABLE video_jobs RENAME TO migration_0027_video_jobs;
ALTER TABLE personal_tasks RENAME TO migration_0027_personal_tasks;

CREATE TABLE personal_tasks (
    personal_task_id    INTEGER PRIMARY KEY,
    todo_group_id       INTEGER NOT NULL
                        REFERENCES todo_groups(todo_group_id) ON DELETE RESTRICT,
    todo_routine_id     INTEGER
                        REFERENCES todo_routines(todo_routine_id) ON DELETE SET NULL,
    sequence            INTEGER CHECK (sequence IS NULL OR sequence > 0),
    related_contact_id  INTEGER REFERENCES contacts(contact_id) ON DELETE SET NULL,
    text                TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'todo'
                        CHECK (status IN (
                            'unplanned', 'todo', 'complete', 'ignore',
                            'archive', 'ai_suggested'
                        )),
    sort_position       INTEGER NOT NULL DEFAULT 0,
    scheduled_at_utc    TEXT,
    due_at_utc          TEXT,
    completed_at_utc    TEXT,
    source              TEXT,
    external_id         TEXT,
    source_event_id     TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
    created_at_utc      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc      TEXT,
    is_all_day          INTEGER NOT NULL DEFAULT 0
                        CHECK (is_all_day IN (0, 1)),
    duration_minutes    INTEGER
                        CHECK (duration_minutes IS NULL OR duration_minutes > 0),
    planning_prompt_text TEXT
                        CHECK (
                            planning_prompt_text IS NULL
                            OR length(trim(planning_prompt_text)) BETWEEN 1 AND 10000
                        ),
    UNIQUE (todo_group_id, sequence),
    UNIQUE (source, external_id)
) STRICT;

INSERT INTO personal_tasks (
    personal_task_id, todo_group_id, todo_routine_id, sequence,
    related_contact_id, text, status, sort_position, scheduled_at_utc,
    due_at_utc, completed_at_utc, source, external_id, source_event_id,
    created_at_utc, updated_at_utc, is_all_day, duration_minutes,
    planning_prompt_text
)
SELECT
    personal_task_id, todo_group_id, todo_routine_id, sequence,
    related_contact_id, text, status, sort_position, scheduled_at_utc,
    due_at_utc, completed_at_utc, source, external_id, source_event_id,
    created_at_utc, updated_at_utc, is_all_day, duration_minutes, NULL
FROM migration_0027_personal_tasks;

CREATE TABLE reminders (
    reminder_id         INTEGER PRIMARY KEY,
    calendar_event_id   INTEGER REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE,
    personal_task_id    INTEGER REFERENCES personal_tasks(personal_task_id) ON DELETE CASCADE,
    title               TEXT,
    remind_at_utc       TEXT NOT NULL,
    delivery_method     TEXT NOT NULL DEFAULT 'agent'
                        CHECK (delivery_method IN (
                            'agent', 'webhook', 'notification',
                            'email', 'sms', 'other'
                        )),
    delivery_target     TEXT,
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                            'pending', 'processing', 'delivered',
                            'snoozed', 'cancelled', 'error'
                        )),
    attempt_count       INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    last_attempt_at_utc TEXT,
    delivered_at_utc   TEXT,
    error_text          TEXT,
    created_at_utc      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc      TEXT
) STRICT;

INSERT INTO reminders (
    reminder_id, calendar_event_id, personal_task_id, title, remind_at_utc,
    delivery_method, delivery_target, status, attempt_count,
    last_attempt_at_utc, delivered_at_utc, error_text,
    created_at_utc, updated_at_utc
)
SELECT
    reminder_id, calendar_event_id, personal_task_id, title, remind_at_utc,
    delivery_method, delivery_target, status, attempt_count,
    last_attempt_at_utc, delivered_at_utc, error_text,
    created_at_utc, updated_at_utc
FROM migration_0027_reminders;

CREATE TABLE video_jobs (
    video_job_id        INTEGER PRIMARY KEY,
    request_event_id    TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
    source_turn_id      TEXT,
    content_id          INTEGER REFERENCES content_items(content_id) ON DELETE SET NULL,
    renderer            TEXT NOT NULL DEFAULT 'remotion'
                        CHECK (renderer IN ('remotion', 'adobe_premiere', 'other')),
    template            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN (
                            'queued', 'preparing', 'rendering',
                            'complete', 'error', 'cancelled'
                        )),
    input_json          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
    output_file_id      INTEGER REFERENCES files(file_id) ON DELETE SET NULL,
    error_text          TEXT,
    created_at_utc      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at_utc      TEXT,
    completed_at_utc    TEXT,
    updated_at_utc      TEXT,
    personal_task_id    INTEGER REFERENCES personal_tasks(personal_task_id) ON DELETE SET NULL,
    video_script_id     INTEGER REFERENCES video_scripts(video_script_id) ON DELETE SET NULL
) STRICT;

INSERT INTO video_jobs (
    video_job_id, request_event_id, source_turn_id, content_id, renderer,
    template, status, input_json, output_file_id, error_text, created_at_utc,
    started_at_utc, completed_at_utc, updated_at_utc, personal_task_id,
    video_script_id
)
SELECT
    video_job_id, request_event_id, source_turn_id, content_id, renderer,
    template, status, input_json, output_file_id, error_text, created_at_utc,
    started_at_utc, completed_at_utc, updated_at_utc, personal_task_id,
    video_script_id
FROM migration_0027_video_jobs;

DROP TABLE migration_0027_reminders;
DROP TABLE migration_0027_video_jobs;
DROP TABLE migration_0027_personal_tasks;

CREATE INDEX personal_tasks_status_schedule
    ON personal_tasks(status, scheduled_at_utc, due_at_utc);

CREATE INDEX personal_tasks_group_order
    ON personal_tasks(todo_group_id, sort_position, personal_task_id);

CREATE INDEX personal_tasks_contact
    ON personal_tasks(related_contact_id, status);

CREATE UNIQUE INDEX personal_tasks_routine_occurrence
    ON personal_tasks(todo_routine_id, scheduled_at_utc)
    WHERE todo_routine_id IS NOT NULL AND scheduled_at_utc IS NOT NULL;

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

CREATE INDEX reminders_due ON reminders(status, remind_at_utc);

CREATE VIEW due_reminders AS
SELECT *
FROM reminders
WHERE status IN ('pending', 'error')
  AND remind_at_utc <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

CREATE INDEX video_jobs_script_created
    ON video_jobs(video_script_id, created_at_utc DESC, video_job_id DESC);

CREATE UNIQUE INDEX video_jobs_one_active_script
    ON video_jobs(video_script_id)
    WHERE video_script_id IS NOT NULL
      AND status IN ('queued', 'preparing', 'rendering');

CREATE VIEW open_personal_tasks AS
SELECT *
FROM personal_tasks
WHERE status IN ('unplanned', 'todo', 'ai_suggested');

ALTER TABLE todo_routines
ADD COLUMN planning_prompt_text TEXT
                                CHECK (
                                    planning_prompt_text IS NULL
                                    OR length(trim(planning_prompt_text)) BETWEEN 1 AND 10000
                                );

ALTER TABLE calendar_events
ADD COLUMN planning_prompt_text TEXT
                                CHECK (
                                    planning_prompt_text IS NULL
                                    OR length(trim(planning_prompt_text)) BETWEEN 1 AND 10000
                                );
-- end migration 0027

-- migration 0026: reset-completed-briefing-runs
-- A completed run is immutable ledger history, not reusable current-run state.
-- Clear legacy terminal answers and completion markers so every finished
-- briefing is immediately ready for its next run. Preserve interrupted runs.

UPDATE interaction_guide_steps AS step
SET answers_json = '{}',
    progress_state = 'pending',
    updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (
  SELECT 1
  FROM activity_events AS started
  JOIN activity_events AS completed
    ON completed.subject_type = 'interaction_guide_run'
   AND completed.subject_id = started.subject_id
   AND completed.event_type = 'interaction_guide.run_completed'
  WHERE started.event_type = 'interaction_guide.run_started'
    AND started.subject_type = 'interaction_guide_run'
    AND json_extract(started.payload_json, '$.interactionGuideId') = step.interaction_guide_id
)
AND NOT EXISTS (
  SELECT 1
  FROM activity_events AS started
  WHERE started.event_type = 'interaction_guide.run_started'
    AND started.subject_type = 'interaction_guide_run'
    AND json_extract(started.payload_json, '$.interactionGuideId') = step.interaction_guide_id
    AND NOT EXISTS (
      SELECT 1
      FROM activity_events AS terminal
      WHERE terminal.subject_type = 'interaction_guide_run'
        AND terminal.subject_id = started.subject_id
        AND terminal.event_type IN (
          'interaction_guide.run_completed', 'interaction_guide.run_cancelled'
        )
    )
);
-- end migration 0026

-- migration 0025: tracker-owned-log-units
-- Numeric log entries form one comparable series per tracker. Keep existing
-- tracker units, mark every missing canonical unit for review, discard legacy
-- per-entry units, and keep the canonical unit only on the tracker.

UPDATE trackers
SET default_unit = 'set me'
WHERE default_unit IS NULL;

ALTER TABLE trackers RENAME COLUMN default_unit TO unit;

DROP INDEX trackers_group_name;
DROP INDEX log_entries_tracker_occurred;
DROP INDEX log_entries_source_external;
ALTER TABLE log_entries RENAME TO log_entries_with_entry_units;
ALTER TABLE trackers RENAME TO trackers_with_nullable_units;

CREATE TABLE trackers (
    tracker_id      INTEGER PRIMARY KEY,
    log_group_id    INTEGER NOT NULL
                    REFERENCES log_groups(log_group_id) ON DELETE RESTRICT,
    name            TEXT NOT NULL COLLATE NOCASE UNIQUE
                    CHECK (length(trim(name)) BETWEEN 1 AND 200),
    unit            TEXT NOT NULL
                    CHECK (length(trim(unit)) BETWEEN 1 AND 100),
    archived_at_utc TEXT,
    created_at_utc  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc  TEXT
) STRICT;

INSERT INTO trackers (
  tracker_id, log_group_id, name, unit, archived_at_utc, created_at_utc, updated_at_utc
)
SELECT
  tracker_id, log_group_id, name, unit, archived_at_utc, created_at_utc, updated_at_utc
FROM trackers_with_nullable_units;

CREATE TABLE log_entries (
    log_entry_id    INTEGER PRIMARY KEY,
    tracker_id      INTEGER NOT NULL
                    REFERENCES trackers(tracker_id) ON DELETE RESTRICT,
    occurred_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    content_text    TEXT NOT NULL
                    CHECK (length(trim(content_text)) BETWEEN 1 AND 10000),
    number_value    REAL,
    source_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
    created_at_utc  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc  TEXT,
    source          TEXT NOT NULL DEFAULT 'agent-slayer'
                    CHECK (length(trim(source)) BETWEEN 1 AND 200),
    external_id     TEXT
                    CHECK (external_id IS NULL OR length(trim(external_id)) BETWEEN 1 AND 1000)
) STRICT;

INSERT INTO log_entries (
  log_entry_id, tracker_id, occurred_at_utc, content_text, number_value,
  source_event_id, created_at_utc, updated_at_utc, source, external_id
)
SELECT
  log_entry_id, tracker_id, occurred_at_utc, content_text, number_value,
  source_event_id, created_at_utc, updated_at_utc, source, external_id
FROM log_entries_with_entry_units;

DROP TABLE log_entries_with_entry_units;
DROP TABLE trackers_with_nullable_units;

CREATE INDEX trackers_group_name
    ON trackers(log_group_id, archived_at_utc, name);

CREATE INDEX log_entries_tracker_occurred
    ON log_entries(tracker_id, occurred_at_utc DESC, log_entry_id DESC);

CREATE UNIQUE INDEX log_entries_source_external
    ON log_entries(source, external_id)
    WHERE external_id IS NOT NULL;

CREATE TRIGGER log_entries_require_tracker_unit_before_insert
BEFORE INSERT ON log_entries
WHEN NEW.number_value IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM trackers
   WHERE tracker_id = NEW.tracker_id AND unit IS NOT NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'numeric log entries require a tracker unit');
END;

CREATE TRIGGER trackers_require_unit_before_insert
BEFORE INSERT ON trackers
WHEN NEW.unit IS NULL
BEGIN
  SELECT RAISE(ABORT, 'trackers require a canonical unit');
END;

CREATE TRIGGER trackers_require_unit_before_update
BEFORE UPDATE OF unit ON trackers
WHEN NEW.unit IS NULL
BEGIN
  SELECT RAISE(ABORT, 'trackers require a canonical unit');
END;

CREATE TRIGGER log_entries_require_tracker_unit_before_update
BEFORE UPDATE OF tracker_id, number_value ON log_entries
WHEN NEW.number_value IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM trackers
   WHERE tracker_id = NEW.tracker_id AND unit IS NOT NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'numeric log entries require a tracker unit');
END;

CREATE TRIGGER trackers_preserve_numeric_unit_before_update
BEFORE UPDATE OF unit ON trackers
WHEN OLD.unit IS NOT NEW.unit
 AND OLD.unit <> 'set me' COLLATE NOCASE
 AND EXISTS (
   SELECT 1 FROM log_entries
   WHERE tracker_id = OLD.tracker_id AND number_value IS NOT NULL
 )
BEGIN
  SELECT RAISE(ABORT, 'a tracker unit cannot change after numeric entries exist');
END;
-- end migration 0025

-- migration 0024: planned-todo-duration
-- Preserve the amount of time reserved for a scheduled to-do or routine
-- template without overloading its independent due-date deadline.

ALTER TABLE personal_tasks
ADD COLUMN duration_minutes INTEGER
                            CHECK (duration_minutes IS NULL OR duration_minutes > 0);
-- end migration 0024

-- migration 0023: scripted-video-production-jobs
-- Link application-owned background render jobs to the exact durable script
-- they execute. The script's ordered source join remains authoritative; the
-- job owns only preparation, rendering, output, and retry state.

ALTER TABLE video_jobs
ADD COLUMN video_script_id INTEGER
             REFERENCES video_scripts(video_script_id) ON DELETE SET NULL;

CREATE INDEX video_jobs_script_created
    ON video_jobs(video_script_id, created_at_utc DESC, video_job_id DESC);

CREATE UNIQUE INDEX video_jobs_one_active_script
    ON video_jobs(video_script_id)
    WHERE video_script_id IS NOT NULL
      AND status IN ('queued', 'preparing', 'rendering');
-- end migration 0023

-- migration 0022: minimal-structured-interaction-state
-- Keep the guide as a named versioned container. Each ordered step owns only
-- its user-visible opening, agent instructions, current answers, and explicit
-- current-run progress. Immutable run history remains in activity_events.

ALTER TABLE interaction_guides DROP COLUMN guide_text;

ALTER TABLE interaction_guide_steps DROP COLUMN name;
ALTER TABLE interaction_guide_steps DROP COLUMN objective_text;
ALTER TABLE interaction_guide_steps
ADD COLUMN progress_state TEXT NOT NULL DEFAULT 'pending'
                    CHECK (progress_state IN ('pending', 'active', 'completed'));

UPDATE interaction_guide_steps AS step
SET progress_state = 'completed'
WHERE EXISTS (
  SELECT 1
  FROM activity_events AS started
  JOIN activity_events AS completed
    ON completed.subject_type = 'interaction_guide_run'
   AND completed.subject_id = started.subject_id
   AND completed.event_type = 'interaction_guide.step_completed'
  WHERE started.event_type = 'interaction_guide.run_started'
    AND started.subject_type = 'interaction_guide_run'
    AND json_extract(started.payload_json, '$.interactionGuideId') = step.interaction_guide_id
    AND json_extract(completed.payload_json, '$.stepNumber') = step.step_number
    AND NOT EXISTS (
      SELECT 1
      FROM activity_events AS terminal
      WHERE terminal.subject_type = 'interaction_guide_run'
        AND terminal.subject_id = started.subject_id
        AND terminal.event_type IN (
          'interaction_guide.run_completed', 'interaction_guide.run_cancelled'
        )
    )
);

UPDATE interaction_guide_steps AS step
SET progress_state = 'active'
WHERE step.enabled = 1
  AND step.progress_state = 'pending'
  AND step.interaction_guide_step_id = (
    SELECT candidate.interaction_guide_step_id
    FROM interaction_guide_steps AS candidate
    WHERE candidate.interaction_guide_id = step.interaction_guide_id
      AND candidate.enabled = 1
      AND candidate.progress_state = 'pending'
    ORDER BY candidate.step_number, candidate.interaction_guide_step_id
    LIMIT 1
  )
  AND EXISTS (
    SELECT 1
    FROM activity_events AS started
    WHERE started.event_type = 'interaction_guide.run_started'
      AND started.subject_type = 'interaction_guide_run'
      AND json_extract(started.payload_json, '$.interactionGuideId') = step.interaction_guide_id
      AND NOT EXISTS (
        SELECT 1
        FROM activity_events AS terminal
        WHERE terminal.subject_type = 'interaction_guide_run'
          AND terminal.subject_id = started.subject_id
          AND terminal.event_type IN (
            'interaction_guide.run_completed', 'interaction_guide.run_cancelled'
          )
      )
  );

CREATE INDEX interaction_guide_steps_guide_progress
ON interaction_guide_steps(interaction_guide_id, progress_state, enabled, step_number);
-- end migration 0022

-- migration 0021: multi-interaction-video-scripts
-- Preserve portable, generator-ready video scripts as first-class content
-- production artifacts. Each script may be grounded in several exact Agent
-- Slayer interactions, retained in chronological source order.

CREATE TABLE video_scripts (
    video_script_id     INTEGER PRIMARY KEY,
    title               TEXT NOT NULL
                        CHECK (length(trim(title)) BETWEEN 1 AND 200),
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'archived')),
    schema_version      INTEGER NOT NULL DEFAULT 1
                        CHECK (schema_version = 1),
    script_json         TEXT NOT NULL
                        CHECK (
                            length(script_json) <= 500000
                            AND json_valid(script_json)
                            AND json_type(script_json) = 'object'
                        ),
    script_text         TEXT NOT NULL
                        CHECK (length(trim(script_text)) BETWEEN 1 AND 500000),
    created_by_event_id TEXT UNIQUE REFERENCES activity_events(event_id) ON DELETE SET NULL,
    created_at_utc      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc      TEXT,
    archived_at_utc     TEXT,
    version             INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    CHECK (
        (status = 'draft' AND archived_at_utc IS NULL)
        OR (status = 'archived' AND archived_at_utc IS NOT NULL)
    )
) STRICT;

CREATE TABLE video_script_sources (
    video_script_id  INTEGER NOT NULL
                     REFERENCES video_scripts(video_script_id) ON DELETE CASCADE,
    request_event_id TEXT NOT NULL
                     REFERENCES activity_events(event_id) ON DELETE RESTRICT,
    source_order     INTEGER NOT NULL CHECK (source_order > 0),
    PRIMARY KEY (video_script_id, request_event_id),
    UNIQUE (video_script_id, source_order)
) STRICT, WITHOUT ROWID;

CREATE INDEX video_scripts_status_created
    ON video_scripts(status, created_at_utc DESC, video_script_id DESC);

CREATE INDEX video_script_sources_request
    ON video_script_sources(request_event_id, video_script_id);
-- end migration 0021

-- migration 0020: structured-interaction-steps
-- Split reusable interaction guides into an aggregate brief plus ordered,
-- independently answerable script steps. Definition edits increment the parent
-- guide version; answers are current-run state and remain in the child row until
-- an explicitly requested new run clears them.

CREATE TABLE interaction_guide_steps (
    interaction_guide_step_id INTEGER PRIMARY KEY,
    interaction_guide_id      INTEGER NOT NULL
                              REFERENCES interaction_guides(interaction_guide_id)
                              ON DELETE CASCADE,
    step_number               INTEGER NOT NULL CHECK (step_number > 0),
    name                      TEXT
                              CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 200),
    opening_text              TEXT NOT NULL
                              CHECK (length(trim(opening_text)) BETWEEN 1 AND 10000),
    objective_text            TEXT NOT NULL
                              CHECK (length(trim(objective_text)) BETWEEN 1 AND 10000),
    instructions_text         TEXT
                              CHECK (instructions_text IS NULL OR length(trim(instructions_text)) BETWEEN 1 AND 50000),
    answers_json              TEXT NOT NULL DEFAULT '{}'
                              CHECK (
                                  length(answers_json) <= 100000
                                  AND json_valid(answers_json)
                                  AND json_type(answers_json) = 'object'
                              ),
    completion_mode           TEXT NOT NULL DEFAULT 'response_valid'
                              CHECK (completion_mode IN (
                                  'response_valid', 'user_advances', 'tool_receipt'
                              )),
    enabled                   INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at_utc            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc            TEXT,
    UNIQUE (interaction_guide_id, step_number)
) STRICT;

CREATE INDEX interaction_guide_steps_guide_order
    ON interaction_guide_steps(interaction_guide_id, enabled, step_number);
-- end migration 0020

-- migration 0019: durable-file-catalog
-- Give persisted files concise human-facing identity and synchronized full-text
-- discovery without moving file bytes into SQLite.

ALTER TABLE files
ADD COLUMN title TEXT
                 CHECK (title IS NULL OR length(trim(title)) BETWEEN 1 AND 200);

ALTER TABLE files
ADD COLUMN description TEXT
                       CHECK (description IS NULL OR length(trim(description)) BETWEEN 1 AND 5000);

ALTER TABLE files
ADD COLUMN title_source TEXT NOT NULL DEFAULT 'original_filename'
                             CHECK (title_source IN ('original_filename', 'ai', 'user'));

ALTER TABLE files
ADD COLUMN updated_at_utc TEXT;

UPDATE files
SET title = COALESCE(NULLIF(trim(original_filename), ''), 'File ' || file_id);

CREATE INDEX files_created
    ON files(created_at_utc DESC, file_id DESC);

CREATE VIRTUAL TABLE files_fts USING fts5(
    title,
    description,
    original_filename,
    content = 'files',
    content_rowid = 'file_id'
);

CREATE TRIGGER files_fts_insert
AFTER INSERT ON files
BEGIN
    INSERT INTO files_fts(rowid, title, description, original_filename)
    VALUES (NEW.file_id, NEW.title, NEW.description, NEW.original_filename);
END;

CREATE TRIGGER files_fts_delete
AFTER DELETE ON files
BEGIN
    INSERT INTO files_fts(files_fts, rowid, title, description, original_filename)
    VALUES ('delete', OLD.file_id, OLD.title, OLD.description, OLD.original_filename);
END;

CREATE TRIGGER files_fts_update
AFTER UPDATE OF title, description, original_filename ON files
BEGIN
    INSERT INTO files_fts(files_fts, rowid, title, description, original_filename)
    VALUES ('delete', OLD.file_id, OLD.title, OLD.description, OLD.original_filename);
    INSERT INTO files_fts(rowid, title, description, original_filename)
    VALUES (NEW.file_id, NEW.title, NEW.description, NEW.original_filename);
END;

INSERT INTO files_fts(files_fts) VALUES ('rebuild');
-- end migration 0019

-- migration 0018: interaction-guides
-- Store user-owned plans for structured interactions independently from
-- recurring to-do definitions. A repeating to-do may point to one guide, but
-- recurrence remains entirely owned by todo_routines.

CREATE TABLE interaction_guides (
    interaction_guide_id INTEGER PRIMARY KEY,
    name                 TEXT NOT NULL COLLATE NOCASE UNIQUE
                         CHECK (length(trim(name)) BETWEEN 1 AND 200),
    guide_text           TEXT NOT NULL
                         CHECK (length(trim(guide_text)) BETWEEN 1 AND 50000),
    status               TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'archived')),
    version              INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at_utc       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc       TEXT
) STRICT;

CREATE INDEX interaction_guides_status_name
    ON interaction_guides(status, name, interaction_guide_id);

ALTER TABLE todo_routines
ADD COLUMN interaction_guide_id INTEGER
          REFERENCES interaction_guides(interaction_guide_id) ON DELETE SET NULL;
-- end migration 0018

-- migration 0017: recognize-existing-sequenced-todo-groups
-- Migration 0016 introduced an opt-in flag with a default of zero. Preserve
-- the established behavior of groups that already contained numbered tasks by
-- enabling automatic numbering for those groups.

UPDATE todo_groups AS todo_group
SET uses_sequence = 1,
    updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE uses_sequence = 0
  AND EXISTS (
      SELECT 1
      FROM personal_tasks AS task
      WHERE task.todo_group_id = todo_group.todo_group_id
        AND task.sequence IS NOT NULL
  );

WITH unnumbered AS (
    SELECT task.personal_task_id,
           COALESCE((
               SELECT MAX(numbered.sequence)
               FROM personal_tasks AS numbered
               WHERE numbered.todo_group_id = task.todo_group_id
           ), 0) + ROW_NUMBER() OVER (
               PARTITION BY task.todo_group_id
               ORDER BY task.sort_position, task.personal_task_id
           ) AS next_sequence
    FROM personal_tasks AS task
    JOIN todo_groups AS todo_group USING (todo_group_id)
    WHERE todo_group.uses_sequence = 1
      AND task.sequence IS NULL
)
UPDATE personal_tasks
SET sequence = (
    SELECT unnumbered.next_sequence
    FROM unnumbered
    WHERE unnumbered.personal_task_id = personal_tasks.personal_task_id
)
WHERE personal_task_id IN (SELECT personal_task_id FROM unnumbered);
-- end migration 0017

-- migration 0016: governed-todo-sequences
-- Let a to-do group opt into stable sequence numbers. Tasks inserted without a
-- number into a governed group receive the next positive number atomically;
-- ordinary groups continue to allow unnumbered tasks.

ALTER TABLE todo_groups
ADD COLUMN uses_sequence INTEGER NOT NULL DEFAULT 0
                         CHECK (uses_sequence IN (0, 1));

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
-- end migration 0016

-- migration 0015: grouped-content
-- Organize the content catalog like the personal to-do list: every item belongs
-- to one named group and may carry a stable positive sequence within that group.
-- Preserve the action-content fields and Agent Slayer provenance already stored
-- on content_items. Rebuild video_jobs alongside the parent table so its content
-- references survive the SQLite table replacement.

PRAGMA defer_foreign_keys = ON;

ALTER TABLE video_jobs RENAME TO migration_0015_video_jobs;
ALTER TABLE content_items RENAME TO migration_0015_content_items;

CREATE TABLE content_groups (
    content_group_id INTEGER PRIMARY KEY,
    name             TEXT NOT NULL COLLATE NOCASE UNIQUE
                     CHECK (length(trim(name)) BETWEEN 1 AND 200),
    sort_position    INTEGER NOT NULL DEFAULT 0,
    archived_at_utc  TEXT,
    created_at_utc   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc   TEXT
) STRICT;

INSERT INTO content_groups (content_group_id, name, sort_position)
VALUES (1, 'General', 10);

CREATE TABLE content_items (
    content_id           INTEGER PRIMARY KEY,
    content_group_id     INTEGER NOT NULL
                         REFERENCES content_groups(content_group_id) ON DELETE RESTRICT,
    sequence             INTEGER CHECK (sequence IS NULL OR sequence > 0),
    content_type         TEXT NOT NULL DEFAULT 'mobileUGC_tutorial'
                         CHECK (content_type IN (
                             'mobileUGC_tutorial', 'mobileUGC_ad',
                             'webUGC_tutorial', 'webUGC_ad', 'video_ad',
                             'podcast', 'image', 'unknown'
                         )),
    title                TEXT NOT NULL,
    transcript           TEXT,
    description          TEXT,
    published_at_utc     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    content_host         TEXT NOT NULL DEFAULT 'youtube'
                         CHECK (content_host IN (
                             'youtube', 'vimeo', 'spotify', 'mytlomdotcom', 'none'
                         )),
    content_status       TEXT NOT NULL DEFAULT 'active'
                         CHECK (content_status IN ('active', 'obsolete', 'unused', 'queued')),
    content_url          TEXT,
    relationship_to_user TEXT NOT NULL DEFAULT 'mine'
                         CHECK (relationship_to_user IN ('mine', 'reference')),
    creator_contact_id   INTEGER REFERENCES contacts(contact_id) ON DELETE SET NULL,
    personal_notes       TEXT,
    external_id          TEXT,
    primary_file_id      INTEGER REFERENCES files(file_id) ON DELETE SET NULL,
    consumed_at_utc      TEXT,
    source_event_id      TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
    created_at_utc       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc       TEXT,
    UNIQUE (content_group_id, sequence)
) STRICT;

INSERT INTO content_items (
    content_id, content_group_id, sequence, content_type, title, transcript,
    description, published_at_utc, content_host, content_status, content_url,
    relationship_to_user, creator_contact_id, personal_notes, external_id, primary_file_id,
    consumed_at_utc, source_event_id, created_at_utc, updated_at_utc
)
SELECT
    content_id, 1, content_id,
    CASE content_kind
        WHEN 'podcast' THEN 'podcast'
        WHEN 'image' THEN 'image'
        ELSE 'unknown'
    END,
    title, transcript, description,
    COALESCE(published_at_utc, created_at_utc, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CASE lower(trim(COALESCE(host, '')))
        WHEN 'youtube' THEN 'youtube'
        WHEN 'vimeo' THEN 'vimeo'
        WHEN 'spotify' THEN 'spotify'
        WHEN 'mytlomdotcom' THEN 'mytlomdotcom'
        WHEN 'none' THEN 'none'
        ELSE 'none'
    END,
    CASE status
        WHEN 'queued' THEN 'queued'
        WHEN 'obsolete' THEN 'obsolete'
        WHEN 'archived' THEN 'unused'
        WHEN 'idea' THEN 'queued'
        WHEN 'draft' THEN 'queued'
        ELSE 'active'
    END,
    source_url, relationship_to_user, creator_contact_id, personal_notes,
    external_id, primary_file_id,
    consumed_at_utc, source_event_id, created_at_utc, updated_at_utc
FROM migration_0015_content_items;

CREATE TABLE video_jobs (
    video_job_id        INTEGER PRIMARY KEY,
    request_event_id    TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
    source_turn_id      TEXT,
    content_id          INTEGER REFERENCES content_items(content_id) ON DELETE SET NULL,
    renderer            TEXT NOT NULL DEFAULT 'remotion'
                        CHECK (renderer IN ('remotion', 'adobe_premiere', 'other')),
    template            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN (
                            'queued', 'preparing', 'rendering',
                            'complete', 'error', 'cancelled'
                        )),
    input_json          TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(input_json)),
    output_file_id      INTEGER REFERENCES files(file_id) ON DELETE SET NULL,
    error_text          TEXT,
    created_at_utc      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    started_at_utc      TEXT,
    completed_at_utc    TEXT,
    updated_at_utc      TEXT,
    personal_task_id    INTEGER REFERENCES personal_tasks(personal_task_id) ON DELETE SET NULL
) STRICT;

INSERT INTO video_jobs (
    video_job_id, request_event_id, source_turn_id, content_id, renderer,
    template, status, input_json, output_file_id, error_text, created_at_utc,
    started_at_utc, completed_at_utc, updated_at_utc, personal_task_id
)
SELECT
    video_job_id, request_event_id, source_turn_id, content_id, renderer,
    template, status, input_json, output_file_id, error_text, created_at_utc,
    started_at_utc, completed_at_utc, updated_at_utc, personal_task_id
FROM migration_0015_video_jobs;

DROP TABLE migration_0015_video_jobs;
DROP TABLE migration_0015_content_items;

CREATE INDEX content_groups_order
    ON content_groups(archived_at_utc, sort_position, content_group_id);

CREATE INDEX content_items_group_order
    ON content_items(content_group_id, sequence, content_id);

CREATE INDEX content_items_creator
    ON content_items(creator_contact_id, published_at_utc DESC);

CREATE INDEX content_items_type_status
    ON content_items(content_type, content_status);
-- end migration 0015

-- migration 0014: remove-contact-relationships
-- Contacts use notes and reusable tags for overlapping classifications. Abort
-- instead of deleting anything if a relationship record appears before this
-- migration is applied.

CREATE TABLE migration_0014_contact_relationships_guard (
    row_count INTEGER NOT NULL CHECK (row_count = 0)
) STRICT;

INSERT INTO migration_0014_contact_relationships_guard (row_count)
SELECT COUNT(*) FROM contact_relationships;

DROP TABLE contact_relationships;
DROP TABLE migration_0014_contact_relationships_guard;
-- end migration 0014

-- migration 0013: ordered-todo-groups
-- Give to-do groups an explicit presentation order independent of their names.
-- Seed existing groups in their current alphabetical order.

ALTER TABLE todo_groups
ADD COLUMN sort_position INTEGER NOT NULL DEFAULT 0;

WITH ordered_groups AS (
    SELECT todo_group_id,
           ROW_NUMBER() OVER (ORDER BY name COLLATE NOCASE, todo_group_id) * 10 AS sort_position
    FROM todo_groups
)
UPDATE todo_groups
SET sort_position = (
    SELECT ordered_groups.sort_position
    FROM ordered_groups
    WHERE ordered_groups.todo_group_id = todo_groups.todo_group_id
);

CREATE INDEX todo_groups_order
    ON todo_groups(archived_at_utc, sort_position, todo_group_id);
-- end migration 0013

-- migration 0012: all-day-todos
-- Distinguish a task assigned to a calendar day from a task scheduled for an
-- exact time. Routine definitions carry the same flag into future occurrences.

ALTER TABLE personal_tasks
ADD COLUMN is_all_day INTEGER NOT NULL DEFAULT 0
                  CHECK (is_all_day IN (0, 1));

ALTER TABLE todo_routines
ADD COLUMN is_all_day INTEGER NOT NULL DEFAULT 0
                  CHECK (is_all_day IN (0, 1));
-- end migration 0012

-- migration 0011: generic-log-imports
-- Give every log entry generic provenance and an optional upstream identity so
-- bounded imports from any source can be replayed without creating duplicates.

ALTER TABLE log_entries
ADD COLUMN source TEXT NOT NULL DEFAULT 'agent-slayer'
                  CHECK (length(trim(source)) BETWEEN 1 AND 200);

ALTER TABLE log_entries
ADD COLUMN external_id TEXT
                       CHECK (external_id IS NULL OR length(trim(external_id)) BETWEEN 1 AND 1000);

CREATE UNIQUE INDEX log_entries_source_external
    ON log_entries(source, external_id)
    WHERE external_id IS NOT NULL;
-- end migration 0011

-- migration 0010: personal-logs
-- Add general-purpose grouped trackers and self-contained log entries. Numeric
-- values and units are optional query projections of the complete entry text.

CREATE TABLE log_groups (
    log_group_id    INTEGER PRIMARY KEY,
    name            TEXT NOT NULL COLLATE NOCASE UNIQUE
                    CHECK (length(trim(name)) BETWEEN 1 AND 200),
    archived_at_utc TEXT,
    created_at_utc  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc  TEXT
) STRICT;

CREATE TABLE trackers (
    tracker_id      INTEGER PRIMARY KEY,
    log_group_id    INTEGER NOT NULL
                    REFERENCES log_groups(log_group_id) ON DELETE RESTRICT,
    name            TEXT NOT NULL COLLATE NOCASE UNIQUE
                    CHECK (length(trim(name)) BETWEEN 1 AND 200),
    default_unit    TEXT
                    CHECK (default_unit IS NULL OR length(trim(default_unit)) BETWEEN 1 AND 100),
    archived_at_utc TEXT,
    created_at_utc  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc  TEXT
) STRICT;

CREATE INDEX trackers_group_name
    ON trackers(log_group_id, archived_at_utc, name);

CREATE TABLE log_entries (
    log_entry_id    INTEGER PRIMARY KEY,
    tracker_id      INTEGER NOT NULL
                    REFERENCES trackers(tracker_id) ON DELETE RESTRICT,
    occurred_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    content_text    TEXT NOT NULL
                    CHECK (length(trim(content_text)) BETWEEN 1 AND 10000),
    number_value    REAL,
    unit            TEXT
                    CHECK (unit IS NULL OR length(trim(unit)) BETWEEN 1 AND 100),
    source_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
    created_at_utc  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc  TEXT,
    CHECK (unit IS NULL OR number_value IS NOT NULL)
) STRICT;

CREATE INDEX log_entries_tracker_occurred
    ON log_entries(tracker_id, occurred_at_utc DESC, log_entry_id DESC);
-- end migration 0010

-- migration 0009: typed-profile-facts
-- Let one broad fact type contain multiple self-describing active rows. Tools
-- replace or archive an exact row by its stable profile_fact_id.

DROP INDEX profile_facts_status_key;
DROP INDEX profile_facts_one_active_key;

ALTER TABLE profile_facts RENAME COLUMN fact_key TO fact_type;
ALTER TABLE profile_facts RENAME COLUMN value_text TO fact_text;

UPDATE profile_facts
SET fact_type = CASE fact_type
    WHEN 'wife_vehicle' THEN 'vehicle'
    WHEN 'user_shoe_size' THEN 'clothing_size'
    WHEN 'son_vince_shoe_size' THEN 'clothing_size'
    WHEN 'household_members' THEN 'household_member'
    WHEN 'pets' THEN 'pet'
    WHEN 'scheduling_preferences' THEN 'scheduling_preference'
    WHEN 'dietary_preference' THEN 'dietary_information'
    WHEN 'dietary_preferences' THEN 'dietary_information'
    WHEN 'dietary_requirement' THEN 'dietary_information'
    WHEN 'food_allergy' THEN 'dietary_information'
    WHEN 'food_allergies' THEN 'dietary_information'
    WHEN 'accessibility_needs' THEN 'accessibility_need'
    WHEN 'clothing_sizes' THEN 'clothing_size'
    WHEN 'travel_preferences' THEN 'travel_preference'
    ELSE fact_type
END;

CREATE INDEX profile_facts_status_type
    ON profile_facts(fact_status, fact_type, profile_fact_id);
-- end migration 0009

-- migration 0008: profile-facts
-- Store current and archived user-owned profile facts in SQLite so conversation
-- tools, first-call context, and observability share one durable authority.

CREATE TABLE profile_facts (
    profile_fact_id   INTEGER PRIMARY KEY,
    fact_key          TEXT NOT NULL
                      CHECK (length(trim(fact_key)) BETWEEN 1 AND 200),
    value_text        TEXT NOT NULL
                      CHECK (length(trim(value_text)) BETWEEN 1 AND 10000),
    fact_status       TEXT NOT NULL DEFAULT 'active'
                      CHECK (fact_status IN ('active', 'archived')),
    source_event_id   TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
    archived_by_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
    created_at_utc    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc    TEXT,
    archived_at_utc   TEXT,
    CHECK (
        (fact_status = 'active' AND archived_at_utc IS NULL)
        OR (fact_status = 'archived' AND archived_at_utc IS NOT NULL)
    )
) STRICT;

CREATE INDEX profile_facts_status_key
    ON profile_facts(fact_status, fact_key);

CREATE UNIQUE INDEX profile_facts_one_active_key
    ON profile_facts(fact_key)
    WHERE fact_status = 'active';
-- end migration 0008
