import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerDatabaseTools } from "../src/tools/database-tools.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("native todo tools add and complete a Development task", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  assert.equal(store.status.ready, true);
  const ledger = new Ledger(store);
  const request = ledger.createRequest({ text: "Add the outlet todo" });
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, ledger);

  const created = await registry.execute("todo_add", {
    text: "Flip the Tesla charging outlet",
    group: "Development",
    scheduledAtUtc: null,
    dueAtUtc: null,
  }, { requestId: "request-1", requestEventId: request.eventId, callId: "call-add" });

  assert.equal(created.created, true);
  assert.equal(created.task.groupName, "Development");
  assert.equal(created.task.text, "Flip the Tesla charging outlet");
  const listed = await registry.execute("todo_list", { group: "Development", status: null, limit: 20 });
  assert.deepEqual(listed.tasks.map((task) => task.text), ["Flip the Tesla charging outlet"]);

  const updated = await registry.execute("todo_update", {
    taskId: created.task.id,
    text: null,
    group: null,
    status: "complete",
    scheduledAtUtc: null,
    dueAtUtc: null,
  }, { requestId: "request-1", callId: "call-update" });
  assert.equal(updated.task.status, "complete");
  assert.ok(updated.task.completedAtUtc);
});

test("generic database writes cannot mutate the ledger", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const registry = new ToolRegistry();
  registerDatabaseTools(registry, store, ledger);
  await assert.rejects(
    registry.execute("database_write", {
      action: "delete",
      table: "activity_events",
      values: {},
      where: { event_id: "anything" },
    }),
    /not permitted/,
  );
});

test("legacy voice-service requests remain visible without rewriting their events", (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);

  ledger.append({
    type: "voice.request.received",
    status: "queued",
    actorType: "user",
    actorName: "Nate",
    source: "text_web",
    channel: "tailnet_web",
    turnId: "legacy-request",
    subjectType: "voice_request",
    subjectId: "legacy-request",
    content: "Add the old request",
    payload: { inputKind: "text" },
  });
  ledger.append({
    type: "agent.turn.end",
    phase: "end",
    status: "complete",
    actorType: "agent",
    actorName: "Legacy runtime",
    turnId: "legacy-request",
    subjectType: "voice_request",
    subjectId: "legacy-request",
    content: "The old response",
  });

  assert.deepEqual(ledger.recentRequests(), [{
    requestId: "legacy-request",
    channel: "web",
    submittedAtMs: ledger.trace("legacy-request")[0].occurredAtMs,
    status: "complete",
    request: "Add the old request",
    response: "The old response",
    error: null,
    usage: null,
    eventCount: 2,
  }]);
  assert.deepEqual(
    ledger.recentConversation().map(({ role, content }) => ({ role, content })),
    [
      { role: "user", content: "Add the old request" },
      { role: "assistant", content: "The old response" },
    ],
  );
  assert.equal(ledger.searchHistory("old response").length, 1);
});
