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

test("the authoritative MariaDB baseline is complete at schema version 29", () => {
  const source = fs.readFileSync(path.join(root, "db", "mariadb", "0001-baseline.sql"), "utf8");
  const statements = parseMariaDbScript(source);
  assert.equal(statements.filter((statement) => /^CREATE TABLE\b/iu.test(statement)).length, 32);
  assert.equal(statements.filter((statement) => /^CREATE VIEW\b/iu.test(statement)).length, 7);
  assert.equal(statements.filter((statement) => /^CREATE TRIGGER\b/iu.test(statement)).length, 7);
  assert.match(statements.at(-1), /VALUES \(1, 29, 'Chapeaux Fous MariaDB database'\)$/);
});
