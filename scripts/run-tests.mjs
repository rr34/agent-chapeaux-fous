import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import {
  databaseConnectionFromEnvironment,
  quoteMariaDbIdentifier,
} from "./mariadb-schema.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentFilename = path.join(repositoryRoot, ".env");
if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);

const mode = process.argv[2] ?? "all";
if (!["all", "unit", "integration"].includes(mode)) {
  throw new Error(`Unknown test mode ${mode}; expected all, unit, or integration`);
}

const testRoot = path.join(repositoryRoot, "test");
const files = fs.readdirSync(testRoot)
  .filter((filename) => filename.endsWith(".test.mjs"))
  .sort()
  .map((filename) => path.join("test", filename));
const integrationFiles = new Set(files.filter((filename) => (
  fs.readFileSync(path.join(repositoryRoot, filename), "utf8").includes('from "./helpers.mjs"')
)));
const selectedFiles = files.filter((filename) => (
  mode === "all"
  || (mode === "integration" ? integrationFiles.has(filename) : !integrationFiles.has(filename))
));

function verifyTestDatabaseAccess() {
  const configured = databaseConnectionFromEnvironment(process.env, { test: true });
  const { database: _configuredDatabase, ...adminConnection } = configured;
  const databaseName = `agent_slayer_test_probe_${process.pid}_${randomBytes(6).toString("hex")}`;
  const quotedName = quoteMariaDbIdentifier(databaseName);
  let admin;
  let created = false;
  try {
    admin = new MariaDatabaseSync(adminConnection);
    admin.exec(`CREATE DATABASE ${quotedName} CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);
    created = true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      "Integration tests require a MariaDB account that can create and drop isolated databases. "
      + "Set MARIADB_TEST_USER and MARIADB_TEST_PASSWORD (plus host, port, or socket when needed) "
      + `in .env. Preflight failed: ${detail}`,
    );
  } finally {
    if (admin) {
      try {
        if (created) admin.exec(`DROP DATABASE ${quotedName}`);
      } finally {
        admin.close();
      }
    }
  }
}

if (mode !== "unit") verifyTestDatabaseAccess();

const result = spawnSync(process.execPath, ["--test", ...selectedFiles], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
