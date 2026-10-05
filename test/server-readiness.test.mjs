import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const server = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
const healthStart = server.indexOf("function health() {");
const handlerStart = server.indexOf("const server = http.createServer");
const healthSource = server.slice(healthStart, handlerStart);
const requestHandlerSource = server.slice(handlerStart, server.indexOf("\nserver.listen", handlerStart));

function readHealth({ database, model, tlom }) {
  const context = vm.createContext({
    store: { status: database },
    modelTransport: { health: () => model, id: "test-model", displayName: "Test model" },
    mcp: { health: () => ({ tlom }) },
    jmap: { health: () => ({ ready: true }) },
    payments: { health: () => ({ ready: false, configured: false, connected: false }) },
    registry: { list: () => [{ name: "todo_list", source: "local" }] },
    identity: { component: "agent-slayer" },
    config: { model: "test-model" },
  });
  vm.runInContext(healthSource, context);
  return context.health();
}

test("a failed TLOM connection remains visible without taking the core service down", () => {
  const body = readHealth({
    database: { ready: true, engine: "mariadb" },
    model: { ready: true, reason: null },
    tlom: { ready: false, error: "personal access token expired" },
  });

  assert.equal(body.ready, true);
  assert.equal(body.reason, null);
  assert.equal(body.integrations.tlom.ready, false);
  assert.match(body.integrations.tlom.error, /expired/);
  assert.deepEqual(Array.from(body.tools, ({ name }) => name), ["todo_list"]);
});

test("database and model failures still make the core service unavailable", () => {
  const tlom = { ready: true };
  const databaseDown = readHealth({
    database: { ready: false, reason: "database unavailable" },
    model: { ready: true, reason: null },
    tlom,
  });
  assert.equal(databaseDown.ready, false);
  assert.equal(databaseDown.reason, "database unavailable");

  const modelDown = readHealth({
    database: { ready: true },
    model: { ready: false, reason: "model unavailable" },
    tlom,
  });
  assert.equal(modelDown.ready, false);
  assert.equal(modelDown.reason, "model unavailable");
});

test("new requests are admitted while TLOM is disconnected", async () => {
  const responses = [];
  let queueWakes = 0;
  const context = vm.createContext({
    URL,
    http: { createServer: handler => ({ handler }) },
    serveStatic: async () => false,
    requireAuthorization: () => true,
    store: { status: { ready: true } },
    mcp: { requiredProblem: () => "tlom integration is unavailable" },
    jmap: { requiredProblem: () => null },
    readJson: async () => ({ text: "Add a personal to-do" }),
    normalizeRunLimits: () => null,
    normalizeReferencedRequestIds: () => [],
    normalizeSelectedObjectCandidates: () => [],
    selectedObjectMentionsAreVisible: () => true,
    ledger: { createRequest: () => ({ requestId: "new-request" }) },
    queue: { notify: () => { queueWakes++; } },
    sendJson: (_response, status, body) => responses.push({ status, body }),
    console: { error: error => { throw error; } },
  });
  vm.runInContext(requestHandlerSource, context);
  const handler = vm.runInContext("server.handler", context);

  await handler({ method: "POST", url: "/api/requests", headers: { host: "localhost" } }, {});

  assert.equal(responses.length, 1);
  assert.equal(responses[0].status, 202);
  assert.equal(responses[0].body.requestId, "new-request");
  assert.equal(queueWakes, 1);
});
test("tracker schedule route delegates to the owning catch-up service", async () => {
  const calls = [];
  const responses = [];
  const recurrence = {
    frequency: "WEEKLY",
    interval: 1,
    weekdays: ["SU"],
    count: null,
    until_date: null,
    time_zone: "America/New_York",
  };
  const context = vm.createContext({
    URL,
    http: { createServer: handler => ({ handler }) },
    serveStatic: async () => false,
    requireAuthorization: () => true,
    store: { status: { ready: true } },
    readJson: async () => ({ starts_at_utc: "2026-10-04T04:00:00.000Z", recurrence }),
    catchUp: {
      setTrackerSchedule(input, operation) {
        calls.push({ input, operation });
        return { tracker_id: input.tracker_id };
      },
    },
    sendJson: (_response, status, body) => responses.push({ status, body }),
    sendError: (_response, error) => { throw error; },
    console: { error: error => { throw error; } },
  });
  vm.runInContext(requestHandlerSource, context);
  const handler = vm.runInContext("server.handler", context);

  await handler({
    method: "PATCH",
    url: "/api/journal-trackers/31/schedule",
    headers: { host: "localhost" },
  }, {});

  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    input: {
      tracker_id: 31,
      starts_at_utc: "2026-10-04T04:00:00.000Z",
      recurrence,
    },
    operation: {
      actorType: "user",
      actorName: "tracker_schedule_web",
      channel: "web",
    },
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(responses)), [{
    status: 200,
    body: { tracker_id: 31 },
  }]);
});
