import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMigrationTarget,
  chunkRows,
  hashRows,
  parseMariaDbScript,
  quoteMariaDbIdentifier,
} from "../scripts/mariadb-migration.mjs";

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
