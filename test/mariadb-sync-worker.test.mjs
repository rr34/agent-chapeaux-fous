import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalUtcDateTime,
  createMariaDbWorkerHandler,
  mariaDbUtcTypeCast,
  normalizeMariaDbDateTimeParameters,
} from "../src/mariadb-sync-worker.mjs";

class FakeConnection {
  constructor(id) {
    this.id = id;
    this.listeners = new Map();
    this.nextExecuteError = null;
    this.ended = false;
  }

  on(name, listener) {
    this.listeners.set(name, listener);
  }

  disconnect(error = Object.assign(new Error("server closed idle connection"), {
    code: "PROTOCOL_CONNECTION_LOST",
    fatal: true,
  })) {
    this.listeners.get("error")?.(error);
  }

  async query(sql) {
    if (/SELECT @@SESSION\.sql_mode/u.test(sql)) {
      return [[{ sql_mode: "STRICT_TRANS_TABLES" }], []];
    }
    if (/SELECT VERSION\(\)/u.test(sql)) return [[{ version: `fake-${this.id}` }], []];
    return [[], []];
  }

  async execute() {
    if (this.nextExecuteError) {
      const error = this.nextExecuteError;
      this.nextExecuteError = null;
      throw error;
    }
    return [[{ connection_id: this.id }], []];
  }

  async end() {
    this.ended = true;
  }
}

function harness() {
  const connections = [];
  const configurations = [];
  const messages = [];
  const handle = createMariaDbWorkerHandler({
    createConnection: async (configuration) => {
      configurations.push(configuration);
      const connection = new FakeConnection(connections.length + 1);
      connections.push(connection);
      return connection;
    },
    reportConnectionError: (message) => messages.push(message),
  });
  return { configurations, connections, handle, messages };
}

const selectConnection = {
  type: "prepared",
  mode: "get",
  sql: "SELECT connection_id",
  parameters: [],
};

test("the MariaDB worker reconnects after an idle connection closes", async () => {
  const { configurations, connections, handle, messages } = harness();
  assert.deepEqual(await handle({ type: "init", configuration: { database: "test" } }), {
    version: "fake-1",
  });
  assert.deepEqual(await handle(selectConnection), { connection_id: 1 });
  assert.equal(configurations[0].timezone, "Z");
  assert.equal(configurations[0].typeCast, mariaDbUtcTypeCast);

  connections[0].disconnect();

  assert.deepEqual(await handle(selectConnection), { connection_id: 2 });
  assert.equal(connections.length, 2);
  assert.match(messages[0], /reconnecting on the next operation/u);
});

test("MariaDB DATETIME values cross the compatibility bridge as canonical UTC ISO strings", () => {
  assert.equal(canonicalUtcDateTime("2026-09-13 01:02:03.4"), "2026-09-13T01:02:03.400Z");
  assert.equal(canonicalUtcDateTime("2026-09-13T01:02:03.456789"), "2026-09-13T01:02:03.456Z");
  assert.equal(canonicalUtcDateTime(null), null);
  assert.equal(mariaDbUtcTypeCast({ type: "DATETIME", string: () => "2026-09-13 01:02:03.004" }), "2026-09-13T01:02:03.004Z");
  assert.equal(mariaDbUtcTypeCast({ type: "VARCHAR" }, () => "untouched"), "untouched");
  assert.throws(() => canonicalUtcDateTime("not-a-date"), /invalid DATETIME/u);
});

test("only parameters bound to native instant columns use MariaDB DATETIME literal syntax", () => {
  const instant = "2026-09-13T01:02:03.456Z";
  assert.deepEqual(normalizeMariaDbDateTimeParameters(
    "INSERT INTO calendar_events (external_id, starts_at_utc, title, created_at_utc) VALUES (?, ?, ?, ?)",
    [instant, instant, "launch", instant],
  ), [instant, "2026-09-13 01:02:03.456", "launch", "2026-09-13 01:02:03.456"]);
  assert.deepEqual(normalizeMariaDbDateTimeParameters(
    "SELECT * FROM calendar_events WHERE starts_at_utc BETWEEN ? AND ? AND external_id = ?",
    [instant, instant, instant],
  ), ["2026-09-13 01:02:03.456", "2026-09-13 01:02:03.456", instant]);
  assert.deepEqual(normalizeMariaDbDateTimeParameters(
    "UPDATE reminders SET resolved_at = ? WHERE remind_at_utc <= ? AND external_id = ?",
    [instant, instant, instant],
  ), ["2026-09-13 01:02:03.456", "2026-09-13 01:02:03.456", instant]);
  assert.deepEqual(normalizeMariaDbDateTimeParameters(
    'INSERT INTO "profile_facts" ("external_id", "updated_at_utc") VALUES (?, ?)',
    [instant, instant],
  ), [instant, "2026-09-13 01:02:03.456"]);
  assert.deepEqual(normalizeMariaDbDateTimeParameters(
    "INSERT INTO journal3_entries (external_id, occurred_at_utc) VALUES (?, ?), (?, ?)",
    ["first", instant, "second", instant],
  ), ["first", "2026-09-13 01:02:03.456", "second", "2026-09-13 01:02:03.456"]);
  assert.deepEqual(normalizeMariaDbDateTimeParameters(
    'SELECT * FROM "calendar_events" WHERE "starts_at_utc" >= ? AND "ical_recurrence_id" = ?',
    [instant, instant],
  ), ["2026-09-13 01:02:03.456", instant]);
  assert.deepEqual(normalizeMariaDbDateTimeParameters(
    "UPDATE video_jobs SET started_at_utc = COALESCE(started_at_utc, ?) WHERE video_job_id = ?",
    [instant, 12],
  ), ["2026-09-13 01:02:03.456", 12]);
  assert.deepEqual(normalizeMariaDbDateTimeParameters(
    "UPDATE calendar_events SET title = ? WHERE calendar_event_id = ? AND COALESCE(updated_at_utc, created_at_utc) = ?",
    ["launch", 12, instant],
  ), ["launch", 12, "2026-09-13 01:02:03.456"]);
});

test("a failed in-flight command is not replayed and the following command reconnects", async () => {
  const { connections, handle } = harness();
  await handle({ type: "init", configuration: { database: "test" } });
  connections[0].nextExecuteError = Object.assign(
    new Error("Can't add new command when connection is in closed state"),
    { fatal: true },
  );

  await assert.rejects(() => handle(selectConnection), /closed state/u);
  assert.equal(connections.length, 1);
  assert.deepEqual(await handle(selectConnection), { connection_id: 2 });
  assert.equal(connections.length, 2);
});

test("closing the worker does not reconnect an intentionally closed connection", async () => {
  const { connections, handle } = harness();
  await handle({ type: "init", configuration: { database: "test" } });
  assert.equal(await handle({ type: "close" }), true);
  assert.equal(connections[0].ended, true);
  assert.equal(connections.length, 1);
});
