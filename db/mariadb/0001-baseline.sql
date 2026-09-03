-- Chapeaux Fous MariaDB schema baseline.
-- Target: MariaDB 10.11, schema version 28.
--
-- Apply only to an empty database whose default character set is utf8mb4.
-- The SQLite database remains the authoritative migration source until the
-- rehearsal and cutover verification reports both succeed.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE database_meta (
    singleton       TINYINT UNSIGNED NOT NULL,
    schema_version  INT UNSIGNED NOT NULL,
    created_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                    DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    description     TEXT,
    PRIMARY KEY (singleton),
    CONSTRAINT database_meta_singleton CHECK (singleton = 1)
) ENGINE=InnoDB;

CREATE TABLE files (
    file_id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    storage_path       TEXT NOT NULL,
    storage_path_hash  BINARY(32) AS (UNHEX(SHA2(storage_path, 256))) PERSISTENT,
    original_filename  TEXT,
    media_kind         VARCHAR(32) NOT NULL DEFAULT 'other',
    mime_type          VARCHAR(255),
    sha256             CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
    byte_size          BIGINT,
    duration_ms        BIGINT,
    width              BIGINT,
    height             BIGINT,
    source_event_id    VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    title              VARCHAR(200),
    description        TEXT,
    title_source       VARCHAR(32) NOT NULL DEFAULT 'original_filename',
    updated_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (file_id),
    UNIQUE KEY files_storage_path (storage_path_hash),
    UNIQUE KEY files_sha256_unique (sha256),
    KEY files_created (created_at_utc, file_id),
    FULLTEXT KEY files_fulltext (title, description, original_filename),
    CONSTRAINT files_media_kind CHECK (media_kind IN ('audio', 'video', 'image', 'document', 'archive', 'other')),
    CONSTRAINT files_byte_size CHECK (byte_size IS NULL OR byte_size >= 0),
    CONSTRAINT files_duration CHECK (duration_ms IS NULL OR duration_ms >= 0),
    CONSTRAINT files_width CHECK (width IS NULL OR width > 0),
    CONSTRAINT files_height CHECK (height IS NULL OR height > 0),
    CONSTRAINT files_title_source CHECK (title_source IN ('original_filename', 'ai', 'user'))
) ENGINE=InnoDB;

CREATE TABLE activity_events (
    event_seq        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id         VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (LOWER(REPLACE(UUID(), '-', ''))),
    occurred_at_ms   BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000),
    recorded_at_ms   BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000),
    occurred_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    event_type       VARCHAR(255) NOT NULL,
    event_phase      VARCHAR(16) NOT NULL DEFAULT 'point',
    status           VARCHAR(64),
    actor_type       VARCHAR(32) NOT NULL,
    actor_name       VARCHAR(255),
    source           VARCHAR(255) NOT NULL,
    channel          VARCHAR(255),
    session_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    turn_id          VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    trace_id         VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    operation_id     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    span_id          VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    parent_span_id   VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    parent_event_id  VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    name             VARCHAR(255),
    content_text     LONGTEXT,
    payload_json     LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '{}',
    primary_file_id  BIGINT UNSIGNED,
    subject_type     VARCHAR(255),
    subject_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    external_ref     TEXT,
    error_text       LONGTEXT,
    PRIMARY KEY (event_seq),
    UNIQUE KEY activity_events_event_id (event_id),
    KEY activity_events_occurred (occurred_at_ms, event_seq),
    KEY activity_events_operation (operation_id, occurred_at_ms, event_seq),
    KEY activity_events_session (session_id, occurred_at_ms, event_seq),
    KEY activity_events_subject (subject_type, subject_id, occurred_at_ms),
    KEY activity_events_trace (trace_id, occurred_at_ms, event_seq),
    KEY activity_events_turn (turn_id, occurred_at_ms, event_seq),
    KEY activity_events_type (event_type, occurred_at_ms),
    FULLTEXT KEY activity_events_fulltext (name, content_text, source),
    CONSTRAINT activity_events_primary_file
      FOREIGN KEY (primary_file_id) REFERENCES files(file_id) ON DELETE SET NULL,
    CONSTRAINT activity_events_phase CHECK (event_phase IN ('point', 'start', 'end', 'error')),
    CONSTRAINT activity_events_actor CHECK (actor_type IN ('user', 'agent', 'model', 'tool', 'system', 'service', 'external')),
    CONSTRAINT activity_events_payload_json CHECK (JSON_VALID(payload_json))
) ENGINE=InnoDB;

CREATE TABLE activity_event_files (
    event_id   VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    file_id    BIGINT UNSIGNED NOT NULL,
    file_role  VARCHAR(32) NOT NULL DEFAULT 'attachment',
    ordinal    BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (event_id, file_id),
    KEY activity_event_files_file (file_id, event_id),
    CONSTRAINT activity_event_files_event FOREIGN KEY (event_id) REFERENCES activity_events(event_id) ON DELETE CASCADE,
    CONSTRAINT activity_event_files_file_fk FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
    CONSTRAINT activity_event_files_role CHECK (file_role IN ('attachment', 'input', 'output', 'other')),
    CONSTRAINT activity_event_files_ordinal CHECK (ordinal >= 0)
) ENGINE=InnoDB;

CREATE TABLE agent_turn_attempts (
    attempt_id             VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_event_id        VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subject_type           VARCHAR(255) NOT NULL,
    subject_id             VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attempt_number         BIGINT NOT NULL,
    session_id             VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    agent_operation_id     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    openclaw_run_id        VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    request_content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    correlation_method     VARCHAR(32),
    status                 VARCHAR(32) NOT NULL DEFAULT 'processing',
    started_at_ms          BIGINT NOT NULL,
    correlated_at_ms       BIGINT,
    completed_at_ms        BIGINT,
    created_at_utc         VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                           DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc         VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (attempt_id),
    UNIQUE KEY agent_turn_attempts_operation (agent_operation_id),
    UNIQUE KEY agent_turn_attempts_run (openclaw_run_id),
    UNIQUE KEY agent_turn_attempts_number (subject_type, subject_id, attempt_number),
    KEY agent_turn_attempts_active_prompt (session_id, request_content_sha256, status, started_at_ms),
    KEY agent_turn_attempts_subject (subject_type, subject_id, attempt_number),
    CONSTRAINT agent_turn_attempts_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE RESTRICT,
    CONSTRAINT agent_turn_attempts_attempt CHECK (attempt_number > 0),
    CONSTRAINT agent_turn_attempts_hash CHECK (CHAR_LENGTH(request_content_sha256) = 64),
    CONSTRAINT agent_turn_attempts_correlation CHECK (correlation_method IS NULL OR correlation_method IN ('prompt_sha256', 'gateway_result')),
    CONSTRAINT agent_turn_attempts_status CHECK (status IN ('processing', 'complete', 'error', 'interrupted')),
    CONSTRAINT agent_turn_attempts_correlation_state CHECK (
      (openclaw_run_id IS NULL AND correlation_method IS NULL AND correlated_at_ms IS NULL)
      OR (openclaw_run_id IS NOT NULL AND correlation_method IS NOT NULL AND correlated_at_ms IS NOT NULL)
    )
) ENGINE=InnoDB;

CREATE TABLE contacts (
    contact_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contact_kind       VARCHAR(32) NOT NULL DEFAULT 'person',
    display_name       VARCHAR(500) NOT NULL,
    given_name         VARCHAR(255),
    family_name        VARCHAR(255),
    organization_name  VARCHAR(500),
    is_self            TINYINT NOT NULL DEFAULT 0,
    status             VARCHAR(32) NOT NULL DEFAULT 'active',
    notes              TEXT,
    source             VARCHAR(255),
    external_id        VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    birth_date         CHAR(10) CHARACTER SET ascii COLLATE ascii_bin,
    active_self_guard  TINYINT AS (IF(is_self = 1 AND status = 'active', 1, NULL)) PERSISTENT,
    PRIMARY KEY (contact_id),
    UNIQUE KEY contacts_one_self (active_self_guard),
    KEY contacts_display_name (display_name),
    CONSTRAINT contacts_kind CHECK (contact_kind IN ('person', 'organization', 'service')),
    CONSTRAINT contacts_is_self CHECK (is_self IN (0, 1)),
    CONSTRAINT contacts_status CHECK (status IN ('active', 'inactive', 'blocked', 'deceased')),
    CONSTRAINT contacts_birth_date CHECK (birth_date IS NULL OR birth_date REGEXP '^([0-9]{4}|--)-[0-9]{2}-[0-9]{2}$')
) ENGINE=InnoDB;

CREATE TABLE contact_methods (
    contact_method_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    contact_id         BIGINT UNSIGNED NOT NULL,
    method_kind        VARCHAR(32) NOT NULL,
    label              VARCHAR(255),
    value              TEXT NOT NULL,
    normalized_value   VARCHAR(512),
    is_primary         TINYINT NOT NULL DEFAULT 0,
    can_receive        TINYINT NOT NULL DEFAULT 1,
    created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    value_hash         BINARY(32) AS (UNHEX(SHA2(value, 256))) PERSISTENT,
    PRIMARY KEY (contact_method_id),
    UNIQUE KEY contact_methods_value (contact_id, method_kind, value_hash),
    KEY contact_methods_lookup (method_kind, normalized_value),
    CONSTRAINT contact_methods_contact FOREIGN KEY (contact_id) REFERENCES contacts(contact_id) ON DELETE CASCADE,
    CONSTRAINT contact_methods_kind CHECK (method_kind IN ('email', 'phone', 'postal_address', 'handle', 'url', 'other')),
    CONSTRAINT contact_methods_primary CHECK (is_primary IN (0, 1)),
    CONSTRAINT contact_methods_receive CHECK (can_receive IN (0, 1))
) ENGINE=InnoDB;

CREATE TABLE tags (
    tag_id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    slug            VARCHAR(255) NOT NULL,
    label           VARCHAR(255) NOT NULL,
    is_active       TINYINT NOT NULL DEFAULT 1,
    created_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                    DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    PRIMARY KEY (tag_id),
    UNIQUE KEY tags_slug (slug),
    CONSTRAINT tags_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB;

CREATE TABLE record_tags (
    tag_id          BIGINT UNSIGNED NOT NULL,
    record_type     VARCHAR(128) NOT NULL,
    record_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                    DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    PRIMARY KEY (tag_id, record_type, record_id),
    KEY record_tags_record (record_type, record_id),
    CONSTRAINT record_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE content_groups (
    content_group_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name              VARCHAR(200) NOT NULL,
    sort_position     BIGINT NOT NULL DEFAULT 0,
    archived_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                      DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (content_group_id),
    UNIQUE KEY content_groups_name (name),
    KEY content_groups_order (archived_at_utc, sort_position, content_group_id),
    CONSTRAINT content_groups_name_length CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 200)
) ENGINE=InnoDB;

CREATE TABLE log_groups (
    log_group_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name             VARCHAR(200) NOT NULL,
    archived_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (log_group_id),
    UNIQUE KEY log_groups_name (name),
    CONSTRAINT log_groups_name_length CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 200)
) ENGINE=InnoDB;

CREATE TABLE interaction_guides (
    interaction_guide_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name                  VARCHAR(200) NOT NULL,
    status                VARCHAR(32) NOT NULL DEFAULT 'active',
    version               BIGINT NOT NULL DEFAULT 1,
    created_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                          DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (interaction_guide_id),
    UNIQUE KEY interaction_guides_name (name),
    KEY interaction_guides_status_name (status, name, interaction_guide_id),
    CONSTRAINT interaction_guides_name_length CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 200),
    CONSTRAINT interaction_guides_status CHECK (status IN ('active', 'archived')),
    CONSTRAINT interaction_guides_version CHECK (version > 0)
) ENGINE=InnoDB;

CREATE TABLE todo_groups (
    todo_group_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name              VARCHAR(255) NOT NULL,
    archived_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                      DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    sort_position     BIGINT NOT NULL DEFAULT 0,
    uses_sequence     TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (todo_group_id),
    UNIQUE KEY todo_groups_name (name),
    KEY todo_groups_order (archived_at_utc, sort_position, todo_group_id),
    CONSTRAINT todo_groups_sequence CHECK (uses_sequence IN (0, 1))
) ENGINE=InnoDB;

CREATE TABLE trackers (
    tracker_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    log_group_id     BIGINT UNSIGNED NOT NULL,
    name             VARCHAR(200) NOT NULL,
    unit             VARCHAR(100) NOT NULL,
    archived_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (tracker_id),
    UNIQUE KEY trackers_name (name),
    KEY trackers_group_name (log_group_id, archived_at_utc, name),
    CONSTRAINT trackers_group FOREIGN KEY (log_group_id) REFERENCES log_groups(log_group_id) ON DELETE RESTRICT,
    CONSTRAINT trackers_name_length CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 200),
    CONSTRAINT trackers_unit_length CHECK (CHAR_LENGTH(TRIM(unit)) BETWEEN 1 AND 100)
) ENGINE=InnoDB;

CREATE TABLE calendar_events (
    calendar_event_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    ical_uid            VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin,
    ical_recurrence_id  VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    title               TEXT NOT NULL,
    description         LONGTEXT,
    location_text       TEXT,
    starts_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ends_at_utc         VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    time_zone           VARCHAR(255),
    is_all_day          TINYINT NOT NULL DEFAULT 0,
    status              VARCHAR(32) NOT NULL DEFAULT 'confirmed',
    recurrence_rule     TEXT,
    source_event_id     VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                        DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    planning_prompt_text TEXT,
    ical_single_guard   VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin
                        AS (IF(ical_uid IS NOT NULL AND ical_recurrence_id IS NULL, ical_uid, NULL)) PERSISTENT,
    PRIMARY KEY (calendar_event_id),
    UNIQUE KEY calendar_events_ical_occurrence (ical_uid, ical_recurrence_id),
    UNIQUE KEY calendar_events_ical_single (ical_single_guard),
    KEY calendar_events_start (starts_at_utc, status),
    CONSTRAINT calendar_events_source FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT calendar_events_all_day CHECK (is_all_day IN (0, 1)),
    CONSTRAINT calendar_events_status CHECK (status IN ('tentative', 'confirmed', 'cancelled', 'completed')),
    CONSTRAINT calendar_events_prompt CHECK (planning_prompt_text IS NULL OR CHAR_LENGTH(TRIM(planning_prompt_text)) BETWEEN 1 AND 10000)
) ENGINE=InnoDB;

CREATE TABLE calendar_event_exclusions (
    calendar_event_id       BIGINT UNSIGNED NOT NULL,
    excluded_starts_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (calendar_event_id, excluded_starts_at_utc),
    KEY calendar_event_exclusions_start (excluded_starts_at_utc, calendar_event_id),
    CONSTRAINT calendar_event_exclusions_event FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE calendar_event_contacts (
    calendar_event_id  BIGINT UNSIGNED NOT NULL,
    contact_id         BIGINT UNSIGNED NOT NULL,
    participant_role   VARCHAR(32) NOT NULL DEFAULT 'attendee',
    response_status    VARCHAR(64),
    PRIMARY KEY (calendar_event_id, contact_id, participant_role),
    CONSTRAINT calendar_event_contacts_event FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE,
    CONSTRAINT calendar_event_contacts_contact FOREIGN KEY (contact_id) REFERENCES contacts(contact_id) ON DELETE CASCADE,
    CONSTRAINT calendar_event_contacts_role CHECK (participant_role IN ('organizer', 'attendee', 'customer', 'other'))
) ENGINE=InnoDB;

CREATE TABLE interaction_guide_steps (
    interaction_guide_step_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    interaction_guide_id       BIGINT UNSIGNED NOT NULL,
    step_number                BIGINT NOT NULL,
    opening_text               TEXT NOT NULL,
    contract_json              LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
                               DEFAULT '{"version":1,"instructions":null,"inputs":[],"operations":[],"recoveryReads":[],"completion":{"mode":"response_valid"}}',
    answers_json               LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '{}',
    enabled                    TINYINT NOT NULL DEFAULT 1,
    created_at_utc             VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                               DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc             VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    progress_state             VARCHAR(32) NOT NULL DEFAULT 'pending',
    PRIMARY KEY (interaction_guide_step_id),
    UNIQUE KEY interaction_guide_steps_number (interaction_guide_id, step_number),
    KEY interaction_guide_steps_guide_order (interaction_guide_id, enabled, step_number),
    KEY interaction_guide_steps_guide_progress (interaction_guide_id, progress_state, enabled, step_number),
    CONSTRAINT interaction_guide_steps_guide FOREIGN KEY (interaction_guide_id) REFERENCES interaction_guides(interaction_guide_id) ON DELETE CASCADE,
    CONSTRAINT interaction_guide_steps_step CHECK (step_number > 0),
    CONSTRAINT interaction_guide_steps_opening CHECK (CHAR_LENGTH(TRIM(opening_text)) BETWEEN 1 AND 10000),
    CONSTRAINT interaction_guide_steps_contract CHECK (JSON_VALID(contract_json)),
    CONSTRAINT interaction_guide_steps_answers CHECK (JSON_VALID(answers_json)),
    CONSTRAINT interaction_guide_steps_enabled CHECK (enabled IN (0, 1)),
    CONSTRAINT interaction_guide_steps_progress CHECK (progress_state IN ('pending', 'active', 'completed'))
) ENGINE=InnoDB;

CREATE TABLE todo_routines (
    todo_routine_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    todo_group_id           BIGINT UNSIGNED NOT NULL,
    text                    TEXT NOT NULL,
    first_scheduled_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    first_due_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    time_zone               VARCHAR(255) NOT NULL,
    recurrence_rule         TEXT NOT NULL,
    disabled_at_utc         VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc          VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                            DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc          VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    is_all_day             TINYINT NOT NULL DEFAULT 0,
    interaction_guide_id   BIGINT UNSIGNED,
    planning_prompt_text   TEXT,
    PRIMARY KEY (todo_routine_id),
    CONSTRAINT todo_routines_group FOREIGN KEY (todo_group_id) REFERENCES todo_groups(todo_group_id) ON DELETE RESTRICT,
    CONSTRAINT todo_routines_guide FOREIGN KEY (interaction_guide_id) REFERENCES interaction_guides(interaction_guide_id) ON DELETE SET NULL,
    CONSTRAINT todo_routines_all_day CHECK (is_all_day IN (0, 1)),
    CONSTRAINT todo_routines_prompt CHECK (planning_prompt_text IS NULL OR CHAR_LENGTH(TRIM(planning_prompt_text)) BETWEEN 1 AND 10000)
) ENGINE=InnoDB;

CREATE TABLE personal_tasks (
    personal_task_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    todo_group_id        BIGINT UNSIGNED NOT NULL,
    todo_routine_id      BIGINT UNSIGNED,
    sequence             BIGINT,
    related_contact_id   BIGINT UNSIGNED,
    text                 TEXT NOT NULL,
    status               VARCHAR(32) NOT NULL DEFAULT 'todo',
    sort_position        BIGINT NOT NULL DEFAULT 0,
    scheduled_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    due_at_utc           VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    completed_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    source               VARCHAR(255),
    external_id          VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin,
    source_event_id      VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    is_all_day           TINYINT NOT NULL DEFAULT 0,
    duration_minutes     BIGINT,
    planning_prompt_text TEXT,
    PRIMARY KEY (personal_task_id),
    UNIQUE KEY personal_tasks_group_sequence (todo_group_id, sequence),
    UNIQUE KEY personal_tasks_source_external (source, external_id),
    UNIQUE KEY personal_tasks_routine_occurrence (todo_routine_id, scheduled_at_utc),
    KEY personal_tasks_status_schedule (status, scheduled_at_utc, due_at_utc),
    KEY personal_tasks_group_order (todo_group_id, sort_position, personal_task_id),
    KEY personal_tasks_contact (related_contact_id, status),
    CONSTRAINT personal_tasks_group FOREIGN KEY (todo_group_id) REFERENCES todo_groups(todo_group_id) ON DELETE RESTRICT,
    CONSTRAINT personal_tasks_routine FOREIGN KEY (todo_routine_id) REFERENCES todo_routines(todo_routine_id) ON DELETE SET NULL,
    CONSTRAINT personal_tasks_contact_fk FOREIGN KEY (related_contact_id) REFERENCES contacts(contact_id) ON DELETE SET NULL,
    CONSTRAINT personal_tasks_source FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT personal_tasks_sequence CHECK (sequence IS NULL OR sequence > 0),
    CONSTRAINT personal_tasks_status CHECK (status IN ('unplanned', 'todo', 'complete', 'ignore', 'archive', 'ai_suggested')),
    CONSTRAINT personal_tasks_all_day CHECK (is_all_day IN (0, 1)),
    CONSTRAINT personal_tasks_duration CHECK (duration_minutes IS NULL OR duration_minutes > 0),
    CONSTRAINT personal_tasks_prompt CHECK (planning_prompt_text IS NULL OR CHAR_LENGTH(TRIM(planning_prompt_text)) BETWEEN 1 AND 10000)
) ENGINE=InnoDB;

CREATE TABLE reminders (
    reminder_id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    calendar_event_id    BIGINT UNSIGNED,
    personal_task_id     BIGINT UNSIGNED,
    title                TEXT,
    remind_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    delivery_method      VARCHAR(32) NOT NULL DEFAULT 'agent',
    delivery_target      TEXT,
    status               VARCHAR(32) NOT NULL DEFAULT 'pending',
    attempt_count        BIGINT NOT NULL DEFAULT 0,
    last_attempt_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    delivered_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    error_text           LONGTEXT,
    created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (reminder_id),
    KEY reminders_due (status, remind_at_utc),
    CONSTRAINT reminders_event FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE,
    CONSTRAINT reminders_task FOREIGN KEY (personal_task_id) REFERENCES personal_tasks(personal_task_id) ON DELETE CASCADE,
    CONSTRAINT reminders_delivery CHECK (delivery_method IN ('agent', 'webhook', 'notification', 'email', 'sms', 'other')),
    CONSTRAINT reminders_status CHECK (status IN ('pending', 'processing', 'delivered', 'snoozed', 'cancelled', 'error')),
    CONSTRAINT reminders_attempt CHECK (attempt_count >= 0)
) ENGINE=InnoDB;

CREATE TABLE log_entries (
    log_entry_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    tracker_id       BIGINT UNSIGNED NOT NULL,
    occurred_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    content_text     TEXT NOT NULL,
    number_value     DOUBLE,
    source_event_id  VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    source           VARCHAR(200) NOT NULL DEFAULT 'agent-slayer',
    external_id      VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (log_entry_id),
    UNIQUE KEY log_entries_source_external (source, external_id),
    KEY log_entries_tracker_occurred (tracker_id, occurred_at_utc, log_entry_id),
    CONSTRAINT log_entries_tracker FOREIGN KEY (tracker_id) REFERENCES trackers(tracker_id) ON DELETE RESTRICT,
    CONSTRAINT log_entries_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT log_entries_content CHECK (CHAR_LENGTH(TRIM(content_text)) BETWEEN 1 AND 10000),
    CONSTRAINT log_entries_source_length CHECK (CHAR_LENGTH(TRIM(source)) BETWEEN 1 AND 200),
    CONSTRAINT log_entries_external_length CHECK (external_id IS NULL OR CHAR_LENGTH(TRIM(external_id)) BETWEEN 1 AND 1000)
) ENGINE=InnoDB;

CREATE TABLE content_items (
    content_id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    content_group_id      BIGINT UNSIGNED NOT NULL,
    sequence              BIGINT,
    content_type          VARCHAR(64) NOT NULL DEFAULT 'mobileUGC_tutorial',
    title                 TEXT NOT NULL,
    transcript            LONGTEXT,
    description           LONGTEXT,
    published_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                          DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    content_host          VARCHAR(64) NOT NULL DEFAULT 'youtube',
    content_status        VARCHAR(32) NOT NULL DEFAULT 'active',
    content_url           TEXT,
    relationship_to_user  VARCHAR(32) NOT NULL DEFAULT 'mine',
    creator_contact_id    BIGINT UNSIGNED,
    personal_notes        LONGTEXT,
    external_id           VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin,
    primary_file_id       BIGINT UNSIGNED,
    consumed_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    source_event_id       VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                          DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (content_id),
    UNIQUE KEY content_items_group_sequence (content_group_id, sequence),
    KEY content_items_group_order (content_group_id, sequence, content_id),
    KEY content_items_creator (creator_contact_id, published_at_utc),
    KEY content_items_type_status (content_type, content_status),
    CONSTRAINT content_items_group FOREIGN KEY (content_group_id) REFERENCES content_groups(content_group_id) ON DELETE RESTRICT,
    CONSTRAINT content_items_creator_fk FOREIGN KEY (creator_contact_id) REFERENCES contacts(contact_id) ON DELETE SET NULL,
    CONSTRAINT content_items_file FOREIGN KEY (primary_file_id) REFERENCES files(file_id) ON DELETE SET NULL,
    CONSTRAINT content_items_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT content_items_sequence CHECK (sequence IS NULL OR sequence > 0),
    CONSTRAINT content_items_type CHECK (content_type IN ('mobileUGC_tutorial', 'mobileUGC_ad', 'webUGC_tutorial', 'webUGC_ad', 'video_ad', 'podcast', 'image', 'unknown')),
    CONSTRAINT content_items_host CHECK (content_host IN ('youtube', 'vimeo', 'spotify', 'mytlomdotcom', 'none')),
    CONSTRAINT content_items_status CHECK (content_status IN ('active', 'obsolete', 'unused', 'queued')),
    CONSTRAINT content_items_relationship CHECK (relationship_to_user IN ('mine', 'reference'))
) ENGINE=InnoDB;

CREATE TABLE video_scripts (
    video_script_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    title                VARCHAR(200) NOT NULL,
    status               VARCHAR(32) NOT NULL DEFAULT 'draft',
    schema_version       BIGINT NOT NULL DEFAULT 1,
    script_json          LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    script_text          LONGTEXT NOT NULL,
    created_by_event_id  VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    archived_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    version              BIGINT NOT NULL DEFAULT 1,
    PRIMARY KEY (video_script_id),
    UNIQUE KEY video_scripts_created_by (created_by_event_id),
    KEY video_scripts_status_created (status, created_at_utc, video_script_id),
    CONSTRAINT video_scripts_event FOREIGN KEY (created_by_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT video_scripts_title CHECK (CHAR_LENGTH(TRIM(title)) BETWEEN 1 AND 200),
    CONSTRAINT video_scripts_status CHECK (status IN ('draft', 'archived')),
    CONSTRAINT video_scripts_schema CHECK (schema_version = 1),
    CONSTRAINT video_scripts_json CHECK (CHAR_LENGTH(script_json) <= 500000 AND JSON_VALID(script_json)),
    CONSTRAINT video_scripts_text CHECK (CHAR_LENGTH(TRIM(script_text)) BETWEEN 1 AND 500000),
    CONSTRAINT video_scripts_version CHECK (version > 0),
    CONSTRAINT video_scripts_archive_state CHECK ((status = 'draft' AND archived_at_utc IS NULL) OR (status = 'archived' AND archived_at_utc IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE video_script_sources (
    video_script_id  BIGINT UNSIGNED NOT NULL,
    request_event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_order     BIGINT NOT NULL,
    PRIMARY KEY (video_script_id, request_event_id),
    UNIQUE KEY video_script_sources_order (video_script_id, source_order),
    KEY video_script_sources_request (request_event_id, video_script_id),
    CONSTRAINT video_script_sources_script FOREIGN KEY (video_script_id) REFERENCES video_scripts(video_script_id) ON DELETE CASCADE,
    CONSTRAINT video_script_sources_event FOREIGN KEY (request_event_id) REFERENCES activity_events(event_id) ON DELETE RESTRICT,
    CONSTRAINT video_script_sources_positive CHECK (source_order > 0)
) ENGINE=InnoDB;

CREATE TABLE video_jobs (
    video_job_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    request_event_id   VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    source_turn_id     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    content_id         BIGINT UNSIGNED,
    renderer           VARCHAR(32) NOT NULL DEFAULT 'remotion',
    template           VARCHAR(255) NOT NULL,
    status             VARCHAR(32) NOT NULL DEFAULT 'queued',
    input_json         LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '{}',
    output_file_id     BIGINT UNSIGNED,
    error_text         LONGTEXT,
    created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    started_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    completed_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    updated_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    personal_task_id   BIGINT UNSIGNED,
    video_script_id    BIGINT UNSIGNED,
    active_script_guard BIGINT UNSIGNED AS (IF(status IN ('queued', 'preparing', 'rendering'), video_script_id, NULL)) PERSISTENT,
    PRIMARY KEY (video_job_id),
    UNIQUE KEY video_jobs_one_active_script (active_script_guard),
    KEY video_jobs_script_created (video_script_id, created_at_utc, video_job_id),
    CONSTRAINT video_jobs_event FOREIGN KEY (request_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT video_jobs_content FOREIGN KEY (content_id) REFERENCES content_items(content_id) ON DELETE SET NULL,
    CONSTRAINT video_jobs_file FOREIGN KEY (output_file_id) REFERENCES files(file_id) ON DELETE SET NULL,
    CONSTRAINT video_jobs_task FOREIGN KEY (personal_task_id) REFERENCES personal_tasks(personal_task_id) ON DELETE SET NULL,
    CONSTRAINT video_jobs_script FOREIGN KEY (video_script_id) REFERENCES video_scripts(video_script_id) ON DELETE SET NULL,
    CONSTRAINT video_jobs_renderer CHECK (renderer IN ('remotion', 'adobe_premiere', 'other')),
    CONSTRAINT video_jobs_status CHECK (status IN ('queued', 'preparing', 'rendering', 'complete', 'error', 'cancelled')),
    CONSTRAINT video_jobs_json CHECK (JSON_VALID(input_json))
) ENGINE=InnoDB;

CREATE TABLE profile_facts (
    profile_fact_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    fact_type            VARCHAR(200) NOT NULL,
    fact_text            TEXT NOT NULL,
    fact_status          VARCHAR(32) NOT NULL DEFAULT 'active',
    source_event_id      VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    archived_by_event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    archived_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (profile_fact_id),
    KEY profile_facts_status_type (fact_status, fact_type, profile_fact_id),
    CONSTRAINT profile_facts_source FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT profile_facts_archiver FOREIGN KEY (archived_by_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT profile_facts_type CHECK (CHAR_LENGTH(TRIM(fact_type)) BETWEEN 1 AND 200),
    CONSTRAINT profile_facts_text CHECK (CHAR_LENGTH(TRIM(fact_text)) BETWEEN 1 AND 10000),
    CONSTRAINT profile_facts_status CHECK (fact_status IN ('active', 'archived')),
    CONSTRAINT profile_facts_archive_state CHECK ((fact_status = 'active' AND archived_at_utc IS NULL) OR (fact_status = 'archived' AND archived_at_utc IS NOT NULL))
) ENGINE=InnoDB;

CREATE TABLE notes (
    note_id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    title            TEXT,
    body_text        LONGTEXT NOT NULL,
    note_kind        VARCHAR(32) NOT NULL DEFAULT 'personal',
    status           VARCHAR(32) NOT NULL DEFAULT 'active',
    subject_type     VARCHAR(128),
    subject_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    source_event_id  VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    occurred_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (note_id),
    KEY notes_subject (subject_type, subject_id, created_at_utc),
    CONSTRAINT notes_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT notes_kind CHECK (note_kind IN ('personal', 'journal', 'reference', 'idea', 'other')),
    CONSTRAINT notes_status CHECK (status IN ('active', 'archived', 'deleted'))
) ENGINE=InnoDB;

CREATE TABLE record_links (
    record_link_id    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    left_record_type  VARCHAR(64) NOT NULL,
    left_record_id    VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    relationship_type VARCHAR(64) NOT NULL,
    right_record_type VARCHAR(64) NOT NULL,
    right_record_id   VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    notes             TEXT,
    source_event_id   VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                      DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    PRIMARY KEY (record_link_id),
    UNIQUE KEY record_links_identity (left_record_type, left_record_id, relationship_type, right_record_type, right_record_id),
    KEY record_links_right (right_record_type, right_record_id, relationship_type),
    CONSTRAINT record_links_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT record_links_distinct CHECK (left_record_type <> right_record_type OR left_record_id <> right_record_id)
) ENGINE=InnoDB;

CREATE TABLE correspondence (
    correspondence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    medium            VARCHAR(32) NOT NULL,
    direction         VARCHAR(32) NOT NULL,
    account_key       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    thread_key        VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    external_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    in_reply_to_id    BIGINT UNSIGNED,
    subject           TEXT,
    body_text         LONGTEXT,
    body_html         LONGTEXT,
    status            VARCHAR(64),
    sent_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    received_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    source_event_id   VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin,
    created_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                      DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    PRIMARY KEY (correspondence_id),
    UNIQUE KEY correspondence_external (medium, account_key, external_id),
    KEY correspondence_thread (medium, account_key, thread_key),
    KEY correspondence_timeline_index (correspondence_id),
    CONSTRAINT correspondence_reply FOREIGN KEY (in_reply_to_id) REFERENCES correspondence(correspondence_id) ON DELETE SET NULL,
    CONSTRAINT correspondence_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT correspondence_medium CHECK (medium IN ('email', 'sms', 'mms', 'imessage', 'chat', 'voicemail', 'other')),
    CONSTRAINT correspondence_direction CHECK (direction IN ('inbound', 'outbound', 'draft', 'internal'))
) ENGINE=InnoDB;

CREATE TABLE correspondence_files (
    correspondence_id BIGINT UNSIGNED NOT NULL,
    file_id            BIGINT UNSIGNED NOT NULL,
    attachment_role    VARCHAR(32) NOT NULL DEFAULT 'attachment',
    PRIMARY KEY (correspondence_id, file_id),
    CONSTRAINT correspondence_files_message FOREIGN KEY (correspondence_id) REFERENCES correspondence(correspondence_id) ON DELETE CASCADE,
    CONSTRAINT correspondence_files_file FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
    CONSTRAINT correspondence_files_role CHECK (attachment_role IN ('attachment', 'inline', 'recording', 'other'))
) ENGINE=InnoDB;

CREATE TABLE correspondence_participants (
    correspondence_id  BIGINT UNSIGNED NOT NULL,
    participant_role   VARCHAR(32) NOT NULL,
    contact_id         BIGINT UNSIGNED,
    contact_method_id  BIGINT UNSIGNED,
    address_value      VARCHAR(512) NOT NULL,
    display_name       VARCHAR(500),
    PRIMARY KEY (correspondence_id, participant_role, address_value),
    KEY correspondence_participants_contact (contact_id, correspondence_id),
    CONSTRAINT correspondence_participants_message FOREIGN KEY (correspondence_id) REFERENCES correspondence(correspondence_id) ON DELETE CASCADE,
    CONSTRAINT correspondence_participants_contact_fk FOREIGN KEY (contact_id) REFERENCES contacts(contact_id) ON DELETE SET NULL,
    CONSTRAINT correspondence_participants_method FOREIGN KEY (contact_method_id) REFERENCES contact_methods(contact_method_id) ON DELETE SET NULL,
    CONSTRAINT correspondence_participants_role CHECK (participant_role IN ('from', 'to', 'cc', 'bcc', 'reply_to', 'sender', 'recipient'))
) ENGINE=InnoDB;

CREATE VIEW activity_operation_latency AS
WITH operation_times AS (
    SELECT operation_id, trace_id, name,
           MIN(CASE WHEN event_phase = 'start' THEN occurred_at_ms END) AS started_at_ms,
           MAX(CASE WHEN event_phase IN ('end', 'error') THEN occurred_at_ms END) AS finished_at_ms,
           MAX(CASE WHEN event_phase = 'error' THEN 1 ELSE 0 END) AS ended_in_error
    FROM activity_events
    WHERE operation_id IS NOT NULL
    GROUP BY operation_id, trace_id, name
)
SELECT operation_id, trace_id, name, started_at_ms, finished_at_ms,
       CASE WHEN started_at_ms IS NOT NULL AND finished_at_ms IS NOT NULL
            THEN finished_at_ms - started_at_ms END AS duration_ms,
       ended_in_error
FROM operation_times;

CREATE VIEW activity_recent AS
SELECT * FROM activity_events ORDER BY occurred_at_ms DESC, event_seq DESC LIMIT 1000;

CREATE VIEW activity_turn_latency AS
SELECT turn_id,
       MIN(occurred_at_ms) AS started_at_ms,
       MAX(occurred_at_ms) AS finished_at_ms,
       MAX(occurred_at_ms) - MIN(occurred_at_ms) AS duration_ms,
       COUNT(*) AS event_count,
       SUM(CASE WHEN event_phase = 'error' THEN 1 ELSE 0 END) AS error_count
FROM activity_events
WHERE turn_id IS NOT NULL
GROUP BY turn_id;

CREATE VIEW correspondence_timeline AS
SELECT correspondence.*,
       COALESCE(received_at_utc, sent_at_utc, created_at_utc) AS timeline_at_utc
FROM correspondence;

CREATE VIEW due_reminders AS
SELECT * FROM reminders
WHERE status IN ('pending', 'error')
  AND remind_at_utc <= CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z');

CREATE VIEW open_personal_tasks AS
SELECT * FROM personal_tasks
WHERE status IN ('unplanned', 'todo', 'ai_suggested');

CREATE VIEW upcoming_calendar AS
SELECT * FROM calendar_events
WHERE status IN ('tentative', 'confirmed')
  AND starts_at_utc >= CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
ORDER BY starts_at_utc;

DELIMITER //

CREATE TRIGGER personal_tasks_assign_sequence_before_insert
BEFORE INSERT ON personal_tasks
FOR EACH ROW
BEGIN
  IF NEW.sequence IS NULL
     AND EXISTS (SELECT 1 FROM todo_groups WHERE todo_group_id = NEW.todo_group_id AND uses_sequence = 1)
  THEN
    SET NEW.sequence = (
      SELECT COALESCE(MAX(sequence), 0) + 1
      FROM personal_tasks
      WHERE todo_group_id = NEW.todo_group_id
    );
  END IF;
END//

CREATE TRIGGER personal_tasks_assign_sequence_before_update
BEFORE UPDATE ON personal_tasks
FOR EACH ROW
BEGIN
  IF NEW.sequence IS NULL
     AND EXISTS (SELECT 1 FROM todo_groups WHERE todo_group_id = NEW.todo_group_id AND uses_sequence = 1)
  THEN
    SET NEW.sequence = (
      SELECT COALESCE(MAX(sequence), 0) + 1
      FROM personal_tasks
      WHERE todo_group_id = NEW.todo_group_id
        AND personal_task_id <> OLD.personal_task_id
    );
  END IF;
END//

CREATE TRIGGER log_entries_require_tracker_unit_before_insert
BEFORE INSERT ON log_entries
FOR EACH ROW
BEGIN
  IF NEW.number_value IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM trackers WHERE tracker_id = NEW.tracker_id AND unit IS NOT NULL)
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'numeric log entries require a tracker unit';
  END IF;
END//

CREATE TRIGGER log_entries_require_tracker_unit_before_update
BEFORE UPDATE ON log_entries
FOR EACH ROW
BEGIN
  IF NEW.number_value IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM trackers WHERE tracker_id = NEW.tracker_id AND unit IS NOT NULL)
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'numeric log entries require a tracker unit';
  END IF;
END//

CREATE TRIGGER trackers_preserve_numeric_unit_before_update
BEFORE UPDATE ON trackers
FOR EACH ROW
BEGIN
  IF NOT (OLD.unit <=> NEW.unit)
     AND LOWER(OLD.unit) <> 'set me'
     AND EXISTS (SELECT 1 FROM log_entries WHERE tracker_id = OLD.tracker_id AND number_value IS NOT NULL)
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'a tracker unit cannot change after numeric entries exist';
  END IF;
END//

DELIMITER ;

INSERT INTO database_meta (singleton, schema_version, description)
VALUES (1, 28, 'Chapeaux Fous MariaDB database');
