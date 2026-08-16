import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readMigrationLedger(path.join(root, "db", "migrations.sql"))
  .find(({ version }) => version === 14);

function relationshipDatabase({ populated = false } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE contacts (
      contact_id INTEGER PRIMARY KEY,
      display_name TEXT NOT NULL
    ) STRICT;
    CREATE TABLE contact_relationships (
      relationship_id INTEGER PRIMARY KEY,
      contact_id INTEGER NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      related_contact_id INTEGER NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
      relationship_type TEXT NOT NULL,
      CHECK (contact_id <> related_contact_id),
      UNIQUE (contact_id, related_contact_id, relationship_type)
    ) STRICT;
  `);
  if (populated) {
    database.exec(`
      INSERT INTO contacts (display_name) VALUES ('One'), ('Two');
      INSERT INTO contact_relationships (
        contact_id, related_contact_id, relationship_type
      ) VALUES (1, 2, 'relative');
    `);
  }
  return database;
}

test("migration 14 removes an empty contact relationships table", () => {
  assert.ok(migration);
  const database = relationshipDatabase();
  try {
    database.exec(migration.sql);
    assert.equal(database.prepare(`
      SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'contact_relationships'
    `).get(), undefined);
    assert.equal(database.prepare(`
      SELECT 1 FROM sqlite_schema
      WHERE type = 'table' AND name = 'migration_0014_contact_relationships_guard'
    `).get(), undefined);
  } finally {
    database.close();
  }
});

test("migration 14 refuses to delete unexpected relationship records", () => {
  const database = relationshipDatabase({ populated: true });
  try {
    database.exec("BEGIN IMMEDIATE");
    assert.throws(() => database.exec(migration.sql), /CHECK constraint failed/);
    database.exec("ROLLBACK");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contact_relationships").get().count, 1);
  } finally {
    database.close();
  }
});
