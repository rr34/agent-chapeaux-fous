import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = readMigrationLedger(path.join(root, "db", "migrations.sql"))
  .find(({ version }) => version === 25);

test("migration 25 makes tracker units canonical and erases per-entry units", () => {
  assert.ok(migration);
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  try {
    database.exec(`
      CREATE TABLE activity_events (event_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE log_groups (
        log_group_id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      ) STRICT;
      CREATE TABLE trackers (
        tracker_id INTEGER PRIMARY KEY,
        log_group_id INTEGER NOT NULL REFERENCES log_groups(log_group_id),
        name TEXT NOT NULL,
        default_unit TEXT,
        archived_at_utc TEXT,
        created_at_utc TEXT NOT NULL,
        updated_at_utc TEXT
      ) STRICT;
      CREATE TABLE log_entries (
        log_entry_id INTEGER PRIMARY KEY,
        tracker_id INTEGER NOT NULL REFERENCES trackers(tracker_id),
        occurred_at_utc TEXT NOT NULL,
        content_text TEXT NOT NULL,
        number_value REAL,
        unit TEXT,
        source_event_id TEXT REFERENCES activity_events(event_id),
        created_at_utc TEXT NOT NULL,
        updated_at_utc TEXT,
        source TEXT NOT NULL DEFAULT 'agent-slayer',
        external_id TEXT
      ) STRICT;
      CREATE INDEX trackers_group_name
        ON trackers(log_group_id, archived_at_utc, name);
      CREATE INDEX log_entries_tracker_occurred
        ON log_entries(tracker_id, occurred_at_utc DESC, log_entry_id DESC);
      CREATE UNIQUE INDEX log_entries_source_external
        ON log_entries(source, external_id) WHERE external_id IS NOT NULL;
      INSERT INTO log_groups (log_group_id, name) VALUES (1, 'Health');
      INSERT INTO trackers (
        tracker_id, log_group_id, name, default_unit, created_at_utc
      ) VALUES
        (1, 1, 'Weight', 'kg', '2026-08-01T00:00:00Z'),
        (2, 1, 'Pain', NULL, '2026-08-01T00:00:00Z');
      INSERT INTO log_entries (
        log_entry_id, tracker_id, occurred_at_utc, content_text, number_value,
        unit, created_at_utc, source, external_id
      ) VALUES
        (1, 1, '2026-08-01T12:00:00Z', '180 pounds in an old import', 180,
         'pounds', '2026-08-01T12:00:00Z', 'old-import', 'weight-1'),
        (2, 2, '2026-08-02T12:00:00Z', 'Pain was 4', 4,
         'out of 10', '2026-08-02T12:00:00Z', 'agent-slayer', NULL);
    `);

    database.exec(migration.sql);

    assert.deepEqual(
      database.prepare("SELECT name, unit FROM trackers ORDER BY tracker_id").all()
        .map((row) => ({ ...row })),
      [{ name: "Weight", unit: "kg" }, { name: "Pain", unit: "set me" }],
    );
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM pragma_table_info('log_entries') WHERE name = 'unit'
    `).get().count, 0);
    assert.deepEqual(
      database.prepare(`
        SELECT log_entry_id, tracker_id, number_value, source, external_id
        FROM log_entries ORDER BY log_entry_id
      `).all().map((row) => ({ ...row })),
      [
        { log_entry_id: 1, tracker_id: 1, number_value: 180, source: "old-import", external_id: "weight-1" },
        { log_entry_id: 2, tracker_id: 2, number_value: 4, source: "agent-slayer", external_id: null },
      ],
    );
    database.prepare("UPDATE trackers SET unit = 'out of 10' WHERE tracker_id = 2").run();
    assert.throws(
      () => database.prepare("UPDATE trackers SET unit = 'percent' WHERE tracker_id = 2").run(),
      /cannot change after numeric entries exist/,
    );
    assert.throws(
      () => database.prepare("UPDATE trackers SET unit = NULL WHERE tracker_id = 1").run(),
      /canonical unit|cannot change after numeric entries exist/,
    );
  } finally {
    database.close();
  }
});
