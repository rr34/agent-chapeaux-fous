import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { ToolRegistry, schemaProblem } from "../src/tools/registry.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { temporaryDatabase } from "./helpers.mjs";

function definitions() {
  const registry = new ToolRegistry();
  registerTodoTools(registry, {}, {});
  return Object.fromEntries(registry.toolDefinitions().map((tool) => [tool.name, tool]));
}

function harness(context) {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, ledger);
  const request = ledger.createRequest({ text: "Manage my to-dos" });
  const toolContext = { requestId: request.requestId, requestEventId: request.eventId,
    callId: "todo-test", channel: "test" };
  return { store, registry, toolContext };
}

test("native to-do contracts are entirely non-temporal", () => {
  const tools = definitions();
  for (const retired of ["routine_list", "routine_add", "routine_update", "todo_recurrence_set", "todo_move_overdue_to_today"]) {
    assert.equal(Object.hasOwn(tools, retired), false);
  }
  for (const name of ["todo_add", "todo_update"]) {
    const properties = name === "todo_add"
      ? tools[name].inputSchema.properties
      : tools[name].inputSchema.properties.updates.items.properties;
    for (const retired of ["scheduled_at_utc", "due_at_utc", "is_all_day", "duration_minutes", "recurrence"]) {
      assert.equal(Object.hasOwn(properties, retired), false, `${name}.${retired}`);
    }
  }
  assert.ok(tools.todo_interaction_guide_set);
  assert.equal(schemaProblem({ created: true, task: { personal_task_id: 1, text: "Call Ruby" } },
    tools.todo_add.outputSchema), null);
});

test("to-dos can be created, listed, and completed without calendar fields", async (context) => {
  const { store, registry, toolContext } = harness(context);
  const created = await registry.execute("todo_add", {
    text: "Bathe Ruby", group: "Inbox", status: "todo",
    related_contact_id: null, interaction_guide_id: null,
    planning_prompt_text: null, position: null,
  }, toolContext);
  assert.equal(created.task.text, "Bathe Ruby");
  for (const retired of ["scheduled_at_utc", "due_at_utc", "is_all_day", "duration_minutes", "todo_routine_id"]) {
    assert.equal(Object.hasOwn(created.task, retired), false);
  }
  const listed = await registry.execute("todo_list", { queries: [{
    query_id: "open", group: null, status: "todo", limit: 20,
  }] });
  assert.deepEqual(listed.results[0].tasks.map(({ text }) => text), ["Bathe Ruby"]);
  const updated = await registry.execute("todo_update", { updates: [{
    personal_task_id: created.task.personal_task_id, status: "complete",
  }] }, toolContext);
  assert.equal(updated.items[0].task.status, "complete");
  assert.ok(updated.items[0].task.completed_at_utc);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM calendar_events").get().count, 0);
});

test("any to-do may link directly to an active interaction guide", async (context) => {
  const { store, registry, toolContext } = harness(context);
  const guideId = Number(store.requireReady().prepare(`
    INSERT INTO interaction_guides (name, status) VALUES ('Ruby care', 'active')
    RETURNING interaction_guide_id
  `).get().interaction_guide_id);
  const created = await registry.execute("todo_add", {
    text: "Bathe Ruby", group: "Inbox", status: "todo",
    related_contact_id: null, interaction_guide_id: guideId,
    planning_prompt_text: null, position: null,
  }, toolContext);
  assert.equal(created.task.interaction_guide.interaction_guide_id, guideId);
  const cleared = await registry.execute("todo_interaction_guide_set", {
    personal_task_id: created.task.personal_task_id, interaction_guide_id: null,
  }, toolContext);
  assert.equal(cleared.task.interaction_guide, null);
});

test("to-do update batches stay atomic", async (context) => {
  const { registry, toolContext } = harness(context);
  const first = await registry.execute("todo_add", {
    text: "First", group: "Inbox", status: "todo", related_contact_id: null,
    interaction_guide_id: null, planning_prompt_text: null, position: null,
  }, toolContext);
  await assert.rejects(registry.execute("todo_update", { updates: [
    { personal_task_id: first.task.personal_task_id, text: "Changed" },
    { personal_task_id: 999999, text: "Missing" },
  ] }, toolContext), /does not exist/);
  const listed = await registry.execute("todo_list", { queries: [{
    query_id: "first", group: null, status: null,
    personal_task_ids: [first.task.personal_task_id], limit: 20,
  }] });
  assert.equal(listed.results[0].tasks[0].text, "First");
});
