import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { readMigrationLedger } from "../scripts/agent-migrations.mjs";

test("migration 0021 adds versioned scripts and ordered many-interaction sources", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "video-script-migration-"));
  const filename = path.join(directory, "agent.sqlite");
  const database = new DatabaseSync(filename);
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE database_meta (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        schema_version INTEGER NOT NULL,
        description TEXT
      ) STRICT;
      INSERT INTO database_meta VALUES (1, 20, 'migration test');
      CREATE TABLE activity_events (
        event_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        turn_id TEXT,
        event_type TEXT NOT NULL
      ) STRICT;
      INSERT INTO activity_events (event_id, turn_id, event_type) VALUES
        ('request-event-1', 'request-1', 'request.received'),
        ('request-event-2', 'request-2', 'request.received'),
        ('generation-event', 'generation-request', 'request.received');
    `);
    const migration = readMigrationLedger(path.resolve("db/migrations.sql"))
      .find(({ version }) => version === 21);
    assert.ok(migration);
    database.exec(migration.sql);
    database.prepare("UPDATE database_meta SET schema_version = 21 WHERE singleton = 1").run();

    const scriptId = Number(database.prepare(`
      INSERT INTO video_scripts (
        title, script_json, script_text, created_by_event_id
      ) VALUES ('Portable script', '{}', '# Portable script', 'generation-event')
    `).run().lastInsertRowid);
    database.prepare(`
      INSERT INTO video_script_sources (video_script_id, request_event_id, source_order)
      VALUES (?, 'request-event-1', 1), (?, 'request-event-2', 2)
    `).run(scriptId, scriptId);

    assert.deepEqual(
      database.prepare(`
        SELECT request_event_id, source_order
        FROM video_script_sources ORDER BY source_order
      `).all().map(({ request_event_id: requestEventId, source_order: sourceOrder }) => ({
        request_event_id: requestEventId,
        source_order: Number(sourceOrder),
      })),
      [
        { request_event_id: "request-event-1", source_order: 1 },
        { request_event_id: "request-event-2", source_order: 2 },
      ],
    );
    assert.throws(
      () => database.prepare(`
        INSERT INTO video_script_sources (video_script_id, request_event_id, source_order)
        VALUES (?, 'missing-event', 3)
      `).run(scriptId),
      /FOREIGN KEY constraint failed/,
    );
    database.prepare("DELETE FROM video_scripts WHERE video_script_id = ?").run(scriptId);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM video_script_sources").get().count, 0);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
