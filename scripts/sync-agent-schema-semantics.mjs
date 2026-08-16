import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { databaseFilename as defaultDatabaseFilename } from "./agent-schema.mjs";
import { writeAgentSemanticForm } from "./agent-schema-semantics.mjs";

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return path.resolve(value);
}

const databaseFilename = optionValue("--database") ?? defaultDatabaseFilename;
if (!fs.existsSync(databaseFilename)) throw new Error(`Agent database not found: ${databaseFilename}`);

const database = new DatabaseSync(databaseFilename, { readOnly: true });
try {
  const report = writeAgentSemanticForm(database, {
    seedComments: process.argv.includes("--seed-comments"),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  database.close();
}
