import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  agentPersonTables, assertPersonIsolationReady, inspectPersonIsolation, personIsolationSchemaVersion,
} from "../src/person-isolation.mjs";
import {
  applyPersonIsolationMigration, canonicalSchema69Artifacts, personIsolationForeignKeyStatements,
} from "../scripts/person-isolation-migration.mjs";

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

test("person isolation gives ordinary foreign keys a separately named composite index", () => {
  const statements = personIsolationForeignKeyStatements([{
    TABLE_NAME: "contact_methods", CONSTRAINT_NAME: "contact_methods_contact",
    COLUMN_NAME: "contact_id", REFERENCED_TABLE_NAME: "contacts",
    REFERENCED_COLUMN_NAME: "contact_id", UPDATE_RULE: "RESTRICT", DELETE_RULE: "CASCADE",
  }]);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /ADD KEY `t3_fk_[0-9a-f]{16}` \(person_id, `contact_id`\)/u);
  assert.doesNotMatch(statements[0], /`contact_methods_contact`/u);
  assert.match(statements[1], /FOREIGN KEY \(person_id, `contact_id`\)/u);
  assert.match(statements[1], /REFERENCES `person_data_contacts` \(person_id, `contact_id`\)/u);
});

test("SET NULL references retain null propagation and add same-person validation triggers", () => {
  const statements = personIsolationForeignKeyStatements([{
    TABLE_NAME: "activity_events", CONSTRAINT_NAME: "activity_events_primary_file",
    COLUMN_NAME: "primary_file_id", REFERENCED_TABLE_NAME: "files",
    REFERENCED_COLUMN_NAME: "file_id", UPDATE_RULE: "RESTRICT", DELETE_RULE: "SET NULL",
  }]);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /BEFORE INSERT[\s\S]+FOLLOWS `t3_person_insert_activity_events`/u);
  assert.match(statements[1], /BEFORE UPDATE[\s\S]+FOLLOWS `t3_person_update_activity_events`/u);
  assert.match(statements[0], /parent\.person_id = NEW\.person_id/u);
  assert.match(statements[2], /FOREIGN KEY \(`primary_file_id`\)/u);
  assert.doesNotMatch(statements[2], /FOREIGN KEY \(person_id/u);
  assert.match(statements[2], /ON DELETE SET NULL/u);
});

test("a structurally converted schema-69 database resumes the interrupted migration in place", async () => {
  const canonical = canonicalSchema69Artifacts();
  const calls = [];
  const objectRows = agentPersonTables.flatMap((name) => [
    { TABLE_NAME: name, TABLE_TYPE: "VIEW" },
    { TABLE_NAME: `person_data_${name}`, TABLE_TYPE: "BASE TABLE" },
  ]).concat({ TABLE_NAME: canonical.derivedViews[0].name, TABLE_TYPE: "VIEW" });
  const connection = {
    async query(sql) {
      calls.push(sql);
      if (/FROM information_schema\.TABLES/u.test(sql)) return [objectRows, []];
      if (/FROM information_schema\.REFERENTIAL_CONSTRAINTS/u.test(sql) && !/JOIN/u.test(sql)) {
        return [[{
          TABLE_NAME: "person_data_activity_events",
          CONSTRAINT_NAME: "activity_events_primary_file",
        }], []];
      }
      if (/FROM information_schema\.STATISTICS/u.test(sql)) {
        return [[{
          TABLE_NAME: "person_data_activity_events", INDEX_NAME: "activity_events_primary_file",
          COLUMN_NAME: "person_id", SEQ_IN_INDEX: 1,
        }], []];
      }
      if (/FROM information_schema\.TRIGGERS/u.test(sql)) {
        return [[{ TRIGGER_NAME: "t3_ref_bi_deadbeefdeadbeef" }], []];
      }
      return [[], []];
    },
  };
  let output = "";
  await applyPersonIsolationMigration(connection, "agent_test", {
    output: { write(value) { output += value; } },
  });
  assert.match(output, /Repaired the partial schema-70 conversion in place/u);
  assert.ok(calls.some((sql) => /DROP FOREIGN KEY `activity_events_primary_file`/u.test(sql)));
  assert.ok(calls.some((sql) => /DROP INDEX `activity_events_primary_file`/u.test(sql)));
  assert.ok(calls.some((sql) => /DROP TRIGGER `t3_ref_bi_deadbeefdeadbeef`/u.test(sql)));
  assert.equal(calls.filter((sql) => /ADD CONSTRAINT/u.test(sql)).length, canonical.foreignKeys.length);
  for (const view of canonical.derivedViews) {
    assert.ok(calls.some((sql) => sql === view.sql));
  }
});
