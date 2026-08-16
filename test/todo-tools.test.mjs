import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerDatabaseTools } from "../src/tools/database-tools.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("todo_group_list exposes every active group including empty catchalls", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, new Ledger(store));

  const result = await registry.execute("todo_group_list", {});
  assert.deepEqual(result.groups, [
    { id: 2, name: "Development", archivedAtUtc: null, openTaskCount: 0 },
    { id: 1, name: "Inbox", archivedAtUtc: null, openTaskCount: 0 },
  ]);
});

test("todo_group_archive rejects active groups and preserves terminal-only groups", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, ledger);

  const created = await registry.execute("todo_add", {
    text: "Disposable task", group: "Development", scheduledAtUtc: null, dueAtUtc: null,
  }, { requestId: "delete-group", callId: "add" });
  await assert.rejects(
    registry.execute("todo_group_archive", { name: "Development" }, { requestId: "archive-group", callId: "archive" }),
    /active task/,
  );
  await registry.execute("todo_update", {
    taskId: created.task.id, text: null, group: null, status: "complete",
    scheduledAtUtc: null, dueAtUtc: null,
  }, { requestId: "delete-group", callId: "complete" });
  const archived = await registry.execute(
    "todo_group_archive", { name: "Development" }, { requestId: "archive-group", callId: "archive" },
  );
  assert.equal(archived.archived, true);
  assert.equal(archived.retainedTerminalTaskCount, 1);
  const task = store.requireReady().prepare(`
    SELECT todo_group.name, todo_group.archived_at_utc
    FROM personal_tasks AS task JOIN todo_groups AS todo_group USING (todo_group_id)
    WHERE task.personal_task_id = ?
  `).get(created.task.id);
  assert.equal(task.name, "Development");
  assert.ok(task.archived_at_utc);
});

test("todo_group_rename keeps tasks attached through the stable group ID", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, ledger);

  const created = await registry.execute("todo_add", {
    text: "Rename-safe task", group: "Development", scheduledAtUtc: null, dueAtUtc: null,
  }, { requestId: "rename-group", callId: "add" });
  const renamed = await registry.execute("todo_group_rename", {
    currentName: "Development", newName: "Engineering",
  }, { requestId: "rename-group", callId: "rename" });
  assert.equal(renamed.group.previousName, "Development");
  assert.equal(renamed.group.name, "Engineering");
  const listed = await registry.execute("todo_list", { group: "Engineering", status: null, limit: 20 });
  assert.deepEqual(listed.tasks.map(({ id }) => id), [created.task.id]);
  await assert.rejects(
    registry.execute("todo_group_rename", {
      currentName: "Inbox", newName: "Incoming",
    }, { requestId: "rename-group", callId: "rename-inbox" }),
    /cannot be renamed/,
  );
});

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

test("native todo tools accept structured recurrence and generate the next task", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, ledger);

  const created = await registry.execute("todo_add", {
    text: "Take weekly measurement",
    group: "Development",
    scheduledAtUtc: "2026-08-17T13:00:00.000Z",
    dueAtUtc: null,
    recurrence: {
      frequency: "WEEKLY", interval: 1, weekdays: ["MO"], count: 6,
      untilDate: null, timeZone: "America/New_York",
    },
  }, { requestId: "recurring", callId: "add-recurring" });
  assert.ok(created.task.routineId);
  assert.equal(created.task.recurrenceRule, "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=6");

  const changed = await registry.execute("todo_recurrence_set", {
    taskId: created.task.id,
    enabled: true,
    recurrence: {
      frequency: "WEEKLY", interval: 2, weekdays: ["TU", "FR"], count: null,
      untilDate: "2026-12-31", timeZone: "America/New_York",
    },
  }, { requestId: "recurring", callId: "change-recurring" });
  assert.equal(
    changed.task.recurrenceRule,
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR;UNTIL=20261231T235959",
  );

  const completed = await registry.execute("todo_update", {
    taskId: created.task.id, text: null, group: null, status: "complete",
    scheduledAtUtc: null, dueAtUtc: null,
  }, { requestId: "recurring", callId: "complete-recurring" });
  assert.ok(completed.generatedTaskId);
  assert.equal(store.requireReady().prepare(
    "SELECT todo_routine_id FROM personal_tasks WHERE personal_task_id = ?",
  ).get(completed.generatedTaskId).todo_routine_id, created.task.routineId);
  assert.equal(store.requireReady().prepare(`
    SELECT COUNT(*) AS count FROM activity_events
    WHERE event_type = 'personal_todo.generated' AND subject_id = ?
  `).get(String(completed.generatedTaskId)).count, 1);
});

test("native todo tools preserve an explicit all-day schedule", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, new Ledger(store));

  const created = await registry.execute("todo_add", {
    text: "Spend the day outside",
    group: "Inbox",
    scheduledAtUtc: "2026-08-22T04:00:00.000Z",
    isAllDay: true,
    dueAtUtc: null,
  }, { requestId: "all-day", callId: "add" });
  assert.equal(created.task.isAllDay, true);

  const updated = await registry.execute("todo_update", {
    taskId: created.task.id,
    text: null,
    group: null,
    status: null,
    scheduledAtUtc: null,
    isAllDay: false,
    dueAtUtc: null,
  }, { requestId: "all-day", callId: "make-timed" });
  assert.equal(updated.task.isAllDay, false);
});

test("todo_add uses Inbox when a requested group is missing, then supports a confirmed create and move", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const database = store.requireReady();
  database.prepare("DELETE FROM todo_groups WHERE name = 'Development'").run();
  const ledger = new Ledger(store);
  const request = ledger.createRequest({ text: "Add the cutover todo" });
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, ledger);

  const created = await registry.execute("todo_add", {
    text: "Verify Agent Slayer cutover",
    group: "Development",
    scheduledAtUtc: null,
    dueAtUtc: null,
  }, { requestId: "request-create-group", requestEventId: request.eventId, callId: "call-create-group" });

  assert.equal(created.created, true);
  assert.deepEqual(created.groupResolution, {
    requestedGroup: "Development",
    actualGroup: "Inbox",
    requestedGroupFound: false,
    usedInboxFallback: true,
    askToCreateRequestedGroup: true,
  });
  assert.equal(created.task.groupName, "Inbox");
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM todo_groups WHERE name = 'Development'").get().count,
    0,
  );

  const group = await registry.execute("todo_group_create", {
    name: "Development",
  }, { requestId: "request-create-group", callId: "call-group-create" });
  assert.equal(group.created, true);
  assert.equal(group.group.name, "Development");

  const moved = await registry.execute("todo_update", {
    taskId: created.task.id,
    text: null,
    group: "Development",
    status: null,
    scheduledAtUtc: null,
    dueAtUtc: null,
  }, { requestId: "request-create-group", callId: "call-move" });
  assert.equal(moved.task.groupName, "Development");
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM todo_groups WHERE name = 'Development'").get().count,
    1,
  );
  assert.equal(
    database.prepare(`
      SELECT COUNT(*) AS count
      FROM personal_tasks AS task
      JOIN todo_groups AS todo_group USING (todo_group_id)
      WHERE todo_group.name = 'Development' AND task.text = 'Verify Agent Slayer cutover'
    `).get().count,
    1,
  );
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
    elapsedMs: Math.max(0, ledger.trace("legacy-request")[1].occurredAtMs - ledger.trace("legacy-request")[0].occurredAtMs),
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
