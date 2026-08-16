import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = path.resolve(moduleDirectory, "..");
const environmentFilename = path.join(repositoryRoot, ".env");
if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);

export const databaseFilename = path.resolve(
  repositoryRoot,
  process.env.SLAYER_DATABASE?.trim() || "data/agent.sqlite",
);
export const semanticFormFilename = path.join(repositoryRoot, "db", "schema-semantics.json");
export const migrationsFilename = path.join(repositoryRoot, "db", "migrations.sql");
