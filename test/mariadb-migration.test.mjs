import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertMigrationTarget,
  chunkRows,
  hashRows,
  parseMariaDbScript,
  quoteMariaDbIdentifier,
} from "../scripts/mariadb-migration.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("MariaDB migration target is rehearsal-only by default", () => {
  assert.equal(assertMigrationTarget("chapeauxfous_rehearsal"), "chapeauxfous_rehearsal");
  assert.throws(() => assertMigrationTarget("chapeauxfous"), /Refusing non-rehearsal database/);
  assert.equal(assertMigrationTarget("chapeauxfous", { allowLive: true }), "chapeauxfous");
  assert.throws(() => assertMigrationTarget("bad-name_rehearsal"), /Invalid MariaDB database name/);
});

test("MariaDB identifiers are validated before interpolation", () => {
  assert.equal(quoteMariaDbIdentifier("activity_events"), "`activity_events`");
  assert.throws(() => quoteMariaDbIdentifier("activity_events; DROP TABLE files"), /Invalid MariaDB identifier/);
});

test("MariaDB schema parser respects trigger delimiters", () => {
  const statements = parseMariaDbScript(`
SET NAMES utf8mb4;
DELIMITER //
CREATE TRIGGER example BEFORE INSERT ON sample
FOR EACH ROW
BEGIN
  SET NEW.value = COALESCE(NEW.value, 'x;y');
END//
DELIMITER ;
CREATE VIEW sample_view AS SELECT * FROM sample;
`);
  assert.deepEqual(statements, [
    "SET NAMES utf8mb4",
    "CREATE TRIGGER example BEFORE INSERT ON sample\nFOR EACH ROW\nBEGIN\n  SET NEW.value = COALESCE(NEW.value, 'x;y');\nEND",
    "CREATE VIEW sample_view AS SELECT * FROM sample",
  ]);
});

test("row digests distinguish null and binary values while normalizing driver numeric representations", () => {
  const columns = ["a", "b"];
  const first = hashRows([{ a: null, b: Buffer.from("1") }], columns).digest("hex");
  const second = hashRows([{ a: "", b: "1" }], columns).digest("hex");
  const numeric = hashRows([{ a: 0, b: 1 }], columns).digest("hex");
  const driverString = hashRows([{ a: "0", b: "1" }], columns).digest("hex");
  assert.notEqual(first, second);
  assert.equal(numeric, driverString);
});

test("row chunks respect count and approximate byte bounds without dropping oversized rows", () => {
  assert.deepEqual(chunkRows([{ value: "a" }, { value: "b" }, { value: "c" }], { maximumRows: 2 }), [
    [{ value: "a" }, { value: "b" }],
    [{ value: "c" }],
  ]);
  assert.deepEqual(chunkRows([{ value: "oversized" }], { maximumBytes: 1 }), [[{ value: "oversized" }]]);
});

test("active video-job uniqueness does not derive a generated column from its foreign key", () => {
  const schema = fs.readFileSync(path.join(repositoryRoot, "db/mariadb/0001-baseline.sql"), "utf8");
  assert.match(
    schema,
    /active_script_status TINYINT UNSIGNED AS \(IF\(status IN \('queued', 'preparing', 'rendering'\), 1, NULL\)\) PERSISTENT/,
  );
  assert.match(schema, /UNIQUE KEY video_jobs_one_active_script \(video_script_id, active_script_status\)/);
  assert.doesNotMatch(schema, /AS \([^\n]*video_script_id[^\n]*\) PERSISTENT/);
});

test("MariaDB birth-date constraint accepts both SQLite date representations", () => {
  const schema = fs.readFileSync(path.join(repositoryRoot, "db/mariadb/0001-baseline.sql"), "utf8");
  const contactsTable = schema.match(/CREATE TABLE contacts \([\s\S]*?\n\) ENGINE=InnoDB;/)?.[0] ?? "";
  const birthDateConstraint = contactsTable.match(/CONSTRAINT contacts_birth_date CHECK \([\s\S]*?\n    \)/)?.[0] ?? "";
  assert.match(birthDateConstraint, /birth_date REGEXP '\^\(\[0-9\]\{4\}-\|--\)/);
  assert.doesNotMatch(birthDateConstraint, /DATE_FORMAT/);
  assert.match(schema, /CREATE TRIGGER contacts_validate_birth_date_before_insert/);
  assert.match(schema, /CREATE TRIGGER contacts_validate_birth_date_before_update/);
  assert.match(schema, /MOD\(CAST\(SUBSTRING\(NEW\.birth_date, 1, 4\) AS UNSIGNED\), 400\) = 0/);
});

test("tag slug identity remains binary under a case-insensitive database default", () => {
  const schema = fs.readFileSync(path.join(repositoryRoot, "db/mariadb/0001-baseline.sql"), "utf8");
  const tagsTable = schema.match(/CREATE TABLE tags \([\s\S]*?\n\) ENGINE=InnoDB;/)?.[0] ?? "";
  assert.match(tagsTable, /slug\s+VARCHAR\(255\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/);
  assert.match(tagsTable, /UNIQUE KEY tags_slug \(slug\)/);
});
