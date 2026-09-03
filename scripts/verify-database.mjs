#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { SlayerDatabase, inspectDatabase, summarizeDatabaseObjects } from "../src/database.mjs";
import { repositoryRoot, semanticFormFilename } from "./agent-schema.mjs";
import { assertAgentSemanticFormMatches } from "./agent-schema-semantics.mjs";
import { databaseConnectionFromEnvironment } from "./mariadb-schema.mjs";

const environmentFilename = path.join(repositoryRoot, ".env");
if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);

const connection = databaseConnectionFromEnvironment();
const store = new SlayerDatabase({ engine: "mariadb", connection });
try {
  if (!store.status.ready) throw new Error(store.status.reason);
  const database = store.requireReady();
  const inspection = inspectDatabase(database);
  if (!inspection.ready) {
    throw new Error(`Database is not compatible with Agent Slayer:\n- ${inspection.problems.join("\n- ")}`);
  }
  await assertAgentSemanticFormMatches(database, semanticFormFilename);
  const counts = summarizeDatabaseObjects(store.objects());
  const fullTextIndexes = database.prepare(`
    SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME) AS count
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND INDEX_TYPE = 'FULLTEXT'
  `).get();
  console.log(`Agent Slayer MariaDB database is ready: ${connection.database}`);
  console.log(
    `Verified ${counts.applicationTableCount} application tables and ${counts.applicationViewCount} views (${counts.applicationObjectCount} schema objects).`,
  );
  console.log(`Verified ${Number(fullTextIndexes.count)} FULLTEXT indexes and db/schema-semantics.json mechanics.`);
} finally {
  store.close();
}
