-- Chapeaux Fous MariaDB schema migration: version 29 -> 30.
--
-- Preconditions:
--   1. Stop every application writer.
--   2. Create and retain a current mariadb-dump of the application database.
--   3. Verify schema version 29 with the pre-upgrade application revision.
--
-- Recovery:
--   MariaDB DDL commits implicitly. If this migration fails, keep writers
--   stopped, correct the reported statement, and rerun this file. Every
--   constraint drop is guarded and every column modification is idempotent.
--   Restore the pre-migration dump if recovery requires rolling back.
--
-- Postconditions:
--   1. Synchronize db/schema-semantics.json, then run npm run db:verify and tests.
--   2. Confirm database_meta.schema_version = 30.
--   3. Confirm information_schema.COLUMNS reports 33 enum columns on base tables.
--   4. Confirm CHECK_CONSTRAINTS contains no removed vocabulary checks.

SET @chapeaux_fous_previous_sql_mode = @@SESSION.sql_mode;
SET SESSION sql_mode = IF(
  FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode)
    OR FIND_IN_SET('STRICT_TRANS_TABLES', @@SESSION.sql_mode),
  @@SESSION.sql_mode,
  CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_TRANS_TABLES')
);

DELIMITER //

DROP PROCEDURE IF EXISTS chapeaux_fous_require_schema_29_or_30//
CREATE PROCEDURE chapeaux_fous_require_schema_29_or_30()
BEGIN
  DECLARE current_version INT;
  SELECT schema_version INTO current_version
  FROM database_meta
  WHERE singleton = 1;

  IF current_version IS NULL OR current_version NOT IN (29, 30) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'enum migration requires schema version 29 or 30';
  END IF;
END//

CALL chapeaux_fous_require_schema_29_or_30()//
DROP PROCEDURE chapeaux_fous_require_schema_29_or_30//

DELIMITER ;

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

UPDATE database_meta
SET schema_version = 30
WHERE singleton = 1;

SET SESSION sql_mode = @chapeaux_fous_previous_sql_mode;
