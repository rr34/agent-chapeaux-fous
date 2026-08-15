#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { inspectDatabase } from "../src/database.mjs";

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
      console.log(`Agent Slayer database is ready: ${filename}`);
      console.log(`Verified ${result.objects.length} user-defined tables and views.`);
    }
  } finally {
    database.close();
  }
}
