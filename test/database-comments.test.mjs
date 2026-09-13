import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { runDatabaseMigrations } from "../scripts/migrate-database.mjs";
import { verifyDatabase } from "../scripts/verify-database.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { SlayerDatabase } from "../src/database.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerDatabaseTools } from "../src/tools/database-tools.mjs";
import { temporaryDatabase, baselineBeforeCatchUp } from "./helpers.mjs";

function catalog(database) {
  const columns = database.prepare(`SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE,
    IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME,
    GENERATION_EXPRESSION, COLUMN_KEY FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`).all();
  const indexes = database.prepare(`SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE,
    SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`).all();
  const keys = database.prepare(`SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME,
    REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`).all();
  return {
    columns: columns.filter(row => !["catch_up_questions", "todo_correspondence_join", "calendar_events_correspondence_join"].includes(row.TABLE_NAME) && !row.COLUMN_NAME.startsWith("asking_")),
    indexes: indexes.filter(row => !["catch_up_questions", "todo_correspondence_join", "calendar_events_correspondence_join"].includes(row.TABLE_NAME)),
    keys: keys.filter(row => !["catch_up_questions", "todo_correspondence_join", "calendar_events_correspondence_join"].includes(row.TABLE_NAME)),
  };
}

test("comment migration preserves mechanics and rows, supports replay, and exposes comments on request", async context => {
  const baseline = baselineBeforeCatchUp(fs.readFileSync(baselineFilename, "utf8"));
  const oldSchema = baseline.replace(/ COMMENT\s*=?\s*'(?:[^']|'')*'/gu, "")
    .replace("VALUES (1, 35,", "VALUES (1, 34,");
  const temporary = temporaryDatabase({ schema: oldSchema });
  context.after(temporary.cleanup);
  const database = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => database.close());
  database.exec("INSERT INTO files (storage_path, title) VALUES ('test/comment-preservation', 'Keep this file')");
  const before = catalog(database);
  const rows = database.prepare("SELECT * FROM files").all();
  const options = {
    connectionSettings: temporary.target.connection,
    backupConfirmed: true, writersStopped: true, output: { write() {} },
  };
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [35, 36, 37, 38, 39, 40]);
  assert.deepEqual(catalog(database), before);
  assert.deepEqual(database.prepare("SELECT * FROM files").all(), rows);
  await verifyDatabase(database);
  assert.deepEqual((await runDatabaseMigrations(options)).applied, []);
  // Simulate a DDL commit followed by interruption before the version marker.
  database.exec("UPDATE database_meta SET schema_version = 34 WHERE singleton = 1");
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [35, 36, 37, 38, 39, 40]);
  assert.deepEqual(catalog(database), before);
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const registry = new ToolRegistry();
  registerDatabaseTools(registry, store, {});
  const result = await registry.execute("database_schema", { objectName: "journal_entries" });
  assert.match(result.objects[0].comment, /authoritative time-stamped personal observations/);
  assert.match(result.objects[0].columns.find(column => column.name === "number_value").comment, /parent tracker's canonical unit/);
  const read = await registry.execute("database_read", { objectName: "files", columns: ["title"] });
  assert.equal(read.rows[0].title, "Keep this file");
  assert.equal(Object.hasOwn(read, "schemaProjection"), false);

  const fresh = temporaryDatabase();
  context.after(fresh.cleanup);
  const freshDatabase = new MariaDatabaseSync(fresh.target.connection);
  context.after(() => freshDatabase.close());
  const commentCatalog = db => ({
    tables: db.prepare(`SELECT TABLE_NAME, TABLE_COMMENT FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`).all(),
    fields: db.prepare(`SELECT TABLE_NAME, COLUMN_NAME, COLUMN_COMMENT FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`).all(),
  });
  assert.deepEqual(commentCatalog(database), commentCatalog(freshDatabase));
});

test("verification is read-only and detects missing search indexes and journal guards", async context => {
  const temporary = temporaryDatabase();
  context.after(temporary.cleanup);
  const database = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => database.close());
  const readOnly = { prepare(sql) {
    assert.match(sql.trim(), /^SELECT\b/iu);
    return database.prepare(sql);
  } };
  assert.equal((await verifyDatabase(readOnly)).fullTextIndexCount, 2);
  database.exec("ALTER TABLE files DROP INDEX files_fulltext");
  await assert.rejects(verifyDatabase(readOnly), /Required FULLTEXT index files.files_fulltext/);
  database.exec("CREATE FULLTEXT INDEX files_fulltext ON files (title, description, original_filename)");
  database.exec("DROP TRIGGER journal_entries_require_tracker_unit_before_insert");
  await assert.rejects(verifyDatabase(readOnly), /trigger/i);
});
