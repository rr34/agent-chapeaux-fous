import assert from "node:assert/strict";
import test from "node:test";
import { countSqlParameters, parseUpdateReturning, translateSqliteSql } from "../src/mariadb-sql.mjs";

test("SQLite transaction and conflict syntax translates to MariaDB", () => {
  assert.equal(translateSqliteSql("BEGIN IMMEDIATE"), "START TRANSACTION");
  assert.equal(translateSqliteSql("PRAGMA foreign_keys = ON"), null);
  assert.equal(
    translateSqliteSql("INSERT OR IGNORE INTO record_tags (tag_id) VALUES (?)"),
    "INSERT IGNORE INTO record_tags (tag_id) VALUES (?)",
  );
  assert.equal(
    translateSqliteSql(`INSERT INTO todo_personal (todo_routine_id, scheduled_at_utc) VALUES (?, ?)
      ON CONFLICT (todo_routine_id, scheduled_at_utc) WHERE todo_routine_id IS NOT NULL
      DO NOTHING`),
    "INSERT IGNORE INTO todo_personal (todo_routine_id, scheduled_at_utc) VALUES (?, ?)",
  );
});

test("SQLite collation, timestamp, and quoted identifiers translate to MariaDB", () => {
  const translated = translateSqliteSql(`
    UPDATE "interaction_guides"
    SET updated_at_utc = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE name = ? COLLATE NOCASE
  `);
  assert.match(translated, /UPDATE `interaction_guides`/);
  assert.match(translated, /DATE_FORMAT\(UTC_TIMESTAMP\(3\)/);
  assert.match(translated, /COLLATE utf8mb4_general_ci/);
  assert.equal(translateSqliteSql("value LIKE ? ESCAPE '\\'"), "value LIKE ? ESCAPE '\\\\'");
});

test("UPDATE RETURNING parsing separates mutation and predicate parameters", () => {
  const parsed = parseUpdateReturning(`
    UPDATE video_jobs SET status = ?, updated_at_utc = ?
    WHERE video_job_id = ? AND status = 'preparing'
    RETURNING *
  `);
  assert.deepEqual(parsed, {
    table: "video_jobs",
    setSql: "status = ?, updated_at_utc = ?",
    whereSql: "video_job_id = ? AND status = 'preparing'",
    returningSql: "*",
    setParameterCount: 2,
  });
  assert.equal(countSqlParameters("value = '?', other = ?, final = \"?\""), 1);
});
