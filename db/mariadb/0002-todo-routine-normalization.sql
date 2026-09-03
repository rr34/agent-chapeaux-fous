-- MariaDB schema migration 0029: todo-routine-normalization
-- Preconditions and post-migration invariants are enforced by
-- scripts/migrate-mariadb-schema.mjs. DDL is intentionally MariaDB-only.

DROP VIEW open_personal_tasks;

RENAME TABLE personal_tasks TO todo_personal;

ALTER TABLE todo_routines
    ADD COLUMN publication_mode VARCHAR(32) NOT NULL DEFAULT 'on_completion' AFTER todo_group_id,
    ADD COLUMN default_status VARCHAR(32) NOT NULL DEFAULT 'todo' AFTER text,
    ADD COLUMN related_contact_id BIGINT UNSIGNED AFTER recurrence_rule,
    ADD COLUMN duration_minutes BIGINT AFTER related_contact_id,
    ADD COLUMN source_event_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin AFTER disabled_at_utc,
    ADD CONSTRAINT todo_routines_publication_mode
      CHECK (publication_mode IN ('on_completion', 'calendar')),
    ADD CONSTRAINT todo_routines_default_status
      CHECK (default_status IN ('unplanned', 'todo', 'ai_suggested')),
    ADD CONSTRAINT todo_routines_duration
      CHECK (duration_minutes IS NULL OR duration_minutes > 0),
    ADD CONSTRAINT todo_routines_contact
      FOREIGN KEY (related_contact_id) REFERENCES contacts(contact_id) ON DELETE SET NULL,
    ADD CONSTRAINT todo_routines_source
      FOREIGN KEY (source_event_id) REFERENCES activity_events(event_id) ON DELETE SET NULL;

CREATE TEMPORARY TABLE migration_0029_routine_representatives AS
SELECT task.personal_task_id,
       task.todo_routine_id,
       task.related_contact_id,
       task.status,
       task.duration_minutes,
       task.source_event_id
FROM todo_personal AS task
WHERE task.todo_routine_id IS NOT NULL
  AND task.personal_task_id = (
    SELECT candidate.personal_task_id
    FROM todo_personal AS candidate
    WHERE candidate.todo_routine_id = task.todo_routine_id
    ORDER BY candidate.status IN ('unplanned', 'todo', 'ai_suggested') DESC,
             candidate.personal_task_id DESC
    LIMIT 1
  );

UPDATE todo_routines AS routine
LEFT JOIN migration_0029_routine_representatives AS representative
  ON representative.todo_routine_id = routine.todo_routine_id
SET routine.related_contact_id = representative.related_contact_id,
    routine.default_status = CASE
      WHEN representative.status IN ('unplanned', 'todo', 'ai_suggested')
        THEN representative.status
      ELSE 'todo'
    END,
    routine.duration_minutes = representative.duration_minutes,
    routine.source_event_id = representative.source_event_id;

UPDATE todo_routines AS routine
JOIN todo_groups AS todo_group USING (todo_group_id)
JOIN todo_groups AS inbox
  ON inbox.name = 'Inbox' COLLATE utf8mb4_general_ci
 AND inbox.archived_at_utc IS NULL
SET routine.publication_mode = 'calendar',
    routine.todo_group_id = inbox.todo_group_id
WHERE todo_group.name = 'Routine' COLLATE utf8mb4_general_ci;

DELETE task
FROM todo_personal AS task
JOIN todo_groups AS todo_group USING (todo_group_id)
WHERE todo_group.name = 'Routine' COLLATE utf8mb4_general_ci;

UPDATE todo_personal AS task
JOIN todo_routines AS routine
  ON task.external_id LIKE CONCAT('routine:', routine.todo_routine_id, ':%')
SET task.todo_routine_id = routine.todo_routine_id
WHERE task.source = 'routine_publish';

UPDATE todo_groups
SET archived_at_utc = COALESCE(archived_at_utc, CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')),
    updated_at_utc = CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')
WHERE name = 'Routine' COLLATE utf8mb4_general_ci;

ALTER TABLE todo_personal
    RENAME INDEX personal_tasks_group_sequence TO todo_personal_group_sequence,
    RENAME INDEX personal_tasks_source_external TO todo_personal_source_external,
    RENAME INDEX personal_tasks_routine_occurrence TO todo_personal_routine_occurrence,
    RENAME INDEX personal_tasks_status_schedule TO todo_personal_status_schedule,
    RENAME INDEX personal_tasks_group_order TO todo_personal_group_order,
    RENAME INDEX personal_tasks_contact TO todo_personal_contact;

DROP TRIGGER personal_tasks_assign_sequence_before_insert;
DROP TRIGGER personal_tasks_assign_sequence_before_update;

DELIMITER //
CREATE TRIGGER todo_personal_assign_sequence_before_insert
BEFORE INSERT ON todo_personal
FOR EACH ROW
BEGIN
  IF NEW.sequence IS NULL
     AND EXISTS (
       SELECT 1 FROM todo_groups
       WHERE todo_group_id = NEW.todo_group_id AND uses_sequence = 1
     ) THEN
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
     AND EXISTS (
       SELECT 1 FROM todo_groups
       WHERE todo_group_id = NEW.todo_group_id AND uses_sequence = 1
     ) THEN
    SET NEW.sequence = (
      SELECT COALESCE(MAX(sequence), 0) + 1
      FROM todo_personal
      WHERE todo_group_id = NEW.todo_group_id
        AND personal_task_id <> OLD.personal_task_id
    );
  END IF;
END//
DELIMITER ;

CREATE VIEW open_todo_personal AS
SELECT * FROM todo_personal
WHERE status IN ('unplanned', 'todo', 'ai_suggested');

UPDATE database_meta SET schema_version = 29 WHERE singleton = 1;

DROP TEMPORARY TABLE migration_0029_routine_representatives;
