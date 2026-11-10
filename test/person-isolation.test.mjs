import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  agentPersonTables, assertPersonIsolationReady, inspectPersonIsolation, personIsolationSchemaVersion,
} from "../src/person-isolation.mjs";

function fakeDatabase({ version, tables }) {
  return {
    prepare(sql) {
      if (sql.includes("database_meta")) return { get: () => ({ schema_version: version }) };
      if (sql.includes("information_schema.COLUMNS")) {
        return { all: () => tables.map((table_name) => ({ table_name })) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test("person isolation requires every Agent table and the migration version", () => {
  const applicationTables = ["database_meta", "files", "contacts"];
  assert.deepEqual(inspectPersonIsolation(fakeDatabase({
    version: personIsolationSchemaVersion, tables: ["files"],
  }), applicationTables), {
    schemaVersion: personIsolationSchemaVersion,
    missingTables: ["contacts"],
  });
  assert.throws(() => assertPersonIsolationReady(fakeDatabase({
    version: personIsolationSchemaVersion - 1, tables: ["files", "contacts"],
  }), applicationTables), /person-isolated schema version 70 is required/);
  assert.doesNotThrow(() => assertPersonIsolationReady(fakeDatabase({
    version: personIsolationSchemaVersion, tables: ["files", "contacts"],
  }), applicationTables));
});

test("the person isolation manifest covers every schema-69 Agent base table", () => {
  const baseline = fs.readFileSync(new URL("../db/mariadb/0001-baseline.sql", import.meta.url), "utf8");
  const baseTables = [...baseline.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?`?([a-z0-9_]+)`?/giu)]
    .map((match) => match[1])
    .filter((name) => name !== "database_meta")
    .toSorted();
  assert.deepEqual([...agentPersonTables].toSorted(), baseTables);
});
