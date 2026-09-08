#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { SlayerDatabase, inspectDatabase, summarizeDatabaseObjects } from "../src/database.mjs";
import { repositoryRoot } from "./agent-schema.mjs";
import { databaseConnectionFromEnvironment } from "./mariadb-schema.mjs";
import { assertMigrationSpecificIntegrity, migrationsFilename } from "./migrate-database.mjs";
import { readMigrationLedger } from "./database-migrations.mjs";

export async function verifyDatabase(database) {
  const inspection = inspectDatabase(database);
  if (!inspection.ready) {
    throw new Error(`Database is not compatible with Agent Slayer:\n- ${inspection.problems.join("\n- ")}`);
  }
  const databaseName = database.prepare("SELECT DATABASE() AS name").get().name;
  const connection = {
    query: async (sql, parameters = []) => [database.prepare(sql).all(...parameters)],
  };
  // Reuse reviewed migration postconditions for keys, indexes and trigger guards.
  // These checks only SELECT metadata; verification never runs a migration.
  for (const migration of readMigrationLedger(migrationsFilename)) {
    await assertMigrationSpecificIntegrity(connection, migration, databaseName);
  }
  const fullTextIndexes = database.prepare(`
    SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
           COLUMN_NAME AS column_name, SEQ_IN_INDEX AS position
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND INDEX_TYPE = 'FULLTEXT'
    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
  `).all();
  for (const [table, index, columns] of [
    ["files", "files_fulltext", ["title", "description", "original_filename"]],
    ["activity_events", "activity_events_fulltext", ["name", "content_text", "source"]],
  ]) {
    const actual = fullTextIndexes.filter(row => row.table_name === table && row.index_name === index)
      .map(row => row.column_name);
    if (JSON.stringify(actual) !== JSON.stringify(columns)) {
      throw new Error(`Required FULLTEXT index ${table}.${index} must cover ${columns.join(", ")}`);
    }
  }
  return {
    ...summarizeDatabaseObjects(inspection.objects.map(object => ({
      type: object.table_type === "BASE TABLE" ? "table" : "view",
    }))),
    fullTextIndexCount: new Set(fullTextIndexes.map(row => `${row.table_name}.${row.index_name}`)).size,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const environmentFilename = path.join(repositoryRoot, ".env");
  if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);

  const connection = databaseConnectionFromEnvironment();
  const store = new SlayerDatabase({ engine: "mariadb", connection });
  try {
    if (!store.status.ready) throw new Error(store.status.reason);
    const database = store.requireReady();
    const counts = await verifyDatabase(database);
    console.log(`Agent Slayer MariaDB database is ready: ${connection.database}`);
    console.log(
      `Verified ${counts.applicationTableCount} application tables and ${counts.applicationViewCount} views (${counts.applicationObjectCount} schema objects).`,
    );
    console.log(`Verified ${counts.fullTextIndexCount} FULLTEXT indexes and migration integrity.`);
  } finally {
    store.close();
  }
}
