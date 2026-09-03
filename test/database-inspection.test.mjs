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
