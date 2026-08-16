-- Agent Slayer SQLite migration ledger.
--
-- Add each new migration directly below this header so the newest change stays
-- at the top. The runner validates newest-first file order and applies pending
-- migrations oldest-first. It owns transactions, backups, integrity checks,
-- schema-version updates, and schema-semantic synchronization.

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
