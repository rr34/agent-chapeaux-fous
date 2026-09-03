#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import {
  assertMigrationTarget,
  findForeignKeyViolations,
  inspectMariaDbServer,
  parseMariaDbScript,
} from "./mariadb-migration.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentFilename = path.join(repositoryRoot, ".env");
if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);

function usage() {
  return `Usage:
  npm run db:mariadb:schema:migrate -- --database chapeauxfous_rehearsal
  npm run db:mariadb:schema:migrate -- --database chapeauxfous --allow-live --backup-confirmed

Required environment variables: MARIADB_USER, MARIADB_PASSWORD
(SLAYER_DATABASE_USER and SLAYER_DATABASE_PASSWORD are also accepted.)
Optional: MARIADB_HOST, MARIADB_PORT, MARIADB_SOCKET`;
}

function options(argv) {
  const parsed = { allowLive: false, backupConfirmed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-live") parsed.allowLive = true;
    else if (argument === "--backup-confirmed") parsed.backupConfirmed = true;
    else if (argument === "--database") {
      parsed.database = argv[index + 1];
      index += 1;
    } else if (argument === "--help" || argument === "-h") parsed.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return parsed;
}

function numeric(row, name) {
  return Number(row?.[name] ?? 0);
}

let connection;
try {
  const input = options(process.argv.slice(2));
  if (input.help) {
    console.log(usage());
    process.exit(0);
  }
  if (!input.database) throw new Error(`--database is required.\n\n${usage()}`);
  const databaseName = assertMigrationTarget(input.database, { allowLive: input.allowLive });
  const isLive = !databaseName.endsWith("_rehearsal");
  if (isLive && !input.backupConfirmed) {
    throw new Error("Live schema migration requires --backup-confirmed after a current MariaDB dump has been created.");
  }
  const user = process.env.MARIADB_USER?.trim() || process.env.SLAYER_DATABASE_USER?.trim();
  const password = process.env.MARIADB_PASSWORD ?? process.env.SLAYER_DATABASE_PASSWORD;
  if (!user || password == null) throw new Error(`MARIADB_USER and MARIADB_PASSWORD are required.\n\n${usage()}`);
  connection = await mysql.createConnection({
    host: process.env.MARIADB_HOST?.trim() || process.env.SLAYER_DATABASE_HOST?.trim() || "localhost",
    port: Number(process.env.MARIADB_PORT || process.env.SLAYER_DATABASE_PORT || 3306),
    socketPath: process.env.MARIADB_SOCKET?.trim() || process.env.SLAYER_DATABASE_SOCKET?.trim() || undefined,
    user,
    password,
    database: databaseName,
    charset: "utf8mb4",
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: true,
  });
  const server = await inspectMariaDbServer(connection, databaseName);
  const [[metadata]] = await connection.query("SELECT schema_version FROM database_meta WHERE singleton = 1");
  if (Number(metadata?.schema_version) !== 28) {
    throw new Error(`Expected MariaDB schema version 28, found ${metadata?.schema_version ?? "none"}.`);
  }
  const [[tables]] = await connection.query(`
    SELECT SUM(TABLE_NAME = 'personal_tasks') AS old_table,
           SUM(TABLE_NAME = 'todo_personal') AS new_table
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
  `);
  if (numeric(tables, "old_table") !== 1 || numeric(tables, "new_table") !== 0) {
    throw new Error("Expected personal_tasks to exist and todo_personal not to exist before migration.");
  }
  const [[before]] = await connection.query(`
    SELECT
      (SELECT COUNT(*) FROM personal_tasks) AS task_count,
      (SELECT COUNT(*) FROM todo_routines) AS routine_count,
      (SELECT COUNT(*) FROM todo_groups
        WHERE name = 'Inbox' AND archived_at_utc IS NULL) AS active_inbox_count,
      (SELECT COUNT(*)
         FROM personal_tasks AS task
         JOIN todo_groups AS todo_group USING (todo_group_id)
        WHERE todo_group.name = 'Routine') AS template_count,
      (SELECT COUNT(*)
         FROM todo_routines AS routine
         JOIN todo_groups AS todo_group USING (todo_group_id)
        WHERE todo_group.name = 'Routine') AS calendar_routine_count,
      (SELECT COUNT(*)
         FROM personal_tasks AS task
         JOIN todo_groups AS todo_group USING (todo_group_id)
        WHERE todo_group.name = 'Routine'
          AND task.todo_routine_id IS NULL) AS invalid_template_rows,
      (SELECT COUNT(*)
         FROM todo_routines AS routine
         JOIN todo_groups AS todo_group USING (todo_group_id)
         LEFT JOIN personal_tasks AS task
           ON task.todo_routine_id = routine.todo_routine_id
          AND task.todo_group_id = todo_group.todo_group_id
        WHERE todo_group.name = 'Routine'
          AND task.personal_task_id IS NULL) AS missing_template_rows,
      (SELECT COUNT(*)
         FROM reminders AS reminder
         JOIN personal_tasks AS task USING (personal_task_id)
         JOIN todo_groups AS todo_group USING (todo_group_id)
        WHERE todo_group.name = 'Routine') AS template_reminders,
      (SELECT COUNT(*)
         FROM video_jobs AS job
         JOIN personal_tasks AS task USING (personal_task_id)
         JOIN todo_groups AS todo_group USING (todo_group_id)
        WHERE todo_group.name = 'Routine') AS template_video_jobs,
      (SELECT COUNT(*)
         FROM personal_tasks AS task
         LEFT JOIN todo_routines AS routine
           ON task.external_id LIKE CONCAT('routine:', routine.todo_routine_id, ':%')
        WHERE task.source = 'routine_publish'
          AND routine.todo_routine_id IS NULL) AS invalid_publications
  `);
  if (numeric(before, "active_inbox_count") !== 1) {
    throw new Error("Migration requires exactly one active Inbox destination group; migration stopped before DDL.");
  }
  if (numeric(before, "invalid_template_rows") || numeric(before, "missing_template_rows")) {
    throw new Error("The legacy Routine group does not match the expected one-definition/linked-template model; migration stopped before DDL.");
  }
  if (numeric(before, "template_reminders") || numeric(before, "template_video_jobs")) {
    throw new Error("A hidden Routine task is still referenced by a reminder or video job; migration stopped before DDL.");
  }
  if (numeric(before, "invalid_publications")) {
    throw new Error("A routine_publish task does not identify an existing routine; migration stopped before DDL.");
  }
  console.log(`Preflight passed on MariaDB ${server.version}, ${databaseName}: ${before.task_count} tasks, ${before.routine_count} routines, ${before.template_count} removable template rows.`);

  const sql = fs.readFileSync(path.join(repositoryRoot, "db/mariadb/0002-todo-routine-normalization.sql"), "utf8");
  for (const statement of parseMariaDbScript(sql)) await connection.query(statement);

  const [[after]] = await connection.query(`
    SELECT
      (SELECT schema_version FROM database_meta WHERE singleton = 1) AS schema_version,
      (SELECT COUNT(*) FROM todo_personal) AS task_count,
      (SELECT COUNT(*) FROM todo_routines) AS routine_count,
      (SELECT COUNT(*) FROM todo_personal WHERE source = 'routine_publish' AND todo_routine_id IS NULL) AS unlinked_publications,
      (SELECT COUNT(*) FROM todo_routines WHERE publication_mode = 'calendar') AS calendar_routines
  `);
  const expectedTasks = numeric(before, "task_count") - numeric(before, "template_count");
  if (numeric(after, "schema_version") !== 29
      || numeric(after, "task_count") !== expectedTasks
      || numeric(after, "routine_count") !== numeric(before, "routine_count")
      || numeric(after, "calendar_routines") !== numeric(before, "calendar_routine_count")
      || numeric(after, "unlinked_publications") !== 0) {
    throw new Error(`Post-migration counts are invalid: ${JSON.stringify({ before, after, expectedTasks })}`);
  }
  const violations = await findForeignKeyViolations(connection, databaseName);
  if (violations.length) throw new Error(`Foreign-key violations found: ${JSON.stringify(violations)}`);
  console.log(`Migration passed: ${after.task_count} actual tasks, ${after.routine_count} routine definitions, ${after.calendar_routines} calendar-published routines, no foreign-key orphans.`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
} finally {
  await connection?.end();
}
