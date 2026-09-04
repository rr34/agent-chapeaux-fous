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

export async function assertMigrationSpecificIntegrity(connection, migration, databaseName) {
  if (migration.version === 30) await assertVersion30Integrity(connection, databaseName);
  if (migration.version === 31) await assertVersion31Integrity(connection, databaseName);
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
