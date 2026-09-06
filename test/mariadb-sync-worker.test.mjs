import assert from "node:assert/strict";
import test from "node:test";
import { createMariaDbWorkerHandler } from "../src/mariadb-sync-worker.mjs";

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
  const messages = [];
  const handle = createMariaDbWorkerHandler({
    createConnection: async () => {
      const connection = new FakeConnection(connections.length + 1);
      connections.push(connection);
      return connection;
    },
    reportConnectionError: (message) => messages.push(message),
  });
  return { connections, handle, messages };
}

const selectConnection = {
  type: "prepared",
  mode: "get",
  sql: "SELECT connection_id",
  parameters: [],
};

test("the MariaDB worker reconnects after an idle connection closes", async () => {
  const { connections, handle, messages } = harness();
  assert.deepEqual(await handle({ type: "init", configuration: { database: "test" } }), {
    version: "fake-1",
  });
  assert.deepEqual(await handle(selectConnection), { connection_id: 1 });

  connections[0].disconnect();

  assert.deepEqual(await handle(selectConnection), { connection_id: 2 });
  assert.equal(connections.length, 2);
  assert.match(messages[0], /reconnecting on the next operation/u);
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
