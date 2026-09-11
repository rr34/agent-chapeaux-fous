import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  databaseConnectionFromEnvironment,
  parseMariaDbScript,
  quoteMariaDbIdentifier,
} from "../scripts/mariadb-schema.mjs";
import { readMigrationLedger, splitMariaDbStatements } from "../scripts/database-migrations.mjs";
import { requiredEnumColumns } from "../src/database.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("MariaDB schema parsing preserves compound trigger statements", () => {
  const statements = parseMariaDbScript(`
    CREATE TABLE example (id BIGINT PRIMARY KEY);
    DELIMITER //
    CREATE TRIGGER example_before_insert
    BEFORE INSERT ON example
    FOR EACH ROW
    BEGIN
      SET NEW.id = COALESCE(NEW.id, 1);
    END//
    DELIMITER ;
    INSERT INTO example (id) VALUES (1);
  `);
  assert.equal(statements.length, 3);
  assert.match(statements[1], /^CREATE TRIGGER/);
  assert.match(statements[1], /END$/);
});

test("MariaDB connection settings validate names and ports", () => {
  const environment = {
    MARIADB_ENGINE: "mariadb",
    MARIADB_HOST: "db.internal",
    MARIADB_PORT: "3307",
    MARIADB_NAME: "chapeauxfous",
    MARIADB_USER: "app",
    MARIADB_PASSWORD: "secret",
  };
  assert.deepEqual(databaseConnectionFromEnvironment(environment), {
    host: "db.internal",
    port: 3307,
    socketPath: undefined,
    user: "app",
    password: "secret",
    database: "chapeauxfous",
  });
  assert.equal(quoteMariaDbIdentifier("chapeauxfous"), "`chapeauxfous`");
  assert.throws(
    () => databaseConnectionFromEnvironment({ ...environment, MARIADB_PORT: "0" }),
    /integer from 1 to 65535/,
  );
  assert.throws(
    () => databaseConnectionFromEnvironment({ ...environment, MARIADB_NAME: "bad-name" }),
    /valid MariaDB identifier/,
  );
  assert.throws(
    () => databaseConnectionFromEnvironment({
      SLAYER_DATABASE_NAME: "chapeauxfous",
      SLAYER_DATABASE_USER: "app",
      SLAYER_DATABASE_PASSWORD: "secret",
    }),
    /MARIADB_ENGINE must be mariadb/,
  );
});

test("the authoritative MariaDB baseline is complete at schema version 38", () => {
  const source = fs.readFileSync(path.join(root, "db", "mariadb", "0001-baseline.sql"), "utf8");
  const statements = parseMariaDbScript(source);
  assert.equal(statements.filter((statement) => /^CREATE TABLE\b/iu.test(statement)).length, 32);
  assert.equal(statements.filter((statement) => /^CREATE VIEW\b/iu.test(statement)).length, 7);
  assert.equal(statements.filter((statement) => /^CREATE TRIGGER\b/iu.test(statement)).length, 7);
  assert.equal(source.match(/\bENUM\(/gu)?.length, 29);
  assert.equal(source.match(/\bCHECK\s*\(/gu)?.length, 52);
  assert.equal(
    Object.values(requiredEnumColumns).reduce((count, fields) => count + Object.keys(fields).length, 0),
    29,
  );
  for (const [tableName, fields] of Object.entries(requiredEnumColumns)) {
    const table = statements.find((statement) => statement.startsWith(`CREATE TABLE ${tableName} `));
    assert.ok(table, `missing table ${tableName}`);
    const normalizedTable = table.replace(/\s+/gu, " ");
    for (const [fieldName, values] of Object.entries(fields)) {
      const declaration = `${fieldName} ENUM(${values.map((value) => `'${value}'`).join(", ")})`;
      assert.ok(normalizedTable.includes(declaration), `missing enum declaration ${tableName}.${declaration}`);
    }
  }
  assert.doesNotMatch(source, /CHECK \([^\n]*(?:IS NULL OR )?[a-z_]+ IN \('[^\n]+\)\)/u);
  assert.match(
    source,
    /status\s+ENUM\('tentative', 'confirmed', 'cancelled'\) NOT NULL DEFAULT 'confirmed'/u,
  );
  assert.doesNotMatch(source, /calendar_events_status|ENUM\([^\n]*'completed'[^\n]*\) NOT NULL DEFAULT 'confirmed'/u);
  assert.doesNotMatch(source, /CREATE TABLE agent_turn_attempts\b/u);
  assert.match(statements.at(-1), /VALUES \(1, 38, 'Chapeaux Fous MariaDB database'\)$/);
});

test("the correspondence join migration matches fresh-install definitions without rewriting existing records", () => {
  const migration = readMigrationLedger(path.join(root, "db", "migrations.sql")).find(item => item.version === 37);
  const baseline = parseMariaDbScript(fs.readFileSync(path.join(root, "db", "mariadb", "0001-baseline.sql"), "utf8"));
  const normalize = sql => sql.replace(/^--.*$/gmu, "").replace("CREATE TABLE IF NOT EXISTS", "CREATE TABLE").replace(/\s+/gu, " ").trim().replace(/;$/u, "");
  const statements = splitMariaDbStatements(migration.sql);
  assert.equal(statements.length, 2);
  for (const statement of statements) {
    assert.ok(baseline.some(candidate => normalize(candidate) === normalize(statement)));
    assert.match(normalize(statement), /^CREATE TABLE (?:todo_correspondence_join|calendar_events_correspondence_join) /u);
  }
  assert.match(migration.sql, /writer downtime: not required/u);
});

test("the version 30 enum migration is a reviewable ledger block", () => {
  const migration = readMigrationLedger(path.join(root, "db", "migrations.sql"))
    .find(({ version }) => version === 30);
  const statements = splitMariaDbStatements(migration.sql);
  assert.equal(migration.label, "0030:native-enum-columns");
  assert.match(migration.sql, /writer downtime: required/u);
  assert.match(migration.sql, /recovery: MariaDB DDL commits implicitly/u);
  assert.match(migration.sql, /resumable block/u);
  const source = migration.sql;
  assert.match(source, /WHERE status = 'completed'/u);
  assert.equal(source.match(/DROP CONSTRAINT IF EXISTS/gu)?.length, 33);
  assert.equal(source.match(/\bMODIFY [a-z_]+ ENUM\(/gu)?.length, 33);
  assert.match(statements.at(-1), /SET SESSION sql_mode = @chapeaux_fous_previous_sql_mode/u);
  assert.doesNotMatch(source, /UPDATE database_meta/u);
});

test("the version 31 migration normalizes legacy todo_personal constraint names", () => {
  const migration = readMigrationLedger(path.join(root, "db", "migrations.sql"))
    .find(({ version }) => version === 31);
  assert.equal(migration.label, "0031:normalize-todo-personal-constraint-names");
  assert.match(migration.sql, /writer downtime: required/u);
  assert.match(migration.sql, /DROP CONSTRAINT IF EXISTS personal_tasks_group/u);
  assert.match(migration.sql, /DROP INDEX IF EXISTS personal_tasks_source/u);
  assert.match(migration.sql, /ADD CONSTRAINT todo_personal_source/u);
  assert.match(migration.sql, /ADD CONSTRAINT todo_personal_prompt/u);
  assert.doesNotMatch(migration.sql, /UPDATE database_meta/u);
});

test("the Journal migration preserves the baseline's tracker-unit guards as complete prepared statements", () => {
  const migration = readMigrationLedger(path.join(root, "db", "migrations.sql"))
    .find(({ version }) => version === 32);
  const statements = splitMariaDbStatements(migration.sql);
  const baseline = parseMariaDbScript(fs.readFileSync(path.join(root, "db", "mariadb", "0001-baseline.sql"), "utf8"));
  const normalize = (sql) => sql.replace(/\s+/gu, " ").trim();
  const triggerStatements = statements.filter((sql) => sql.startsWith("SET @journal_migration_sql = 'CREATE TRIGGER"));
  assert.equal(triggerStatements.length, 3);
  for (const statement of triggerStatements) {
    const sql = statement.slice("SET @journal_migration_sql = '".length, -2).replaceAll("''", "'");
    assert.ok(baseline.some((candidate) => normalize(candidate) === normalize(sql)));
  }
  assert.match(migration.sql, /writer downtime: required/u);
  assert.doesNotMatch(migration.sql, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE|UPDATE activity_events|UPDATE database_meta)\b/iu);
});

test("Journal migration drops foreign keys explicitly before separate replacement statements", () => {
  const migration = readMigrationLedger(path.join(root, "db", "migrations.sql"))
    .find(({ version }) => version === 32);
  const statements = splitMariaDbStatements(migration.sql).map((sql) => sql.replace(/^--.*$/gmu, ""));
  for (const [table, current, previous] of [
    ["trackers", "trackers_group", null],
    ["journal_entries", "journal_entries_tracker", "log_entries_tracker"],
    ["journal_entries", "journal_entries_event", "log_entries_event"],
  ]) {
    const addIndex = statements.findIndex((sql) => sql.includes(`ADD CONSTRAINT ${current} FOREIGN KEY`));
    assert.ok(addIndex >= 0);
    for (const name of [current, previous].filter(Boolean)) {
      const dropIndex = statements.findIndex((sql) => sql.includes(`DROP FOREIGN KEY IF EXISTS ${name}`));
      assert.ok(dropIndex >= 0 && dropIndex < addIndex, `${table}.${name} must be dropped before its replacement`);
      assert.doesNotMatch(statements[dropIndex], /\bADD CONSTRAINT\b/u);
      assert.ok(!migration.sql.includes(`DROP CONSTRAINT IF EXISTS ${name}`));
    }
  }
});
