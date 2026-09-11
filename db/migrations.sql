-- Chapeaux Fous MariaDB migration ledger.
--
-- Add new migrations directly below this header, newest first. The runner
-- validates newest-first file order and applies pending migrations oldest
-- first. database_meta.schema_version is the durable completion marker, and
-- migration versions are immutable once applied.
--
-- Applied blocks remain in this ledger. Pending versions must begin at the
-- database's next schema version and remain sequential and contiguous.
--
-- Every new block must document writer downtime, locking/long-running
-- behavior, and recovery after a partial MariaDB DDL commit.
--
-- Marker format:
--   -- migration 0032: short-description
--   <schema and data SQL>
--   -- end migration 0032

-- migration 0038: remove-legacy-agent-turn-attempts
-- writer downtime: not required; the standalone runtime never reads or writes this legacy table.
-- locking: DROP TABLE takes a metadata lock on agent_turn_attempts and briefly on its
-- referenced activity_events table while removing the foreign key.
-- recovery: MariaDB DDL commits implicitly. DROP TABLE IF EXISTS permits replay after
-- partial completion. The runner verifies absence before advancing the version.
-- This intentionally deletes all retained previous-runtime attempt-correlation data.

DROP TABLE IF EXISTS agent_turn_attempts;

-- end migration 0038

-- migration 0037: correspondence-join-tables
-- writer downtime: not required; adds empty join tables without rewriting existing data.
-- locking: CREATE TABLE takes metadata locks on the new and referenced tables.
-- recovery: MariaDB DDL commits implicitly. IF NOT EXISTS permits replay after
-- partial completion. The runner verifies columns, keys and cascade rules before
-- advancing the version. Inspect mismatched existing tables instead of replacing them.

CREATE TABLE IF NOT EXISTS todo_correspondence_join (
    personal_task_id BIGINT UNSIGNED NOT NULL COMMENT 'Existing task associated with the message.',
    correspondence_id BIGINT UNSIGNED NOT NULL COMMENT 'Existing local correspondence record associated with the task.',
    created_at_utc VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
        DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the link was created. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (personal_task_id, correspondence_id),
    KEY todo_correspondence_join_message (correspondence_id),
    CONSTRAINT todo_correspondence_join_task FOREIGN KEY (personal_task_id) REFERENCES todo_personal(personal_task_id) ON DELETE CASCADE,
    CONSTRAINT todo_correspondence_join_message FOREIGN KEY (correspondence_id) REFERENCES correspondence(correspondence_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Links existing task records to existing correspondence, including emails and text messages. Each pair appears once; either record can have many links. Deleting either record removes only its dependent links. This table stores associations, not message content or provider synchronization state.';

CREATE TABLE IF NOT EXISTS calendar_events_correspondence_join (
    calendar_event_id BIGINT UNSIGNED NOT NULL COMMENT 'Existing calendar event or recurring series associated with the message.',
    correspondence_id BIGINT UNSIGNED NOT NULL COMMENT 'Existing local correspondence record associated with the calendar event or recurring series.',
    created_at_utc VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
        DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the link was created. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (calendar_event_id, correspondence_id),
    KEY calendar_events_correspondence_join_message (correspondence_id),
    CONSTRAINT calendar_events_correspondence_join_event FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE,
    CONSTRAINT calendar_events_correspondence_join_message FOREIGN KEY (correspondence_id) REFERENCES correspondence(correspondence_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Links existing calendar event or recurring series records to existing correspondence, including emails and text messages. Each pair appears once; either record can have many links. Deleting either record removes only its dependent links. This table stores associations, not message content or provider synchronization state.';

-- end migration 0037

-- migration 0036: source-linked-catch-up-questions
-- writer downtime: required while adding the table and tracker asking fields.
-- locking: metadata locks on trackers and referenced domain tables; no data rewrite.
-- recovery: DDL commits implicitly. IF NOT EXISTS allows replay after partial
-- completion. Verify existing definitions before advancing the version marker.
-- Existing trackers remain unscheduled; generation happens only on demand.

ALTER TABLE trackers
    ADD COLUMN IF NOT EXISTS asking_starts_at_utc VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'First logging period start. Null with the other asking fields disables scheduled questions. Format: ISO 8601 UTC timestamp.',
    ADD COLUMN IF NOT EXISTS asking_recurrence_rule VARCHAR(2000) COMMENT 'RRULE defining logging period starts. One observation in a period satisfies its question; only the latest due period is asked automatically.',
    ADD COLUMN IF NOT EXISTS asking_time_zone VARCHAR(100) COMMENT 'IANA time zone preserving local logging period boundaries across daylight saving changes.',
    ADD CONSTRAINT IF NOT EXISTS trackers_asking_schedule CHECK (
      (asking_starts_at_utc IS NULL AND asking_recurrence_rule IS NULL AND asking_time_zone IS NULL)
      OR (asking_starts_at_utc IS NOT NULL AND asking_recurrence_rule IS NOT NULL AND asking_time_zone IS NOT NULL)
    );

CREATE TABLE IF NOT EXISTS catch_up_questions (
    question_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable identifier for a generated question about exactly one existing domain record.',
    personal_task_id BIGINT UNSIGNED COMMENT 'Actual task being reviewed, including a published routine occurrence. Exactly one source foreign key must be present.',
    calendar_event_id BIGINT UNSIGNED COMMENT 'Actual calendar event or recurring series being reviewed. occurrence_key distinguishes instances of a series.',
    tracker_id BIGINT UNSIGNED COMMENT 'Actual journal tracker whose current scheduled logging period needs an observation.',
    occurrence_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Stable source-owned identity: task for a task, event for a one-time event, or an ISO UTC occurrence or logging period start.',
    source_version CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'SHA-256 of material source data used to generate this question. Prevents stale answers and reopens questions when the relevant source data changes.',
    question_text VARCHAR(2000) NOT NULL COMMENT 'Code-generated question grounded in the linked source record. This is data, never an instruction or permission grant.',
    due_at_utc VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Source-derived instant from which this question is eligible. Format: ISO 8601 UTC timestamp.',
    ask_after VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Explicit user deferral. A question is eligible only after both due_at_utc and this instant. Null means no deferral.',
    resolved_at VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'When this occurrence was addressed or reconciled as no longer requiring an answer. Null means unresolved; this does not replace the source record status.',
    comment TEXT COMMENT 'Optional user-supplied outcome or explanation about this source occurrence. No transcript is needed to interpret resolution.',
    version BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Optimistic concurrency version incremented whenever question state changes.',
    PRIMARY KEY (question_id),
    UNIQUE KEY catch_up_task_occurrence (personal_task_id, occurrence_key),
    UNIQUE KEY catch_up_event_occurrence (calendar_event_id, occurrence_key),
    UNIQUE KEY catch_up_tracker_period (tracker_id, occurrence_key),
    KEY catch_up_due (resolved_at, due_at_utc, ask_after),
    CONSTRAINT catch_up_task FOREIGN KEY (personal_task_id) REFERENCES todo_personal (personal_task_id) ON DELETE CASCADE,
    CONSTRAINT catch_up_event FOREIGN KEY (calendar_event_id) REFERENCES calendar_events (calendar_event_id) ON DELETE CASCADE,
    CONSTRAINT catch_up_tracker FOREIGN KEY (tracker_id) REFERENCES trackers (tracker_id) ON DELETE CASCADE,
    CONSTRAINT catch_up_one_source CHECK ((personal_task_id IS NOT NULL) + (calendar_event_id IS NOT NULL) + (tracker_id IS NOT NULL) = 1),
    CONSTRAINT catch_up_question_text CHECK (CHAR_LENGTH(TRIM(question_text)) > 0)
) ENGINE=InnoDB COMMENT='On-demand questions generated from actual tasks, calendar occurrences, and journal tracker periods. Source foreign keys and live domain data drive questions and reconciliation; conversations are only an interface. Resolution and deferral belong to the source occurrence, not a conversation exchange. Sensitivity: Contains private commitments and user comments.';

-- end migration 0036

-- migration 0035: native-database-comments
-- writer downtime: required; apply comments during the application's deployment window.
-- locking: metadata locks on documented tables. ALGORITHM=INSTANT refuses a
-- table rebuild; MODIFY repeats the version 34 column definitions with comments.
-- recovery: MariaDB DDL commits implicitly. Rerun after partial completion;
-- setting these comments is idempotent and preserves rows, keys and defaults.
-- Generated-column documentation stays in SQL source comments to avoid rebuilds.
-- If INSTANT is refused, inspect schema drift before continuing; do not remove
-- the algorithm guard or change a column's definition to force this migration.
-- Table/column comments are the storage documentation; tool contracts own the
-- model-facing input/output meanings. No extraction or generated file is needed.

ALTER TABLE database_meta
    COMMENT='Identifies the application MariaDB database and records its current schema version. The sole row describes the database itself rather than a user-domain entity. The table must contain exactly the singleton row whose key is 1. schema_version advances only after an approved migration succeeds. Sensitivity: Contains non-secret internal database metadata.',
    MODIFY COLUMN singleton       TINYINT UNSIGNED NOT NULL COMMENT 'Constant primary key fixed at 1 so the table can contain only one metadata row.',
    MODIFY COLUMN schema_version  INT UNSIGNED NOT NULL COMMENT 'Current integer schema generation expected by the application.',
    MODIFY COLUMN created_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                    DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this database metadata row was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN description     TEXT COMMENT 'Human-readable description of this database''s intended ownership and purpose.',
    ALGORITHM=INSTANT;

ALTER TABLE files
    COMMENT='Catalogs files held in agent media storage while keeping large binary bytes outside MariaDB. One row represents one externally stored file and records where it is stored plus known integrity and media metadata. storage_path identifies the external bytes; this table never contains the file bytes themselves. sha256 may be used to verify integrity or identify duplicate content. Sensitivity: Paths, filenames, hashes, and metadata may reveal private user content even though bytes are stored elsewhere.',
    MODIFY COLUMN file_id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this stored-file record.',
    MODIFY COLUMN storage_path       TEXT NOT NULL COMMENT 'Unique path locating the file bytes in agent media storage.',
    MODIFY COLUMN original_filename  TEXT COMMENT 'Filename supplied by the original source before storage renaming or organization.',
    MODIFY COLUMN media_kind         ENUM('audio', 'video', 'image', 'document', 'archive', 'other') NOT NULL DEFAULT 'other' COMMENT 'Broad media category used by agent workflows. audio: Audio recording or sound file. video: Video or animation file. image: Still image or graphic file. document: Textual or paginated document file. archive: Archive containing one or more files. other: File type not covered by the named media categories.',
    MODIFY COLUMN mime_type          VARCHAR(255) COMMENT 'Internet media type reported or detected for the file.',
    MODIFY COLUMN sha256             CHAR(64) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'SHA-256 digest of the file bytes for integrity verification and duplicate detection. Format: 64-character lowercase hexadecimal SHA-256 digest.',
    MODIFY COLUMN byte_size          BIGINT COMMENT 'Size of the stored file in bytes. Units: bytes. Format: non-negative integer.',
    MODIFY COLUMN duration_ms        BIGINT COMMENT 'Playback duration of audio or video in milliseconds when known. Units: milliseconds. Format: non-negative integer.',
    MODIFY COLUMN width              BIGINT COMMENT 'Pixel width of an image or video when known. Units: pixels. Format: positive integer.',
    MODIFY COLUMN height             BIGINT COMMENT 'Pixel height of an image or video when known. Units: pixels. Format: positive integer.',
    MODIFY COLUMN source_event_id    VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Stable event_id of the ledger event that introduced the file when known.',
    MODIFY COLUMN created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this file metadata record was inserted. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN title              VARCHAR(200) COMMENT 'Concise human-facing title for the stored file. Initially derived from the original filename and may later be suggested by AI or edited by the user.',
    MODIFY COLUMN description        TEXT COMMENT 'Plain-language searchable description of the file contents.',
    MODIFY COLUMN title_source       ENUM('original_filename', 'ai', 'user') NOT NULL DEFAULT 'original_filename' COMMENT 'Authority that supplied the current title, used to prevent AI from overwriting a user-edited title. original_filename: The title is the deterministic upload-time fallback. ai: The title was suggested by the model after inspecting the file. user: The title was confirmed or edited by the user and must not be overwritten by AI.',
    MODIFY COLUMN updated_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent title or description change.',
    ALGORITHM=INSTANT;

ALTER TABLE activity_events
    COMMENT='Preserves a chronological, searchable record of activity visible at the boundaries between users, agents, models, tools, services, and external systems. One row represents one observed event, such as a request arriving, a model call starting, a tool returning a result, a response being produced, or an error occurring. Treat rows as append-oriented historical evidence; corrections should normally be recorded as later events rather than rewriting prior observations. Use event_seq for exact local insertion order and occurred_at_ms for source-event chronology. Sensitivity: May contain private user content, tool arguments, model-visible data, errors, and operational identifiers.',
    MODIFY COLUMN event_seq        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Monotonically increasing local sequence used to order ledger insertions exactly.',
    MODIFY COLUMN event_id         VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (LOWER(REPLACE(UUID(), '-', ''))) COMMENT 'Stable public identifier used to refer to this event from other records and interfaces.',
    MODIFY COLUMN occurred_at_ms   BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000) COMMENT 'When the represented event occurred according to its source, expressed as Unix epoch milliseconds. Units: milliseconds. Format: Unix epoch milliseconds.',
    MODIFY COLUMN recorded_at_ms   BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000) COMMENT 'When this ledger received and stored the event, expressed as Unix epoch milliseconds. Units: milliseconds. Format: Unix epoch milliseconds.',
    MODIFY COLUMN occurred_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'Human-readable UTC timestamp corresponding to the event occurrence time recorded for this row. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN event_type       VARCHAR(255) NOT NULL COMMENT 'Extensible event name identifying what happened, such as a request, model call, tool call, response, lifecycle transition, or error.',
    MODIFY COLUMN event_phase      ENUM('point', 'start', 'end', 'error') NOT NULL DEFAULT 'point' COMMENT 'Whether this record is a standalone point event or the start, successful end, or error end of an operation. point: Standalone event rather than an operation boundary. start: Operation began. end: Operation completed without a recorded error. error: Operation terminated with an error.',
    MODIFY COLUMN status           VARCHAR(64) COMMENT 'Optional source-specific state or outcome associated with the event.',
    MODIFY COLUMN actor_type       ENUM('user', 'agent', 'model', 'tool', 'system', 'service', 'external') NOT NULL COMMENT 'Broad category of the participant or system component that performed the recorded action. user: Human user. agent: Agent orchestration layer. model: Language or other AI model. tool: Agent-callable tool or MCP operation. system: Runtime or operating-system component. service: Long-running application service. external: System outside the agent runtime.',
    MODIFY COLUMN actor_name       VARCHAR(255) COMMENT 'More specific human-readable or machine-readable identity of the actor when known.',
    MODIFY COLUMN source           VARCHAR(255) NOT NULL COMMENT 'System, plugin, service, or integration that supplied the event to the ledger.',
    MODIFY COLUMN channel          VARCHAR(255) COMMENT 'Communication channel through which the event entered or left the agent system, when applicable.',
    MODIFY COLUMN session_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier grouping events belonging to the same agent runtime session.',
    MODIFY COLUMN turn_id          VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier grouping all observable events belonging to one user-request and assistant-response turn.',
    MODIFY COLUMN trace_id         VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier grouping a distributed chain of related operations across components.',
    MODIFY COLUMN operation_id     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier pairing the start and terminal events for one measurable operation.',
    MODIFY COLUMN span_id          VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier of this event''s tracing span when span-level tracing is available.',
    MODIFY COLUMN parent_span_id   VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier of the tracing span that directly contains this span.',
    MODIFY COLUMN parent_event_id  VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Stable event_id of the earlier ledger event that directly caused or contains this event when known.',
    MODIFY COLUMN name             VARCHAR(255) COMMENT 'Short human-readable operation, event, model, tool, or component name.',
    MODIFY COLUMN content_text     LONGTEXT COMMENT 'Complete human-readable content visible at this event boundary, such as a user request, transcript, model output, or tool text.',
    MODIFY COLUMN payload_json     LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '{}' COMMENT 'Structured event-specific details, including observable arguments, results, identifiers, usage, or provider metadata not represented by dedicated columns. Format: JSON object encoded as text.',
    MODIFY COLUMN primary_file_id  BIGINT UNSIGNED COMMENT 'File record most directly associated with this event, such as its original recording or generated artifact.',
    MODIFY COLUMN subject_type     VARCHAR(255) COMMENT 'Type of domain record this event concerns, used together with subject_id.',
    MODIFY COLUMN subject_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier of the domain record named by subject_type.',
    MODIFY COLUMN external_ref     TEXT COMMENT 'Identifier or reference assigned by an external system when no dedicated column exists.',
    MODIFY COLUMN error_text       LONGTEXT COMMENT 'Complete observable error message or terminal failure text associated with this event.',
    ALGORITHM=INSTANT;

ALTER TABLE activity_event_files
    COMMENT='Associates any observable activity event with all files that were supplied to it or produced by it. One row links one stored file to one activity event in a specific ordered role. Use activity_events.primary_file_id only for the one primary file; this relationship preserves every associated file. Sensitivity: Links private files to private interactions and observable agent operations.',
    MODIFY COLUMN event_id   VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Observable activity event to which the file belongs.',
    MODIFY COLUMN file_id    BIGINT UNSIGNED NOT NULL COMMENT 'Stored-file record associated with the activity event.',
    MODIFY COLUMN file_role  ENUM('attachment', 'input', 'output', 'other') NOT NULL DEFAULT 'attachment' COMMENT 'How the file participates in the activity event. attachment: File attached to a user request or other event. input: File consumed as an explicit operation input. output: File produced by an operation. other: File relationship not covered by the named roles.',
    MODIFY COLUMN ordinal    BIGINT NOT NULL DEFAULT 0 COMMENT 'Zero-based display and processing order among files associated with the event. Units: position.',
    ALGORITHM=INSTANT;

ALTER TABLE agent_turn_attempts
    COMMENT='Retains attempt-correlation records created by the previous runtime; the standalone Agent Slayer runtime does not write this table. One legacy row associates a user-facing request with one attempt made by the previous runtime. Treat this table as retained historical compatibility data, not the current request execution path. Current model and tool boundaries are recorded directly in activity_events. Sensitivity: Contains request hashes and internal run, session, and operation identifiers.',
    MODIFY COLUMN attempt_id             VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Stable identifier for this processing attempt.',
    MODIFY COLUMN source_event_id        VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Ledger event containing the original user-facing request that this attempt processes.',
    MODIFY COLUMN subject_type           VARCHAR(255) NOT NULL COMMENT 'Type of user-facing request record being processed, such as a voice request.',
    MODIFY COLUMN subject_id             VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Identifier of the user-facing request record named by subject_type.',
    MODIFY COLUMN attempt_number         BIGINT NOT NULL COMMENT 'One-based retry number within the same subject_type and subject_id.',
    MODIFY COLUMN session_id             VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'the previous runtime session in which this attempt was submitted, when known.',
    MODIFY COLUMN agent_operation_id     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Unique voice-service operation identifier used to correlate this attempt with ledger events.',
    MODIFY COLUMN openclaw_run_id        VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'the previous runtime run identifier confirmed for this attempt after correlation.',
    MODIFY COLUMN request_content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'SHA-256 hash of the exact submitted request text used for deterministic prompt correlation. Format: 64-character lowercase hexadecimal SHA-256 digest.',
    MODIFY COLUMN correlation_method     ENUM('prompt_sha256', 'gateway_result') COMMENT 'Evidence used to associate the attempt with openclaw_run_id. prompt_sha256: Matched by the SHA-256 hash of the exact submitted prompt. gateway_result: Confirmed by the run identifier returned by the Gateway.',
    MODIFY COLUMN status                 ENUM('processing', 'complete', 'error', 'interrupted') NOT NULL DEFAULT 'processing' COMMENT 'Current processing outcome of this attempt. processing: Attempt is still active. complete: Attempt produced its terminal response successfully. error: Attempt terminated with an error. interrupted: Processing stopped before a normal terminal result.',
    MODIFY COLUMN started_at_ms          BIGINT NOT NULL COMMENT 'When processing began, in Unix epoch milliseconds. Units: milliseconds. Format: Unix epoch milliseconds.',
    MODIFY COLUMN correlated_at_ms       BIGINT COMMENT 'When the the previous runtime run was associated with this attempt, in Unix epoch milliseconds. Units: milliseconds. Format: Unix epoch milliseconds.',
    MODIFY COLUMN completed_at_ms        BIGINT COMMENT 'When processing reached a terminal state, in Unix epoch milliseconds. Units: milliseconds. Format: Unix epoch milliseconds.',
    MODIFY COLUMN created_at_utc         VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                           DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the attempt record was inserted. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc         VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the latest recorded change to the attempt. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE contacts
    COMMENT='Provides one address book for people, organizations, and services that other agent records need to identify or relate to. One row represents one person, organization, or service known to the user. At most one active contact may have is_self set to 1. Use contact_methods for reachable addresses rather than placing them in notes. birth_date is the authoritative birthday fact; calendar birthday entries are derived from it. Sensitivity: Contains personal identity, birth dates, relationship, status, and free-text notes.',
    MODIFY COLUMN contact_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this person, organization, or service.',
    MODIFY COLUMN contact_kind       ENUM('person', 'organization', 'service') NOT NULL DEFAULT 'person' COMMENT 'Whether this contact represents a person, organization, or service identity. person: Individual human. organization: Company, group, agency, or other organization. service: Service or system represented as a contactable identity.',
    MODIFY COLUMN display_name       VARCHAR(500) NOT NULL COMMENT 'Preferred human-readable name used to show and refer to the contact.',
    MODIFY COLUMN given_name         VARCHAR(255) COMMENT 'Person''s given or first name when the contact is a person.',
    MODIFY COLUMN family_name        VARCHAR(255) COMMENT 'Person''s family or last name when the contact is a person.',
    MODIFY COLUMN organization_name  VARCHAR(500) COMMENT 'Organization name associated with this contact when applicable.',
    MODIFY COLUMN is_self            TINYINT NOT NULL DEFAULT 0 COMMENT '1 only for the active contact record representing the user; otherwise 0. Format: MariaDB boolean: 0=false, 1=true.',
    MODIFY COLUMN status             ENUM('active', 'inactive', 'blocked', 'deceased') NOT NULL DEFAULT 'active' COMMENT 'Current address-book status of the contact. active: Current usable contact. inactive: Retained contact not currently active. blocked: Contact from whom interaction is blocked or should be avoided. deceased: Person is known to be deceased.',
    MODIFY COLUMN notes              TEXT COMMENT 'Private free-text context about the contact that does not belong in a structured relationship or method.',
    MODIFY COLUMN source             VARCHAR(255) COMMENT 'System or process from which this contact was imported or created.',
    MODIFY COLUMN external_id        VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier assigned to this contact by the source system.',
    MODIFY COLUMN created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the contact record was inserted. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the latest recorded change to the contact. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN birth_date         VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Contact''s birth date, with an explicitly optional year, used to derive birthday calendar entries and age when possible. Format: YYYY-MM-DD when the year is known; --MM-DD when it is unknown. Do not invent a birth year; use --MM-DD when only month and day are known. Age is derived only when the stored value includes a year. Generated birthday labels are projections and must not be written back as permanent age text. Sensitivity: A birth date tied to an identified person is sensitive personal information.',
    ALGORITHM=INSTANT;

ALTER TABLE contact_methods
    COMMENT='Stores the email addresses, phone numbers, postal addresses, handles, URLs, and other reachable identities belonging to contacts. One row represents one original contact value of one kind for one contact, plus matching and delivery metadata. value preserves the original representation; normalized_value exists for matching and lookup. Sensitivity: Contains personal contact information and delivery addresses.',
    MODIFY COLUMN contact_method_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this contact method.',
    MODIFY COLUMN contact_id         BIGINT UNSIGNED NOT NULL COMMENT 'Contact that owns this address or reachable identity.',
    MODIFY COLUMN method_kind        ENUM('email', 'phone', 'postal_address', 'handle', 'url', 'other') NOT NULL COMMENT 'Kind of address or identity stored in value. email: Email address. phone: Telephone number. postal_address: Physical mailing or street address. handle: Username or service-specific handle. url: Web address. other: Contact identity not covered by the named kinds.',
    MODIFY COLUMN label              VARCHAR(255) COMMENT 'Human-facing qualifier such as home, work, mobile, or billing.',
    MODIFY COLUMN value              TEXT NOT NULL COMMENT 'Original address, number, handle, URL, or other contact value as supplied.',
    MODIFY COLUMN normalized_value   VARCHAR(512) COMMENT 'Canonicalized representation used for reliable lookup and matching while value preserves the original.',
    MODIFY COLUMN is_primary         TINYINT NOT NULL DEFAULT 0 COMMENT '1 when this is the preferred contact method of its kind for the contact; otherwise 0. Format: MariaDB boolean: 0=false, 1=true.',
    MODIFY COLUMN can_receive        TINYINT NOT NULL DEFAULT 1 COMMENT '1 when the agent may use this method as a delivery destination; otherwise 0. Format: MariaDB boolean: 0=false, 1=true.',
    MODIFY COLUMN created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this contact method was inserted. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE tags
    COMMENT='Defines reusable human labels that can categorize many kinds of agent records. One row defines one tag with a stable machine slug and human-facing label. Use slug for stable matching and label for display. Inactive tags remain defined but should not normally be offered for new assignments. Sensitivity: Tag names may reveal private organizational categories.',
    MODIFY COLUMN tag_id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this tag.',
    MODIFY COLUMN slug            VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Unique stable machine identifier used for matching and references.',
    MODIFY COLUMN label           VARCHAR(255) NOT NULL COMMENT 'Human-readable text displayed for the tag.',
    MODIFY COLUMN is_active       TINYINT NOT NULL DEFAULT 1 COMMENT '1 when the tag is available for normal use; otherwise 0. Format: MariaDB boolean: 0=false, 1=true.',
    MODIFY COLUMN created_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                    DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the tag was defined. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE contacts_tags_join
    COMMENT='Stores the tag assignments used by Contacts, retaining the legacy record type and record ID columns. One row assigns one tag to one typed record; Contacts uses record_type contact. record_type and record_id form a polymorphic reference that MariaDB cannot validate with a foreign key. The table rename preserves existing assignments of every record type; contact operations select record_type contact. Sensitivity: Tag assignments may reveal private categorization of people, communications, work, or content.',
    MODIFY COLUMN tag_id          BIGINT UNSIGNED NOT NULL COMMENT 'Tag assigned to the record.',
    MODIFY COLUMN record_type     VARCHAR(128) NOT NULL COMMENT 'Type of record receiving the tag.',
    MODIFY COLUMN record_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Text representation of the identifier for the record named by record_type.',
    MODIFY COLUMN created_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                    DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the tag was assigned. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE content_groups
    COMMENT='Defines the named groups that organize the user''s content catalog. One row represents one content group. Every content item belongs to exactly one content group. sort_position controls group presentation order without changing stable group identifiers. Sensitivity: Group names may reveal private content plans and interests.',
    MODIFY COLUMN content_group_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this content group.',
    MODIFY COLUMN name              VARCHAR(200) NOT NULL COMMENT 'Complete human-facing name of the content group.',
    MODIFY COLUMN sort_position     BIGINT NOT NULL DEFAULT 0 COMMENT 'Mutable presentation order used to place the group and all of its content in the catalog.',
    MODIFY COLUMN archived_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time when this group was removed from active content organization, or null while active. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN created_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                      DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC time when this content group was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time of the most recent content-group change, when one has occurred. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE journal_groups
    COMMENT='Defines broad named groups that organize the user''s personal trackers. One row represents one organizational group such as Health, Home, or General. Groups organize trackers but do not identify individual observations. Group names are unique without regard to letter case. Sensitivity: Group names may reveal private areas of the user''s life and health.',
    MODIFY COLUMN journal_group_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for one personal-journal group.',
    MODIFY COLUMN name             VARCHAR(200) NOT NULL COMMENT 'Complete human-facing name of the group. Unique without regard to letter case. Sensitivity: May identify a private area of activity or health.',
    MODIFY COLUMN archived_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp when this group was archived, or null while it is active. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN created_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this group was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent change to this group, when changed. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE interaction_guides
    COMMENT='Stores named, versioned containers for durable user-owned structured interactions. One row represents one named interaction guide whose complete interaction content is defined by its numbered steps. Numbered steps are loaded only when the user explicitly asks to use, inspect, or change that exact guide. A guide describes an interaction but does not own a schedule or recurrence. A repeating to-do may reference a guide through todo_routines.interaction_guide_id. Sensitivity: Contains private preferences, questions, and instructions for the user''s personal interactions with the agent.',
    MODIFY COLUMN interaction_guide_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for one interaction guide.',
    MODIFY COLUMN name                  VARCHAR(200) NOT NULL COMMENT 'User-facing unique name used to select the guide without loading its text. Names are unique without regard to letter case.',
    MODIFY COLUMN status                ENUM('active', 'archived') NOT NULL DEFAULT 'active' COMMENT 'Lifecycle state controlling whether the guide is available for new guided interactions. active: The guide is available to inspect, edit, start, and link from a repeating to-do. archived: The guide is retained as history but unavailable for new links or starts.',
    MODIFY COLUMN version               BIGINT NOT NULL DEFAULT 1 COMMENT 'Monotonically increasing optimistic-concurrency version for agent and UI edits. Units: revision number. An update or archive must match the current version and increments it on success.',
    MODIFY COLUMN created_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                          DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the interaction guide was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent successful guide update or archival, when one has occurred. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE todo_groups
    COMMENT='Defines the named groups that organize the user''s one authoritative personal To-Do List. One row represents one named task group, such as Inbox or Watches. Groups are named containers, not tasks and not a second hierarchy. Group names are unique without regard to letter case. When uses_sequence is 1, a newly inserted task with no sequence receives max(sequence) + 1 within this group; when it is 0, sequence remains optional. Sensitivity: Group names may reveal the user''s private projects and areas of responsibility.',
    MODIFY COLUMN todo_group_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable internal identifier for one personal to-do group.',
    MODIFY COLUMN name              VARCHAR(255) NOT NULL COMMENT 'Complete human-facing name of the group; the schema intentionally has no separate description. Unique without regard to letter case. Sensitivity: May identify a private project or area of responsibility.',
    MODIFY COLUMN archived_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when the group was archived; null while the group is active. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN created_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                      DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC instant when the group record was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant of the group record’s most recent material update; null until first updated. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN sort_position     BIGINT NOT NULL DEFAULT 0 COMMENT 'Mutable presentation order used to place this group and all of its tasks in the to-do list. Lower values appear first; moving a group does not change task membership or task order within the group.',
    MODIFY COLUMN uses_sequence     TINYINT NOT NULL DEFAULT 0 COMMENT 'Whether this group automatically assigns the next unique positive sequence number to tasks added without one. 0: Sequence numbers are optional and are not assigned automatically. 1: Unnumbered tasks receive the next number after the group''s current maximum. Disabling automatic sequencing preserves numbers already assigned.',
    ALGORITHM=INSTANT;

ALTER TABLE trackers
    COMMENT='Defines the reusable subjects under which the user records personal observations over time. One row represents one globally named tracked subject, such as Weight, Bowel movement, Mood, or Medication. Tracker names are globally unique without regard to letter case so a natural-language journal request has one unambiguous target. Every tracker has one canonical unit shared by its complete numeric series. The migration marker set me must be replaced before another entry is recorded. A canonical unit cannot be changed after numeric entries exist, except when replacing the set me migration marker. Sensitivity: Tracker names may reveal private health conditions, habits, medications, or other personal interests.',
    MODIFY COLUMN tracker_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for one personal tracker.',
    MODIFY COLUMN journal_group_id     BIGINT UNSIGNED NOT NULL COMMENT 'Organizational group containing this tracker.',
    MODIFY COLUMN name             VARCHAR(200) NOT NULL COMMENT 'Complete human-facing name of the tracked subject. Unique globally without regard to letter case. Sensitivity: May name a private health condition, habit, medication, or activity.',
    MODIFY COLUMN unit             VARCHAR(100) NOT NULL COMMENT 'Canonical unit shared by every numeric entry in this tracker''s trend series. Required for every tracker; event-style trackers use an explicit count such as occurrence or dose. The set me value is a migration review marker, not a real measurement unit. After numeric entries exist, changing this unit would reinterpret history and is rejected unless the old value is set me.',
    MODIFY COLUMN archived_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp when tracking was archived, or null while the tracker is active. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN created_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this tracker was first defined. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent change to this tracker, when changed. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE calendar_events
    COMMENT='Stores every commitment and scheduled event in the user''s one authoritative agent calendar. One row represents one scheduled event or one materialized occurrence of a repeating event. starts_at_utc and ends_at_utc are UTC instants; time_zone preserves the intended display zone. There is exactly one logical calendar; imported identifiers prevent duplicate events but never partition events into separate calendars. Materialized repeating occurrences are ordinary event rows and may be edited independently. planning_prompt_text is optional and records the exact proactive planning question associated with the scheduled time. Sensitivity: Contains the user''s private schedule, locations, participants, and imported calendar identifiers.',
    MODIFY COLUMN calendar_event_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this calendar event.',
    MODIFY COLUMN ical_uid            VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Persistent iCalendar UID used to identify an imported event or recurrence family and prevent duplicate imports. Format: RFC 5545 UID text. This identifies imported calendar data; it does not identify a separate calendar.',
    MODIFY COLUMN ical_recurrence_id  VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Original iCalendar recurrence-instance identifier distinguishing this materialized occurrence within the shared UID. Format: RFC 5545 RECURRENCE-ID text. Together with ical_uid, this value prevents duplicate imports of the same recurring occurrence.',
    MODIFY COLUMN title               TEXT NOT NULL COMMENT 'Human-readable event name shown on the calendar.',
    MODIFY COLUMN description         LONGTEXT COMMENT 'Complete available description or notes for the event.',
    MODIFY COLUMN location_text       TEXT COMMENT 'Human-readable physical, virtual, or meeting location.',
    MODIFY COLUMN starts_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'UTC instant when the event starts. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN ends_at_utc         VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when the event ends, when an end is known. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN time_zone           VARCHAR(255) COMMENT 'IANA or provider time-zone name used to display the event in its intended local time.',
    MODIFY COLUMN is_all_day          TINYINT NOT NULL DEFAULT 0 COMMENT '1 when the event represents a calendar day rather than a precise time; otherwise 0. Format: MariaDB boolean: 0=false, 1=true.',
    MODIFY COLUMN status              ENUM('tentative', 'confirmed', 'cancelled') NOT NULL DEFAULT 'confirmed' COMMENT 'Current scheduling state of the event. Format: RFC 5545 VEVENT status. tentative: Event is proposed but not firmly confirmed. confirmed: Event is scheduled to occur. cancelled: Event will not occur. Calendar events happen; completion is represented only by the passage of time, not a stored event status.',
    MODIFY COLUMN recurrence_rule     TEXT COMMENT 'iCalendar RRULE describing how the event repeats.',
    MODIFY COLUMN source_event_id     VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Ledger event that caused this calendar record to be created when known.',
    MODIFY COLUMN created_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                        DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this local calendar record was inserted. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the latest recorded change to this local calendar record. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN planning_prompt_text TEXT COMMENT 'Optional question the agent should proactively ask to help the user decide how this scheduled time will be used. Format: Plain text question. Null means no proactive planning question is attached to this event.',
    ALGORITHM=INSTANT;

ALTER TABLE calendar_event_exclusions
    COMMENT='Records individual recurrence instances omitted from a repeating calendar event. One row excludes one generated occurrence from one recurring calendar event. A recurring event may have any number of excluded occurrences; never collapse them into one delimited or JSON field. Values are normalized UTC instants used when expanding the parent event''s recurrence rule. Sensitivity: Reveals changes and omissions in the user''s private schedule.',
    MODIFY COLUMN calendar_event_id       BIGINT UNSIGNED NOT NULL COMMENT 'Recurring calendar event whose generated occurrence is omitted. The referenced event supplies the recurrence rule.',
    MODIFY COLUMN excluded_starts_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'UTC start instant of the recurrence instance that must not be generated or displayed. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE calendar_event_contacts
    COMMENT='Associates contacts with calendar events while preserving each contact''s participant role and response. One row states that one contact participates in one calendar event in one specific role. The same contact may appear more than once on an event only when the participant role differs. Sensitivity: May reveal a person''s schedule, attendance, and relationship to an event.',
    MODIFY COLUMN calendar_event_id  BIGINT UNSIGNED NOT NULL COMMENT 'Calendar event in which the contact participates.',
    MODIFY COLUMN contact_id         BIGINT UNSIGNED NOT NULL COMMENT 'Contact participating in the calendar event.',
    MODIFY COLUMN participant_role   ENUM('organizer', 'attendee', 'customer', 'other') NOT NULL DEFAULT 'attendee' COMMENT 'Role the contact has in the event. organizer: Contact organizes or owns the event. attendee: Contact is invited or attending. customer: Contact participates as the customer associated with the event. other: A meaningful participant role not covered by the named values.',
    MODIFY COLUMN response_status    VARCHAR(64) COMMENT 'Provider or user response such as accepted, declined, tentative, or needs action when known.',
    ALGORITHM=INSTANT;

ALTER TABLE interaction_guide_steps
    COMMENT='Stores each reusable exchange''s literal opening, authoritative structured contract, current answers, and resumable progress. One row is one complete numbered interaction step and its mutable current-run state. The parent interaction_guides.version is the only definition concurrency version and increments when any exchange definition changes. The contract''s structured inputs, operations, recovery reads, and completion rule are authoritative; explanatory instructions cannot introduce undeclared behavior. A run remains on its current exchange until the contract completion rule is satisfied, then advances to the next higher enabled number. Completing a run preserves its progress in activity_events, then immediately resets answers_json and progress_state for the next run. Generic database reads and writes must not expose or mutate these private rows; use the owning interaction-guide tools. Sensitivity: Contains private scripted openings, reusable execution contracts, and the user''s current answers.',
    MODIFY COLUMN interaction_guide_step_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for one numbered interaction-guide step.',
    MODIFY COLUMN interaction_guide_id       BIGINT UNSIGNED NOT NULL COMMENT 'Identifier of the parent interaction guide that owns this step and its definition version.',
    MODIFY COLUMN step_number                BIGINT NOT NULL COMMENT 'Positive user-facing number ordering this step within its guide. Units: ordinal number. Format: positive integer. Numbers may contain gaps; completion advances to the next higher enabled number rather than assuming current plus one.',
    MODIFY COLUMN opening_text               TEXT NOT NULL COMMENT 'Fixed opening text that begins this step every time it becomes current. Present this text literally rather than asking the model to paraphrase it.',
    MODIFY COLUMN contract_json              LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
                               DEFAULT '{"version":1,"instructions":null,"inputs":[],"operations":[],"recoveryReads":[],"completion":{"mode":"response_valid"}}' COMMENT 'Versioned JSON contract containing optional explanatory instructions plus authoritative typed inputs, exact destination operations and argument bindings, bounded recovery reads, and the completion rule. Format: JSON object, contract version 1, at most 200000 characters. Free-text instructions may explain structured fields but cannot introduce undeclared inputs, tools, destinations, recovery actions, or completion requirements. Every destination mutation names its exact application tool and argument template in operations. The completion mode is contract data, not a separate exchange column. Sensitivity: May contain private workflow instructions and destination identifiers.',
    MODIFY COLUMN answers_json               LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '{}' COMMENT 'JSON object containing answers the user has actually supplied for this step in the current run, keyed by concise stable answer names. Format: JSON object, at most 100000 characters. Merge partial answers without discarding answers already collected in the active run. A completed run clears this object only after that run''s progress has been retained in activity_events. Answers do not replace business validation or successful receipts from the tools that own destination data. Sensitivity: Contains private user answers that may span any domain covered by the structured interaction.',
    MODIFY COLUMN enabled                    TINYINT NOT NULL DEFAULT 1 COMMENT 'Whether new and active runs include this step when selecting the current and next higher numbered step. 0: The definition is retained but skipped by runs. 1: The step participates in runs.',
    MODIFY COLUMN created_at_utc             VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                               DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this numbered interaction-guide step was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc             VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent definition or current-answer update to this step, when one has occurred. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN progress_state             ENUM('pending', 'active', 'completed') NOT NULL DEFAULT 'pending' COMMENT 'Current-run progress for this step, used to resume an interrupted structured interaction at exactly one active step. pending: The current run has not yet completed this step. active: This is the current step to present or continue. completed: The current run completed this step and advanced beyond it. The interaction-guide service owns transitions; definition tools do not write this field directly. Run completion or explicit cancellation resets current progress only after immutable history is retained in activity_events.',
    ALGORITHM=INSTANT;

ALTER TABLE todo_routines
    COMMENT='Stores authoritative reusable definitions for standing calendar routines and completion-driven recurring personal tasks. One row represents one reusable routine definition, including its publication behavior, destination group, default occurrence content, schedule anchor, and recurrence rule. A calendar routine is a definition, not a hidden personal task; publishing creates dated tasks linked by todo_routine_id. An on_completion routine generates its next actual task when the current linked occurrence is completed or ignored. Editing a linked task occurrence does not rewrite the parent routine definition. RRULE determines recurrence from first_scheduled_at_utc in time_zone. Default status, contact, duration, guide, and planning prompt are copied into newly generated occurrences. Sensitivity: Contains the user''s private recurring responsibilities and schedules.',
    MODIFY COLUMN todo_routine_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable internal identifier for one reusable to-do routine definition.',
    MODIFY COLUMN todo_group_id           BIGINT UNSIGNED NOT NULL COMMENT 'Required destination group for task occurrences generated from this routine.',
    MODIFY COLUMN publication_mode        ENUM('on_completion', 'calendar') NOT NULL DEFAULT 'on_completion' COMMENT 'Controls whether dated occurrences are published into calendar ranges or generated after completion of the prior occurrence.',
    MODIFY COLUMN text                    TEXT NOT NULL COMMENT 'Complete wording copied into every generated task occurrence; there is no title-description split. Sensitivity: May contain private recurring plans and instructions.',
    MODIFY COLUMN default_status          ENUM('unplanned', 'todo', 'ai_suggested') NOT NULL DEFAULT 'todo' COMMENT 'Initial lifecycle status assigned to each new task occurrence.',
    MODIFY COLUMN first_scheduled_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'UTC instant anchoring the RRULE and the first scheduled task occurrence. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN first_due_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Optional first deadline; its offset from first_scheduled_at_utc is preserved for generated occurrences. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN time_zone               VARCHAR(255) NOT NULL COMMENT 'IANA time-zone name used to preserve local wall-clock recurrence across daylight-saving changes. Format: IANA time-zone name.',
    MODIFY COLUMN recurrence_rule         TEXT NOT NULL COMMENT 'RFC 5545 RRULE that defines daily, day-of-week, monthly, quarterly, or other recurrence. Format: RFC 5545 RRULE without a required RRULE: prefix.',
    MODIFY COLUMN related_contact_id      BIGINT UNSIGNED COMMENT 'Optional contact copied to each newly generated task occurrence.',
    MODIFY COLUMN duration_minutes        BIGINT COMMENT 'Positive planned duration copied to each task occurrence. Format: Positive whole minutes.',
    MODIFY COLUMN disabled_at_utc         VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when this routine stopped generating new occurrences; null while enabled. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN source_event_id         VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Activity event that created this routine definition.',
    MODIFY COLUMN created_at_utc          VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                            DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC instant when this routine definition was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc          VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant of this routine definition’s most recent material update; null until first updated. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN interaction_guide_id   BIGINT UNSIGNED COMMENT 'Optional interaction guide offered when the user starts an occurrence of this recurring to-do. This reference does not schedule or repeat the guide; the containing to-do routine owns recurrence.',
    MODIFY COLUMN planning_prompt_text   TEXT COMMENT 'Optional proactive planning question copied into each task occurrence generated from this routine. Format: Plain text question. Null means generated occurrences have no routine-supplied planning question.',
    ALGORITHM=INSTANT;

ALTER TABLE todo_personal
    COMMENT='Stores actual actionable and historical occurrences in the user’s authoritative personal To-Do List. One row represents one actual personal task occurrence; todo_routine_id optionally links it to the reusable definition that produced it. Every task belongs to exactly one todo group. sequence is an optional stable identifier unique within a group; sort_position is mutable presentation order. scheduled_at_utc places work on the calendar, due_at_utc is its deadline, and completed_at_utc records actual completion. The single text field contains the concrete plan for this occurrence and may differ from its parent routine text. Editing an occurrence does not rewrite its linked routine definition. unplanned is an active status for an item that still needs a concrete plan. planning_prompt_text is nullable and independent of status. Sensitivity: Contains the user''s private tasks, plans, relationships, schedules, and source references.',
    MODIFY COLUMN personal_task_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable internal identifier for one personal task.',
    MODIFY COLUMN todo_group_id        BIGINT UNSIGNED NOT NULL COMMENT 'Required group that contains and orders this personal task.',
    MODIFY COLUMN todo_routine_id      BIGINT UNSIGNED COMMENT 'Optional parent routine definition that generated this actual task occurrence.',
    MODIFY COLUMN sequence             BIGINT COMMENT 'Stable positive number that identifies this task within its group when that group uses numbered work. Units: sequence number. Unique within todo_group_id when present; unlike sort_position, it does not change when the list is reordered.',
    MODIFY COLUMN related_contact_id   BIGINT UNSIGNED COMMENT 'Optional contact that this task concerns; it does not assign ownership of the task.',
    MODIFY COLUMN text                 TEXT NOT NULL COMMENT 'Complete wording of the task, serving as both its short label and any longer explanation. Sensitivity: May contain private plans, names, and instructions.',
    MODIFY COLUMN status               ENUM('unplanned', 'todo', 'complete', 'ignore', 'archive', 'ai_suggested') NOT NULL DEFAULT 'todo' COMMENT 'Compact lifecycle state controlling whether and how the task appears in the user''s list. unplanned: The item is active but still needs a concrete plan. todo: the user intends to do this task. complete: The task was finished. ignore: The task was intentionally skipped without completion. archive: The task is retained as history but removed from ordinary views. ai_suggested: The agent proposed the task and the user has not yet accepted or dismissed it.',
    MODIFY COLUMN sort_position        BIGINT NOT NULL DEFAULT 0 COMMENT 'Mutable ordering value used to place tasks directly within a group; it conveys no importance or priority. Lower values appear first within the same group.',
    MODIFY COLUMN scheduled_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when the user intends to work on the task; this projects the task onto the calendar. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN due_at_utc           VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC deadline by which the task should be complete, distinct from its scheduled work time. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN completed_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when the task entered complete status; null for tasks not currently complete. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN source               VARCHAR(255) COMMENT 'Optional stable name of the system or workflow that supplied this task.',
    MODIFY COLUMN external_id          VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Optional identifier assigned by source; together with source it prevents duplicate imports or publications. Unique with source when both values are present.',
    MODIFY COLUMN source_event_id      VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Optional observable activity event that created or imported this task.',
    MODIFY COLUMN created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC instant when this task occurrence was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant of this task occurrence’s most recent material update; null until first updated. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN is_all_day           TINYINT NOT NULL DEFAULT 0 COMMENT '1 when the task is assigned to its scheduled calendar date without an exact clock time; otherwise 0. Format: MariaDB boolean: 0=false, 1=true.',
    MODIFY COLUMN duration_minutes     BIGINT COMMENT 'Optional positive planned duration for this task occurrence. Units: minutes. Format: Positive whole minutes.',
    MODIFY COLUMN planning_prompt_text TEXT COMMENT 'Optional question the agent should proactively ask to help turn this task into a concrete plan. Format: Plain text question. Null means the task has no stored planning question. The field may be present on any task status and does not itself change the status.',
    ALGORITHM=INSTANT;

ALTER TABLE reminders
    COMMENT='Stores when and how an alarm should be delivered and preserves observable delivery, retry, and error state. One row represents one standalone, calendar-linked, or personal-task-linked reminder and its delivery lifecycle. A reminder may link to a calendar event, a personal task, or neither. Delivery attempts must update attempt_count and the corresponding timing or error fields. Sensitivity: Contains private reminder text, linked commitments, delivery targets, payloads, and errors.',
    MODIFY COLUMN reminder_id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this reminder.',
    MODIFY COLUMN calendar_event_id    BIGINT UNSIGNED COMMENT 'Calendar event whose timing or commitment this reminder supports, when applicable.',
    MODIFY COLUMN personal_task_id     BIGINT UNSIGNED COMMENT 'Optional personal task whose reminder lifecycle this row serves. Deleting the task also deletes its subordinate reminder.',
    MODIFY COLUMN title                TEXT COMMENT 'Human-readable notification text or reminder name.',
    MODIFY COLUMN remind_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'UTC instant at or after which the reminder becomes due for delivery. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN delivery_method      ENUM('agent', 'webhook', 'notification', 'email', 'sms', 'other') NOT NULL DEFAULT 'agent' COMMENT 'Mechanism through which the reminder should be delivered. agent: Agent surfaces the reminder through its normal interaction channel. webhook: HTTP webhook receives the reminder. notification: Device or browser notification. email: Email delivery. sms: SMS delivery. other: Delivery mechanism not covered by the named values.',
    MODIFY COLUMN delivery_target      TEXT COMMENT 'Method-specific destination such as an address, number, endpoint, or device when needed.',
    MODIFY COLUMN status               ENUM('pending', 'processing', 'delivered', 'snoozed', 'cancelled', 'error') NOT NULL DEFAULT 'pending' COMMENT 'Current delivery lifecycle state of the reminder. pending: Waiting for remind_at_utc or delivery processing. processing: A delivery attempt is active. delivered: Delivery succeeded. snoozed: Delivery was postponed to a later time. cancelled: Reminder should not be delivered. error: Most recent delivery attempt failed and may need retry or correction.',
    MODIFY COLUMN attempt_count        BIGINT NOT NULL DEFAULT 0 COMMENT 'Number of delivery attempts already made.',
    MODIFY COLUMN last_attempt_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time of the most recent delivery attempt. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN delivered_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time successful delivery was recorded. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN error_text           LONGTEXT COMMENT 'Most recent observable delivery error when status is error.',
    MODIFY COLUMN created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the reminder was inserted. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the latest recorded change to the reminder. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE journal_entries
    COMMENT='Stores the user''s authoritative time-stamped personal observations under reusable trackers. One row represents one complete personal observation with an optional numeric projection in its tracker''s canonical unit. content_text is the complete human-readable observation; number_value is an optional trend projection rather than a replacement for it. occurred_at_utc records when the observed event happened, while created_at_utc records when the row was saved. The parent tracker owns the single canonical unit for every number_value in its series; entries never duplicate a unit. For imported rows, the source and non-null external_id pair is a stable idempotency key and must never identify two different observations. Sensitivity: Contains private personal observations that may include health, nutrition, habits, symptoms, and daily activities.',
    MODIFY COLUMN journal_entry_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for one personal journal entry.',
    MODIFY COLUMN tracker_id       BIGINT UNSIGNED NOT NULL COMMENT 'Tracker under which this observation is recorded.',
    MODIFY COLUMN occurred_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC instant when the recorded observation or event occurred. Format: ISO 8601 UTC timestamp. This may differ from created_at_utc when the user records something retrospectively.',
    MODIFY COLUMN content_text     TEXT NOT NULL COMMENT 'Complete self-contained natural-language content of the observation. Preserve supporting context here instead of fragmenting it into a separate note field. When a numeric projection exists, this text still remains the complete readable entry. Sensitivity: May contain private health, nutrition, behavioral, or situational context.',
    MODIFY COLUMN number_value     DOUBLE COMMENT 'Optional numeric projection extracted from the complete journal content for calculation, comparison, and trends. Null is valid for observations without a useful numeric component. Interpret this value using the parent tracker''s canonical unit.',
    MODIFY COLUMN source_event_id  VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Optional activity event for the user request that caused this journal entry to be recorded.',
    MODIFY COLUMN created_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this journal row was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent modification to this journal row, when modified. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN source           VARCHAR(200) NOT NULL DEFAULT 'agent-slayer' COMMENT 'Stable generic name of the application, export, or local path from which this journal entry originated. Use agent-slayer for ordinary native journal writes and a consistent source name for every page of one external import. Sensitivity: May identify a private external application or data export.',
    MODIFY COLUMN external_id      VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Optional stable record identifier assigned by source and used with source to make imports idempotent. Required by the generic import tool and null for ordinary native journal entries without an upstream identity. The pair of source and external_id is unique whenever external_id is present. Sensitivity: May expose an identifier from a private external data source.',
    ALGORITHM=INSTANT;

ALTER TABLE content_items
    COMMENT='Catalogs the user''s own content and reference material from other creators in one searchable structure. One row represents one work or source item, such as a video, book, article, podcast, image, document, course, or website. Every content item belongs to exactly one content group. sequence is an optional stable positive number unique within a content group. relationship_to_user distinguishes the user''s authored or planned work from reference material. transcript preserves source speech or text; personal_notes preserves the user''s reaction or intended use. Sensitivity: May contain private drafts, transcripts, reading history, personal notes, and source metadata.',
    MODIFY COLUMN content_id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this content item.',
    MODIFY COLUMN content_group_id      BIGINT UNSIGNED NOT NULL COMMENT 'Content group that owns and organizes this item.',
    MODIFY COLUMN sequence              BIGINT COMMENT 'Stable positive number identifying this content item within its group when numbered organization is used. Units: sequence number. Unique within content_group_id when present; unlike content_group.sort_position, it identifies an item rather than presentation placement.',
    MODIFY COLUMN content_type          ENUM('mobileUGC_tutorial', 'mobileUGC_ad', 'webUGC_tutorial', 'webUGC_ad', 'video_ad', 'podcast', 'image', 'unknown') NOT NULL DEFAULT 'mobileUGC_tutorial' COMMENT 'Action-content format and production surface for this item. mobileUGC_tutorial: Mobile-app user-generated-style tutorial. mobileUGC_ad: Mobile-app user-generated-style advertisement. webUGC_tutorial: Web-app user-generated-style tutorial. webUGC_ad: Web-app user-generated-style advertisement. video_ad: Video advertisement outside the mobile or web UGC-specific formats. podcast: Podcast or spoken-audio content. image: Still image or graphic content. unknown: Content whose production format has not been identified.',
    MODIFY COLUMN title                 TEXT NOT NULL COMMENT 'Human-readable title of the work or source item.',
    MODIFY COLUMN transcript            LONGTEXT COMMENT 'Source speech or text transcribed or extracted from the content itself.',
    MODIFY COLUMN description           LONGTEXT COMMENT 'Summary or description of what the content is about.',
    MODIFY COLUMN published_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                          DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC publication time reported for the content when known. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN content_host          ENUM('youtube', 'vimeo', 'spotify', 'mytlomdotcom', 'none') NOT NULL DEFAULT 'youtube' COMMENT 'Platform or service that hosts the published content. youtube: Hosted on YouTube. vimeo: Hosted on Vimeo. spotify: Hosted on Spotify. mytlomdotcom: Hosted on mytlom.com. none: The content has no external host.',
    MODIFY COLUMN content_status        ENUM('active', 'obsolete', 'unused', 'queued') NOT NULL DEFAULT 'active' COMMENT 'Current action-content lifecycle state. active: Content is current and available for use. obsolete: Content has been superseded and should not guide current work. unused: Content is retained but not currently used. queued: Content is awaiting production or publication.',
    MODIFY COLUMN content_url           TEXT COMMENT 'Canonical public or hosted URL for the content when one exists. Format: URL.',
    MODIFY COLUMN relationship_to_user  ENUM('mine', 'reference') NOT NULL DEFAULT 'mine' COMMENT 'Whether the item is the user''s authored or planned work or reference material from elsewhere. mine: the user''s authored, owned, planned, or produced content. reference: Material from another creator kept as a source or reference.',
    MODIFY COLUMN creator_contact_id    BIGINT UNSIGNED COMMENT 'Known person, organization, or service that created the content.',
    MODIFY COLUMN personal_notes        LONGTEXT COMMENT 'the user''s own reaction, interpretation, plan, or intended use for the content.',
    MODIFY COLUMN external_id           VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier assigned to the item by its host or source system.',
    MODIFY COLUMN primary_file_id       BIGINT UNSIGNED COMMENT 'Main locally stored file representing this content item when one exists.',
    MODIFY COLUMN consumed_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time when the user finished or recorded consuming the reference material. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN source_event_id       VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Ledger event that caused this content item to be created when known.',
    MODIFY COLUMN created_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                          DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this catalog record was inserted. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the latest recorded change to this catalog record. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE video_scripts
    COMMENT='Stores reusable, copy-ready production scripts grounded in explicitly selected Agent interactions for external generators and the built-in Agent-interface renderer. One row is one versioned portable video-script draft with a structured production plan and deterministic human-readable export. A script is the authoritative content-production plan; MP4 execution state belongs to linked video_jobs rows. Creation is idempotent for the exact Agent Slayer request event recorded in created_by_event_id. Source interactions are authoritative and are preserved separately in video_script_sources. Sensitivity: May contain private details selected from user interactions; secrets and unrelated private details must be excluded before persistence.',
    MODIFY COLUMN video_script_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for the portable AI-video script.',
    MODIFY COLUMN title                VARCHAR(200) NOT NULL COMMENT 'Concise human-facing title for finding and copying the production script.',
    MODIFY COLUMN status               ENUM('draft', 'archived') NOT NULL DEFAULT 'draft' COMMENT 'Current user-facing lifecycle state of the script. draft: Active script available for review and use with an external generator. archived: Retained script hidden from the default active view.',
    MODIFY COLUMN schema_version       BIGINT NOT NULL DEFAULT 1 COMMENT 'Version of the structured script_json production-plan contract.',
    MODIFY COLUMN script_json          LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Complete structured production plan, including generator prompt, scenes, grounding references, continuity notes, and negative constraints. Format: JSON object encoded as text.',
    MODIFY COLUMN script_text          LONGTEXT NOT NULL COMMENT 'Complete copy-ready Markdown production script deterministically compiled from script_json at creation time. Format: Markdown.',
    MODIFY COLUMN created_by_event_id  VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Exact request-received ledger event whose authorized tool execution created this script.',
    MODIFY COLUMN created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC time when the script record was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time of the latest script lifecycle or content update. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN archived_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time when the script was archived; null while it remains a draft. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN version              BIGINT NOT NULL DEFAULT 1 COMMENT 'Monotonic optimistic-concurrency version for user-visible script changes. Units: revision.',
    ALGORITHM=INSTANT;

ALTER TABLE video_script_sources
    COMMENT='Preserves the ordered many-to-many grounding between a portable AI-video script and the completed Agent Slayer interactions explicitly selected for it. One row links one video script to one selected request event at one stable chronological source position. Every source must be an exact completed request event selected by the user. source_order is chronological within one script and must not be inferred from display order. Sensitivity: Links portable content drafts to private user requests and responses.',
    MODIFY COLUMN video_script_id  BIGINT UNSIGNED NOT NULL COMMENT 'Portable AI-video script grounded by this source association.',
    MODIFY COLUMN request_event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Exact immutable request-received ledger event selected as source evidence.',
    MODIFY COLUMN source_order     BIGINT NOT NULL COMMENT 'One-based chronological position of this interaction among the script''s selected sources. Units: position.',
    ALGORITHM=INSTANT;

ALTER TABLE video_jobs
    COMMENT='Tracks background execution attempts for script-driven video productions and any retained legacy render jobs. One row represents one attempt to render one video using one renderer, template, input package, and eventual output or error. A script-driven video job is subordinate execution state and never replaces its authoritative video_scripts record. At most one queued, preparing, or rendering job may exist for one linked script. Every meaningful state transition should also be observable in activity_events. Sensitivity: May contain private source interactions, render inputs, output paths, and errors.',
    MODIFY COLUMN video_job_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this rendering job.',
    MODIFY COLUMN request_event_id   VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Ledger request event whose accepted tool call initiated this render job, when known.',
    MODIFY COLUMN source_turn_id     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Agent turn identifier for the complete source interaction when known.',
    MODIFY COLUMN content_id         BIGINT UNSIGNED COMMENT 'Content catalog item that this rendering job produces or updates when one exists.',
    MODIFY COLUMN renderer           ENUM('remotion', 'adobe_premiere', 'other') NOT NULL DEFAULT 'remotion' COMMENT 'Rendering implementation selected to execute the job. remotion: Render with the Remotion code-based video pipeline. adobe_premiere: Render through Adobe Premiere automation. other: Another explicitly identified renderer.',
    MODIFY COLUMN template           VARCHAR(255) NOT NULL COMMENT 'Stable template name or identifier defining the video''s composition.',
    MODIFY COLUMN status             ENUM('queued', 'preparing', 'rendering', 'complete', 'error', 'cancelled') NOT NULL DEFAULT 'queued' COMMENT 'Current execution state of the rendering job. queued: Waiting for execution. preparing: Inputs and environment are being prepared. rendering: Renderer is actively producing output. complete: Rendered output was produced successfully. error: Execution terminated with an error. cancelled: Execution was deliberately stopped.',
    MODIFY COLUMN input_json         LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '{}' COMMENT 'Bounded job contract and identifiers needed to resolve the authoritative script and ordered sources for this render attempt. Format: JSON object encoded as text.',
    MODIFY COLUMN output_file_id     BIGINT UNSIGNED COMMENT 'File metadata record for the completed rendered video when successful.',
    MODIFY COLUMN error_text         LONGTEXT COMMENT 'Complete observable rendering error when the job fails.',
    MODIFY COLUMN created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the rendering job was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN started_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp when rendering preparation or execution began. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN completed_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp when the job reached a terminal state. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the latest recorded state change. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN personal_task_id   BIGINT UNSIGNED COMMENT 'Optional durable personal task that requested and owns this subordinate render execution. Deleting the task preserves the render job and clears this reference.',
    MODIFY COLUMN video_script_id    BIGINT UNSIGNED COMMENT 'Durable production script whose scene plan this background render job executes, when this is a script-driven job.',
    ALGORITHM=INSTANT;

ALTER TABLE profile_facts
    COMMENT='Stores the current and archived durable facts and preferences that describe the user to the secretary. One row represents one version of one self-contained typed profile fact; multiple active rows may share a fact type. Only active rows of repository-selected relevant fact types are included automatically in first-call model context. A type is a broad repeatable category; the text identifies the person or item to which each row applies. Replacing a fact targets its exact profile_fact_id, archives that row, and inserts a new active version. Deleting a fact targets its exact profile_fact_id and archives it rather than erasing historical data. Sensitivity: Contains private user identity, location, address, preferences, and other durable personal information.',
    MODIFY COLUMN profile_fact_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable row identifier used by profile tools to replace or archive this exact fact.',
    MODIFY COLUMN fact_type            VARCHAR(200) NOT NULL COMMENT 'Broad repeatable category for this fact, shared by related rows when appropriate. Format: lowercase snake_case. Multiple active rows may have the same fact_type.',
    MODIFY COLUMN fact_text            TEXT NOT NULL COMMENT 'Self-contained natural-language statement identifying the fact''s person or item. The text must remain understandable without deriving a subject from fact_type. Sensitivity: May contain private personal information.',
    MODIFY COLUMN fact_status          ENUM('active', 'archived') NOT NULL DEFAULT 'active' COMMENT 'Whether the fact is current or retained only as archived history. active: Current fact eligible for first-call context when its type is relevant. archived: Historical fact omitted from ordinary model context.',
    MODIFY COLUMN source_event_id      VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'User request event that created this version of the fact.',
    MODIFY COLUMN archived_by_event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'User request event that archived this fact version, either by replacement or deletion.',
    MODIFY COLUMN created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC time when this fact version was created. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time when the fact was most recently changed. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN archived_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time when the fact was archived; null while active. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE correspondence
    COMMENT='Preserves complete logical messages across email, SMS, MMS, iMessage, chat, voicemail, and future communication media. One row represents one inbound, outbound, draft, or internal message, independent of how many participants or files it has. Preserve the complete available message rather than replacing it with extracted facts or a summary. Use correspondence_participants and correspondence_files for people and attachments. Sensitivity: Contains highly private communications, message bodies, headers, account identifiers, and provider metadata.',
    MODIFY COLUMN correspondence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this message.',
    MODIFY COLUMN medium            ENUM('email', 'sms', 'mms', 'imessage', 'chat', 'voicemail', 'other') NOT NULL COMMENT 'Communication medium through which the message exists. email: Email message. sms: SMS text message. mms: Multimedia messaging service message. imessage: Apple iMessage communication. chat: Message from a chat or messaging platform. voicemail: Recorded or transcribed voicemail. other: Communication medium not covered by the named values.',
    MODIFY COLUMN direction         ENUM('inbound', 'outbound', 'draft', 'internal') NOT NULL COMMENT 'Whether the message arrived, was sent, remains a draft, or exists only as an internal record. inbound: Received from another participant. outbound: Sent to another participant. draft: Prepared but not sent. internal: Recorded for internal agent/user use rather than transmitted.',
    MODIFY COLUMN account_key       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Mailbox, phone identity, or service account through which the message was handled.',
    MODIFY COLUMN thread_key        VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Provider or local conversation identifier grouping related messages.',
    MODIFY COLUMN external_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Provider-assigned identifier for this message.',
    MODIFY COLUMN in_reply_to_id    BIGINT UNSIGNED COMMENT 'Earlier local correspondence record to which this message directly replies.',
    MODIFY COLUMN subject           TEXT COMMENT 'Complete message subject or title when the medium provides one.',
    MODIFY COLUMN body_text         LONGTEXT COMMENT 'Complete available plain-text body of the message or voicemail transcript.',
    MODIFY COLUMN body_html         LONGTEXT COMMENT 'Complete available HTML body when supplied by the communication provider.',
    MODIFY COLUMN status            VARCHAR(64) COMMENT 'Provider- or workflow-specific message state, such as unread, sent, failed, or archived.',
    MODIFY COLUMN sent_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when the message was sent, when known. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN received_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when the message was received, when known. Format: ISO 8601 UTC timestamp.',
    MODIFY COLUMN source_event_id   VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Ledger event that introduced or created this correspondence record when known.',
    MODIFY COLUMN created_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                      DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this local message record was inserted. Format: ISO 8601 UTC timestamp.',
    ALGORITHM=INSTANT;

ALTER TABLE correspondence_files
    COMMENT='Associates externally stored files with correspondence and identifies how each file appears in the message. One row links one file to one message as an attachment, inline asset, recording, or other file role. The file bytes live in agent media storage; this table stores only the relationship. Sensitivity: Reveals which private files belong to private communications.',
    MODIFY COLUMN correspondence_id BIGINT UNSIGNED NOT NULL COMMENT 'Message to which the file belongs.',
    MODIFY COLUMN file_id            BIGINT UNSIGNED NOT NULL COMMENT 'Externally stored file associated with the message.',
    MODIFY COLUMN attachment_role    ENUM('attachment', 'inline', 'recording', 'other') NOT NULL DEFAULT 'attachment' COMMENT 'How the file appears or functions in the message. attachment: Ordinary attached file. inline: File displayed inside the message body. recording: Audio or video recording that constitutes message content. other: File role not covered by the named values.',
    ALGORITHM=INSTANT;

ALTER TABLE correspondence_participants
    COMMENT='Records senders and recipients for correspondence while retaining unmatched addresses that do not yet resolve to a contact. One row represents one participant address in one role on one message, optionally linked to a known contact and contact method. address_value preserves the address observed on the message even when no contact matches it. Sensitivity: Contains private communication participants, addresses, and display names.',
    MODIFY COLUMN correspondence_id  BIGINT UNSIGNED NOT NULL COMMENT 'Message on which this participant appears.',
    MODIFY COLUMN participant_role   ENUM('from', 'to', 'cc', 'bcc', 'reply_to', 'sender', 'recipient') NOT NULL COMMENT 'Sender or recipient role the observed address has on the message. from: Email-style From participant. to: Email-style primary recipient. cc: Email-style carbon-copy recipient. bcc: Email-style blind-carbon-copy recipient. reply_to: Email-style Reply-To address to use when responding instead of the From address. sender: Generic sender for media without email-style headers. recipient: Generic recipient for media without email-style headers.',
    MODIFY COLUMN contact_id         BIGINT UNSIGNED COMMENT 'Known contact matched to the observed participant, when a match exists.',
    MODIFY COLUMN contact_method_id  BIGINT UNSIGNED COMMENT 'Specific known email address, phone number, or other method matched to the observed participant.',
    MODIFY COLUMN address_value      VARCHAR(512) NOT NULL COMMENT 'Address or identity exactly observed on the message, retained even when no contact matches.',
    MODIFY COLUMN display_name       VARCHAR(500) COMMENT 'Participant display name supplied with the message when available.',
    ALGORITHM=INSTANT;

-- end migration 0035

-- migration 0034: rename-contact-tags-and-remove-record-links
-- writer downtime: required; contact readers and writers must switch to the
-- matching application code when record_tags is renamed.
-- locking: the rename and drop take metadata locks; tag rows are not rewritten.
-- recovery: MariaDB DDL commits implicitly. Keep writers stopped and rerun
-- this block after a partial commit. The rename checks for the old table and
-- never overwrites the destination. Restore record_links from the verified
-- backup to recover its intentionally discarded contents.

SET @contact_tags_migration_sql = IF(EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'record_tags' AND TABLE_TYPE = 'BASE TABLE'), 'RENAME TABLE record_tags TO contacts_tags_join', 'DO 0');
PREPARE contact_tags_migration_statement FROM @contact_tags_migration_sql;
EXECUTE contact_tags_migration_statement;
DEALLOCATE PREPARE contact_tags_migration_statement;

DROP TABLE IF EXISTS record_links;

-- end migration 0034

-- migration 0033: remove-unused-notes
-- writer downtime: not required; no application feature reads or writes notes.
-- locking: DROP TABLE takes a metadata lock on notes only; no other table is rebuilt.
-- recovery: MariaDB DDL commits implicitly. Rerun this block if the table was
-- dropped before the version advanced. Restore notes from the verified backup
-- to recover its contents. This intentionally discards notes without copying rows.

DROP TABLE IF EXISTS notes;

-- end migration 0033

-- migration 0032: rename-personal-log-to-journal
-- writer downtime: required; deploy the matching Journal application after migration.
-- locking: table/column renames and constraint/index changes take metadata locks;
-- constraint validation can scan entries. No entries or activity receipts are rewritten.
-- recovery: MariaDB DDL commits implicitly. Keep writers stopped on failure and
-- rerun this resumable block. Renames check for the original object; constraints
-- and triggers are restored explicitly. Restore the verified backup to roll back.
-- postconditions: the runner checks names, relationships, indexes, and triggers
-- before recording version 32. Run npm run db:verify.

DROP TRIGGER IF EXISTS log_entries_require_tracker_unit_before_insert;
DROP TRIGGER IF EXISTS log_entries_require_tracker_unit_before_update;
DROP TRIGGER IF EXISTS journal_entries_require_tracker_unit_before_insert;
DROP TRIGGER IF EXISTS journal_entries_require_tracker_unit_before_update;
DROP TRIGGER IF EXISTS trackers_preserve_numeric_unit_before_update;
ALTER TABLE trackers DROP FOREIGN KEY IF EXISTS trackers_group;

SET @journal_migration_sql = IF(EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'log_groups' AND TABLE_TYPE = 'BASE TABLE'), 'RENAME TABLE log_groups TO journal_groups', 'DO 0');
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

SET @journal_migration_sql = IF(EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'log_entries' AND TABLE_TYPE = 'BASE TABLE'), 'RENAME TABLE log_entries TO journal_entries', 'DO 0');
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

SET @journal_migration_sql = IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_groups' AND COLUMN_NAME = 'log_group_id'), 'ALTER TABLE journal_groups CHANGE COLUMN log_group_id journal_group_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', 'DO 0');
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

SET @journal_migration_sql = IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trackers' AND COLUMN_NAME = 'log_group_id'), 'ALTER TABLE trackers CHANGE COLUMN log_group_id journal_group_id BIGINT UNSIGNED NOT NULL', 'DO 0');
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

SET @journal_migration_sql = IF(EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_entries' AND COLUMN_NAME = 'log_entry_id'), 'ALTER TABLE journal_entries CHANGE COLUMN log_entry_id journal_entry_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', 'DO 0');
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

SET @journal_migration_sql = IF(EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_groups' AND INDEX_NAME = 'log_groups_name'), 'ALTER TABLE journal_groups RENAME INDEX log_groups_name TO journal_groups_name', 'DO 0');
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

SET @journal_migration_sql = IF(EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_entries' AND INDEX_NAME = 'log_entries_source_external'), 'ALTER TABLE journal_entries RENAME INDEX log_entries_source_external TO journal_entries_source_external', 'DO 0');
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

SET @journal_migration_sql = IF(EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_entries' AND INDEX_NAME = 'log_entries_tracker_occurred'), 'ALTER TABLE journal_entries RENAME INDEX log_entries_tracker_occurred TO journal_entries_tracker_occurred', 'DO 0');
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

SET @journal_migration_sql = IF(EXISTS (SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'journal_entries' AND INDEX_NAME = 'log_entries_event'), 'ALTER TABLE journal_entries RENAME INDEX log_entries_event TO journal_entries_event', 'DO 0');
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

ALTER TABLE journal_groups
  DROP CONSTRAINT IF EXISTS log_groups_name_length,
  DROP CONSTRAINT IF EXISTS journal_groups_name_length,
  ADD CONSTRAINT journal_groups_name_length CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 200);

-- MDEV-32270: DROP CONSTRAINT combined with ADD CONSTRAINT can retain old
-- foreign keys. Use typed drops and finish them before adding replacements.
-- Drop both names so replay also repairs a previous partially completed run.
ALTER TABLE journal_entries
  DROP FOREIGN KEY IF EXISTS log_entries_tracker,
  DROP FOREIGN KEY IF EXISTS journal_entries_tracker;

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_tracker FOREIGN KEY (tracker_id) REFERENCES trackers(tracker_id) ON DELETE RESTRICT;

ALTER TABLE journal_entries
  DROP FOREIGN KEY IF EXISTS log_entries_event,
  DROP FOREIGN KEY IF EXISTS journal_entries_event;

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL;

ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS log_entries_content,
  DROP CONSTRAINT IF EXISTS journal_entries_content,
  ADD CONSTRAINT journal_entries_content CHECK (CHAR_LENGTH(TRIM(content_text)) BETWEEN 1 AND 10000);

ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS log_entries_source_length,
  DROP CONSTRAINT IF EXISTS journal_entries_source_length,
  ADD CONSTRAINT journal_entries_source_length CHECK (CHAR_LENGTH(TRIM(source)) BETWEEN 1 AND 200);

ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS log_entries_external_length,
  DROP CONSTRAINT IF EXISTS journal_entries_external_length,
  ADD CONSTRAINT journal_entries_external_length CHECK (external_id IS NULL OR CHAR_LENGTH(TRIM(external_id)) BETWEEN 1 AND 1000);

ALTER TABLE trackers ADD CONSTRAINT trackers_group FOREIGN KEY (journal_group_id) REFERENCES journal_groups(journal_group_id) ON DELETE RESTRICT;

SET @journal_migration_sql = 'CREATE TRIGGER journal_entries_require_tracker_unit_before_insert
BEFORE INSERT ON journal_entries
FOR EACH ROW
BEGIN
  IF NEW.number_value IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM trackers WHERE tracker_id = NEW.tracker_id AND unit IS NOT NULL)
  THEN
    SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''numeric journal entries require a tracker unit'';
  END IF;
END';
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

SET @journal_migration_sql = 'CREATE TRIGGER journal_entries_require_tracker_unit_before_update
BEFORE UPDATE ON journal_entries
FOR EACH ROW
BEGIN
  IF NEW.number_value IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM trackers WHERE tracker_id = NEW.tracker_id AND unit IS NOT NULL)
  THEN
    SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''numeric journal entries require a tracker unit'';
  END IF;
END';
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

SET @journal_migration_sql = 'CREATE TRIGGER trackers_preserve_numeric_unit_before_update
BEFORE UPDATE ON trackers
FOR EACH ROW
BEGIN
  IF NOT (OLD.unit <=> NEW.unit)
     AND LOWER(OLD.unit) <> ''set me''
     AND EXISTS (SELECT 1 FROM journal_entries WHERE tracker_id = OLD.tracker_id AND number_value IS NOT NULL)
  THEN
    SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''a tracker unit cannot change after numeric entries exist'';
  END IF;
END';
PREPARE journal_migration_statement FROM @journal_migration_sql;
EXECUTE journal_migration_statement;
DEALLOCATE PREPARE journal_migration_statement;

-- end migration 0032

-- migration 0031: normalize-todo-personal-constraint-names
-- writer downtime: required; this replaces constraints on todo_personal.
-- locking: ALTER TABLE takes a metadata lock and may briefly rebuild indexes.
-- recovery: MariaDB DDL commits implicitly. Keep writers stopped after a
-- failure and rerun this idempotent block; it removes both the legacy and
-- canonical names before restoring the canonical constraints.
-- postconditions: the runner verifies the canonical foreign keys, checks, and
-- source index before recording schema version 31. Then run npm run db:verify.

ALTER TABLE todo_personal
  DROP CONSTRAINT IF EXISTS personal_tasks_group,
  DROP CONSTRAINT IF EXISTS personal_tasks_routine,
  DROP CONSTRAINT IF EXISTS personal_tasks_contact_fk,
  DROP CONSTRAINT IF EXISTS personal_tasks_source,
  DROP CONSTRAINT IF EXISTS todo_personal_group,
  DROP CONSTRAINT IF EXISTS todo_personal_routine,
  DROP CONSTRAINT IF EXISTS todo_personal_contact_fk,
  DROP CONSTRAINT IF EXISTS todo_personal_source;

ALTER TABLE todo_personal
  DROP INDEX IF EXISTS personal_tasks_source;

ALTER TABLE todo_personal
  DROP CONSTRAINT IF EXISTS personal_tasks_sequence,
  DROP CONSTRAINT IF EXISTS personal_tasks_status,
  DROP CONSTRAINT IF EXISTS personal_tasks_all_day,
  DROP CONSTRAINT IF EXISTS personal_tasks_duration,
  DROP CONSTRAINT IF EXISTS personal_tasks_prompt,
  DROP CONSTRAINT IF EXISTS todo_personal_sequence,
  DROP CONSTRAINT IF EXISTS todo_personal_status,
  DROP CONSTRAINT IF EXISTS todo_personal_all_day,
  DROP CONSTRAINT IF EXISTS todo_personal_duration,
  DROP CONSTRAINT IF EXISTS todo_personal_prompt;

ALTER TABLE todo_personal
  ADD CONSTRAINT todo_personal_group
    FOREIGN KEY (todo_group_id) REFERENCES todo_groups(todo_group_id) ON DELETE RESTRICT,
  ADD CONSTRAINT todo_personal_routine
    FOREIGN KEY (todo_routine_id) REFERENCES todo_routines(todo_routine_id) ON DELETE SET NULL,
  ADD CONSTRAINT todo_personal_contact_fk
    FOREIGN KEY (related_contact_id) REFERENCES contacts(contact_id) ON DELETE SET NULL,
  ADD CONSTRAINT todo_personal_source
    FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
  ADD CONSTRAINT todo_personal_sequence
    CHECK (sequence IS NULL OR sequence > 0),
  ADD CONSTRAINT todo_personal_all_day
    CHECK (is_all_day IN (0, 1)),
  ADD CONSTRAINT todo_personal_duration
    CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  ADD CONSTRAINT todo_personal_prompt
    CHECK (planning_prompt_text IS NULL OR CHAR_LENGTH(TRIM(planning_prompt_text)) BETWEEN 1 AND 10000);

-- end migration 0031

-- migration 0030: native-enum-columns
-- writer downtime: required; this rebuilds columns used by active writers.
-- locking: ALTER TABLE takes metadata locks and may rebuild affected tables.
-- recovery: MariaDB DDL commits implicitly. Keep writers stopped after a
-- failure, inspect which statements committed, and rerun this resumable block.
-- Every constraint drop is guarded and every column modification is
-- idempotent. Restore the pre-migration dump when recovery requires rollback.
-- postconditions: the runner verifies table and foreign-key integrity before
-- recording schema version 30. Then run npm run db:verify and the test suite.

SET @chapeaux_fous_previous_sql_mode = @@SESSION.sql_mode;
SET SESSION sql_mode = IF(
  FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode)
    OR FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode),
  @@SESSION.sql_mode,
  CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_TRANS_TABLES')
);

-- VEVENT has no completed state. Preserve already-happened events as confirmed.
UPDATE calendar_events
SET status = 'confirmed'
WHERE status = 'completed';

ALTER TABLE files
  DROP CONSTRAINT IF EXISTS files_media_kind,
  DROP CONSTRAINT IF EXISTS files_title_source,
  MODIFY media_kind ENUM('audio', 'video', 'image', 'document', 'archive', 'other') NOT NULL DEFAULT 'other',
  MODIFY title_source ENUM('original_filename', 'ai', 'user') NOT NULL DEFAULT 'original_filename';

ALTER TABLE activity_events
  DROP CONSTRAINT IF EXISTS activity_events_phase,
  DROP CONSTRAINT IF EXISTS activity_events_actor,
  MODIFY event_phase ENUM('point', 'start', 'end', 'error') NOT NULL DEFAULT 'point',
  MODIFY actor_type ENUM('user', 'agent', 'model', 'tool', 'system', 'service', 'external') NOT NULL;

ALTER TABLE activity_event_files
  DROP CONSTRAINT IF EXISTS activity_event_files_role,
  MODIFY file_role ENUM('attachment', 'input', 'output', 'other') NOT NULL DEFAULT 'attachment';

ALTER TABLE agent_turn_attempts
  DROP CONSTRAINT IF EXISTS agent_turn_attempts_correlation,
  DROP CONSTRAINT IF EXISTS agent_turn_attempts_status,
  MODIFY correlation_method ENUM('prompt_sha256', 'gateway_result') NULL,
  MODIFY status ENUM('processing', 'complete', 'error', 'interrupted') NOT NULL DEFAULT 'processing';

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_kind,
  DROP CONSTRAINT IF EXISTS contacts_status,
  MODIFY contact_kind ENUM('person', 'organization', 'service') NOT NULL DEFAULT 'person',
  MODIFY status ENUM('active', 'inactive', 'blocked', 'deceased') NOT NULL DEFAULT 'active';

ALTER TABLE contact_methods
  DROP CONSTRAINT IF EXISTS contact_methods_kind,
  MODIFY method_kind ENUM('email', 'phone', 'postal_address', 'handle', 'url', 'other') NOT NULL;

ALTER TABLE interaction_guides
  DROP CONSTRAINT IF EXISTS interaction_guides_status,
  MODIFY status ENUM('active', 'archived') NOT NULL DEFAULT 'active';

ALTER TABLE calendar_events
  DROP CONSTRAINT IF EXISTS calendar_events_status,
  MODIFY status ENUM('tentative', 'confirmed', 'cancelled') NOT NULL DEFAULT 'confirmed';

ALTER TABLE calendar_event_contacts
  DROP CONSTRAINT IF EXISTS calendar_event_contacts_role,
  MODIFY participant_role ENUM('organizer', 'attendee', 'customer', 'other') NOT NULL DEFAULT 'attendee';

ALTER TABLE interaction_guide_steps
  DROP CONSTRAINT IF EXISTS interaction_guide_steps_progress,
  MODIFY progress_state ENUM('pending', 'active', 'completed') NOT NULL DEFAULT 'pending';

ALTER TABLE todo_routines
  DROP CONSTRAINT IF EXISTS todo_routines_publication_mode,
  DROP CONSTRAINT IF EXISTS todo_routines_default_status,
  MODIFY publication_mode ENUM('on_completion', 'calendar') NOT NULL DEFAULT 'on_completion',
  MODIFY default_status ENUM('unplanned', 'todo', 'ai_suggested') NOT NULL DEFAULT 'todo';

ALTER TABLE todo_personal
  DROP CONSTRAINT IF EXISTS todo_personal_status,
  MODIFY status ENUM('unplanned', 'todo', 'complete', 'ignore', 'archive', 'ai_suggested') NOT NULL DEFAULT 'todo';

ALTER TABLE reminders
  DROP CONSTRAINT IF EXISTS reminders_delivery,
  DROP CONSTRAINT IF EXISTS reminders_status,
  MODIFY delivery_method ENUM('agent', 'webhook', 'notification', 'email', 'sms', 'other') NOT NULL DEFAULT 'agent',
  MODIFY status ENUM('pending', 'processing', 'delivered', 'snoozed', 'cancelled', 'error') NOT NULL DEFAULT 'pending';

ALTER TABLE content_items
  DROP CONSTRAINT IF EXISTS content_items_type,
  DROP CONSTRAINT IF EXISTS content_items_host,
  DROP CONSTRAINT IF EXISTS content_items_status,
  DROP CONSTRAINT IF EXISTS content_items_relationship,
  MODIFY content_type ENUM('mobileUGC_tutorial', 'mobileUGC_ad', 'webUGC_tutorial', 'webUGC_ad', 'video_ad', 'podcast', 'image', 'unknown') NOT NULL DEFAULT 'mobileUGC_tutorial',
  MODIFY content_host ENUM('youtube', 'vimeo', 'spotify', 'mytlomdotcom', 'none') NOT NULL DEFAULT 'youtube',
  MODIFY content_status ENUM('active', 'obsolete', 'unused', 'queued') NOT NULL DEFAULT 'active',
  MODIFY relationship_to_user ENUM('mine', 'reference') NOT NULL DEFAULT 'mine';

ALTER TABLE video_scripts
  DROP CONSTRAINT IF EXISTS video_scripts_status,
  MODIFY status ENUM('draft', 'archived') NOT NULL DEFAULT 'draft';

ALTER TABLE video_jobs
  DROP CONSTRAINT IF EXISTS video_jobs_renderer,
  DROP CONSTRAINT IF EXISTS video_jobs_status,
  MODIFY renderer ENUM('remotion', 'adobe_premiere', 'other') NOT NULL DEFAULT 'remotion',
  MODIFY status ENUM('queued', 'preparing', 'rendering', 'complete', 'error', 'cancelled') NOT NULL DEFAULT 'queued';

ALTER TABLE profile_facts
  DROP CONSTRAINT IF EXISTS profile_facts_status,
  MODIFY fact_status ENUM('active', 'archived') NOT NULL DEFAULT 'active';

ALTER TABLE notes
  DROP CONSTRAINT IF EXISTS notes_kind,
  DROP CONSTRAINT IF EXISTS notes_status,
  MODIFY note_kind ENUM('personal', 'journal', 'reference', 'idea', 'other') NOT NULL DEFAULT 'personal',
  MODIFY status ENUM('active', 'archived', 'deleted') NOT NULL DEFAULT 'active';

ALTER TABLE correspondence
  DROP CONSTRAINT IF EXISTS correspondence_medium,
  DROP CONSTRAINT IF EXISTS correspondence_direction,
  MODIFY medium ENUM('email', 'sms', 'mms', 'imessage', 'chat', 'voicemail', 'other') NOT NULL,
  MODIFY direction ENUM('inbound', 'outbound', 'draft', 'internal') NOT NULL;

ALTER TABLE correspondence_files
  DROP CONSTRAINT IF EXISTS correspondence_files_role,
  MODIFY attachment_role ENUM('attachment', 'inline', 'recording', 'other') NOT NULL DEFAULT 'attachment';

ALTER TABLE correspondence_participants
  DROP CONSTRAINT IF EXISTS correspondence_participants_role,
  MODIFY participant_role ENUM('from', 'to', 'cc', 'bcc', 'reply_to', 'sender', 'recipient') NOT NULL;

SET SESSION sql_mode = @chapeaux_fous_previous_sql_mode;

-- end migration 0030
