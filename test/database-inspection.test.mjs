import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase, modelWritableTables, summarizeDatabaseObjects } from "../src/database.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("database counts distinguish application tables and views", () => {
  const objects = [
    { type: "table", name: "files" },
    { type: "table", name: "activity_events" },
    { type: "view", name: "recent_files" },
  ];
  assert.deepEqual(summarizeDatabaseObjects(objects), {
    applicationTableCount: 2,
    applicationViewCount: 1,
    applicationObjectCount: 3,
  });
});

test("MariaDB object discovery quotes its sql alias", () => {
  let statement = "";
  const store = Object.create(SlayerDatabase.prototype);
  store.engine = "mariadb";
  store.status = { ready: true };
  store.database = {
    prepare(sql) {
      statement = sql;
      return { all: () => [] };
    },
  };

  assert.deepEqual(store.objects(), []);
  assert.match(statement, /NULL AS `sql`/);
});

test("generic model writes use an explicit allowlist instead of inheriting new domain tables", (context) => {
  const temporary = temporaryDatabase();
  context.after(temporary.cleanup);
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());

  assert.deepEqual([...modelWritableTables].sort(), ["content_groups", "content_items"]);
  assert.equal(store.objectInfo("content_items", { writable: true }).writable, true);
  assert.throws(
    () => store.objectInfo("contacts", { writable: true }),
    /Model writes are not permitted on contacts/,
  );
  assert.equal(store.objectInfo("contacts").writable, false);
});

test("MariaDB exposes native enums and rejects invalid enum values", (context) => {
  const temporary = temporaryDatabase();
  context.after(temporary.cleanup);
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const database = store.requireReady();
  assert.match(
    database.prepare("SELECT @@SESSION.sql_mode AS sql_mode").get().sql_mode,
    /(?:^|,)STRICT_(?:ALL_TABLES|TRANS_TABLES)(?:,|$)/u,
  );

  const enumColumns = database.prepare(`
    SELECT c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name, c.COLUMN_TYPE AS column_type
    FROM information_schema.COLUMNS c
    JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
    WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE' AND c.DATA_TYPE = 'enum'
    ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
  `).all();
  assert.equal(enumColumns.length, 33);
  assert.equal(
    enumColumns.find(({ table_name, column_name }) => (
      table_name === "calendar_events" && column_name === "status"
    ))?.column_type,
    "enum('tentative','confirmed','cancelled')",
  );
  assert.throws(
    () => database.prepare(`
      INSERT INTO calendar_events (title, starts_at_utc, status)
      VALUES ('Invalid state', '2030-01-01T12:00:00.000Z', 'completed')
    `).run(),
    /Data truncated|Incorrect .* value|invalid/iu,
  );
});
