import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { backup, DatabaseSync } from "node:sqlite";
import {
  databaseFilename as defaultDatabaseFilename,
  migrationsFilename,
} from "./agent-schema.mjs";
import { readMigrationLedger, validatePendingMigrations } from "./agent-migrations.mjs";
import {
  agentSchemaVersion,
  assertAgentSemanticFormMatches,
  writeAgentSemanticForm,
} from "./agent-schema-semantics.mjs";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return path.resolve(value);
}

const databaseFilename = optionValue("--database") ?? defaultDatabaseFilename;
const updateSemanticForm = !process.argv.includes("--no-semantics");

function assertHealthy(database) {
  const foreignKeyFailures = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyFailures.length > 0) {
    throw new Error(`Foreign-key check failed: ${JSON.stringify(foreignKeyFailures)}`);
  }
  const integrity = database.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") {
    throw new Error(`Integrity check failed: ${JSON.stringify(integrity)}`);
  }
}

async function main() {
  if (!fs.existsSync(databaseFilename)) {
    throw new Error(`Agent database not found: ${databaseFilename}`);
  }

  const database = new DatabaseSync(databaseFilename);
  database.exec("PRAGMA foreign_keys = ON");

  try {
    assertHealthy(database);
    // Migrations are run only while database writers are stopped. Fold any
    // committed WAL pages into the main file so backups and file-level test
    // copies contain the same durable schema that SQLite sees here.
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    const currentVersion = agentSchemaVersion(database);
    const allMigrations = readMigrationLedger(migrationsFilename);
    const pending = validatePendingMigrations(allMigrations, currentVersion);
    if (pending.length === 0) {
      if (updateSemanticForm) assertAgentSemanticFormMatches(database);
      process.stdout.write(`Agent database is already at schema version ${currentVersion}.\n`);
      return;
    }

    const backupDirectory = path.join(path.dirname(databaseFilename), "backups");
    fs.mkdirSync(backupDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const backupFilename = path.join(
      backupDirectory,
      `agent-before-v${pending[0].version}-${timestamp}.sqlite`,
    );
    await backup(database, backupFilename);
    process.stdout.write(`Backup created: ${backupFilename}\n`);

    for (const migration of pending) {
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(migration.sql);
        database.prepare(`
          UPDATE database_meta
          SET schema_version = ?
          WHERE singleton = 1
        `).run(migration.version);
        assertHealthy(database);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      process.stdout.write(`Applied migration ${migration.label}.\n`);
    }

    assertHealthy(database);
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    if (updateSemanticForm) writeAgentSemanticForm(database);
    process.stdout.write(`Agent database migrated to schema version ${agentSchemaVersion(database)}.\n`);
  } finally {
    database.close();
  }
}

await main();
