#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { inspectDatabase } from "../src/database.mjs";
import { semanticFormFilename } from "./agent-schema.mjs";
import { agentSchemaVersion, assertAgentSemanticFormMatches } from "./agent-schema-semantics.mjs";
import {
  applyMariaDbSchema,
  assertEmptyMariaDbDatabase,
  assertMigrationTarget,
  digestMariaDbTable,
  findForeignKeyViolations,
  importSqliteTable,
  inspectMariaDbServer,
  readApplicationTables,
} from "./mariadb-migration.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentFilename = path.join(repositoryRoot, ".env");
if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);

function usage() {
  return `Usage:
  npm run db:mariadb:rehearse -- --source /tmp/chapeaux-fous-rehearsal.sqlite --database chapeauxfous_rehearsal

Required MariaDB environment variables:
  MARIADB_USER, MARIADB_PASSWORD

Optional:
  MARIADB_HOST (default localhost), MARIADB_PORT (default 3306), MARIADB_SOCKET
  --allow-live   Permit a database name that does not end in _rehearsal.`;
}

function parseArguments(argv) {
  const result = { allowLive: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-live") result.allowLive = true;
    else if (argument === "--source" || argument === "--database") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      result[argument.slice(2)] = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

let sqlite;
let maria;
try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!options.source || !options.database) throw new Error(`--source and --database are required.\n\n${usage()}`);
  const sourceFilename = path.resolve(options.source);
  if (!fs.existsSync(sourceFilename)) throw new Error(`SQLite source is missing: ${sourceFilename}`);
  const databaseName = assertMigrationTarget(options.database, { allowLive: options.allowLive });
  const user = process.env.MARIADB_USER?.trim();
  const password = process.env.MARIADB_PASSWORD;
  if (!user || password == null) throw new Error(`MARIADB_USER and MARIADB_PASSWORD are required.\n\n${usage()}`);

  sqlite = new DatabaseSync(sourceFilename, { readOnly: true });
  sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const sourceVersion = agentSchemaVersion(sqlite);
  if (sourceVersion !== 28) {
    throw new Error(
      `SQLite source schema version is ${sourceVersion}; expected 28. `
      + `Migrate the disposable copy first:\n  npm run schema:migrate -- --database ${sourceFilename} --no-semantics`,
    );
  }
  const sourceInspection = inspectDatabase(sqlite);
  if (!sourceInspection.ready) {
    throw new Error(`SQLite source is not compatible:\n- ${sourceInspection.problems.join("\n- ")}`);
  }
  assertAgentSemanticFormMatches(sqlite, semanticFormFilename);

  maria = await mysql.createConnection({
    host: process.env.MARIADB_HOST?.trim() || "localhost",
    port: Number(process.env.MARIADB_PORT || 3306),
    socketPath: process.env.MARIADB_SOCKET?.trim() || undefined,
    user,
    password,
    database: databaseName,
    charset: "utf8mb4",
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: true,
  });

  const server = await inspectMariaDbServer(maria, databaseName);
  console.log(`Source verified: ${sourceFilename} (schema version ${sourceVersion})`);
  console.log(`Destination verified: MariaDB ${server.version}, ${databaseName} (${server.character_set}/${server.collation})`);
  await assertEmptyMariaDbDatabase(maria, databaseName);

  const schemaSource = fs.readFileSync(path.join(repositoryRoot, "db/mariadb/0001-baseline.sql"), "utf8");
  const { applied, deferredTriggers } = await applyMariaDbSchema(maria, schemaSource);
  console.log(`Applied ${applied} schema statements; ${deferredTriggers.length} data-sensitive triggers deferred.`);

  const tables = readApplicationTables(semanticFormFilename);
  const reports = [];
  await maria.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
  try {
    for (const tableName of tables) {
      const report = await importSqliteTable({ sqlite, maria, tableName });
      reports.push(report);
      console.log(`Imported ${tableName}: ${report.count} rows`);
    }
  } finally {
    await maria.query("SET SESSION FOREIGN_KEY_CHECKS = 1");
  }

  for (const statement of deferredTriggers) await maria.query(statement);
  console.log(`Applied ${deferredTriggers.length} deferred triggers.`);

  const mismatches = [];
  for (const report of reports) {
    const destination = await digestMariaDbTable(maria, report);
    if (destination.count !== report.count || destination.digest !== report.sourceDigest) {
      mismatches.push({
        tableName: report.tableName,
        sourceCount: report.count,
        destinationCount: destination.count,
        sourceDigest: report.sourceDigest,
        destinationDigest: destination.digest,
      });
    }
  }
  const foreignKeyViolations = await findForeignKeyViolations(maria, databaseName);
  if (mismatches.length || foreignKeyViolations.length) {
    throw new Error(
      `Migration verification failed:\n${JSON.stringify({ mismatches, foreignKeyViolations }, null, 2)}`,
    );
  }

  const totalRows = reports.reduce((sum, report) => sum + report.count, 0);
  console.log(`Rehearsal passed: ${tables.length} tables, ${totalRows} rows, all row digests equal, no foreign-key orphans.`);
  console.log("The live database was not touched.");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
} finally {
  sqlite?.close();
  await maria?.end();
}
