#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { repositoryRoot } from "./agent-schema.mjs";
import { writeAgentSemanticForm } from "./agent-schema-semantics.mjs";
import { databaseConnectionFromEnvironment } from "./mariadb-schema.mjs";

const environmentFilename = path.join(repositoryRoot, ".env");
if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);

const database = new MariaDatabaseSync(databaseConnectionFromEnvironment());
try {
  const report = await writeAgentSemanticForm(database, {
    seedComments: process.argv.includes("--seed-comments"),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  database.close();
}
