#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { requiredEnumColumns } from "../src/database.mjs";
import { repositoryRoot } from "./agent-schema.mjs";
import { databaseConnectionFromEnvironment, quoteMariaDbIdentifier } from "./mariadb-schema.mjs";
import {
  readMigrationLedger,
  splitMariaDbStatements,
  validatePendingMigrations,
} from "./database-migrations.mjs";

export const migrationsFilename = path.join(repositoryRoot, "db/migrations.sql");
export const migrationLockTimeoutSeconds = 30;

const version30RemovedConstraints = [
  "files_media_kind",
  "files_title_source",
  "activity_events_phase",
  "activity_events_actor",
  "activity_event_files_role",
  "agent_turn_attempts_correlation",
  "agent_turn_attempts_status",
  "contacts_kind",
  "contacts_status",
  "contact_methods_kind",
  "interaction_guides_status",
  "calendar_events_status",
  "calendar_event_contacts_role",
  "interaction_guide_steps_progress",
  "todo_routines_publication_mode",
  "todo_routines_default_status",
  "todo_personal_status",
  "reminders_delivery",
  "reminders_status",
  "content_items_type",
  "content_items_host",
  "content_items_status",
  "content_items_relationship",
  "video_scripts_status",
  "video_jobs_renderer",
  "video_jobs_status",
  "profile_facts_status",
  "notes_kind",
  "notes_status",
  "correspondence_medium",
  "correspondence_direction",
  "correspondence_files_role",
  "correspondence_participants_role",
];

const version31RequiredConstraints = new Map([
  ["todo_personal_group", "FOREIGN KEY"],
  ["todo_personal_routine", "FOREIGN KEY"],
  ["todo_personal_contact_fk", "FOREIGN KEY"],
  ["todo_personal_source", "FOREIGN KEY"],
  ["todo_personal_sequence", "CHECK"],
  ["todo_personal_all_day", "CHECK"],
  ["todo_personal_duration", "CHECK"],
  ["todo_personal_prompt", "CHECK"],
]);

const version31RemovedConstraints = [
  "personal_tasks_group",
  "personal_tasks_routine",
  "personal_tasks_contact_fk",
  "personal_tasks_source",
  "personal_tasks_sequence",
  "personal_tasks_status",
  "personal_tasks_all_day",
  "personal_tasks_duration",
  "personal_tasks_prompt",
  "todo_personal_status",
];

function enumValues(columnType) {
  const values = [];
  for (const match of String(columnType ?? "").matchAll(/'((?:''|\\'|[^'])*)'/gu)) {
    values.push(match[1].replaceAll("\\'", "'").replaceAll("''", "'"));
  }
  return values;
}

export function migrationLockName(databaseName) {
  const name = `chapeaux-fous:migrations:${databaseName}`;
  if (name.length > 64) throw new Error("MariaDB migration advisory-lock name exceeds 64 characters");
  return name;
}

export async function acquireMigrationLock(connection, databaseName, timeoutSeconds) {
  const [rows] = await connection.query(
    "SELECT GET_LOCK(?, ?) AS acquired",
    [migrationLockName(databaseName), timeoutSeconds],
  );
  if (Number(rows[0]?.acquired) !== 1) {
    throw new Error(`Could not acquire the Chapeaux Fous migration lock within ${timeoutSeconds} seconds`);
  }
}

export async function releaseMigrationLock(connection, databaseName) {
  const [rows] = await connection.query(
    "SELECT RELEASE_LOCK(?) AS released",
    [migrationLockName(databaseName)],
  );
  if (Number(rows[0]?.released) !== 1) {
    throw new Error("MariaDB migration advisory lock was not owned by this connection");
  }
}

export async function readCurrentSchemaVersion(connection, databaseName) {
  const [tableRows] = await connection.query(
    `SELECT COUNT(*) AS table_count
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'database_meta' AND TABLE_TYPE = 'BASE TABLE'`,
    [databaseName],
  );
  if (Number(tableRows[0]?.table_count) !== 1) {
    throw new Error("database_meta is missing; initialize an empty database from db/mariadb/0001-baseline.sql");
  }

  const [rows] = await connection.query(
    "SELECT singleton, schema_version FROM database_meta",
  );
  const version = Number(rows[0]?.schema_version);
  if (rows.length !== 1 || Number(rows[0]?.singleton) !== 1 || !Number.isInteger(version) || version < 1) {
    throw new Error("database_meta must contain exactly one valid singleton row");
  }
  return version;
}

async function assertVersion30Integrity(connection, databaseName) {
  const [columns] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND DATA_TYPE = 'enum'`,
    [databaseName],
  );
  const actualByName = new Map(columns.map((column) => [
    `${column.TABLE_NAME}.${column.COLUMN_NAME}`,
    enumValues(column.COLUMN_TYPE),
  ]));
  for (const [tableName, fields] of Object.entries(requiredEnumColumns)) {
    for (const [fieldName, expectedValues] of Object.entries(fields)) {
      const qualifiedName = `${tableName}.${fieldName}`;
      const actualValues = actualByName.get(qualifiedName);
      if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) {
        throw new Error(`Migration 0030 did not establish the expected enum ${qualifiedName}`);
      }
    }
  }

  const [constraintRows] = await connection.query(
    `SELECT CONSTRAINT_NAME
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ? AND CONSTRAINT_TYPE = 'CHECK'
        AND CONSTRAINT_NAME IN (${version30RemovedConstraints.map(() => "?").join(", ")})`,
    [databaseName, ...version30RemovedConstraints],
  );
  if (constraintRows.length > 0) {
    throw new Error(
      `Migration 0030 left removed vocabulary constraints: ${constraintRows.map(({ CONSTRAINT_NAME }) => CONSTRAINT_NAME).join(", ")}`,
    );
  }
}

async function assertVersion31Integrity(connection, databaseName) {
  const relevantConstraintNames = [
    ...version31RequiredConstraints.keys(),
    ...version31RemovedConstraints,
  ];
  const [constraintRows] = await connection.query(
    `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'todo_personal'
        AND CONSTRAINT_NAME IN (${relevantConstraintNames.map(() => "?").join(", ")})`,
    [databaseName, ...relevantConstraintNames],
  );
  const actualConstraints = new Map(constraintRows.map((row) => [
    row.CONSTRAINT_NAME,
    row.CONSTRAINT_TYPE,
  ]));
  for (const [constraintName, constraintType] of version31RequiredConstraints) {
    if (actualConstraints.get(constraintName) !== constraintType) {
      throw new Error(
        `Migration 0031 did not establish ${constraintType.toLowerCase()} ${constraintName}`,
      );
    }
  }
  const leftovers = version31RemovedConstraints.filter((name) => actualConstraints.has(name));
  if (leftovers.length > 0) {
    throw new Error(`Migration 0031 left legacy constraints: ${leftovers.join(", ")}`);
  }

  const [indexRows] = await connection.query(
    `SELECT DISTINCT INDEX_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'todo_personal'
        AND INDEX_NAME IN ('personal_tasks_source', 'todo_personal_source')`,
    [databaseName],
  );
  const indexNames = new Set(indexRows.map((row) => row.INDEX_NAME));
  if (!indexNames.has("todo_personal_source") || indexNames.has("personal_tasks_source")) {
    throw new Error("Migration 0031 did not normalize the todo_personal source index");
  }
}

async function assertVersion32Integrity(connection, databaseName) {
  const [columns] = await connection.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME IN ('log_groups', 'log_entries', 'journal_groups', 'journal_entries', 'trackers')`,
    [databaseName],
  );
  const columnNames = new Set(columns.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  for (const name of ["journal_groups.journal_group_id", "journal_entries.journal_entry_id", "trackers.journal_group_id"]) {
    if (!columnNames.has(name)) throw new Error(`Migration 0032 did not establish ${name}`);
  }
  if (columns.some((row) => row.TABLE_NAME.startsWith("log_") || row.COLUMN_NAME.startsWith("log_"))) {
    throw new Error("Migration 0032 left legacy personal journal table or column names");
  }

  const [constraints] = await connection.query(
    `SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME IN ('journal_groups', 'journal_entries', 'trackers')`,
    [databaseName],
  );
  const constraintTypes = new Map(constraints.map((row) => [row.CONSTRAINT_NAME, row.CONSTRAINT_TYPE]));
  for (const [name, type] of [
    ["journal_groups_name_length", "CHECK"],
    ["journal_entries_content", "CHECK"],
    ["journal_entries_source_length", "CHECK"],
    ["journal_entries_external_length", "CHECK"],
    ["journal_entries_tracker", "FOREIGN KEY"],
    ["journal_entries_event", "FOREIGN KEY"],
    ["trackers_group", "FOREIGN KEY"],
  ]) {
    if (constraintTypes.get(name) !== type) throw new Error(`Migration 0032 did not establish ${type} ${name}`);
  }
  const legacyConstraints = constraints.filter((row) => row.CONSTRAINT_NAME.startsWith("log_"));
  if (legacyConstraints.length > 0) {
    const details = legacyConstraints
      .map((row) => `${row.TABLE_NAME}.${row.CONSTRAINT_NAME} (${row.CONSTRAINT_TYPE})`)
      .sort()
      .join(", ");
    throw new Error(`Migration 0032 left legacy personal journal constraint names: ${details}`);
  }

  const [indexes] = await connection.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('journal_groups', 'journal_entries')`,
    [databaseName],
  );
  const indexNames = new Set(indexes.map((row) => row.INDEX_NAME));
  for (const name of ["journal_groups_name", "journal_entries_event", "journal_entries_source_external", "journal_entries_tracker_occurred"]) {
    if (!indexNames.has(name)) throw new Error(`Migration 0032 did not establish index ${name}`);
  }
  if (indexes.some((row) => row.INDEX_NAME.startsWith("log_"))) {
    throw new Error("Migration 0032 left legacy personal journal index names");
  }

  const [triggers] = await connection.query(
    `SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_STATEMENT FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE IN ('journal_entries', 'trackers')`,
    [databaseName],
  );
  const triggerTables = new Map(triggers.map((row) => [row.TRIGGER_NAME, row.EVENT_OBJECT_TABLE]));
  for (const [name, table] of [
    ["journal_entries_require_tracker_unit_before_insert", "journal_entries"],
    ["journal_entries_require_tracker_unit_before_update", "journal_entries"],
    ["trackers_preserve_numeric_unit_before_update", "trackers"],
  ]) {
    if (triggerTables.get(name) !== table) throw new Error(`Migration 0032 did not restore trigger ${name}`);
  }
  if (triggers.some((row) => row.TRIGGER_NAME.startsWith("log_") || /\blog_entries\b/u.test(row.ACTION_STATEMENT))) {
    throw new Error("Migration 0032 left legacy personal journal trigger references");
  }
}

export async function assertMigrationSpecificIntegrity(connection, migration, databaseName) {
  if (migration.version === 40) {
    const [tables] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('calendar_routines', 'calendar_events_todo_join', 'todo_routines')`, [databaseName]);
    const names = new Set(tables.map(row => row.TABLE_NAME));
    if (!names.has("calendar_routines") || !names.has("calendar_events_todo_join") || names.has("todo_routines")) {
      throw new Error("Migration 0040 must retain calendar routines and event/task joins and remove todo_routines");
    }
    const [columns] = await connection.query(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('todo_personal', 'calendar_events', 'catch_up_questions')`, [databaseName]);
    const present = new Set(columns.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
    for (const field of ["todo_routine_id", "scheduled_at_utc", "due_at_utc", "is_all_day", "duration_minutes"]) {
      if (present.has(`todo_personal.${field}`)) throw new Error(`Migration 0040 left temporal to-do column ${field}`);
    }
    for (const field of ["migration_personal_task_id", "migration_relationship_kind"]) {
      if (present.has(`calendar_events.${field}`)) throw new Error(`Migration 0040 left temporary calendar column ${field}`);
    }
    if (present.has("catch_up_questions.personal_task_id")) {
      throw new Error("Migration 0040 left task-derived catch-up storage");
    }
  }
  if (migration.version === 39) {
    const [tables] = await connection.query(`SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('calendar_routines', 'calendar_events_todo_join')`, [databaseName]);
    if (new Set(tables.map(row => row.TABLE_NAME)).size !== 2) {
      throw new Error("Migration 0039 did not create calendar routines and event/task joins");
    }
    const [missing] = await connection.query(`SELECT
      SUM(task.scheduled_at_utc IS NOT NULL AND work_link.calendar_event_id IS NULL) AS missing_work,
      SUM(task.due_at_utc IS NOT NULL AND deadline_link.calendar_event_id IS NULL) AS missing_deadline
      FROM todo_personal AS task
      LEFT JOIN calendar_events AS work_event
        ON work_event.migration_personal_task_id = task.personal_task_id
       AND work_event.migration_relationship_kind = 'work'
      LEFT JOIN calendar_events_todo_join AS work_link
        ON work_link.calendar_event_id = work_event.calendar_event_id
       AND work_link.personal_task_id = task.personal_task_id
       AND work_link.relationship_kind = 'work'
      LEFT JOIN calendar_events AS deadline_event
        ON deadline_event.migration_personal_task_id = task.personal_task_id
       AND deadline_event.migration_relationship_kind = 'deadline'
      LEFT JOIN calendar_events_todo_join AS deadline_link
        ON deadline_link.calendar_event_id = deadline_event.calendar_event_id
       AND deadline_link.personal_task_id = task.personal_task_id
       AND deadline_link.relationship_kind = 'deadline'`);
    if (Number(missing[0]?.missing_work || 0) !== 0 || Number(missing[0]?.missing_deadline || 0) !== 0) {
      throw new Error("Migration 0039 did not preserve every scheduled time and deadline as a linked calendar event");
    }
  }
  if (migration.version === 38) {
    const [rows] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'agent_turn_attempts'`,
      [databaseName],
    );
    if (rows.length > 0) throw new Error("Migration 0038 left the legacy agent_turn_attempts table in place");
  }
  if (migration.version === 37) {
    for (const [table, field, parent, role] of [
      ["todo_correspondence_join", "personal_task_id", "todo_personal", "task"],
      ["calendar_events_correspondence_join", "calendar_event_id", "calendar_events", "event"],
    ]) {
      const fail = (detail) => { throw new Error(`Migration 0037: ${table} ${detail}`); };
      const [columns] = await connection.query(`SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [databaseName, table]);
      for (const id of [field, "correspondence_id"]) {
        if (!columns.some(row => row.COLUMN_NAME === id && /^bigint(?:\(20\))? unsigned$/u.test(row.COLUMN_TYPE)
          && row.IS_NULLABLE === "NO")) fail(`is missing required unsigned ID ${id}`);
      }
      if (!columns.some(row => row.COLUMN_NAME === "created_at_utc" && row.COLUMN_TYPE === "varchar(32)"
        && row.IS_NULLABLE === "NO" && row.COLUMN_DEFAULT != null)) fail("is missing its creation timestamp default");
      const [indexes] = await connection.query(`SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [databaseName, table]);
      const primary = indexes.filter(row => row.INDEX_NAME === "PRIMARY" && Number(row.NON_UNIQUE) === 0)
        .map(row => row.COLUMN_NAME);
      if (JSON.stringify(primary) !== JSON.stringify([field, "correspondence_id"])) fail("is missing its unique pair primary key");
      if (!indexes.some(row => row.INDEX_NAME === `${table}_message` && row.COLUMN_NAME === "correspondence_id"
        && Number(row.SEQ_IN_INDEX) === 1)) fail("is missing the message lookup index");
      const [keys] = await connection.query(`SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME,
          k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE k
        JOIN information_schema.REFERENTIAL_CONSTRAINTS r
          ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME
          AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.CONSTRAINT_SCHEMA = ? AND k.TABLE_NAME = ?`, [databaseName, table]);
      for (const [suffix, column, target] of [[role, field, parent], ["message", "correspondence_id", "correspondence"]]) {
        if (!keys.some(row => row.CONSTRAINT_NAME === `${table}_${suffix}` && row.COLUMN_NAME === column
          && row.REFERENCED_TABLE_NAME === target && row.REFERENCED_COLUMN_NAME === column
          && row.DELETE_RULE === "CASCADE")) fail(`is missing cascading foreign key ${suffix}`);
      }
    }
  }
  if (migration.version === 36) {
    const [sourceColumns] = await connection.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'catch_up_questions'`, [databaseName]);
    const retainsTaskSource = sourceColumns.some(row => row.COLUMN_NAME === "personal_task_id");
    const [keys] = await connection.query(`SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'catch_up_questions'`, [databaseName]);
    for (const [name, column, table, target] of [
      ...(retainsTaskSource ? [["catch_up_task", "personal_task_id", "todo_personal", "personal_task_id"]] : []),
      ["catch_up_event", "calendar_event_id", "calendar_events", "calendar_event_id"],
      ["catch_up_tracker", "tracker_id", "trackers", "tracker_id"],
    ]) {
      if (!keys.some(row => row.CONSTRAINT_NAME === name && row.COLUMN_NAME === column
        && row.REFERENCED_TABLE_NAME === table && row.REFERENCED_COLUMN_NAME === target)) {
        throw new Error(`Migration 0036 did not establish source foreign key ${name}`);
      }
    }
    const [checks] = await connection.query(`SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME IN ('catch_up_questions', 'trackers') AND CONSTRAINT_TYPE = 'CHECK'`, [databaseName]);
    for (const name of ["catch_up_one_source", "catch_up_question_text", "trackers_asking_schedule"]) {
      if (!checks.some(row => row.CONSTRAINT_NAME === name)) throw new Error(`Migration 0036 is missing check ${name}`);
    }
    const [indexes] = await connection.query(`SELECT INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX, NON_UNIQUE
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'catch_up_questions'
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [databaseName]);
    for (const [name, field] of [...(retainsTaskSource ? [["catch_up_task_occurrence", "personal_task_id"]] : []),
      ["catch_up_event_occurrence", "calendar_event_id"], ["catch_up_tracker_period", "tracker_id"]]) {
      const columns = indexes.filter(row => row.INDEX_NAME === name && Number(row.NON_UNIQUE) === 0).map(row => row.COLUMN_NAME);
      if (JSON.stringify(columns) !== JSON.stringify([field, "occurrence_key"])) throw new Error(`Migration 0036 is missing unique source/occurrence index ${name}`);
    }
  }
  if (migration.version === 30) await assertVersion30Integrity(connection, databaseName);
  if (migration.version === 31) await assertVersion31Integrity(connection, databaseName);
  if (migration.version === 32) await assertVersion32Integrity(connection, databaseName);
  if (migration.version === 33) {
    const [rows] = await connection.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'notes'`,
      [databaseName],
    );
    if (rows.length > 0) throw new Error("Migration 0033 left the notes table in place");
  }
  if (migration.version === 34) {
    const [rows] = await connection.query(
      `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
          AND TABLE_NAME IN ('record_tags', 'contacts_tags_join', 'record_links')`,
      [databaseName],
    );
    if (rows.length !== 1 || rows[0].TABLE_NAME !== "contacts_tags_join" || rows[0].TABLE_TYPE !== "BASE TABLE") {
      throw new Error("Migration 0034 must leave contacts_tags_join and remove record_tags and record_links");
    }
  }
}

export async function assertGeneralMariaDbIntegrity(connection, expectedVersion, databaseName) {
  const [foreignKeyMode] = await connection.query(
    "SELECT @@SESSION.foreign_key_checks AS enabled",
  );
  if (Number(foreignKeyMode[0]?.enabled) !== 1) {
    throw new Error("FOREIGN_KEY_CHECKS must be enabled during Chapeaux Fous migrations");
  }

  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME`,
    [databaseName],
  );
  for (const tableName of tableRows.map((row) => row.TABLE_NAME).filter(Boolean)) {
    const [checkRows] = await connection.query(
      `CHECK TABLE ${quoteMariaDbIdentifier(tableName)} QUICK`,
    );
    const failures = checkRows.filter(
      (row) => String(row.Msg_type ?? "").toLowerCase() === "error"
        || (String(row.Msg_type ?? "").toLowerCase() === "status"
          && String(row.Msg_text ?? "").toLowerCase() !== "ok"),
    );
    if (failures.length > 0) {
      throw new Error(`MariaDB CHECK TABLE failed for ${tableName}: ${JSON.stringify(failures)}`);
    }
  }

  const [foreignKeyRows] = await connection.query(
    `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION,
            REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE CONSTRAINT_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
    [databaseName],
  );
  const constraints = new Map();
  for (const row of foreignKeyRows) {
    const key = `${row.TABLE_NAME}\u0000${row.CONSTRAINT_NAME}`;
    if (!constraints.has(key)) constraints.set(key, []);
    constraints.get(key).push(row);
  }
  for (const entries of constraints.values()) {
    const requiredValues = entries
      .map((entry) => `child.${quoteMariaDbIdentifier(entry.COLUMN_NAME)} IS NOT NULL`)
      .join(" AND ");
    const join = entries
      .map(
        (entry) => `parent.${quoteMariaDbIdentifier(entry.REFERENCED_COLUMN_NAME)} = child.${quoteMariaDbIdentifier(entry.COLUMN_NAME)}`,
      )
      .join(" AND ");
    const [orphanRows] = await connection.query(
      `SELECT 1 AS orphan
         FROM ${quoteMariaDbIdentifier(entries[0].TABLE_NAME)} child
        WHERE ${requiredValues}
          AND NOT EXISTS (
            SELECT 1 FROM ${quoteMariaDbIdentifier(entries[0].REFERENCED_TABLE_NAME)} parent WHERE ${join}
          )
        LIMIT 1`,
    );
    if (orphanRows.length > 0) {
      throw new Error(
        `Foreign-key integrity failed for ${entries[0].TABLE_NAME}.${entries[0].CONSTRAINT_NAME}`,
      );
    }
  }

  const currentVersion = await readCurrentSchemaVersion(connection, databaseName);
  if (currentVersion !== expectedVersion) {
    throw new Error(`Schema metadata does not report expected version ${expectedVersion}`);
  }
}

async function advanceSchemaVersion(connection, currentVersion, migration) {
  const [result] = await connection.query(
    `UPDATE database_meta
        SET schema_version = ?
      WHERE singleton = 1 AND schema_version = ?`,
    [migration.version, currentVersion],
  );
  if (Number(result?.affectedRows) !== 1) {
    throw new Error(`Could not advance schema version from ${currentVersion} to ${migration.version}`);
  }
}

export async function runDatabaseMigrations({
  connectionSettings = databaseConnectionFromEnvironment(),
  connect = (settings) => mysql.createConnection({
    ...settings,
    charset: "utf8mb4",
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: true,
  }),
  databaseName = connectionSettings.database,
  ledgerFilename = migrationsFilename,
  lockTimeoutSeconds = migrationLockTimeoutSeconds,
  backupConfirmed = process.env.SLAYER_MIGRATION_BACKUP_CONFIRMED === "1",
  writersStopped = process.env.SLAYER_MIGRATION_WRITERS_STOPPED === "1",
  output = process.stdout,
} = {}) {
  if (!databaseName) throw new Error("MARIADB_NAME is required for migration");
  const migrations = readMigrationLedger(ledgerFilename);
  const connection = await connect(connectionSettings);
  let lockAcquired = false;

  try {
    await acquireMigrationLock(connection, databaseName, lockTimeoutSeconds);
    lockAcquired = true;
    let currentVersion = await readCurrentSchemaVersion(connection, databaseName);
    const pending = validatePendingMigrations(migrations, currentVersion);

    if (pending.length === 0) {
      for (const migration of migrations.filter(({ version }) => version <= currentVersion)) {
        await assertMigrationSpecificIntegrity(connection, migration, databaseName);
      }
      await assertGeneralMariaDbIntegrity(connection, currentVersion, databaseName);
      output.write(`Chapeaux Fous MariaDB is already at schema version ${currentVersion}.\n`);
      return { previousVersion: currentVersion, currentVersion, applied: [] };
    }

    if (!backupConfirmed) {
      throw new Error(
        "Pending migrations require a recoverable backup. Set SLAYER_MIGRATION_BACKUP_CONFIRMED=1 only after confirming it.",
      );
    }
    const downtimeMigrations = pending.filter(({ sql }) => (
      /^-- writer downtime: required\b/imu.test(sql)
    ));
    if (downtimeMigrations.length > 0 && !writersStopped) {
      throw new Error(
        `Pending migrations ${downtimeMigrations.map(({ label }) => label).join(", ")} require database writers to be stopped. Set SLAYER_MIGRATION_WRITERS_STOPPED=1 after stopping Agent Slayer.`,
      );
    }

    output.write(
      "MariaDB DDL can implicitly commit. A failed migration is not automatically rolled back; keep writers stopped and follow db/MIGRATIONS.md recovery steps.\n",
    );
    output.write(`Pending migrations (oldest first): ${pending.map(({ label }) => label).join(", ")}.\n`);
    const previousVersion = currentVersion;
    for (const migration of pending) {
      const statements = splitMariaDbStatements(migration.sql, `migration ${migration.label}`);
      for (const statement of statements) await connection.query(statement);
      await assertMigrationSpecificIntegrity(connection, migration, databaseName);
      await assertGeneralMariaDbIntegrity(connection, currentVersion, databaseName);
      await advanceSchemaVersion(connection, currentVersion, migration);
      currentVersion = migration.version;
      output.write(`Applied migration ${migration.label}.\n`);
    }

    await assertGeneralMariaDbIntegrity(connection, currentVersion, databaseName);
    output.write(`Chapeaux Fous MariaDB migrated to schema version ${currentVersion}. Run npm run db:verify before restarting the service.\n`);
    return { previousVersion, currentVersion, applied: pending.map(({ version }) => version) };
  } finally {
    try {
      if (lockAcquired) await releaseMigrationLock(connection, databaseName);
    } finally {
      await connection.end();
    }
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const environmentFilename = path.join(repositoryRoot, ".env");
  if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);
  await runDatabaseMigrations();
}
