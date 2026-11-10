#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { loadIdentityDatabaseTarget, repositoryRoot } from "../src/config.mjs";
import {
  readMigrationLedger, splitMariaDbStatements, validatePendingMigrations,
} from "./database-migrations.mjs";

export const identityMigrationsFilename = path.join(repositoryRoot, "db/identity/migrations.sql");
export const identityMigrationLockTimeoutSeconds = 30;

function lockName(databaseName) {
  const value = `timev3-identity:migrations:${databaseName}`;
  if (value.length > 64) throw new Error("Identity migration advisory-lock name exceeds 64 characters");
  return value;
}

async function acquireLock(connection, databaseName, timeoutSeconds) {
  const [rows] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [lockName(databaseName), timeoutSeconds]);
  if (Number(rows[0]?.acquired) !== 1) {
    throw new Error(`Could not acquire the Time v3 Identity migration lock within ${timeoutSeconds} seconds`);
  }
}

async function releaseLock(connection, databaseName) {
  const [rows] = await connection.query("SELECT RELEASE_LOCK(?) AS released", [lockName(databaseName)]);
  if (Number(rows[0]?.released) !== 1) throw new Error("Identity migration advisory lock was not owned by this connection");
}

export async function readCurrentIdentitySchemaVersion(connection, databaseName) {
  const [tables] = await connection.query(`
    SELECT COUNT(*) AS table_count
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'identity_meta' AND TABLE_TYPE = 'BASE TABLE'
  `, [databaseName]);
  if (Number(tables[0]?.table_count) !== 1) {
    throw new Error("identity_meta is missing; initialize the database from db/identity/0001-baseline.sql");
  }
  const [rows] = await connection.query("SELECT singleton, schema_version FROM identity_meta");
  const version = Number(rows[0]?.schema_version);
  if (rows.length !== 1 || Number(rows[0]?.singleton) !== 1 || !Number.isInteger(version) || version < 1) {
    throw new Error("identity_meta must contain exactly one valid singleton row");
  }
  return version;
}

async function assertMigrationIntegrity(connection, migration, databaseName) {
  if (migration.version !== 2) return;
  const [columns] = await connection.query(`
    SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLLATION_NAME
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND (
       (TABLE_NAME = 'accounts' AND COLUMN_NAME IN ('email', 'email_normalized'))
       OR (TABLE_NAME = 'people' AND COLUMN_NAME IN ('account_id', 'created_by_account_id'))
     )
  `, [databaseName]);
  const byName = new Map(columns.map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]));
  const [tables] = await connection.query(`
    SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'account_people'
  `, [databaseName]);
  const accountId = byName.get("people.account_id");
  const email = byName.get("accounts.email");
  if (tables.length || byName.has("accounts.email_normalized") || byName.has("people.created_by_account_id")
    || !accountId || accountId.IS_NULLABLE !== "NO" || email?.COLLATION_NAME !== "utf8mb4_bin") {
    throw new Error("Identity migration 0002 did not establish direct person ownership and canonical email storage");
  }
}

async function advanceVersion(connection, currentVersion, migration) {
  const [result] = await connection.query(`
    UPDATE identity_meta SET schema_version = ?
     WHERE singleton = 1 AND schema_version = ?
  `, [migration.version, currentVersion]);
  if (Number(result?.affectedRows) !== 1) {
    throw new Error(`Could not advance Identity schema version from ${currentVersion} to ${migration.version}`);
  }
}

export async function runIdentityMigrations({
  connectionSettings = loadIdentityDatabaseTarget().connection,
  connect = (settings) => mysql.createConnection({
    ...settings, charset: "utf8mb4", dateStrings: true, supportBigNumbers: true, bigNumberStrings: true,
  }),
  databaseName = connectionSettings.database,
  ledgerFilename = identityMigrationsFilename,
  lockTimeoutSeconds = identityMigrationLockTimeoutSeconds,
  backupConfirmed = process.env.SLAYER_MIGRATION_BACKUP_CONFIRMED === "1",
  writersStopped = process.env.SLAYER_MIGRATION_WRITERS_STOPPED === "1",
  output = process.stdout,
} = {}) {
  if (!databaseName) throw new Error("TIMEV3_IDENTITY_MARIADB_NAME is required for migration");
  const migrations = readMigrationLedger(ledgerFilename);
  const connection = await connect(connectionSettings);
  let locked = false;
  try {
    await acquireLock(connection, databaseName, lockTimeoutSeconds);
    locked = true;
    let currentVersion = await readCurrentIdentitySchemaVersion(connection, databaseName);
    const pending = validatePendingMigrations(migrations, currentVersion);
    if (!pending.length) {
      for (const migration of migrations.filter(({ version }) => version <= currentVersion)) {
        await assertMigrationIntegrity(connection, migration, databaseName);
      }
      output.write(`Time v3 Identity is already at schema version ${currentVersion}.\n`);
      return { previousVersion: currentVersion, currentVersion, applied: [] };
    }
    if (!backupConfirmed) {
      throw new Error("Pending Identity migrations require a recoverable backup. Set SLAYER_MIGRATION_BACKUP_CONFIRMED=1 only after confirming it.");
    }
    const downtime = pending.filter(({ sql }) => /^-- writer downtime: required\b/imu.test(sql));
    if (downtime.length && !writersStopped) {
      throw new Error(`Pending Identity migrations ${downtime.map(({ label }) => label).join(", ")} require writers to be stopped. Set SLAYER_MIGRATION_WRITERS_STOPPED=1 after stopping Agent Slayer.`);
    }
    output.write("MariaDB DDL can implicitly commit. A failed migration is not automatically rolled back; keep writers stopped and follow db/identity/MIGRATIONS.md.\n");
    output.write(`Pending Identity migrations (oldest first): ${pending.map(({ label }) => label).join(", ")}.\n`);
    const previousVersion = currentVersion;
    for (const migration of pending) {
      for (const statement of splitMariaDbStatements(migration.sql, `identity migration ${migration.label}`)) {
        await connection.query(statement);
      }
      await assertMigrationIntegrity(connection, migration, databaseName);
      await advanceVersion(connection, currentVersion, migration);
      currentVersion = migration.version;
      output.write(`Applied Identity migration ${migration.label}.\n`);
    }
    output.write(`Time v3 Identity migrated to schema version ${currentVersion}. Run npm run identity:verify before restarting the service.\n`);
    return { previousVersion, currentVersion, applied: pending.map(({ version }) => version) };
  } finally {
    try {
      if (locked) await releaseLock(connection, databaseName);
    } finally {
      await connection.end();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runIdentityMigrations();
}
