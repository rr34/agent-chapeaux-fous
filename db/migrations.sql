-- Agent Slayer SQLite migration ledger.
--
-- Add each new migration directly below this header so the newest change stays
-- at the top. The runner validates newest-first file order and applies pending
-- migrations oldest-first. It owns transactions, backups, integrity checks,
-- schema-version updates, and schema-semantic synchronization.

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
