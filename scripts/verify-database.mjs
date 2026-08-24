#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { inspectDatabase, summarizeDatabaseObjects } from "../src/database.mjs";
import { readMigrationLedger, validatePendingMigrations } from "./agent-migrations.mjs";
import { migrationsFilename, semanticFormFilename } from "./agent-schema.mjs";
import { agentSchemaVersion, assertAgentSemanticFormMatches } from "./agent-schema-semantics.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentFilename = path.join(repositoryRoot, ".env");
if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);
const filename = path.resolve(repositoryRoot, process.env.SLAYER_DATABASE?.trim() || "data/agent.sqlite");

if (!fs.existsSync(filename)) {
  console.error(`Database file is missing: ${filename}`);
  process.exitCode = 1;
} else {
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const result = inspectDatabase(database);
    if (!result.ready) {
      console.error("Database is not compatible with Agent Slayer:");
      for (const problem of result.problems) console.error(`- ${problem}`);
      process.exitCode = 1;
    } else {
      assertAgentSemanticFormMatches(database, semanticFormFilename);
      const pending = validatePendingMigrations(
        readMigrationLedger(migrationsFilename),
        agentSchemaVersion(database),
      );
      const counts = summarizeDatabaseObjects(result.objects);
      console.log(`Agent Slayer database is ready: ${filename}`);
      console.log(
        `Verified ${counts.applicationTableCount} logical application tables and ${counts.applicationViewCount} views (${counts.applicationObjectCount} logical schema objects).`,
      );
      console.log(
        `SQLite reports ${counts.sqliteObjectCount} non-internal table/view entries total, including ${counts.fts5ShadowTableCount} FTS5 shadow tables.`,
      );
      console.log("SQLite mechanics match db/schema-semantics.json.");
      if (pending.length) console.log(`${pending.length} unapplied schema migration${pending.length === 1 ? " is" : "s are"} present.`);
    }
  } finally {
    database.close();
  }
}
