-- Chapeaux Fous MariaDB schema baseline.
-- Target: MariaDB 10.11, schema version 40.
--
-- Apply only to an empty database whose default character set is utf8mb4.
-- This file is the authoritative schema for a fresh Chapeaux Fous database.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE database_meta (
    -- sourceOfTruth: true
    -- synonyms: ["schema metadata", "database version"]
    -- keywords: ["schema version", "database metadata", "migration"]

    singleton       TINYINT UNSIGNED NOT NULL COMMENT 'Constant primary key fixed at 1 so the table can contain only one metadata row.',
    schema_version  INT UNSIGNED NOT NULL COMMENT 'Current integer schema generation expected by the application.',
    created_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                    DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this database metadata row was created. Format: ISO 8601 UTC timestamp.',
    description     TEXT COMMENT 'Human-readable description of this database''s intended ownership and purpose.',
    PRIMARY KEY (singleton),
    CONSTRAINT database_meta_singleton CHECK (singleton = 1)
) ENGINE=InnoDB COMMENT='Identifies the application MariaDB database and records its current schema version. The sole row describes the database itself rather than a user-domain entity. The table must contain exactly the singleton row whose key is 1. schema_version advances only after an approved migration succeeds. Sensitivity: Contains non-secret internal database metadata.';

CREATE TABLE files (
    -- sourceOfTruth: true
    -- synonyms: ["media files", "file catalog"]
    -- keywords: ["file", "recording", "audio", "video", "image", "document", "attachment", "media", "download"]

    file_id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this stored-file record.',
    storage_path       TEXT NOT NULL COMMENT 'Unique path locating the file bytes in agent media storage.',
    -- storage_path_hash: Generated SHA-256 digest of storage_path used to enforce uniqueness for externally stored file locations. Format: 32-byte binary SHA-256 digest. Database-generated value; applications must not write it. Sensitivity: A deterministic digest of a potentially private storage path.
    storage_path_hash  BINARY(32) AS (UNHEX(SHA2(storage_path, 256))) PERSISTENT,
    original_filename  TEXT COMMENT 'Filename supplied by the original source before storage renaming or organization.',
    media_kind         ENUM('audio', 'video', 'image', 'document', 'archive', 'other') NOT NULL DEFAULT 'other' COMMENT 'Broad media category used by agent workflows. audio: Audio recording or sound file. video: Video or animation file. image: Still image or graphic file. document: Textual or paginated document file. archive: Archive containing one or more files. other: File type not covered by the named media categories.',
    mime_type          VARCHAR(255) COMMENT 'Internet media type reported or detected for the file.',
    sha256             CHAR(64) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'SHA-256 digest of the file bytes for integrity verification and duplicate detection. Format: 64-character lowercase hexadecimal SHA-256 digest.',
    byte_size          BIGINT COMMENT 'Size of the stored file in bytes. Units: bytes. Format: non-negative integer.',
    duration_ms        BIGINT COMMENT 'Playback duration of audio or video in milliseconds when known. Units: milliseconds. Format: non-negative integer.',
    width              BIGINT COMMENT 'Pixel width of an image or video when known. Units: pixels. Format: positive integer.',
    height             BIGINT COMMENT 'Pixel height of an image or video when known. Units: pixels. Format: positive integer.',
    source_event_id    VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Stable event_id of the ledger event that introduced the file when known.',
    created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this file metadata record was inserted. Format: ISO 8601 UTC timestamp.',
    title              VARCHAR(200) COMMENT 'Concise human-facing title for the stored file. Initially derived from the original filename and may later be suggested by AI or edited by the user.',
    description        TEXT COMMENT 'Plain-language searchable description of the file contents.',
    title_source       ENUM('original_filename', 'ai', 'user') NOT NULL DEFAULT 'original_filename' COMMENT 'Authority that supplied the current title, used to prevent AI from overwriting a user-edited title. original_filename: The title is the deterministic upload-time fallback. ai: The title was suggested by the model after inspecting the file. user: The title was confirmed or edited by the user and must not be overwritten by AI.',
    updated_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent title or description change.',
    PRIMARY KEY (file_id),
    UNIQUE KEY files_storage_path (storage_path_hash),
    UNIQUE KEY files_sha256_unique (sha256),
    KEY files_created (created_at_utc, file_id),
    FULLTEXT KEY files_fulltext (title, description, original_filename),
    CONSTRAINT files_byte_size CHECK (byte_size IS NULL OR byte_size >= 0),
    CONSTRAINT files_duration CHECK (duration_ms IS NULL OR duration_ms >= 0),
    CONSTRAINT files_width CHECK (width IS NULL OR width > 0),
    CONSTRAINT files_height CHECK (height IS NULL OR height > 0)
) ENGINE=InnoDB COMMENT='Catalogs files held in agent media storage while keeping large binary bytes outside MariaDB. One row represents one externally stored file and records where it is stored plus known integrity and media metadata. storage_path identifies the external bytes; this table never contains the file bytes themselves. sha256 may be used to verify integrity or identify duplicate content. Sensitivity: Paths, filenames, hashes, and metadata may reveal private user content even though bytes are stored elsewhere.';

CREATE TABLE activity_events (
    -- sourceOfTruth: true
    -- synonyms: ["activity ledger", "event ledger"]
    -- keywords: ["agent activity", "conversation history", "what happened", "tool call", "model call", "request", "response", "error"]
    -- content_text keywords: ["request text", "response text", "what was said", "transcript"]
    -- error_text keywords: ["error", "failure", "what went wrong"]
    -- fk:activity_events_primary_file meaning: Connects this observable event to the stored-file record identified by primary_file_id.
    -- fk:activity_events_primary_file cardinality: Each observable event may reference zero or one stored-file record; one referenced record may be used by many observable event records.
    -- fk:activity_events_primary_file importantRules: ["Deleting the referenced row preserves this row and clears the reference."]

    event_seq        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Monotonically increasing local sequence used to order ledger insertions exactly.',
    event_id         VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (LOWER(REPLACE(UUID(), '-', ''))) COMMENT 'Stable public identifier used to refer to this event from other records and interfaces.',
    occurred_at_ms   BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000) COMMENT 'When the represented event occurred according to its source, expressed as Unix epoch milliseconds. Units: milliseconds. Format: Unix epoch milliseconds.',
    recorded_at_ms   BIGINT NOT NULL DEFAULT (UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3)) * 1000) COMMENT 'When this ledger received and stored the event, expressed as Unix epoch milliseconds. Units: milliseconds. Format: Unix epoch milliseconds.',
    occurred_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'Human-readable UTC timestamp corresponding to the event occurrence time recorded for this row. Format: ISO 8601 UTC timestamp.',
    event_type       VARCHAR(255) NOT NULL COMMENT 'Extensible event name identifying what happened, such as a request, model call, tool call, response, lifecycle transition, or error.',
    event_phase      ENUM('point', 'start', 'end', 'error') NOT NULL DEFAULT 'point' COMMENT 'Whether this record is a standalone point event or the start, successful end, or error end of an operation. point: Standalone event rather than an operation boundary. start: Operation began. end: Operation completed without a recorded error. error: Operation terminated with an error.',
    status           VARCHAR(64) COMMENT 'Optional source-specific state or outcome associated with the event.',
    actor_type       ENUM('user', 'agent', 'model', 'tool', 'system', 'service', 'external') NOT NULL COMMENT 'Broad category of the participant or system component that performed the recorded action. user: Human user. agent: Agent orchestration layer. model: Language or other AI model. tool: Agent-callable tool or MCP operation. system: Runtime or operating-system component. service: Long-running application service. external: System outside the agent runtime.',
    actor_name       VARCHAR(255) COMMENT 'More specific human-readable or machine-readable identity of the actor when known.',
    source           VARCHAR(255) NOT NULL COMMENT 'System, plugin, service, or integration that supplied the event to the ledger.',
    channel          VARCHAR(255) COMMENT 'Communication channel through which the event entered or left the agent system, when applicable.',
    session_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier grouping events belonging to the same agent runtime session.',
    turn_id          VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier grouping all observable events belonging to one user-request and assistant-response turn.',
    trace_id         VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier grouping a distributed chain of related operations across components.',
    operation_id     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier pairing the start and terminal events for one measurable operation.',
    span_id          VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier of this event''s tracing span when span-level tracing is available.',
    parent_span_id   VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier of the tracing span that directly contains this span.',
    parent_event_id  VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Stable event_id of the earlier ledger event that directly caused or contains this event when known.',
    name             VARCHAR(255) COMMENT 'Short human-readable operation, event, model, tool, or component name.',
    content_text     LONGTEXT COMMENT 'Complete human-readable content visible at this event boundary, such as a user request, transcript, model output, or tool text.',
    payload_json     LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '{}' COMMENT 'Structured event-specific details, including observable arguments, results, identifiers, usage, or provider metadata not represented by dedicated columns. Format: JSON object encoded as text.',
    primary_file_id  BIGINT UNSIGNED COMMENT 'File record most directly associated with this event, such as its original recording or generated artifact.',
    subject_type     VARCHAR(255) COMMENT 'Type of domain record this event concerns, used together with subject_id.',
    subject_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier of the domain record named by subject_type.',
    external_ref     TEXT COMMENT 'Identifier or reference assigned by an external system when no dedicated column exists.',
    error_text       LONGTEXT COMMENT 'Complete observable error message or terminal failure text associated with this event.',
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
    CONSTRAINT activity_events_payload_json CHECK (JSON_VALID(payload_json))
) ENGINE=InnoDB COMMENT='Preserves a chronological, searchable record of activity visible at the boundaries between users, agents, models, tools, services, and external systems. One row represents one observed event, such as a request arriving, a model call starting, a tool returning a result, a response being produced, or an error occurring. Treat rows as append-oriented historical evidence; corrections should normally be recorded as later events rather than rewriting prior observations. Use event_seq for exact local insertion order and occurred_at_ms for source-event chronology. Sensitivity: May contain private user content, tool arguments, model-visible data, errors, and operational identifiers.';

CREATE TABLE activity_event_files (
    -- sourceOfTruth: true
    -- synonyms: ["event attachments", "request files"]
    -- keywords: ["attached file", "uploaded file", "request attachment", "input file", "output file"]
    -- fk:activity_event_files_event meaning: Connects this event-file association to its observable activity event.
    -- fk:activity_event_files_event cardinality: Each association references exactly one activity event; one event may have many associated files.
    -- fk:activity_event_files_event importantRules: ["Deleting the event also deletes this association, not the stored file itself."]
    -- fk:activity_event_files_file_fk meaning: Connects this event-file association to its stored-file record.
    -- fk:activity_event_files_file_fk cardinality: Each association references exactly one stored file; one file may be associated with many events.
    -- fk:activity_event_files_file_fk importantRules: ["Deleting the stored-file record also deletes this association."]

    event_id   VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Observable activity event to which the file belongs.',
    file_id    BIGINT UNSIGNED NOT NULL COMMENT 'Stored-file record associated with the activity event.',
    file_role  ENUM('attachment', 'input', 'output', 'other') NOT NULL DEFAULT 'attachment' COMMENT 'How the file participates in the activity event. attachment: File attached to a user request or other event. input: File consumed as an explicit operation input. output: File produced by an operation. other: File relationship not covered by the named roles.',
    ordinal    BIGINT NOT NULL DEFAULT 0 COMMENT 'Zero-based display and processing order among files associated with the event. Units: position.',
    PRIMARY KEY (event_id, file_id),
    KEY activity_event_files_file (file_id, event_id),
    CONSTRAINT activity_event_files_event FOREIGN KEY (event_id) REFERENCES activity_events(event_id) ON DELETE CASCADE,
    CONSTRAINT activity_event_files_file_fk FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE,
    CONSTRAINT activity_event_files_ordinal CHECK (ordinal >= 0)
) ENGINE=InnoDB COMMENT='Associates any observable activity event with all files that were supplied to it or produced by it. One row links one stored file to one activity event in a specific ordered role. Use activity_events.primary_file_id only for the one primary file; this relationship preserves every associated file. Sensitivity: Links private files to private interactions and observable agent operations.';

CREATE TABLE contacts (
    -- sourceOfTruth: true
    -- synonyms: ["address book", "people and organizations"]
    -- keywords: ["contact", "person", "people", "organization", "customer", "who is"]
    -- display_name keywords: ["contact name", "person name", "who is"]
    -- given_name keywords: ["first name"]
    -- family_name keywords: ["last name", "surname"]
    -- organization_name keywords: ["company", "business", "employer"]

    contact_id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this person, organization, or service.',
    contact_kind       ENUM('person', 'organization', 'service') NOT NULL DEFAULT 'person' COMMENT 'Whether this contact represents a person, organization, or service identity. person: Individual human. organization: Company, group, agency, or other organization. service: Service or system represented as a contactable identity.',
    display_name       VARCHAR(500) NOT NULL COMMENT 'Preferred human-readable name used to show and refer to the contact.',
    given_name         VARCHAR(255) COMMENT 'Person''s given or first name when the contact is a person.',
    family_name        VARCHAR(255) COMMENT 'Person''s family or last name when the contact is a person.',
    organization_name  VARCHAR(500) COMMENT 'Organization name associated with this contact when applicable.',
    is_self            TINYINT NOT NULL DEFAULT 0 COMMENT '1 only for the active contact record representing the user; otherwise 0. Format: MariaDB boolean: 0=false, 1=true.',
    status             ENUM('active', 'inactive', 'blocked', 'deceased') NOT NULL DEFAULT 'active' COMMENT 'Current address-book status of the contact. active: Current usable contact. inactive: Retained contact not currently active. blocked: Contact from whom interaction is blocked or should be avoided. deceased: Person is known to be deceased.',
    notes              TEXT COMMENT 'Private free-text context about the contact that does not belong in a structured relationship or method.',
    source             VARCHAR(255) COMMENT 'System or process from which this contact was imported or created.',
    external_id        VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier assigned to this contact by the source system.',
    created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the contact record was inserted. Format: ISO 8601 UTC timestamp.',
    updated_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the latest recorded change to the contact. Format: ISO 8601 UTC timestamp.',
    birth_date         VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Contact''s birth date, with an explicitly optional year, used to derive birthday calendar entries and age when possible. Format: YYYY-MM-DD when the year is known; --MM-DD when it is unknown. Do not invent a birth year; use --MM-DD when only month and day are known. Age is derived only when the stored value includes a year. Generated birthday labels are projections and must not be written back as permanent age text. Sensitivity: A birth date tied to an identified person is sensitive personal information.',
    -- active_self_guard: Generated uniqueness guard equal to 1 only for the active contact representing the user, and null otherwise. Format: MariaDB boolean uniqueness guard: 1 or null. Database-generated value used to enforce at most one active self contact; applications must not write it.
    active_self_guard  TINYINT AS (IF(is_self = 1 AND status = 'active', 1, NULL)) PERSISTENT,
    PRIMARY KEY (contact_id),
    UNIQUE KEY contacts_one_self (active_self_guard),
    KEY contacts_display_name (display_name),
    CONSTRAINT contacts_is_self CHECK (is_self IN (0, 1)),
    CONSTRAINT contacts_birth_date CHECK (
      birth_date IS NULL
      OR birth_date REGEXP '^([0-9]{4}-|--)((0[13578]|1[02])-(0[1-9]|[12][0-9]|3[01])|(0[469]|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-9]))$'
    )
) ENGINE=InnoDB COMMENT='Provides one address book for people, organizations, and services that other agent records need to identify or relate to. One row represents one person, organization, or service known to the user. At most one active contact may have is_self set to 1. Use contact_methods for reachable addresses rather than placing them in notes. birth_date is the authoritative birthday fact; calendar birthday entries are derived from it. Sensitivity: Contains personal identity, birth dates, relationship, status, and free-text notes.';

CREATE TABLE contact_methods (
    -- sourceOfTruth: true
    -- synonyms: ["contact details", "addresses"]
    -- keywords: ["phone number", "email address", "postal address", "contact information", "reach", "call", "text", "email"]
    -- value keywords: ["phone number", "email address", "postal address", "handle"]
    -- fk:contact_methods_contact meaning: Connects this contact method to the contact identified by contact_id.
    -- fk:contact_methods_contact cardinality: Each contact method references exactly one contact; one referenced record may be used by many contact method records.
    -- fk:contact_methods_contact importantRules: ["Deleting the referenced row also deletes this dependent row."]

    contact_method_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this contact method.',
    contact_id         BIGINT UNSIGNED NOT NULL COMMENT 'Contact that owns this address or reachable identity.',
    method_kind        ENUM('email', 'phone', 'postal_address', 'handle', 'url', 'other') NOT NULL COMMENT 'Kind of address or identity stored in value. email: Email address. phone: Telephone number. postal_address: Physical mailing or street address. handle: Username or service-specific handle. url: Web address. other: Contact identity not covered by the named kinds.',
    label              VARCHAR(255) COMMENT 'Human-facing qualifier such as home, work, mobile, or billing.',
    value              TEXT NOT NULL COMMENT 'Original address, number, handle, URL, or other contact value as supplied.',
    normalized_value   VARCHAR(512) COMMENT 'Canonicalized representation used for reliable lookup and matching while value preserves the original.',
    is_primary         TINYINT NOT NULL DEFAULT 0 COMMENT '1 when this is the preferred contact method of its kind for the contact; otherwise 0. Format: MariaDB boolean: 0=false, 1=true.',
    can_receive        TINYINT NOT NULL DEFAULT 1 COMMENT '1 when the agent may use this method as a delivery destination; otherwise 0. Format: MariaDB boolean: 0=false, 1=true.',
    created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this contact method was inserted. Format: ISO 8601 UTC timestamp.',
    -- value_hash: Generated SHA-256 digest of the original contact value used to enforce uniqueness even when the value is too long to index directly. Format: 32-byte binary SHA-256 digest. Database-generated value; applications must not write it. Sensitivity: A deterministic digest of personal contact information.
    value_hash         BINARY(32) AS (UNHEX(SHA2(value, 256))) PERSISTENT,
    PRIMARY KEY (contact_method_id),
    UNIQUE KEY contact_methods_value (contact_id, method_kind, value_hash),
    KEY contact_methods_lookup (method_kind, normalized_value),
    CONSTRAINT contact_methods_contact FOREIGN KEY (contact_id) REFERENCES contacts(contact_id) ON DELETE CASCADE,
    CONSTRAINT contact_methods_primary CHECK (is_primary IN (0, 1)),
    CONSTRAINT contact_methods_receive CHECK (can_receive IN (0, 1))
) ENGINE=InnoDB COMMENT='Stores the email addresses, phone numbers, postal addresses, handles, URLs, and other reachable identities belonging to contacts. One row represents one original contact value of one kind for one contact, plus matching and delivery metadata. value preserves the original representation; normalized_value exists for matching and lookup. Sensitivity: Contains personal contact information and delivery addresses.';

CREATE TABLE tags (
    -- sourceOfTruth: true
    -- synonyms: ["labels", "categories"]
    -- keywords: ["tag", "label", "category", "categorize"]

    tag_id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this tag.',
    slug            VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Unique stable machine identifier used for matching and references.',
    label           VARCHAR(255) NOT NULL COMMENT 'Human-readable text displayed for the tag.',
    is_active       TINYINT NOT NULL DEFAULT 1 COMMENT '1 when the tag is available for normal use; otherwise 0. Format: MariaDB boolean: 0=false, 1=true.',
    created_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                    DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the tag was defined. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (tag_id),
    UNIQUE KEY tags_slug (slug),
    CONSTRAINT tags_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB COMMENT='Defines reusable human labels that can categorize many kinds of agent records. One row defines one tag with a stable machine slug and human-facing label. Use slug for stable matching and label for display. Inactive tags remain defined but should not normally be offered for new assignments. Sensitivity: Tag names may reveal private organizational categories.';

CREATE TABLE contacts_tags_join (
    -- sourceOfTruth: true
    -- synonyms: ["contact tags", "contact tag assignments"]
    -- keywords: ["tagged record", "record tag", "categorize"]
    -- fk:record_tags_tag meaning: Connects this tag assignment to the tag identified by tag_id.
    -- fk:record_tags_tag cardinality: Each tag assignment references exactly one tag; one referenced record may be used by many tag assignment records.
    -- fk:record_tags_tag importantRules: ["Deleting the referenced row also deletes this dependent row."]

    tag_id          BIGINT UNSIGNED NOT NULL COMMENT 'Tag assigned to the record.',
    record_type     VARCHAR(128) NOT NULL COMMENT 'Type of record receiving the tag.',
    record_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Text representation of the identifier for the record named by record_type.',
    created_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                    DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the tag was assigned. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (tag_id, record_type, record_id),
    KEY record_tags_record (record_type, record_id),
    CONSTRAINT record_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Stores the tag assignments used by Contacts, retaining the legacy record type and record ID columns. One row assigns one tag to one typed record; Contacts uses record_type contact. record_type and record_id form a polymorphic reference that MariaDB cannot validate with a foreign key. The table rename preserves existing assignments of every record type; contact operations select record_type contact. Sensitivity: Tag assignments may reveal private categorization of people, communications, work, or content.';

CREATE TABLE content_groups (
    -- sourceOfTruth: true
    -- synonyms: ["content categories", "content collections"]
    -- keywords: ["content group", "grouped content"]

    content_group_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this content group.',
    name              VARCHAR(200) NOT NULL COMMENT 'Complete human-facing name of the content group.',
    sort_position     BIGINT NOT NULL DEFAULT 0 COMMENT 'Mutable presentation order used to place the group and all of its content in the catalog.',
    archived_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time when this group was removed from active content organization, or null while active. Format: ISO 8601 UTC timestamp.',
    created_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                      DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC time when this content group was created. Format: ISO 8601 UTC timestamp.',
    updated_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time of the most recent content-group change, when one has occurred. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (content_group_id),
    UNIQUE KEY content_groups_name (name),
    KEY content_groups_order (archived_at_utc, sort_position, content_group_id),
    CONSTRAINT content_groups_name_length CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 200)
) ENGINE=InnoDB COMMENT='Defines the named groups that organize the user''s content catalog. One row represents one content group. Every content item belongs to exactly one content group. sort_position controls group presentation order without changing stable group identifiers. Sensitivity: Group names may reveal private content plans and interests.';

CREATE TABLE journal_groups (
    -- sourceOfTruth: true
    -- synonyms: ["tracker groups", "journal categories"]
    -- keywords: ["journal group", "tracker group", "category", "health"]

    journal_group_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for one personal-journal group.',
    name             VARCHAR(200) NOT NULL COMMENT 'Complete human-facing name of the group. Unique without regard to letter case. Sensitivity: May identify a private area of activity or health.',
    archived_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp when this group was archived, or null while it is active. Format: ISO 8601 UTC timestamp.',
    created_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this group was created. Format: ISO 8601 UTC timestamp.',
    updated_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent change to this group, when changed. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (journal_group_id),
    UNIQUE KEY journal_groups_name (name),
    CONSTRAINT journal_groups_name_length CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 200)
) ENGINE=InnoDB COMMENT='Defines broad named groups that organize the user''s personal trackers. One row represents one organizational group such as Health, Home, or General. Groups organize trackers but do not identify individual observations. Group names are unique without regard to letter case. Sensitivity: Group names may reveal private areas of the user''s life and health.';

CREATE TABLE interaction_guides (
    -- sourceOfTruth: true
    -- synonyms: ["conversation guides", "guided interactions", "interaction plans"]
    -- keywords: ["guide", "structured interaction", "check-in", "briefing", "summary", "review"]

    interaction_guide_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for one interaction guide.',
    name                  VARCHAR(200) NOT NULL COMMENT 'User-facing unique name used to select the guide without loading its text. Names are unique without regard to letter case.',
    status                ENUM('active', 'archived') NOT NULL DEFAULT 'active' COMMENT 'Lifecycle state controlling whether the guide is available for new guided interactions. active: The guide is available to inspect, edit, start, and link from a repeating to-do. archived: The guide is retained as history but unavailable for new links or starts.',
    version               BIGINT NOT NULL DEFAULT 1 COMMENT 'Monotonically increasing optimistic-concurrency version for agent and UI edits. Units: revision number. An update or archive must match the current version and increments it on success.',
    created_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                          DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the interaction guide was created. Format: ISO 8601 UTC timestamp.',
    updated_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent successful guide update or archival, when one has occurred. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (interaction_guide_id),
    UNIQUE KEY interaction_guides_name (name),
    KEY interaction_guides_status_name (status, name, interaction_guide_id),
    CONSTRAINT interaction_guides_name_length CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 200),
    CONSTRAINT interaction_guides_version CHECK (version > 0)
) ENGINE=InnoDB COMMENT='Stores named, versioned containers for durable user-owned structured interactions. One row represents one named interaction guide whose complete interaction content is defined by its numbered steps. Numbered steps are loaded only when the user explicitly asks to use, inspect, or change that exact guide. A guide describes an interaction but does not own a schedule or recurrence. A personal to-do may reference a guide directly. Sensitivity: Contains private preferences, questions, and instructions for the user''s personal interactions with the agent.';

CREATE TABLE todo_groups (
    -- sourceOfTruth: true
    -- synonyms: ["todo groups", "task groups", "projects"]
    -- keywords: ["group", "project", "inbox", "watch jobs"]
    -- uses_sequence synonyms: ["auto sequence", "sequenced group"]
    -- uses_sequence keywords: ["sequence", "next number", "increment"]

    todo_group_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable internal identifier for one personal to-do group.',
    name              VARCHAR(255) NOT NULL COMMENT 'Complete human-facing name of the group; the schema intentionally has no separate description. Unique without regard to letter case. Sensitivity: May identify a private project or area of responsibility.',
    archived_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when the group was archived; null while the group is active. Format: ISO 8601 UTC timestamp.',
    created_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                      DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC instant when the group record was created. Format: ISO 8601 UTC timestamp.',
    updated_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant of the group record’s most recent material update; null until first updated. Format: ISO 8601 UTC timestamp.',
    sort_position     BIGINT NOT NULL DEFAULT 0 COMMENT 'Mutable presentation order used to place this group and all of its tasks in the to-do list. Lower values appear first; moving a group does not change task membership or task order within the group.',
    uses_sequence     TINYINT NOT NULL DEFAULT 0 COMMENT 'Whether this group automatically assigns the next unique positive sequence number to tasks added without one. 0: Sequence numbers are optional and are not assigned automatically. 1: Unnumbered tasks receive the next number after the group''s current maximum. Disabling automatic sequencing preserves numbers already assigned.',
    PRIMARY KEY (todo_group_id),
    UNIQUE KEY todo_groups_name (name),
    KEY todo_groups_order (archived_at_utc, sort_position, todo_group_id),
    CONSTRAINT todo_groups_sequence CHECK (uses_sequence IN (0, 1))
) ENGINE=InnoDB COMMENT='Defines the named groups that organize the user''s one authoritative personal To-Do List. One row represents one named task group, such as Inbox or Watches. Groups are named containers, not tasks and not a second hierarchy. Group names are unique without regard to letter case. When uses_sequence is 1, a newly inserted task with no sequence receives max(sequence) + 1 within this group; when it is 0, sequence remains optional. Sensitivity: Group names may reveal the user''s private projects and areas of responsibility.';

CREATE TABLE trackers (
    -- sourceOfTruth: true
    -- synonyms: ["tracked subjects", "personal trackers", "journal types"]
    -- keywords: ["tracker", "track", "journaling", "measurement", "observation"]
    -- fk:trackers_group meaning: Connects this tracker to the group that organizes it.
    -- fk:trackers_group cardinality: Each tracker belongs to exactly one journal group; one journal group may contain many trackers.
    -- fk:trackers_group importantRules: ["A group containing trackers cannot be deleted through this restricted relationship."]

    tracker_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for one personal tracker.',
    journal_group_id     BIGINT UNSIGNED NOT NULL COMMENT 'Organizational group containing this tracker.',
    name             VARCHAR(200) NOT NULL COMMENT 'Complete human-facing name of the tracked subject. Unique globally without regard to letter case. Sensitivity: May name a private health condition, habit, medication, or activity.',
    unit             VARCHAR(100) NOT NULL COMMENT 'Canonical unit shared by every numeric entry in this tracker''s trend series. Required for every tracker; event-style trackers use an explicit count such as occurrence or dose. The set me value is a migration review marker, not a real measurement unit. After numeric entries exist, changing this unit would reinterpret history and is rejected unless the old value is set me.',
    archived_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp when tracking was archived, or null while the tracker is active. Format: ISO 8601 UTC timestamp.',
    created_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this tracker was first defined. Format: ISO 8601 UTC timestamp.',
    updated_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent change to this tracker, when changed. Format: ISO 8601 UTC timestamp.',
    asking_starts_at_utc VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'First logging period start. Null with the other asking fields disables scheduled questions. Format: ISO 8601 UTC timestamp.',
    asking_recurrence_rule VARCHAR(2000) COMMENT 'RRULE defining logging period starts. One observation in a period satisfies its question; only the latest due period is asked automatically.',
    asking_time_zone VARCHAR(100) COMMENT 'IANA time zone preserving local logging period boundaries across daylight saving changes.',
    PRIMARY KEY (tracker_id),
    CONSTRAINT trackers_asking_schedule CHECK (
      (asking_starts_at_utc IS NULL AND asking_recurrence_rule IS NULL AND asking_time_zone IS NULL)
      OR (asking_starts_at_utc IS NOT NULL AND asking_recurrence_rule IS NOT NULL AND asking_time_zone IS NOT NULL)
    ),

    UNIQUE KEY trackers_name (name),
    KEY trackers_group_name (journal_group_id, archived_at_utc, name),
    CONSTRAINT trackers_group FOREIGN KEY (journal_group_id) REFERENCES journal_groups(journal_group_id) ON DELETE RESTRICT,
    CONSTRAINT trackers_name_length CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 200),
    CONSTRAINT trackers_unit_length CHECK (CHAR_LENGTH(TRIM(unit)) BETWEEN 1 AND 100)
) ENGINE=InnoDB COMMENT='Defines the reusable subjects under which the user records personal observations over time. One row represents one globally named tracked subject, such as Weight, Bowel movement, Mood, or Medication. Tracker names are globally unique without regard to letter case so a natural-language journal request has one unambiguous target. Every tracker has one canonical unit shared by its complete numeric series. The migration marker set me must be replaced before another entry is recorded. A canonical unit cannot be changed after numeric entries exist, except when replacing the set me migration marker. Sensitivity: Tracker names may reveal private health conditions, habits, medications, or other personal interests.';

CREATE TABLE calendar_routines (
    -- sourceOfTruth: true
    -- synonyms: ["recurring calendar patterns", "repeating events"]
    -- keywords: ["calendar routine", "routine", "repeat", "daily", "weekly", "monthly", "yearly"]
    -- fk:calendar_routines_source meaning: Links the routine definition to the activity event that created it.
    -- fk:calendar_routines_source cardinality: Each routine references zero or one activity event; one activity event may be referenced by many routines.
    -- fk:calendar_routines_source importantRules: ["Deleting the activity event preserves the routine and clears this optional reference."]

    calendar_routine_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable identifier for one reusable temporal pattern that generates concrete calendar events.',
    title                TEXT NOT NULL COMMENT 'Default human-readable title copied to generated calendar events.',
    description          LONGTEXT COMMENT 'Optional default description copied to generated calendar events.',
    location_text        TEXT COMMENT 'Optional default location copied to generated calendar events.',
    first_starts_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'UTC start instant anchoring the recurrence rule. Format: ISO 8601 UTC timestamp.',
    first_ends_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Optional UTC end instant for the first occurrence; its duration is preserved for generated events. Format: ISO 8601 UTC timestamp.',
    time_zone            VARCHAR(255) NOT NULL COMMENT 'IANA time-zone name preserving local recurrence times across daylight-saving changes.',
    is_all_day           TINYINT NOT NULL DEFAULT 0 COMMENT '1 when generated events represent calendar days rather than precise clock times; otherwise 0.',
    recurrence_rule      TEXT NOT NULL COMMENT 'RFC 5545 RRULE defining when concrete calendar events are generated.',
    disabled_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when this routine stopped generating events; null while enabled.',
    planning_prompt_text TEXT COMMENT 'Optional proactive planning question copied to generated calendar events.',
    source_event_id      VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Activity event that created this calendar routine when known.',
    created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC instant when this routine was created.',
    updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant of the latest material update.',
    PRIMARY KEY (calendar_routine_id),
    KEY calendar_routines_start (first_starts_at_utc, disabled_at_utc),
    CONSTRAINT calendar_routines_source FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT calendar_routines_all_day CHECK (is_all_day IN (0, 1)),
    CONSTRAINT calendar_routines_ends CHECK (first_ends_at_utc IS NULL OR first_ends_at_utc >= first_starts_at_utc),
    CONSTRAINT calendar_routines_prompt CHECK (planning_prompt_text IS NULL OR CHAR_LENGTH(TRIM(planning_prompt_text)) BETWEEN 1 AND 10000)
) ENGINE=InnoDB COMMENT='Defines reusable temporal patterns that generate concrete calendar events in bounded ranges. Calendar routines never create to-dos and are never advanced by task completion. One row is one recurrence definition; generated occurrences are ordinary calendar_events rows linked by calendar_routine_id and routine_occurrence_key.';

CREATE TABLE calendar_events (
    -- sourceOfTruth: true
    -- synonyms: ["appointments", "schedule entries"]
    -- keywords: ["calendar", "event", "appointment", "meeting", "schedule", "scheduled", "commitment"]
    -- title keywords: ["event name", "appointment name", "meeting name"]
    -- description keywords: ["event details", "appointment notes"]
    -- location_text keywords: ["where is the event", "meeting location"]
    -- starts_at_utc keywords: ["when does it start", "start time", "appointment time"]
    -- ends_at_utc keywords: ["when does it end", "end time"]
    -- planning_prompt_text synonyms: ["planning question"]
    -- planning_prompt_text keywords: ["plan", "proactive question", "blank time"]
    -- planning_prompt_text examples: ["What should we do during these four hours with the kids?"]
    -- fk:calendar_events_source meaning: Connects this calendar event to the observable event identified by source_event_id.
    -- fk:calendar_events_source cardinality: Each calendar event may reference zero or one observable event; one referenced record may be used by many calendar event records.
    -- fk:calendar_events_source importantRules: ["Deleting the referenced row preserves this row and clears the reference."]
    -- fk:calendar_events_routine meaning: Identifies the optional calendar routine that generated this concrete event occurrence.
    -- fk:calendar_events_routine cardinality: Each generated event references exactly one calendar routine; one routine may generate many events.
    -- fk:calendar_events_routine importantRules: ["A routine cannot be deleted while generated event history references it."]

    calendar_event_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this calendar event.',
    calendar_routine_id BIGINT UNSIGNED COMMENT 'Optional calendar routine that generated this concrete event occurrence.',
    routine_occurrence_key VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Original UTC occurrence start from the generating routine. Null for events not generated by a calendar routine.',
    ical_uid            VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Persistent iCalendar UID used to identify an imported event or recurrence family and prevent duplicate imports. Format: RFC 5545 UID text. This identifies imported calendar data; it does not identify a separate calendar.',
    ical_recurrence_id  VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Original iCalendar recurrence-instance identifier distinguishing this materialized occurrence within the shared UID. Format: RFC 5545 RECURRENCE-ID text. Together with ical_uid, this value prevents duplicate imports of the same recurring occurrence.',
    title               TEXT NOT NULL COMMENT 'Human-readable event name shown on the calendar.',
    description         LONGTEXT COMMENT 'Complete available description or notes for the event.',
    location_text       TEXT COMMENT 'Human-readable physical, virtual, or meeting location.',
    starts_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'UTC instant when the event starts. Format: ISO 8601 UTC timestamp.',
    ends_at_utc         VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when the event ends, when an end is known. Format: ISO 8601 UTC timestamp.',
    time_zone           VARCHAR(255) COMMENT 'IANA or provider time-zone name used to display the event in its intended local time.',
    is_all_day          TINYINT NOT NULL DEFAULT 0 COMMENT '1 when the event represents a calendar day rather than a precise time; otherwise 0. Format: MariaDB boolean: 0=false, 1=true.',
    status              ENUM('tentative', 'confirmed', 'cancelled') NOT NULL DEFAULT 'confirmed' COMMENT 'Current scheduling state of the event. Format: RFC 5545 VEVENT status. tentative: Event is proposed but not firmly confirmed. confirmed: Event is scheduled to occur. cancelled: Event will not occur. Calendar events happen; completion is represented only by the passage of time, not a stored event status.',
    recurrence_rule     TEXT COMMENT 'iCalendar RRULE describing how the event repeats.',
    source_event_id     VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Ledger event that caused this calendar record to be created when known.',
    created_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                        DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this local calendar record was inserted. Format: ISO 8601 UTC timestamp.',
    updated_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the latest recorded change to this local calendar record. Format: ISO 8601 UTC timestamp.',
    planning_prompt_text TEXT COMMENT 'Optional question the agent should proactively ask to help the user decide how this scheduled time will be used. Format: Plain text question. Null means no proactive planning question is attached to this event.',
    -- ical_single_guard: Generated iCalendar UID used only for a non-recurring imported event so that the same single event cannot be stored twice. Format: Binary SHA-independent copy of ical_uid; null for recurrence instances. Database-generated value used by calendar_events_ical_single; applications must not write it.
    ical_single_guard   VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin
                        AS (IF(ical_uid IS NOT NULL AND ical_recurrence_id IS NULL, ical_uid, NULL)) PERSISTENT,
    PRIMARY KEY (calendar_event_id),
    UNIQUE KEY calendar_events_ical_occurrence (ical_uid, ical_recurrence_id),
    UNIQUE KEY calendar_events_ical_single (ical_single_guard),
    UNIQUE KEY calendar_events_routine_occurrence (calendar_routine_id, routine_occurrence_key),
    KEY calendar_events_start (starts_at_utc, status),
    CONSTRAINT calendar_events_routine FOREIGN KEY (calendar_routine_id) REFERENCES calendar_routines(calendar_routine_id) ON DELETE RESTRICT,
    CONSTRAINT calendar_events_source FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT calendar_events_all_day CHECK (is_all_day IN (0, 1)),
    CONSTRAINT calendar_events_routine_pair CHECK ((calendar_routine_id IS NULL) = (routine_occurrence_key IS NULL)),
    CONSTRAINT calendar_events_prompt CHECK (planning_prompt_text IS NULL OR CHAR_LENGTH(TRIM(planning_prompt_text)) BETWEEN 1 AND 10000)
) ENGINE=InnoDB COMMENT='Stores every concrete commitment and scheduled event in the user''s one authoritative agent calendar. A row may be independent, imported, or generated from calendar_routines. starts_at_utc and ends_at_utc are UTC instants; time_zone preserves the intended display zone. routine_occurrence_key preserves idempotent generation identity while edits may move the concrete event. planning_prompt_text is optional. Sensitivity: Contains the user''s private schedule, locations, participants, and imported calendar identifiers.';

CREATE TABLE calendar_event_exclusions (
    -- sourceOfTruth: true
    -- derivedFrom: ["calendar_events"]
    -- synonyms: ["recurrence exclusions", "EXDATE values"]
    -- keywords: ["calendar", "recurrence", "excluded date", "exception"]
    -- fk:calendar_event_exclusions_event meaning: Each exclusion belongs to exactly one recurring calendar event; an event may own many exclusions.
    -- fk:calendar_event_exclusions_event cardinality: many-to-one
    -- fk:calendar_event_exclusions_event importantRules: ["Deleting the parent event deletes its exclusions."]

    calendar_event_id       BIGINT UNSIGNED NOT NULL COMMENT 'Recurring calendar event whose generated occurrence is omitted. The referenced event supplies the recurrence rule.',
    excluded_starts_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'UTC start instant of the recurrence instance that must not be generated or displayed. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (calendar_event_id, excluded_starts_at_utc),
    KEY calendar_event_exclusions_start (excluded_starts_at_utc, calendar_event_id),
    CONSTRAINT calendar_event_exclusions_event FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Records individual recurrence instances omitted from a repeating calendar event. One row excludes one generated occurrence from one recurring calendar event. A recurring event may have any number of excluded occurrences; never collapse them into one delimited or JSON field. Values are normalized UTC instants used when expanding the parent event''s recurrence rule. Sensitivity: Reveals changes and omissions in the user''s private schedule.';

CREATE TABLE calendar_event_contacts (
    -- sourceOfTruth: true
    -- synonyms: ["calendar participants", "event contacts"]
    -- keywords: ["event participant", "meeting attendee", "calendar contact", "invited", "accepted invitation"]
    -- fk:calendar_event_contacts_contact meaning: Connects this calendar participant assignment to the contact identified by contact_id.
    -- fk:calendar_event_contacts_contact cardinality: Each calendar participant assignment references exactly one contact; one referenced record may be used by many calendar participant assignment records.
    -- fk:calendar_event_contacts_contact importantRules: ["Deleting the referenced row also deletes this dependent row."]
    -- fk:calendar_event_contacts_event meaning: Connects this calendar participant assignment to the calendar event identified by calendar_event_id.
    -- fk:calendar_event_contacts_event cardinality: Each calendar participant assignment references exactly one calendar event; one referenced record may be used by many calendar participant assignment records.
    -- fk:calendar_event_contacts_event importantRules: ["Deleting the referenced row also deletes this dependent row."]

    calendar_event_id  BIGINT UNSIGNED NOT NULL COMMENT 'Calendar event in which the contact participates.',
    contact_id         BIGINT UNSIGNED NOT NULL COMMENT 'Contact participating in the calendar event.',
    participant_role   ENUM('organizer', 'attendee', 'customer', 'other') NOT NULL DEFAULT 'attendee' COMMENT 'Role the contact has in the event. organizer: Contact organizes or owns the event. attendee: Contact is invited or attending. customer: Contact participates as the customer associated with the event. other: A meaningful participant role not covered by the named values.',
    response_status    VARCHAR(64) COMMENT 'Provider or user response such as accepted, declined, tentative, or needs action when known.',
    PRIMARY KEY (calendar_event_id, contact_id, participant_role),
    CONSTRAINT calendar_event_contacts_event FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE,
    CONSTRAINT calendar_event_contacts_contact FOREIGN KEY (contact_id) REFERENCES contacts(contact_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Associates contacts with calendar events while preserving each contact''s participant role and response. One row states that one contact participates in one calendar event in one specific role. The same contact may appear more than once on an event only when the participant role differs. Sensitivity: May reveal a person''s schedule, attendance, and relationship to an event.';

CREATE TABLE interaction_guide_steps (
    -- sourceOfTruth: true
    -- synonyms: ["structured conversation steps", "scripted questions", "interaction prompts"]
    -- keywords: ["numbered step", "opening question", "answers", "structured interaction"]
    -- contract_json synonyms: ["exchange contract", "destination contract"]
    -- contract_json keywords: ["instructions", "inputs", "operations", "recovery reads", "completion"]
    -- progress_state keywords: ["resume state", "step progress"]
    -- fk:interaction_guide_steps_guide meaning: Each numbered step belongs to exactly one interaction guide; deleting a guide deletes its child step definitions.
    -- fk:interaction_guide_steps_guide cardinality: many interaction_guide_steps to one interaction_guides
    -- fk:interaction_guide_steps_guide importantRules: ["Definition tools update the parent guide version in the same transaction as a child step change."]

    interaction_guide_step_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for one numbered interaction-guide step.',
    interaction_guide_id       BIGINT UNSIGNED NOT NULL COMMENT 'Identifier of the parent interaction guide that owns this step and its definition version.',
    step_number                BIGINT NOT NULL COMMENT 'Positive user-facing number ordering this step within its guide. Units: ordinal number. Format: positive integer. Numbers may contain gaps; completion advances to the next higher enabled number rather than assuming current plus one.',
    opening_text               TEXT NOT NULL COMMENT 'Fixed opening text that begins this step every time it becomes current. Present this text literally rather than asking the model to paraphrase it.',
    contract_json              LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
                               DEFAULT '{"version":1,"instructions":null,"inputs":[],"operations":[],"recoveryReads":[],"completion":{"mode":"response_valid"}}' COMMENT 'Versioned JSON contract containing optional explanatory instructions plus authoritative typed inputs, exact destination operations and argument bindings, bounded recovery reads, and the completion rule. Format: JSON object, contract version 1, at most 200000 characters. Free-text instructions may explain structured fields but cannot introduce undeclared inputs, tools, destinations, recovery actions, or completion requirements. Every destination mutation names its exact application tool and argument template in operations. The completion mode is contract data, not a separate exchange column. Sensitivity: May contain private workflow instructions and destination identifiers.',
    answers_json               LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '{}' COMMENT 'JSON object containing answers the user has actually supplied for this step in the current run, keyed by concise stable answer names. Format: JSON object, at most 100000 characters. Merge partial answers without discarding answers already collected in the active run. A completed run clears this object only after that run''s progress has been retained in activity_events. Answers do not replace business validation or successful receipts from the tools that own destination data. Sensitivity: Contains private user answers that may span any domain covered by the structured interaction.',
    enabled                    TINYINT NOT NULL DEFAULT 1 COMMENT 'Whether new and active runs include this step when selecting the current and next higher numbered step. 0: The definition is retained but skipped by runs. 1: The step participates in runs.',
    created_at_utc             VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                               DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this numbered interaction-guide step was created. Format: ISO 8601 UTC timestamp.',
    updated_at_utc             VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent definition or current-answer update to this step, when one has occurred. Format: ISO 8601 UTC timestamp.',
    progress_state             ENUM('pending', 'active', 'completed') NOT NULL DEFAULT 'pending' COMMENT 'Current-run progress for this step, used to resume an interrupted structured interaction at exactly one active step. pending: The current run has not yet completed this step. active: This is the current step to present or continue. completed: The current run completed this step and advanced beyond it. The interaction-guide service owns transitions; definition tools do not write this field directly. Run completion or explicit cancellation resets current progress only after immutable history is retained in activity_events.',
    PRIMARY KEY (interaction_guide_step_id),
    UNIQUE KEY interaction_guide_steps_number (interaction_guide_id, step_number),
    KEY interaction_guide_steps_guide_order (interaction_guide_id, enabled, step_number),
    KEY interaction_guide_steps_guide_progress (interaction_guide_id, progress_state, enabled, step_number),
    CONSTRAINT interaction_guide_steps_guide FOREIGN KEY (interaction_guide_id) REFERENCES interaction_guides(interaction_guide_id) ON DELETE CASCADE,
    CONSTRAINT interaction_guide_steps_step CHECK (step_number > 0),
    CONSTRAINT interaction_guide_steps_opening CHECK (CHAR_LENGTH(TRIM(opening_text)) BETWEEN 1 AND 10000),
    CONSTRAINT interaction_guide_steps_contract CHECK (JSON_VALID(contract_json)),
    CONSTRAINT interaction_guide_steps_answers CHECK (JSON_VALID(answers_json)),
    CONSTRAINT interaction_guide_steps_enabled CHECK (enabled IN (0, 1))
) ENGINE=InnoDB COMMENT='Stores each reusable exchange''s literal opening, authoritative structured contract, current answers, and resumable progress. One row is one complete numbered interaction step and its mutable current-run state. The parent interaction_guides.version is the only definition concurrency version and increments when any exchange definition changes. The contract''s structured inputs, operations, recovery reads, and completion rule are authoritative; explanatory instructions cannot introduce undeclared behavior. A run remains on its current exchange until the contract completion rule is satisfied, then advances to the next higher enabled number. Completing a run preserves its progress in activity_events, then immediately resets answers_json and progress_state for the next run. Generic database reads and writes must not expose or mutate these private rows; use the owning interaction-guide tools. Sensitivity: Contains private scripted openings, reusable execution contracts, and the user''s current answers.';

CREATE TABLE todo_personal (
    -- sourceOfTruth: true
    -- synonyms: ["personal to-dos", "to-do list", "tasks"]
    -- keywords: ["todo", "to-do", "task", "complete", "sequence"]
    -- planning_prompt_text synonyms: ["planning question"]
    -- planning_prompt_text keywords: ["plan", "unplanned", "proactive question"]
    -- planning_prompt_text examples: ["What do we want to do while we have the kids this afternoon?"]
    -- fk:todo_personal_contact_fk meaning: Associates a personal task with the optional contact it concerns without assigning task ownership.
    -- fk:todo_personal_contact_fk cardinality: Each task references zero or one contact; one contact may be referenced by multiple tasks.
    -- fk:todo_personal_contact_fk importantRules: ["Deleting a contact preserves the task and clears this optional reference."]
    -- fk:todo_personal_group meaning: Places each personal task in its required to-do group.
    -- fk:todo_personal_group cardinality: Each task belongs to exactly one group; one group may contain multiple tasks.
    -- fk:todo_personal_group importantRules: ["A group cannot be deleted while tasks still belong to it."]
    -- fk:todo_personal_guide meaning: Associates this personal to-do with an optional interaction guide offered when work begins.
    -- fk:todo_personal_guide cardinality: Each to-do references zero or one interaction guide; one guide may be used by many to-dos.
    -- fk:todo_personal_guide importantRules: ["Deleting the guide preserves the to-do and clears this optional reference."]
    -- fk:todo_personal_source meaning: Links a personal task to the optional observable activity event that created or imported it.
    -- fk:todo_personal_source cardinality: Each task references zero or one source event; one event may create multiple tasks.
    -- fk:todo_personal_source importantRules: ["Deleting an activity event preserves the task and clears this optional reference."]

    personal_task_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable internal identifier for one personal task.',
    todo_group_id        BIGINT UNSIGNED NOT NULL COMMENT 'Required group that contains and orders this personal task.',
    sequence             BIGINT COMMENT 'Stable positive number that identifies this task within its group when that group uses numbered work. Units: sequence number. Unique within todo_group_id when present; unlike sort_position, it does not change when the list is reordered.',
    related_contact_id   BIGINT UNSIGNED COMMENT 'Optional contact that this task concerns; it does not assign ownership of the task.',
    text                 TEXT NOT NULL COMMENT 'Complete wording of the task, serving as both its short label and any longer explanation. Sensitivity: May contain private plans, names, and instructions.',
    status               ENUM('unplanned', 'todo', 'complete', 'ignore', 'archive', 'ai_suggested') NOT NULL DEFAULT 'todo' COMMENT 'Compact lifecycle state controlling whether and how the task appears in the user''s list. unplanned: The item is active but still needs a concrete plan. todo: the user intends to do this task. complete: The task was finished. ignore: The task was intentionally skipped without completion. archive: The task is retained as history but removed from ordinary views. ai_suggested: The agent proposed the task and the user has not yet accepted or dismissed it.',
    sort_position        BIGINT NOT NULL DEFAULT 0 COMMENT 'Mutable ordering value used to place tasks directly within a group; it conveys no importance or priority. Lower values appear first within the same group.',
    completed_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when the task entered complete status; null for tasks not currently complete. Format: ISO 8601 UTC timestamp.',
    source               VARCHAR(255) COMMENT 'Optional stable name of the system or workflow that supplied this task.',
    external_id          VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Optional identifier assigned by source; together with source it prevents duplicate imports or publications. Unique with source when both values are present.',
    source_event_id      VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Optional observable activity event that created or imported this task.',
    created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC instant when this task occurrence was created. Format: ISO 8601 UTC timestamp.',
    updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant of this task occurrence’s most recent material update; null until first updated. Format: ISO 8601 UTC timestamp.',
    interaction_guide_id BIGINT UNSIGNED COMMENT 'Optional interaction guide offered when the user starts this task. The task owns this association independently of calendar placement.',
    planning_prompt_text TEXT COMMENT 'Optional question the agent should proactively ask to help turn this task into a concrete plan. Format: Plain text question. Null means the task has no stored planning question. The field may be present on any task status and does not itself change the status.',
    PRIMARY KEY (personal_task_id),
    UNIQUE KEY todo_personal_group_sequence (todo_group_id, sequence),
    UNIQUE KEY todo_personal_source_external (source, external_id),
    KEY todo_personal_status (status, personal_task_id),
    KEY todo_personal_group_order (todo_group_id, sort_position, personal_task_id),
    KEY todo_personal_contact (related_contact_id, status),
    CONSTRAINT todo_personal_group FOREIGN KEY (todo_group_id) REFERENCES todo_groups(todo_group_id) ON DELETE RESTRICT,
    CONSTRAINT todo_personal_contact_fk FOREIGN KEY (related_contact_id) REFERENCES contacts(contact_id) ON DELETE SET NULL,
    CONSTRAINT todo_personal_guide FOREIGN KEY (interaction_guide_id) REFERENCES interaction_guides(interaction_guide_id) ON DELETE SET NULL,
    CONSTRAINT todo_personal_source FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT todo_personal_sequence CHECK (sequence IS NULL OR sequence > 0),
    CONSTRAINT todo_personal_prompt CHECK (planning_prompt_text IS NULL OR CHAR_LENGTH(TRIM(planning_prompt_text)) BETWEEN 1 AND 10000)
) ENGINE=InnoDB COMMENT='Stores actionable and historical records in the user’s authoritative personal To-Do List. To-dos have no scheduling, deadline, duration, all-day, or recurrence fields; all temporal placement belongs to calendar events. Every task belongs to one group and may be linked to any number of calendar events through calendar_events_todo_join. completed_at_utc records task lifecycle history. Sensitivity: Contains the user''s private tasks, plans, relationships, and source references.';

CREATE TABLE calendar_events_todo_join (
    -- sourceOfTruth: true
    -- synonyms: ["calendar to-do links", "event task links"]
    -- keywords: ["calendar event", "to-do", "task", "work time", "deadline", "context"]
    -- fk:calendar_events_todo_join_event meaning: Associates one concrete calendar event with a relevant personal to-do.
    -- fk:calendar_events_todo_join_event cardinality: many calendar_events_todo_join to one calendar_events; one event may have many associations
    -- fk:calendar_events_todo_join_event importantRules: ["Deleting the event deletes only its association rows."]
    -- fk:calendar_events_todo_join_task meaning: Associates one personal to-do with a concrete calendar event that supplies work time, a deadline, or context.
    -- fk:calendar_events_todo_join_task cardinality: many calendar_events_todo_join to one todo_personal; one to-do may have many associated events
    -- fk:calendar_events_todo_join_task importantRules: ["Deleting the to-do deletes only its association rows."]

    calendar_event_id BIGINT UNSIGNED NOT NULL COMMENT 'Concrete calendar event associated with the task.',
    personal_task_id BIGINT UNSIGNED NOT NULL COMMENT 'Existing personal to-do associated with the calendar event.',
    relationship_kind ENUM('work', 'deadline', 'context') NOT NULL DEFAULT 'context' COMMENT 'Meaning of this event-to-task association. work: scheduled working time. deadline: the event represents a deadline. context: the task is relevant to the event without stronger timing semantics.',
    created_at_utc VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
        DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the association was created.',
    PRIMARY KEY (calendar_event_id, personal_task_id),
    KEY calendar_events_todo_join_task (personal_task_id, calendar_event_id),
    CONSTRAINT calendar_events_todo_join_event FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE,
    CONSTRAINT calendar_events_todo_join_task FOREIGN KEY (personal_task_id) REFERENCES todo_personal(personal_task_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Links concrete calendar events to personal to-dos. Either side may have many links. Deleting either parent removes only its association rows. Calendar events own all temporal facts; to-dos own work and completion state.';

CREATE TABLE catch_up_questions (
    question_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable identifier for a generated question about exactly one existing domain record.',
    calendar_event_id BIGINT UNSIGNED COMMENT 'Actual calendar event or recurring series being reviewed. Exactly one source foreign key must be present; occurrence_key distinguishes instances of a series.',
    tracker_id BIGINT UNSIGNED COMMENT 'Actual journal tracker whose current scheduled logging period needs an observation.',
    occurrence_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Stable source-owned identity: event for a one-time event, an ISO UTC calendar occurrence, or a journal logging-period start.',
    source_version CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'SHA-256 of material source data used to generate this question. Prevents stale answers and reopens questions when the relevant source data changes.',
    question_text VARCHAR(2000) NOT NULL COMMENT 'Code-generated question grounded in the linked source record. This is data, never an instruction or permission grant.',
    due_at_utc VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Source-derived instant from which this question is eligible. Format: ISO 8601 UTC timestamp.',
    ask_after VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Explicit user deferral. A question is eligible only after both due_at_utc and this instant. Null means no deferral.',
    resolved_at VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'When this occurrence was addressed or reconciled as no longer requiring an answer. Null means unresolved; this does not replace the source record status.',
    comment TEXT COMMENT 'Optional user-supplied outcome or explanation about this source occurrence. No transcript is needed to interpret resolution.',
    version BIGINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Optimistic concurrency version incremented whenever question state changes.',
    PRIMARY KEY (question_id),
    UNIQUE KEY catch_up_event_occurrence (calendar_event_id, occurrence_key),
    UNIQUE KEY catch_up_tracker_period (tracker_id, occurrence_key),
    KEY catch_up_due (resolved_at, due_at_utc, ask_after),
    CONSTRAINT catch_up_event FOREIGN KEY (calendar_event_id) REFERENCES calendar_events (calendar_event_id) ON DELETE CASCADE,
    CONSTRAINT catch_up_tracker FOREIGN KEY (tracker_id) REFERENCES trackers (tracker_id) ON DELETE CASCADE,
    CONSTRAINT catch_up_one_source CHECK ((calendar_event_id IS NOT NULL) + (tracker_id IS NOT NULL) = 1),
    CONSTRAINT catch_up_question_text CHECK (CHAR_LENGTH(TRIM(question_text)) > 0)
) ENGINE=InnoDB COMMENT='On-demand questions generated from calendar occurrences and journal tracker periods. To-dos are intentionally non-temporal and do not independently create catch-up deadlines. Source foreign keys and live domain data drive questions and reconciliation; conversations are only an interface. Sensitivity: Contains private commitments and user comments.';

CREATE TABLE reminders (
    -- sourceOfTruth: true
    -- synonyms: ["alarms", "notifications"]
    -- keywords: ["reminder", "remind me", "alarm", "notification", "notify", "alert"]
    -- title keywords: ["reminder text", "what to remind"]
    -- remind_at_utc keywords: ["reminder time", "when to remind"]
    -- fk:reminders_event meaning: Connects this reminder to the calendar event identified by calendar_event_id.
    -- fk:reminders_event cardinality: Each reminder may reference zero or one calendar event; one referenced record may be used by many reminder records.
    -- fk:reminders_event importantRules: ["Deleting the referenced row also deletes this dependent row."]
    -- fk:reminders_task meaning: Connects a reminder to the optional personal task occurrence it is intended to surface.
    -- fk:reminders_task cardinality: Each reminder may reference zero or one personal task; one task may have multiple reminders.
    -- fk:reminders_task importantRules: ["Deleting the referenced task also deletes its dependent reminder."]

    reminder_id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this reminder.',
    calendar_event_id    BIGINT UNSIGNED COMMENT 'Calendar event whose timing or commitment this reminder supports, when applicable.',
    personal_task_id     BIGINT UNSIGNED COMMENT 'Optional personal task whose reminder lifecycle this row serves. Deleting the task also deletes its subordinate reminder.',
    title                TEXT COMMENT 'Human-readable notification text or reminder name.',
    remind_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'UTC instant at or after which the reminder becomes due for delivery. Format: ISO 8601 UTC timestamp.',
    delivery_method      ENUM('agent', 'webhook', 'notification', 'email', 'sms', 'other') NOT NULL DEFAULT 'agent' COMMENT 'Mechanism through which the reminder should be delivered. agent: Agent surfaces the reminder through its normal interaction channel. webhook: HTTP webhook receives the reminder. notification: Device or browser notification. email: Email delivery. sms: SMS delivery. other: Delivery mechanism not covered by the named values.',
    delivery_target      TEXT COMMENT 'Method-specific destination such as an address, number, endpoint, or device when needed.',
    status               ENUM('pending', 'processing', 'delivered', 'snoozed', 'cancelled', 'error') NOT NULL DEFAULT 'pending' COMMENT 'Current delivery lifecycle state of the reminder. pending: Waiting for remind_at_utc or delivery processing. processing: A delivery attempt is active. delivered: Delivery succeeded. snoozed: Delivery was postponed to a later time. cancelled: Reminder should not be delivered. error: Most recent delivery attempt failed and may need retry or correction.',
    attempt_count        BIGINT NOT NULL DEFAULT 0 COMMENT 'Number of delivery attempts already made.',
    last_attempt_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time of the most recent delivery attempt. Format: ISO 8601 UTC timestamp.',
    delivered_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time successful delivery was recorded. Format: ISO 8601 UTC timestamp.',
    error_text           LONGTEXT COMMENT 'Most recent observable delivery error when status is error.',
    created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the reminder was inserted. Format: ISO 8601 UTC timestamp.',
    updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the latest recorded change to the reminder. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (reminder_id),
    KEY reminders_due (status, remind_at_utc),
    CONSTRAINT reminders_event FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE,
    CONSTRAINT reminders_task FOREIGN KEY (personal_task_id) REFERENCES todo_personal(personal_task_id) ON DELETE CASCADE,
    CONSTRAINT reminders_attempt CHECK (attempt_count >= 0)
) ENGINE=InnoDB COMMENT='Stores when and how an alarm should be delivered and preserves observable delivery, retry, and error state. One row represents one standalone, calendar-linked, or personal-task-linked reminder and its delivery lifecycle. A reminder may link to a calendar event, a personal task, or neither. Delivery attempts must update attempt_count and the corresponding timing or error fields. Sensitivity: Contains private reminder text, linked commitments, delivery targets, payloads, and errors.';

CREATE TABLE journal_entries (
    -- sourceOfTruth: true
    -- synonyms: ["personal journal", "tracking entries", "observations"]
    -- keywords: ["journal", "track", "record", "weight", "health", "mood", "food", "import", "external record"]
    -- fk:journal_entries_event meaning: Connects this journal entry to the observable request event that created it.
    -- fk:journal_entries_event cardinality: Each journal entry may reference zero or one activity event; one activity event may create multiple journal entries.
    -- fk:journal_entries_event importantRules: ["Deleting the source event preserves the journal entry and clears this reference."]
    -- fk:journal_entries_tracker meaning: Connects this observation to the reusable tracker that gives it identity and organization.
    -- fk:journal_entries_tracker cardinality: Each journal entry belongs to exactly one tracker; one tracker may contain many journal entries.
    -- fk:journal_entries_tracker importantRules: ["A tracker with historical entries cannot be deleted through this restricted relationship."]

    journal_entry_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for one personal journal entry.',
    tracker_id       BIGINT UNSIGNED NOT NULL COMMENT 'Tracker under which this observation is recorded.',
    occurred_at_utc  VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC instant when the recorded observation or event occurred. Format: ISO 8601 UTC timestamp. This may differ from created_at_utc when the user records something retrospectively.',
    content_text     TEXT NOT NULL COMMENT 'Complete self-contained natural-language content of the observation. Preserve supporting context here instead of fragmenting it into a separate note field. When a numeric projection exists, this text still remains the complete readable entry. Sensitivity: May contain private health, nutrition, behavioral, or situational context.',
    number_value     DOUBLE COMMENT 'Optional numeric projection extracted from the complete journal content for calculation, comparison, and trends. Null is valid for observations without a useful numeric component. Interpret this value using the parent tracker''s canonical unit.',
    source_event_id  VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Optional activity event for the user request that caused this journal entry to be recorded.',
    created_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                     DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this journal row was created. Format: ISO 8601 UTC timestamp.',
    updated_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the most recent modification to this journal row, when modified. Format: ISO 8601 UTC timestamp.',
    source           VARCHAR(200) NOT NULL DEFAULT 'agent-slayer' COMMENT 'Stable generic name of the application, export, or local path from which this journal entry originated. Use agent-slayer for ordinary native journal writes and a consistent source name for every page of one external import. Sensitivity: May identify a private external application or data export.',
    external_id      VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Optional stable record identifier assigned by source and used with source to make imports idempotent. Required by the generic import tool and null for ordinary native journal entries without an upstream identity. The pair of source and external_id is unique whenever external_id is present. Sensitivity: May expose an identifier from a private external data source.',
    PRIMARY KEY (journal_entry_id),
    UNIQUE KEY journal_entries_source_external (source, external_id),
    KEY journal_entries_tracker_occurred (tracker_id, occurred_at_utc, journal_entry_id),
    CONSTRAINT journal_entries_tracker FOREIGN KEY (tracker_id) REFERENCES trackers(tracker_id) ON DELETE RESTRICT,
    CONSTRAINT journal_entries_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT journal_entries_content CHECK (CHAR_LENGTH(TRIM(content_text)) BETWEEN 1 AND 10000),
    CONSTRAINT journal_entries_source_length CHECK (CHAR_LENGTH(TRIM(source)) BETWEEN 1 AND 200),
    CONSTRAINT journal_entries_external_length CHECK (external_id IS NULL OR CHAR_LENGTH(TRIM(external_id)) BETWEEN 1 AND 1000)
) ENGINE=InnoDB COMMENT='Stores the user''s authoritative time-stamped personal observations under reusable trackers. One row represents one complete personal observation with an optional numeric projection in its tracker''s canonical unit. content_text is the complete human-readable observation; number_value is an optional trend projection rather than a replacement for it. occurred_at_utc records when the observed event happened, while created_at_utc records when the row was saved. The parent tracker owns the single canonical unit for every number_value in its series; entries never duplicate a unit. For imported rows, the source and non-null external_id pair is a stable idempotency key and must never identify two different observations. Sensitivity: Contains private personal observations that may include health, nutrition, habits, symptoms, and daily activities.';

CREATE TABLE content_items (
    -- sourceOfTruth: true
    -- synonyms: ["content catalog", "media and references"]
    -- keywords: ["content", "article", "video", "podcast", "book", "reference material", "creator", "published", "watched", "read"]
    -- title keywords: ["content title", "article title", "video title", "book title"]
    -- transcript keywords: ["content transcript", "spoken words"]
    -- description keywords: ["summary", "what is it about"]
    -- personal_notes keywords: ["my thoughts", "my notes", "reaction"]
    -- fk:content_items_creator_fk meaning: Connects this content item to the contact identified by creator_contact_id.
    -- fk:content_items_creator_fk cardinality: Each content item may reference zero or one contact; one referenced record may be used by many content item records.
    -- fk:content_items_creator_fk importantRules: ["Deleting the referenced row preserves this row and clears the reference."]
    -- fk:content_items_event meaning: Connects this content item to the observable event identified by source_event_id.
    -- fk:content_items_event cardinality: Each content item may reference zero or one observable event; one referenced record may be used by many content item records.
    -- fk:content_items_event importantRules: ["Deleting the referenced row preserves this row and clears the reference."]
    -- fk:content_items_file meaning: Connects this content item to the stored-file record identified by primary_file_id.
    -- fk:content_items_file cardinality: Each content item may reference zero or one stored-file record; one referenced record may be used by many content item records.
    -- fk:content_items_file importantRules: ["Deleting the referenced row preserves this row and clears the reference."]
    -- fk:content_items_group meaning: Connects this content item to the content group identified by content_group_id.
    -- fk:content_items_group cardinality: Each content item references exactly one content group; one group may contain many content items.
    -- fk:content_items_group importantRules: ["A group cannot be deleted while content items still belong to it."]

    content_id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this content item.',
    content_group_id      BIGINT UNSIGNED NOT NULL COMMENT 'Content group that owns and organizes this item.',
    sequence              BIGINT COMMENT 'Stable positive number identifying this content item within its group when numbered organization is used. Units: sequence number. Unique within content_group_id when present; unlike content_group.sort_position, it identifies an item rather than presentation placement.',
    content_type          ENUM('mobileUGC_tutorial', 'mobileUGC_ad', 'webUGC_tutorial', 'webUGC_ad', 'video_ad', 'podcast', 'image', 'unknown') NOT NULL DEFAULT 'mobileUGC_tutorial' COMMENT 'Action-content format and production surface for this item. mobileUGC_tutorial: Mobile-app user-generated-style tutorial. mobileUGC_ad: Mobile-app user-generated-style advertisement. webUGC_tutorial: Web-app user-generated-style tutorial. webUGC_ad: Web-app user-generated-style advertisement. video_ad: Video advertisement outside the mobile or web UGC-specific formats. podcast: Podcast or spoken-audio content. image: Still image or graphic content. unknown: Content whose production format has not been identified.',
    title                 TEXT NOT NULL COMMENT 'Human-readable title of the work or source item.',
    transcript            LONGTEXT COMMENT 'Source speech or text transcribed or extracted from the content itself.',
    description           LONGTEXT COMMENT 'Summary or description of what the content is about.',
    published_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                          DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC publication time reported for the content when known. Format: ISO 8601 UTC timestamp.',
    content_host          ENUM('youtube', 'vimeo', 'spotify', 'mytlomdotcom', 'none') NOT NULL DEFAULT 'youtube' COMMENT 'Platform or service that hosts the published content. youtube: Hosted on YouTube. vimeo: Hosted on Vimeo. spotify: Hosted on Spotify. mytlomdotcom: Hosted on mytlom.com. none: The content has no external host.',
    content_status        ENUM('active', 'obsolete', 'unused', 'queued') NOT NULL DEFAULT 'active' COMMENT 'Current action-content lifecycle state. active: Content is current and available for use. obsolete: Content has been superseded and should not guide current work. unused: Content is retained but not currently used. queued: Content is awaiting production or publication.',
    content_url           TEXT COMMENT 'Canonical public or hosted URL for the content when one exists. Format: URL.',
    relationship_to_user  ENUM('mine', 'reference') NOT NULL DEFAULT 'mine' COMMENT 'Whether the item is the user''s authored or planned work or reference material from elsewhere. mine: the user''s authored, owned, planned, or produced content. reference: Material from another creator kept as a source or reference.',
    creator_contact_id    BIGINT UNSIGNED COMMENT 'Known person, organization, or service that created the content.',
    personal_notes        LONGTEXT COMMENT 'the user''s own reaction, interpretation, plan, or intended use for the content.',
    external_id           VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Identifier assigned to the item by its host or source system.',
    primary_file_id       BIGINT UNSIGNED COMMENT 'Main locally stored file representing this content item when one exists.',
    consumed_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time when the user finished or recorded consuming the reference material. Format: ISO 8601 UTC timestamp.',
    source_event_id       VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Ledger event that caused this content item to be created when known.',
    created_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                          DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this catalog record was inserted. Format: ISO 8601 UTC timestamp.',
    updated_at_utc        VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the latest recorded change to this catalog record. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (content_id),
    UNIQUE KEY content_items_group_sequence (content_group_id, sequence),
    KEY content_items_group_order (content_group_id, sequence, content_id),
    KEY content_items_creator (creator_contact_id, published_at_utc),
    KEY content_items_type_status (content_type, content_status),
    CONSTRAINT content_items_group FOREIGN KEY (content_group_id) REFERENCES content_groups(content_group_id) ON DELETE RESTRICT,
    CONSTRAINT content_items_creator_fk FOREIGN KEY (creator_contact_id) REFERENCES contacts(contact_id) ON DELETE SET NULL,
    CONSTRAINT content_items_file FOREIGN KEY (primary_file_id) REFERENCES files(file_id) ON DELETE SET NULL,
    CONSTRAINT content_items_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT content_items_sequence CHECK (sequence IS NULL OR sequence > 0)
) ENGINE=InnoDB COMMENT='Catalogs the user''s own content and reference material from other creators in one searchable structure. One row represents one work or source item, such as a video, book, article, podcast, image, document, course, or website. Every content item belongs to exactly one content group. sequence is an optional stable positive number unique within a content group. relationship_to_user distinguishes the user''s authored or planned work from reference material. transcript preserves source speech or text; personal_notes preserves the user''s reaction or intended use. Sensitivity: May contain private drafts, transcripts, reading history, personal notes, and source metadata.';

CREATE TABLE video_scripts (
    -- sourceOfTruth: true
    -- synonyms: ["AI video scripts", "video production briefs", "generator scripts"]
    -- keywords: ["video script", "generator prompt", "scene plan", "production brief"]
    -- fk:video_scripts_event meaning: Connects the script to the exact Agent Slayer request that authorized and created it.
    -- fk:video_scripts_event cardinality: Each script references at most one creating request event, and uniqueness permits one script per creating request.
    -- fk:video_scripts_event importantRules: ["Deleting the creating event preserves the script and clears this provenance reference."]

    video_script_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for the portable AI-video script.',
    title                VARCHAR(200) NOT NULL COMMENT 'Concise human-facing title for finding and copying the production script.',
    status               ENUM('draft', 'archived') NOT NULL DEFAULT 'draft' COMMENT 'Current user-facing lifecycle state of the script. draft: Active script available for review and use with an external generator. archived: Retained script hidden from the default active view.',
    schema_version       BIGINT NOT NULL DEFAULT 1 COMMENT 'Version of the structured script_json production-plan contract.',
    script_json          LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Complete structured production plan, including generator prompt, scenes, grounding references, continuity notes, and negative constraints. Format: JSON object encoded as text.',
    script_text          LONGTEXT NOT NULL COMMENT 'Complete copy-ready Markdown production script deterministically compiled from script_json at creation time. Format: Markdown.',
    created_by_event_id  VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Exact request-received ledger event whose authorized tool execution created this script.',
    created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC time when the script record was created. Format: ISO 8601 UTC timestamp.',
    updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time of the latest script lifecycle or content update. Format: ISO 8601 UTC timestamp.',
    archived_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time when the script was archived; null while it remains a draft. Format: ISO 8601 UTC timestamp.',
    version              BIGINT NOT NULL DEFAULT 1 COMMENT 'Monotonic optimistic-concurrency version for user-visible script changes. Units: revision.',
    PRIMARY KEY (video_script_id),
    UNIQUE KEY video_scripts_created_by (created_by_event_id),
    KEY video_scripts_status_created (status, created_at_utc, video_script_id),
    CONSTRAINT video_scripts_event FOREIGN KEY (created_by_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT video_scripts_title CHECK (CHAR_LENGTH(TRIM(title)) BETWEEN 1 AND 200),
    CONSTRAINT video_scripts_schema CHECK (schema_version = 1),
    CONSTRAINT video_scripts_json CHECK (CHAR_LENGTH(script_json) <= 500000 AND JSON_VALID(script_json)),
    CONSTRAINT video_scripts_text CHECK (CHAR_LENGTH(TRIM(script_text)) BETWEEN 1 AND 500000),
    CONSTRAINT video_scripts_version CHECK (version > 0),
    CONSTRAINT video_scripts_archive_state CHECK ((status = 'draft' AND archived_at_utc IS NULL) OR (status = 'archived' AND archived_at_utc IS NOT NULL))
) ENGINE=InnoDB COMMENT='Stores reusable, copy-ready production scripts grounded in explicitly selected Agent interactions for external generators and the built-in Agent-interface renderer. One row is one versioned portable video-script draft with a structured production plan and deterministic human-readable export. A script is the authoritative content-production plan; MP4 execution state belongs to linked video_jobs rows. Creation is idempotent for the exact Agent Slayer request event recorded in created_by_event_id. Source interactions are authoritative and are preserved separately in video_script_sources. Sensitivity: May contain private details selected from user interactions; secrets and unrelated private details must be excluded before persistence.';

CREATE TABLE video_script_sources (
    -- sourceOfTruth: true
    -- synonyms: ["video script interactions", "script source conversations"]
    -- keywords: ["selected interactions", "script sources", "source order"]
    -- fk:video_script_sources_event meaning: Connects the source association to the exact selected request-received ledger event.
    -- fk:video_script_sources_event cardinality: Each association references exactly one request event; one request may ground many scripts.
    -- fk:video_script_sources_event importantRules: ["A referenced request event cannot be deleted while it grounds a retained script."]
    -- fk:video_script_sources_script meaning: Connects the source association to its portable AI-video script.
    -- fk:video_script_sources_script cardinality: Each association belongs to exactly one script; one script has one through eight ordered sources.
    -- fk:video_script_sources_script importantRules: ["Deleting a script deletes only its source associations, never the underlying ledger interactions."]

    video_script_id  BIGINT UNSIGNED NOT NULL COMMENT 'Portable AI-video script grounded by this source association.',
    request_event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Exact immutable request-received ledger event selected as source evidence.',
    source_order     BIGINT NOT NULL COMMENT 'One-based chronological position of this interaction among the script''s selected sources. Units: position.',
    PRIMARY KEY (video_script_id, request_event_id),
    UNIQUE KEY video_script_sources_order (video_script_id, source_order),
    KEY video_script_sources_request (request_event_id, video_script_id),
    CONSTRAINT video_script_sources_script FOREIGN KEY (video_script_id) REFERENCES video_scripts(video_script_id) ON DELETE CASCADE,
    CONSTRAINT video_script_sources_event FOREIGN KEY (request_event_id) REFERENCES activity_events(event_id) ON DELETE RESTRICT,
    CONSTRAINT video_script_sources_positive CHECK (source_order > 0)
) ENGINE=InnoDB COMMENT='Preserves the ordered many-to-many grounding between a portable AI-video script and the completed Agent Slayer interactions explicitly selected for it. One row links one video script to one selected request event at one stable chronological source position. Every source must be an exact completed request event selected by the user. source_order is chronological within one script and must not be inferred from display order. Sensitivity: Links portable content drafts to private user requests and responses.';

CREATE TABLE video_jobs (
    -- sourceOfTruth: true
    -- synonyms: ["render jobs", "video executions"]
    -- keywords: ["video render", "render job", "make a video", "video status", "rendering"]
    -- fk:video_jobs_content meaning: Connects this video rendering job to the content item identified by content_id.
    -- fk:video_jobs_content cardinality: Each video rendering job may reference zero or one content item; one referenced record may be used by many video rendering job records.
    -- fk:video_jobs_content importantRules: ["Deleting the referenced row preserves this row and clears the reference."]
    -- fk:video_jobs_event meaning: Connects this video rendering job to the observable event identified by request_event_id.
    -- fk:video_jobs_event cardinality: Each video rendering job may reference zero or one observable event; one referenced record may be used by many video rendering job records.
    -- fk:video_jobs_event importantRules: ["Deleting the referenced row preserves this row and clears the reference."]
    -- fk:video_jobs_file meaning: Connects this video rendering job to the stored-file record identified by output_file_id.
    -- fk:video_jobs_file cardinality: Each video rendering job may reference zero or one stored-file record; one referenced record may be used by many video rendering job records.
    -- fk:video_jobs_file importantRules: ["Deleting the referenced row preserves this row and clears the reference."]
    -- fk:video_jobs_script meaning: Connects a background render attempt to the exact durable video script it executes.
    -- fk:video_jobs_script cardinality: Each script-driven render job references zero or one script; one script may retain multiple completed or failed attempts but only one active attempt.
    -- fk:video_jobs_script importantRules: ["Deleting a script preserves historical render-job state and clears this reference."]
    -- fk:video_jobs_task meaning: Connects a video rendering job to the optional personal task that requested or tracks the work.
    -- fk:video_jobs_task cardinality: Each video rendering job references zero or one personal task; one task may be associated with multiple rendering jobs.
    -- fk:video_jobs_task importantRules: ["Deleting a task preserves render-job history and clears this optional reference."]

    video_job_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this rendering job.',
    request_event_id   VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Ledger request event whose accepted tool call initiated this render job, when known.',
    source_turn_id     VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Agent turn identifier for the complete source interaction when known.',
    content_id         BIGINT UNSIGNED COMMENT 'Content catalog item that this rendering job produces or updates when one exists.',
    renderer           ENUM('remotion', 'adobe_premiere', 'other') NOT NULL DEFAULT 'remotion' COMMENT 'Rendering implementation selected to execute the job. remotion: Render with the Remotion code-based video pipeline. adobe_premiere: Render through Adobe Premiere automation. other: Another explicitly identified renderer.',
    template           VARCHAR(255) NOT NULL COMMENT 'Stable template name or identifier defining the video''s composition.',
    status             ENUM('queued', 'preparing', 'rendering', 'complete', 'error', 'cancelled') NOT NULL DEFAULT 'queued' COMMENT 'Current execution state of the rendering job. queued: Waiting for execution. preparing: Inputs and environment are being prepared. rendering: Renderer is actively producing output. complete: Rendered output was produced successfully. error: Execution terminated with an error. cancelled: Execution was deliberately stopped.',
    input_json         LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '{}' COMMENT 'Bounded job contract and identifiers needed to resolve the authoritative script and ordered sources for this render attempt. Format: JSON object encoded as text.',
    output_file_id     BIGINT UNSIGNED COMMENT 'File metadata record for the completed rendered video when successful.',
    error_text         LONGTEXT COMMENT 'Complete observable rendering error when the job fails.',
    created_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                       DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the rendering job was created. Format: ISO 8601 UTC timestamp.',
    started_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp when rendering preparation or execution began. Format: ISO 8601 UTC timestamp.',
    completed_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp when the job reached a terminal state. Format: ISO 8601 UTC timestamp.',
    updated_at_utc     VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC timestamp of the latest recorded state change. Format: ISO 8601 UTC timestamp.',
    personal_task_id   BIGINT UNSIGNED COMMENT 'Optional durable personal task that requested and owns this subordinate render execution. Deleting the task preserves the render job and clears this reference.',
    video_script_id    BIGINT UNSIGNED COMMENT 'Durable production script whose scene plan this background render job executes, when this is a script-driven job.',
    -- active_script_status: Generated uniqueness guard equal to 1 while a script-linked job is active, and null after it reaches a terminal state. Format: MariaDB boolean uniqueness guard: 1 or null. Database-generated value used to allow at most one active job per video script; applications must not write it.
    active_script_status TINYINT UNSIGNED AS (IF(status IN ('queued', 'preparing', 'rendering'), 1, NULL)) PERSISTENT,
    PRIMARY KEY (video_job_id),
    UNIQUE KEY video_jobs_one_active_script (video_script_id, active_script_status),
    KEY video_jobs_script_created (video_script_id, created_at_utc, video_job_id),
    CONSTRAINT video_jobs_event FOREIGN KEY (request_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT video_jobs_content FOREIGN KEY (content_id) REFERENCES content_items(content_id) ON DELETE SET NULL,
    CONSTRAINT video_jobs_file FOREIGN KEY (output_file_id) REFERENCES files(file_id) ON DELETE SET NULL,
    CONSTRAINT video_jobs_task FOREIGN KEY (personal_task_id) REFERENCES todo_personal(personal_task_id) ON DELETE SET NULL,
    CONSTRAINT video_jobs_script FOREIGN KEY (video_script_id) REFERENCES video_scripts(video_script_id) ON DELETE SET NULL,
    CONSTRAINT video_jobs_json CHECK (JSON_VALID(input_json))
) ENGINE=InnoDB COMMENT='Tracks background execution attempts for script-driven video productions and any retained legacy render jobs. One row represents one attempt to render one video using one renderer, template, input package, and eventual output or error. A script-driven video job is subordinate execution state and never replaces its authoritative video_scripts record. At most one queued, preparing, or rendering job may exist for one linked script. Every meaningful state transition should also be observable in activity_events. Sensitivity: May contain private source interactions, render inputs, output paths, and errors.';

CREATE TABLE profile_facts (
    -- sourceOfTruth: true
    -- synonyms: ["user profile", "stable facts", "personal preferences"]
    -- keywords: ["my name", "call me", "remember this", "forget this", "my location", "my address", "my vehicle", "preference"]
    -- fact_type examples: ["preferred_name", "default_location", "vehicle", "clothing_size"]
    -- fact_text examples: ["My car is a 2017 Volkswagen Golf.", "My wife's car is a 2020 Honda CR-V.", "My son Vince's shoe size is 9 US."]
    -- fk:profile_facts_archiver meaning: Connects an archived fact version to the request that replaced or deleted it.
    -- fk:profile_facts_archiver cardinality: Each archived fact version may reference zero or one archiving event; one event may archive multiple fact versions.
    -- fk:profile_facts_archiver importantRules: ["Deleting an old event clears this pointer without deleting the profile fact version."]
    -- fk:profile_facts_source meaning: Connects the fact version to the request that created it.
    -- fk:profile_facts_source cardinality: Each profile fact version may reference zero or one source event; one event may create multiple profile fact versions.
    -- fk:profile_facts_source importantRules: ["Deleting an old event clears this pointer without deleting the profile fact."]

    profile_fact_id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable row identifier used by profile tools to replace or archive this exact fact.',
    fact_type            VARCHAR(200) NOT NULL COMMENT 'Broad repeatable category for this fact, shared by related rows when appropriate. Format: lowercase snake_case. Multiple active rows may have the same fact_type.',
    fact_text            TEXT NOT NULL COMMENT 'Self-contained natural-language statement identifying the fact''s person or item. The text must remain understandable without deriving a subject from fact_type. Sensitivity: May contain private personal information.',
    fact_status          ENUM('active', 'archived') NOT NULL DEFAULT 'active' COMMENT 'Whether the fact is current or retained only as archived history. active: Current fact eligible for first-call context when its type is relevant. archived: Historical fact omitted from ordinary model context.',
    source_event_id      VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'User request event that created this version of the fact.',
    archived_by_event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'User request event that archived this fact version, either by replacement or deletion.',
    created_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                         DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC time when this fact version was created. Format: ISO 8601 UTC timestamp.',
    updated_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time when the fact was most recently changed. Format: ISO 8601 UTC timestamp.',
    archived_at_utc      VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC time when the fact was archived; null while active. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (profile_fact_id),
    KEY profile_facts_status_type (fact_status, fact_type, profile_fact_id),
    CONSTRAINT profile_facts_source FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT profile_facts_archiver FOREIGN KEY (archived_by_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL,
    CONSTRAINT profile_facts_type CHECK (CHAR_LENGTH(TRIM(fact_type)) BETWEEN 1 AND 200),
    CONSTRAINT profile_facts_text CHECK (CHAR_LENGTH(TRIM(fact_text)) BETWEEN 1 AND 10000),
    CONSTRAINT profile_facts_archive_state CHECK ((fact_status = 'active' AND archived_at_utc IS NULL) OR (fact_status = 'archived' AND archived_at_utc IS NOT NULL))
) ENGINE=InnoDB COMMENT='Stores the current and archived durable facts and preferences that describe the user to the secretary. One row represents one version of one self-contained typed profile fact; multiple active rows may share a fact type. Only active rows of repository-selected relevant fact types are included automatically in first-call model context. A type is a broad repeatable category; the text identifies the person or item to which each row applies. Replacing a fact targets its exact profile_fact_id, archives that row, and inserts a new active version. Deleting a fact targets its exact profile_fact_id and archives it rather than erasing historical data. Sensitivity: Contains private user identity, location, address, preferences, and other durable personal information.';

CREATE TABLE correspondence (
    -- sourceOfTruth: true
    -- synonyms: ["messages", "communications"]
    -- keywords: ["message", "email", "text message", "sms", "mms", "imessage", "chat", "voicemail", "inbox", "sent"]
    -- subject keywords: ["email subject", "message subject"]
    -- body_text keywords: ["message body", "email body", "what did they say", "voicemail transcript"]
    -- sent_at_utc keywords: ["when sent"]
    -- received_at_utc keywords: ["when received"]
    -- fk:correspondence_event meaning: Connects this message to the observable event identified by source_event_id.
    -- fk:correspondence_event cardinality: Each message may reference zero or one observable event; one referenced record may be used by many message records.
    -- fk:correspondence_event importantRules: ["Deleting the referenced row preserves this row and clears the reference."]
    -- fk:correspondence_reply meaning: Connects this message to the message identified by in_reply_to_id.
    -- fk:correspondence_reply cardinality: Each message may reference zero or one message; one referenced record may be used by many message records.
    -- fk:correspondence_reply importantRules: ["Deleting the referenced row preserves this row and clears the reference."]

    correspondence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable local identifier for this message.',
    medium            ENUM('email', 'sms', 'mms', 'imessage', 'chat', 'voicemail', 'other') NOT NULL COMMENT 'Communication medium through which the message exists. email: Email message. sms: SMS text message. mms: Multimedia messaging service message. imessage: Apple iMessage communication. chat: Message from a chat or messaging platform. voicemail: Recorded or transcribed voicemail. other: Communication medium not covered by the named values.',
    direction         ENUM('inbound', 'outbound', 'draft', 'internal') NOT NULL COMMENT 'Whether the message arrived, was sent, remains a draft, or exists only as an internal record. inbound: Received from another participant. outbound: Sent to another participant. draft: Prepared but not sent. internal: Recorded for internal agent/user use rather than transmitted.',
    account_key       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Mailbox, phone identity, or service account through which the message was handled.',
    thread_key        VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Provider or local conversation identifier grouping related messages.',
    external_id       VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Provider-assigned identifier for this message.',
    in_reply_to_id    BIGINT UNSIGNED COMMENT 'Earlier local correspondence record to which this message directly replies.',
    subject           TEXT COMMENT 'Complete message subject or title when the medium provides one.',
    body_text         LONGTEXT COMMENT 'Complete available plain-text body of the message or voicemail transcript.',
    body_html         LONGTEXT COMMENT 'Complete available HTML body when supplied by the communication provider.',
    status            VARCHAR(64) COMMENT 'Provider- or workflow-specific message state, such as unread, sent, failed, or archived.',
    sent_at_utc       VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when the message was sent, when known. Format: ISO 8601 UTC timestamp.',
    received_at_utc   VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'UTC instant when the message was received, when known. Format: ISO 8601 UTC timestamp.',
    source_event_id   VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Ledger event that introduced or created this correspondence record when known.',
    created_at_utc    VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
                      DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when this local message record was inserted. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (correspondence_id),
    UNIQUE KEY correspondence_external (medium, account_key, external_id),
    KEY correspondence_thread (medium, account_key, thread_key),
    KEY correspondence_timeline_index (correspondence_id),
    CONSTRAINT correspondence_reply FOREIGN KEY (in_reply_to_id) REFERENCES correspondence(correspondence_id) ON DELETE SET NULL,
    CONSTRAINT correspondence_event FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Preserves complete logical messages across email, SMS, MMS, iMessage, chat, voicemail, and future communication media. One row represents one inbound, outbound, draft, or internal message, independent of how many participants or files it has. Preserve the complete available message rather than replacing it with extracted facts or a summary. Use correspondence_participants and correspondence_files for people and attachments. Sensitivity: Contains highly private communications, message bodies, headers, account identifiers, and provider metadata.';

CREATE TABLE todo_correspondence_join (
    personal_task_id BIGINT UNSIGNED NOT NULL COMMENT 'Existing task associated with the message.',
    correspondence_id BIGINT UNSIGNED NOT NULL COMMENT 'Existing local correspondence record associated with the task.',
    created_at_utc VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
        DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the link was created. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (personal_task_id, correspondence_id),
    KEY todo_correspondence_join_message (correspondence_id),
    CONSTRAINT todo_correspondence_join_task FOREIGN KEY (personal_task_id) REFERENCES todo_personal(personal_task_id) ON DELETE CASCADE,
    CONSTRAINT todo_correspondence_join_message FOREIGN KEY (correspondence_id) REFERENCES correspondence(correspondence_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Links existing task records to existing correspondence, including emails and text messages. Each pair appears once; either record can have many links. Deleting either record removes only its dependent links. This table stores associations, not message content or provider synchronization state.';

CREATE TABLE calendar_events_correspondence_join (
    calendar_event_id BIGINT UNSIGNED NOT NULL COMMENT 'Existing calendar event or recurring series associated with the message.',
    correspondence_id BIGINT UNSIGNED NOT NULL COMMENT 'Existing local correspondence record associated with the calendar event or recurring series.',
    created_at_utc VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
        DEFAULT (CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')) COMMENT 'UTC timestamp when the link was created. Format: ISO 8601 UTC timestamp.',
    PRIMARY KEY (calendar_event_id, correspondence_id),
    KEY calendar_events_correspondence_join_message (correspondence_id),
    CONSTRAINT calendar_events_correspondence_join_event FOREIGN KEY (calendar_event_id) REFERENCES calendar_events(calendar_event_id) ON DELETE CASCADE,
    CONSTRAINT calendar_events_correspondence_join_message FOREIGN KEY (correspondence_id) REFERENCES correspondence(correspondence_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Links existing calendar event or recurring series records to existing correspondence, including emails and text messages. Each pair appears once; either record can have many links. Deleting either record removes only its dependent links. This table stores associations, not message content or provider synchronization state.';

CREATE TABLE correspondence_files (
    -- sourceOfTruth: true
    -- synonyms: ["message attachments", "correspondence media"]
    -- keywords: ["message attachment", "email attachment", "attached file"]
    -- fk:correspondence_files_file meaning: Connects this message-file attachment to the stored-file record identified by file_id.
    -- fk:correspondence_files_file cardinality: Each message-file attachment references exactly one stored-file record; one referenced record may be used by many message-file attachment records.
    -- fk:correspondence_files_file importantRules: ["Deleting the referenced row also deletes this dependent row."]
    -- fk:correspondence_files_message meaning: Connects this message-file attachment to the message identified by correspondence_id.
    -- fk:correspondence_files_message cardinality: Each message-file attachment references exactly one message; one referenced record may be used by many message-file attachment records.
    -- fk:correspondence_files_message importantRules: ["Deleting the referenced row also deletes this dependent row."]

    correspondence_id BIGINT UNSIGNED NOT NULL COMMENT 'Message to which the file belongs.',
    file_id            BIGINT UNSIGNED NOT NULL COMMENT 'Externally stored file associated with the message.',
    attachment_role    ENUM('attachment', 'inline', 'recording', 'other') NOT NULL DEFAULT 'attachment' COMMENT 'How the file appears or functions in the message. attachment: Ordinary attached file. inline: File displayed inside the message body. recording: Audio or video recording that constitutes message content. other: File role not covered by the named values.',
    PRIMARY KEY (correspondence_id, file_id),
    CONSTRAINT correspondence_files_message FOREIGN KEY (correspondence_id) REFERENCES correspondence(correspondence_id) ON DELETE CASCADE,
    CONSTRAINT correspondence_files_file FOREIGN KEY (file_id) REFERENCES files(file_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Associates externally stored files with correspondence and identifies how each file appears in the message. One row links one file to one message as an attachment, inline asset, recording, or other file role. The file bytes live in agent media storage; this table stores only the relationship. Sensitivity: Reveals which private files belong to private communications.';

CREATE TABLE correspondence_participants (
    -- sourceOfTruth: true
    -- synonyms: ["message recipients", "message senders"]
    -- keywords: ["sender", "recipient", "from whom", "to whom", "cc", "bcc", "message participant"]
    -- fk:correspondence_participants_contact_fk meaning: Connects this message participant to the contact identified by contact_id.
    -- fk:correspondence_participants_contact_fk cardinality: Each message participant may reference zero or one contact; one referenced record may be used by many message participant records.
    -- fk:correspondence_participants_contact_fk importantRules: ["Deleting the referenced row preserves this row and clears the reference."]
    -- fk:correspondence_participants_message meaning: Connects this message participant to the message identified by correspondence_id.
    -- fk:correspondence_participants_message cardinality: Each message participant references exactly one message; one referenced record may be used by many message participant records.
    -- fk:correspondence_participants_message importantRules: ["Deleting the referenced row also deletes this dependent row."]
    -- fk:correspondence_participants_method meaning: Connects this message participant to the contact method identified by contact_method_id.
    -- fk:correspondence_participants_method cardinality: Each message participant may reference zero or one contact method; one referenced record may be used by many message participant records.
    -- fk:correspondence_participants_method importantRules: ["Deleting the referenced row preserves this row and clears the reference."]

    correspondence_id  BIGINT UNSIGNED NOT NULL COMMENT 'Message on which this participant appears.',
    participant_role   ENUM('from', 'to', 'cc', 'bcc', 'reply_to', 'sender', 'recipient') NOT NULL COMMENT 'Sender or recipient role the observed address has on the message. from: Email-style From participant. to: Email-style primary recipient. cc: Email-style carbon-copy recipient. bcc: Email-style blind-carbon-copy recipient. reply_to: Email-style Reply-To address to use when responding instead of the From address. sender: Generic sender for media without email-style headers. recipient: Generic recipient for media without email-style headers.',
    contact_id         BIGINT UNSIGNED COMMENT 'Known contact matched to the observed participant, when a match exists.',
    contact_method_id  BIGINT UNSIGNED COMMENT 'Specific known email address, phone number, or other method matched to the observed participant.',
    address_value      VARCHAR(512) NOT NULL COMMENT 'Address or identity exactly observed on the message, retained even when no contact matches.',
    display_name       VARCHAR(500) COMMENT 'Participant display name supplied with the message when available.',
    PRIMARY KEY (correspondence_id, participant_role, address_value),
    KEY correspondence_participants_contact (contact_id, correspondence_id),
    CONSTRAINT correspondence_participants_message FOREIGN KEY (correspondence_id) REFERENCES correspondence(correspondence_id) ON DELETE CASCADE,
    CONSTRAINT correspondence_participants_contact_fk FOREIGN KEY (contact_id) REFERENCES contacts(contact_id) ON DELETE SET NULL,
    CONSTRAINT correspondence_participants_method FOREIGN KEY (contact_method_id) REFERENCES contact_methods(contact_method_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Records senders and recipients for correspondence while retaining unmatched addresses that do not yet resolve to a contact. One row represents one participant address in one role on one message, optionally linked to a known contact and contact method. address_value preserves the address observed on the message even when no contact matches it. Sensitivity: Contains private communication participants, addresses, and display names.';

CREATE VIEW activity_operation_latency AS
-- Summarizes elapsed time and error completion for operations reconstructed from their activity_events start, end, and error records. One row summarizes one operation_id, using its earliest start and latest end or error event. A null duration means the ledger does not contain both a start and a terminal event for the operation. Sensitivity: Contains operational identifiers and names derived from the private activity ledger.
-- sourceOfTruth: false
-- derivedFrom: ["activity_events"]
-- synonyms: ["operation latency", "operation timing"]
-- keywords: ["tool latency", "model latency", "how long operation", "performance"]
-- operation_id inheritsFrom: activity_events.operation_id
-- trace_id inheritsFrom: activity_events.trace_id
-- name inheritsFrom: activity_events.name
-- started_at_ms: Earliest recorded start-event time for the operation, in Unix epoch milliseconds. Units: milliseconds. Format: Unix epoch milliseconds.
-- finished_at_ms: Latest recorded end- or error-event time for the operation, in Unix epoch milliseconds. Units: milliseconds. Format: Unix epoch milliseconds.
-- duration_ms: Elapsed milliseconds between started_at_ms and finished_at_ms; null when either boundary is missing. Units: milliseconds. Format: non-negative integer.
-- ended_in_error: Derived 1 when any grouped event has error phase, otherwise 0. Format: MariaDB boolean: 0=false, 1=true.

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
-- Provides a convenient window containing the 1,000 most recent activity_events by source-event time and local sequence. One row is one activity_events record included in the current recent-event window. This view is bounded to 1,000 rows and therefore must not be treated as complete history. Sensitivity: Contains the same private content and operational metadata as activity_events.
-- sourceOfTruth: false
-- derivedFrom: ["activity_events"]
-- synonyms: ["recent activity", "recent ledger events"]
-- keywords: ["latest activity", "recent history"]
-- event_seq inheritsFrom: activity_events.event_seq
-- event_id inheritsFrom: activity_events.event_id
-- occurred_at_ms inheritsFrom: activity_events.occurred_at_ms
-- recorded_at_ms inheritsFrom: activity_events.recorded_at_ms
-- occurred_at_utc inheritsFrom: activity_events.occurred_at_utc
-- event_type inheritsFrom: activity_events.event_type
-- event_phase inheritsFrom: activity_events.event_phase
-- status inheritsFrom: activity_events.status
-- actor_type inheritsFrom: activity_events.actor_type
-- actor_name inheritsFrom: activity_events.actor_name
-- source inheritsFrom: activity_events.source
-- channel inheritsFrom: activity_events.channel
-- session_id inheritsFrom: activity_events.session_id
-- turn_id inheritsFrom: activity_events.turn_id
-- trace_id inheritsFrom: activity_events.trace_id
-- operation_id inheritsFrom: activity_events.operation_id
-- span_id inheritsFrom: activity_events.span_id
-- parent_span_id inheritsFrom: activity_events.parent_span_id
-- parent_event_id inheritsFrom: activity_events.parent_event_id
-- name inheritsFrom: activity_events.name
-- content_text inheritsFrom: activity_events.content_text
-- payload_json inheritsFrom: activity_events.payload_json
-- primary_file_id inheritsFrom: activity_events.primary_file_id
-- subject_type inheritsFrom: activity_events.subject_type
-- subject_id inheritsFrom: activity_events.subject_id
-- external_ref inheritsFrom: activity_events.external_ref
-- error_text inheritsFrom: activity_events.error_text

SELECT * FROM activity_events ORDER BY occurred_at_ms DESC, event_seq DESC LIMIT 1000;

CREATE VIEW activity_turn_latency AS
-- Summarizes the observed time span, event volume, and error count for each agent turn represented in activity_events. One row summarizes all ledger events carrying the same non-null turn_id. Duration is the difference between the earliest and latest observed event, not necessarily provider-reported model latency. Sensitivity: Contains agent-turn identifiers and operational measurements.
-- sourceOfTruth: false
-- derivedFrom: ["activity_events"]
-- synonyms: ["turn latency", "turn timing"]
-- keywords: ["response time", "how long did the agent take", "slow response"]
-- turn_id inheritsFrom: activity_events.turn_id
-- started_at_ms: Earliest observed event time in the turn, in Unix epoch milliseconds. Units: milliseconds. Format: Unix epoch milliseconds.
-- finished_at_ms: Latest observed event time in the turn, in Unix epoch milliseconds. Units: milliseconds. Format: Unix epoch milliseconds.
-- duration_ms: Observed milliseconds between the first and last ledger event in the turn. Units: milliseconds. Format: non-negative integer.
-- event_count: Number of activity_events records associated with the turn.
-- error_count: Number of turn events whose event_phase is error.

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
-- Adds one consistently derived timeline timestamp to each correspondence row for chronological message retrieval. One row is one correspondence record with timeline_at_utc chosen from received, sent, or creation time in that order. The view does not duplicate messages; authoritative message data remains in correspondence. Sensitivity: Contains the same highly private communication content as correspondence.
-- sourceOfTruth: false
-- derivedFrom: ["correspondence"]
-- synonyms: ["message timeline", "chronological correspondence"]
-- keywords: ["recent message", "message history", "conversation timeline", "latest email", "latest message"]
-- correspondence_id inheritsFrom: correspondence.correspondence_id
-- medium inheritsFrom: correspondence.medium
-- direction inheritsFrom: correspondence.direction
-- account_key inheritsFrom: correspondence.account_key
-- thread_key inheritsFrom: correspondence.thread_key
-- external_id inheritsFrom: correspondence.external_id
-- in_reply_to_id inheritsFrom: correspondence.in_reply_to_id
-- subject inheritsFrom: correspondence.subject
-- body_text inheritsFrom: correspondence.body_text
-- body_html inheritsFrom: correspondence.body_html
-- status inheritsFrom: correspondence.status
-- sent_at_utc inheritsFrom: correspondence.sent_at_utc
-- received_at_utc inheritsFrom: correspondence.received_at_utc
-- source_event_id inheritsFrom: correspondence.source_event_id
-- created_at_utc inheritsFrom: correspondence.created_at_utc
-- timeline_at_utc: Derived chronological timestamp: received_at_utc when present, otherwise sent_at_utc, otherwise created_at_utc. Format: ISO 8601 UTC timestamp.

SELECT correspondence.*,
       COALESCE(received_at_utc, sent_at_utc, created_at_utc) AS timeline_at_utc
FROM correspondence;

CREATE VIEW due_reminders AS
-- Selects reminders that are ready for delivery or retry because their reminder time has arrived and their status is pending or error. One row is one reminder record that is currently due for delivery or retry. This is a time-dependent view; membership changes as the current UTC time and reminder status change. Sensitivity: May expose private commitments, notification targets, payloads, and delivery errors.
-- sourceOfTruth: false
-- derivedFrom: ["reminders"]
-- synonyms: ["ready reminders", "reminder delivery queue"]
-- keywords: ["due reminder", "reminder due", "remind now", "pending reminder", "failed reminder"]
-- reminder_id inheritsFrom: reminders.reminder_id
-- calendar_event_id inheritsFrom: reminders.calendar_event_id
-- personal_task_id inheritsFrom: reminders.personal_task_id
-- title inheritsFrom: reminders.title
-- remind_at_utc inheritsFrom: reminders.remind_at_utc
-- delivery_method inheritsFrom: reminders.delivery_method
-- delivery_target inheritsFrom: reminders.delivery_target
-- status inheritsFrom: reminders.status
-- attempt_count inheritsFrom: reminders.attempt_count
-- last_attempt_at_utc inheritsFrom: reminders.last_attempt_at_utc
-- delivered_at_utc inheritsFrom: reminders.delivered_at_utc
-- error_text inheritsFrom: reminders.error_text
-- created_at_utc inheritsFrom: reminders.created_at_utc
-- updated_at_utc inheritsFrom: reminders.updated_at_utc

SELECT * FROM reminders
WHERE status IN ('pending', 'error')
  AND remind_at_utc <= CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z');

CREATE VIEW open_todo_personal AS
-- Provides the personal tasks that currently belong on the user's actionable To-Do List. One row represents one task whose status is unplanned, todo, or ai_suggested. The view includes unplanned, todo, and ai_suggested tasks and excludes complete, ignored, and archived tasks. Sensitivity: Contains the user's private plans, commitments, and agent-suggested work.
-- sourceOfTruth: false
-- derivedFrom: ["todo_personal"]
-- synonyms: ["open tasks", "active todos"]
-- keywords: ["todo", "to-do list", "open task", "what should i do"]
-- personal_task_id inheritsFrom: todo_personal.personal_task_id
-- todo_group_id inheritsFrom: todo_personal.todo_group_id
-- sequence inheritsFrom: todo_personal.sequence
-- related_contact_id inheritsFrom: todo_personal.related_contact_id
-- text inheritsFrom: todo_personal.text
-- status inheritsFrom: todo_personal.status
-- sort_position inheritsFrom: todo_personal.sort_position
-- completed_at_utc inheritsFrom: todo_personal.completed_at_utc
-- source inheritsFrom: todo_personal.source
-- external_id inheritsFrom: todo_personal.external_id
-- source_event_id inheritsFrom: todo_personal.source_event_id
-- created_at_utc inheritsFrom: todo_personal.created_at_utc
-- updated_at_utc inheritsFrom: todo_personal.updated_at_utc
-- interaction_guide_id inheritsFrom: todo_personal.interaction_guide_id
-- planning_prompt_text inheritsFrom: todo_personal.planning_prompt_text

SELECT * FROM todo_personal
WHERE status IN ('unplanned', 'todo', 'ai_suggested');

CREATE VIEW upcoming_calendar AS
-- Selects tentative and confirmed calendar events whose start time has not yet passed, ordered by start time. One row represents one tentative or confirmed calendar event whose start time has not yet passed. This is a time-dependent view and excludes cancelled, completed, and already-started events. Sensitivity: Contains private future schedule and location information.
-- sourceOfTruth: false
-- derivedFrom: ["calendar_events"]
-- synonyms: ["future events", "upcoming schedule"]
-- keywords: ["upcoming", "coming up", "next appointment", "next meeting", "future event", "what is on my calendar"]
-- calendar_event_id inheritsFrom: calendar_events.calendar_event_id
-- ical_uid inheritsFrom: calendar_events.ical_uid
-- ical_recurrence_id inheritsFrom: calendar_events.ical_recurrence_id
-- title inheritsFrom: calendar_events.title
-- description inheritsFrom: calendar_events.description
-- location_text inheritsFrom: calendar_events.location_text
-- starts_at_utc inheritsFrom: calendar_events.starts_at_utc
-- ends_at_utc inheritsFrom: calendar_events.ends_at_utc
-- time_zone inheritsFrom: calendar_events.time_zone
-- is_all_day inheritsFrom: calendar_events.is_all_day
-- status inheritsFrom: calendar_events.status
-- recurrence_rule inheritsFrom: calendar_events.recurrence_rule
-- source_event_id inheritsFrom: calendar_events.source_event_id
-- created_at_utc inheritsFrom: calendar_events.created_at_utc
-- updated_at_utc inheritsFrom: calendar_events.updated_at_utc
-- planning_prompt_text inheritsFrom: calendar_events.planning_prompt_text
-- ical_single_guard inheritsFrom: calendar_events.ical_single_guard

SELECT * FROM calendar_events
WHERE status IN ('tentative', 'confirmed')
  AND starts_at_utc >= CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
ORDER BY starts_at_utc;

DELIMITER //

CREATE TRIGGER contacts_validate_birth_date_before_insert
BEFORE INSERT ON contacts
FOR EACH ROW
BEGIN
  IF NEW.birth_date REGEXP '^[0-9]{4}-02-29$'
     AND NOT (
       MOD(CAST(SUBSTRING(NEW.birth_date, 1, 4) AS UNSIGNED), 400) = 0
       OR (
         MOD(CAST(SUBSTRING(NEW.birth_date, 1, 4) AS UNSIGNED), 4) = 0
         AND MOD(CAST(SUBSTRING(NEW.birth_date, 1, 4) AS UNSIGNED), 100) <> 0
       )
     )
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'birth_date February 29 requires a leap year';
  END IF;
END//

CREATE TRIGGER contacts_validate_birth_date_before_update
BEFORE UPDATE ON contacts
FOR EACH ROW
BEGIN
  IF NEW.birth_date REGEXP '^[0-9]{4}-02-29$'
     AND NOT (
       MOD(CAST(SUBSTRING(NEW.birth_date, 1, 4) AS UNSIGNED), 400) = 0
       OR (
         MOD(CAST(SUBSTRING(NEW.birth_date, 1, 4) AS UNSIGNED), 4) = 0
         AND MOD(CAST(SUBSTRING(NEW.birth_date, 1, 4) AS UNSIGNED), 100) <> 0
       )
     )
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'birth_date February 29 requires a leap year';
  END IF;
END//

CREATE TRIGGER todo_personal_assign_sequence_before_insert
BEFORE INSERT ON todo_personal
FOR EACH ROW
BEGIN
  IF NEW.sequence IS NULL
     AND EXISTS (SELECT 1 FROM todo_groups WHERE todo_group_id = NEW.todo_group_id AND uses_sequence = 1)
  THEN
    SET NEW.sequence = (
      SELECT COALESCE(MAX(sequence), 0) + 1
      FROM todo_personal
      WHERE todo_group_id = NEW.todo_group_id
    );
  END IF;
END//

CREATE TRIGGER todo_personal_assign_sequence_before_update
BEFORE UPDATE ON todo_personal
FOR EACH ROW
BEGIN
  IF NEW.sequence IS NULL
     AND EXISTS (SELECT 1 FROM todo_groups WHERE todo_group_id = NEW.todo_group_id AND uses_sequence = 1)
  THEN
    SET NEW.sequence = (
      SELECT COALESCE(MAX(sequence), 0) + 1
      FROM todo_personal
      WHERE todo_group_id = NEW.todo_group_id
        AND personal_task_id <> OLD.personal_task_id
    );
  END IF;
END//

CREATE TRIGGER journal_entries_require_tracker_unit_before_insert
BEFORE INSERT ON journal_entries
FOR EACH ROW
BEGIN
  IF NEW.number_value IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM trackers WHERE tracker_id = NEW.tracker_id AND unit IS NOT NULL)
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'numeric journal entries require a tracker unit';
  END IF;
END//

CREATE TRIGGER journal_entries_require_tracker_unit_before_update
BEFORE UPDATE ON journal_entries
FOR EACH ROW
BEGIN
  IF NEW.number_value IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM trackers WHERE tracker_id = NEW.tracker_id AND unit IS NOT NULL)
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'numeric journal entries require a tracker unit';
  END IF;
END//

CREATE TRIGGER trackers_preserve_numeric_unit_before_update
BEFORE UPDATE ON trackers
FOR EACH ROW
BEGIN
  IF NOT (OLD.unit <=> NEW.unit)
     AND LOWER(OLD.unit) <> 'set me'
     AND EXISTS (SELECT 1 FROM journal_entries WHERE tracker_id = OLD.tracker_id AND number_value IS NOT NULL)
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'a tracker unit cannot change after numeric entries exist';
  END IF;
END//

DELIMITER ;

INSERT INTO database_meta (singleton, schema_version, description)
VALUES (1, 40, 'Chapeaux Fous MariaDB database');
