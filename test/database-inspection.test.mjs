import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase, modelWritableTables, summarizeDatabaseObjects } from "../src/database.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("database counts distinguish logical objects from SQLite FTS5 shadow tables", () => {
  const objects = [
    { type: "table", name: "files", sql: "CREATE TABLE files (file_id INTEGER PRIMARY KEY)" },
    {
      type: "table",
      name: "files_fts",
      sql: "CREATE VIRTUAL TABLE files_fts USING fts5(title, content='files', content_rowid='file_id')",
    },
    { type: "table", name: "files_fts_data", sql: "CREATE TABLE files_fts_data(id INTEGER PRIMARY KEY, block BLOB)" },
    { type: "table", name: "files_fts_idx", sql: "CREATE TABLE files_fts_idx(segid, term, pgno, PRIMARY KEY(segid, term)) WITHOUT ROWID" },
    { type: "table", name: "files_fts_docsize", sql: "CREATE TABLE files_fts_docsize(id INTEGER PRIMARY KEY, sz BLOB)" },
    { type: "table", name: "files_fts_config", sql: "CREATE TABLE files_fts_config(k PRIMARY KEY, v) WITHOUT ROWID" },
    { type: "view", name: "recent_files", sql: "CREATE VIEW recent_files AS SELECT * FROM files" },
  ];
  assert.deepEqual(summarizeDatabaseObjects(objects), {
    applicationTableCount: 2,
    applicationViewCount: 1,
    applicationObjectCount: 3,
    sqliteObjectCount: 7,
    fts5ShadowTableCount: 4,
  });
});

test("generic model writes use an explicit allowlist instead of inheriting new domain tables", (context) => {
  const temporary = temporaryDatabase();
  context.after(temporary.cleanup);
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());

  assert.deepEqual([...modelWritableTables].sort(), ["content_groups", "content_items"]);
  assert.equal(store.objectInfo("content_items", { writable: true }).writable, true);
  assert.throws(
    () => store.objectInfo("contacts", { writable: true }),
    /Model writes are not permitted on contacts/,
  );
  assert.equal(store.objectInfo("contacts").writable, false);
});
