#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { createNativeSearchCoordinator } from "../src/search/native-search.mjs";
import { assertMigrationTarget } from "./mariadb-migration.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const environmentFilename = path.join(repositoryRoot, ".env");
if (fs.existsSync(environmentFilename)) process.loadEnvFile(environmentFilename);

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage:
  npm run db:mariadb:verify-runtime -- --database chapeauxfous_rehearsal

Required MariaDB environment variables:
  MARIADB_USER, MARIADB_PASSWORD

Optional:
  MARIADB_HOST (default localhost), MARIADB_PORT (default 3306), MARIADB_SOCKET
  --allow-live   Permit verification against a database that does not end in _rehearsal.`);
  process.exit(0);
}

const databaseName = assertMigrationTarget(optionValue("--database") ?? "", {
  allowLive: process.argv.includes("--allow-live"),
});
const user = process.env.MARIADB_USER?.trim();
const password = process.env.MARIADB_PASSWORD;
if (!user || password == null) throw new Error("MARIADB_USER and MARIADB_PASSWORD are required");
const target = {
  engine: "mariadb",
  connection: {
    host: process.env.MARIADB_HOST?.trim() || "localhost",
    port: Number(process.env.MARIADB_PORT || 3306),
    socketPath: process.env.MARIADB_SOCKET?.trim() || undefined,
    user,
    password,
    database: databaseName,
  },
};

const store = new SlayerDatabase(target);
let organizer;
try {
  assert.equal(store.status.ready, true, store.status.reason);
  const database = store.requireReady();
  assert.equal(database.engine, "mariadb");
  const objects = store.objects();
  assert.equal(objects.filter(({ type }) => type === "table").length, 32);
  assert.equal(objects.filter(({ type }) => type === "view").length, 7);
  assert.ok(store.objectInfo("contacts").columns.some(({ name }) => name === "birth_date"));
  assert.equal(store.read({ objectName: "database_meta", limit: 1 }).rows[0].schema_version, 28);

  organizer = new OrganizerStore(target);
  const ledger = new Ledger(store);
  assert.ok(organizer.listContacts({ limit: 2 }).length <= 2);
  assert.ok(Array.isArray(organizer.listTodoGroups({ includeArchived: true })));
  assert.ok(Array.isArray(organizer.listContentGroups({ includeArchived: true })));
  assert.ok(Array.isArray(organizer.listLogTrackers({ includeArchived: true })));
  assert.ok(ledger.listFiles({ limit: 2 }).files.length <= 2);

  const coordinator = createNativeSearchCoordinator({ store, organizer, ledger });
  const search = await coordinator.search({
    query: "the",
    scopes: ["files", "history"],
    mode: "terms",
    limit: 5,
  });
  assert.equal(search.providers.every(({ status }) => status === "complete"), true);

  const beforeCount = Number(database.prepare("SELECT COUNT(*) AS count FROM tags").get().count);
  database.exec("BEGIN IMMEDIATE");
  try {
    const marker = `mariadb-runtime-smoke-${Date.now()}`;
    const inserted = database.prepare(`
      INSERT INTO tags (slug, label) VALUES (?, ?) RETURNING *
    `).get(marker, "MariaDB runtime smoke test");
    assert.equal(inserted.slug, marker);
    const updated = database.prepare(`
      UPDATE tags SET is_active = ? WHERE tag_id = ? RETURNING *
    `).get(0, inserted.tag_id);
    assert.equal(Number(updated.is_active), 0);
    database.exec("ROLLBACK");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const afterCount = Number(database.prepare("SELECT COUNT(*) AS count FROM tags").get().count);
  assert.equal(afterCount, beforeCount);

  console.log(`MariaDB runtime boundary passed against ${databaseName}:`);
  console.log("- schema discovery and bounded generic reads passed");
  console.log("- organizer and ledger read surfaces passed");
  console.log("- MariaDB-backed native search providers passed");
  console.log("- transaction, INSERT RETURNING, UPDATE RETURNING emulation, and rollback passed");
  console.log("- imported application row counts were unchanged");
} finally {
  organizer?.close();
  store.close();
}
