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
-- before recording version 32. Sync schema semantics, then run npm run db:verify.

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
