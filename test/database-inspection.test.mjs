import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDatabaseObjects } from "../src/database.mjs";

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
