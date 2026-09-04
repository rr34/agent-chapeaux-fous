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
