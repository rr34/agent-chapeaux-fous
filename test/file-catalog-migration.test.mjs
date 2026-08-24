import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readMigrationLedger(path.join(root, "db", "migrations.sql"))
  .find(({ version }) => version === 19);

test("migration 19 gives existing uploads durable searchable identities", () => {
  assert.ok(migration);
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE files (
        file_id INTEGER PRIMARY KEY,
        original_filename TEXT,
        created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ) STRICT;
      INSERT INTO files (original_filename) VALUES ('account-tree.csv');
    `);
    database.exec(migration.sql);
    const file = database.prepare(`
      SELECT title, description, title_source, updated_at_utc FROM files WHERE file_id = 1
    `).get();
    assert.equal(file.title, "account-tree.csv");
    assert.equal(file.description, null);
    assert.equal(file.title_source, "original_filename");
    database.prepare(`
      UPDATE files SET title = 'Imported account hierarchy', description = '275 account paths'
      WHERE file_id = 1
    `).run();
    assert.equal(database.prepare(`
      SELECT rowid FROM files_fts WHERE files_fts MATCH 'hierarchy'
    `).get().rowid, 1);
    assert.throws(
      () => database.prepare("UPDATE files SET title_source = 'unknown' WHERE file_id = 1").run(),
      /CHECK constraint failed/,
    );
  } finally {
    database.close();
  }
});
