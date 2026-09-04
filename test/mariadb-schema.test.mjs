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

test("the authoritative MariaDB baseline is complete at schema version 30", () => {
  const source = fs.readFileSync(path.join(root, "db", "mariadb", "0001-baseline.sql"), "utf8");
  const statements = parseMariaDbScript(source);
  assert.equal(statements.filter((statement) => /^CREATE TABLE\b/iu.test(statement)).length, 32);
  assert.equal(statements.filter((statement) => /^CREATE VIEW\b/iu.test(statement)).length, 7);
  assert.equal(statements.filter((statement) => /^CREATE TRIGGER\b/iu.test(statement)).length, 7);
  assert.equal(source.match(/\bENUM\(/gu)?.length, 33);
  assert.equal(source.match(/\bCHECK\s*\(/gu)?.length, 53);
  assert.equal(
    Object.values(requiredEnumColumns).reduce((count, fields) => count + Object.keys(fields).length, 0),
    33,
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
  assert.match(statements.at(-1), /VALUES \(1, 30, 'Chapeaux Fous MariaDB database'\)$/);
});

test("the version 30 enum migration is reviewable and safely replayable", () => {
  const source = fs.readFileSync(path.join(root, "db", "mariadb", "0030-enum-columns.sql"), "utf8");
  const statements = parseMariaDbScript(source);
  assert.match(source, /Stop every application writer/u);
  assert.match(source, /current mariadb-dump/u);
  assert.match(source, /WHERE status = 'completed'/u);
  assert.equal(source.match(/DROP CONSTRAINT IF EXISTS/gu)?.length, 33);
  assert.equal(source.match(/\bMODIFY [a-z_]+ ENUM\(/gu)?.length, 33);
  assert.match(statements.at(-2), /SET schema_version = 30/u);
  assert.match(statements.at(-1), /SET SESSION sql_mode = @chapeaux_fous_previous_sql_mode/u);
});
