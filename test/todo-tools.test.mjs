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

test("active-group context tells orientation when to prepare exact group bindings", () => {
  const registry = new ToolRegistry();
  registerTodoTools(registry, {}, {});
  const view = registry.capabilityManifest("todos").contextViews.find(
    ({ id }) => id === "todos.active_groups",
  );
  assert.match(view.description, /creating or moving a to-do/i);
  assert.match(view.description, /unless an exact to-do-group binding is already supplied/i);
  assert.match(view.description, /No individual to-do items/i);
});

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
    assert.equal(properties.status.enum.includes("unplanned"), false, `${name}.status`);
  }
  assert.equal(schemaProblem({ created: true, task: { personal_task_id: 1, text: "Call Ruby" } },
    tools.todo_add.outputSchema), null);
  assert.match(tools.todo_add.description, /non-null sequence/u);
  assert.match(tools.todo_add.description, /personal_task_id is a different database identity/u);
  assert.match(tools.todo_add.description,
    /same call atomically creates the to-do with its optional connection/u);
  assert.match(tools.todo_add.inputSchema.properties.related_contact_id.description,
    /stored atomically in this call/u);
  assert.match(tools.todo_add.outputSchema.properties.task.properties.sequence.description,
    /user-facing number within the owning group/u);
});

test("to-dos can be created, listed, and completed without calendar fields", async (context) => {
  const { store, registry, toolContext } = harness(context);
  const created = await registry.execute("todo_add", {
    text: "Bathe Ruby", todo_group_id: 1, status: "todo",
    related_contact_id: null,
    planning_prompt_text: null, position: null,
  }, toolContext);
  assert.equal(created.task.text, "Bathe Ruby");
  for (const retired of ["scheduled_at_utc", "due_at_utc", "is_all_day", "duration_minutes", "todo_routine_id"]) {
    assert.equal(Object.hasOwn(created.task, retired), false);
  }
  const newer = await registry.execute("todo_add", {
    text: "Call the groomer", todo_group_id: 1, status: "todo",
    related_contact_id: null, planning_prompt_text: null, position: null,
  }, toolContext);
  const listed = await registry.execute("todo_list", { queries: [{
    query_id: "open", group: null, status: "todo", limit: 20,
  }] });
  assert.deepEqual(listed.results[0].tasks.map(({ text }) => text), ["Call the groomer", "Bathe Ruby"]);
  assert.ok(newer.task.sort_position < created.task.sort_position);
  const updated = await registry.execute("todo_update", { updates: [{
    personal_task_id: created.task.personal_task_id, status: "complete",
  }] }, toolContext);
  assert.equal(updated.items[0].task.status, "complete");
  assert.ok(updated.items[0].task.completed_at_utc);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM calendar_events").get().count, 0);
});

test("todo_add connects an active contact in one call and rejects inactive targets", async (context) => {
  const { store, registry, toolContext } = harness(context);
  const database = store.requireReady();
  const activeId = Number(database.prepare(`
    INSERT INTO contacts (display_name, status) VALUES ('Active Person', 'active')
    RETURNING contact_id
  `).get().contact_id);
  const inactiveId = Number(database.prepare(`
    INSERT INTO contacts (display_name, status) VALUES ('Deleted Person', 'inactive')
    RETURNING contact_id
  `).get().contact_id);
  const created = await registry.execute("todo_add", {
    text: "Customer task", todo_group_id: 1, status: "todo",
    related_contact_id: activeId, planning_prompt_text: null, position: null,
  }, toolContext);
  assert.equal(created.task.related_contact_id, activeId);
  assert.deepEqual(created.task.related_contact, {
    contact_id: activeId,
    ref: `agent-slayer://contacts/${activeId}`,
    display_name: "Active Person",
    status: "active",
  });

  await assert.rejects(registry.execute("todo_update", { updates: [{
    personal_task_id: created.task.personal_task_id,
    related_contact_id: inactiveId,
  }] }, toolContext), /does not exist/u);
  await assert.rejects(registry.execute("todo_add", {
    text: "Deleted customer task", todo_group_id: 1, status: "todo",
    related_contact_id: inactiveId, planning_prompt_text: null, position: null,
  }, toolContext), /does not exist/u);
  assert.equal(database.prepare(`
    SELECT related_contact_id FROM todo_personal WHERE personal_task_id = ?
  `).get(created.task.personal_task_id).related_contact_id, activeId);
});

test("to-do reads return complete connected-contact identities for the batch", async (context) => {
  const { store, registry, toolContext } = harness(context);
  const database = store.requireReady();
  const firstContactId = Number(database.prepare(`
    INSERT INTO contacts (display_name, status) VALUES ('First Person', 'active')
    RETURNING contact_id
  `).get().contact_id);
  const secondContactId = Number(database.prepare(`
    INSERT INTO contacts (display_name, status) VALUES ('Second Person', 'active')
    RETURNING contact_id
  `).get().contact_id);
  const first = await registry.execute("todo_add", {
    text: "Call first", todo_group_id: 1, status: "todo",
    related_contact_id: firstContactId, planning_prompt_text: null, position: null,
  }, toolContext);
  const second = await registry.execute("todo_add", {
    text: "Call second", todo_group_id: 1, status: "todo",
    related_contact_id: secondContactId, planning_prompt_text: null, position: null,
  }, toolContext);

  const listed = await registry.execute("todo_list", { queries: [{
    query_id: "connected", group: null, status: null,
    personal_task_ids: [first.task.personal_task_id, second.task.personal_task_id], limit: 20,
  }] });

  assert.deepEqual(listed.results[0].tasks.map(({ related_contact: contact }) => contact), [{
    contact_id: secondContactId,
    ref: `agent-slayer://contacts/${secondContactId}`,
    display_name: "Second Person",
    status: "active",
  }, {
    contact_id: firstContactId,
    ref: `agent-slayer://contacts/${firstContactId}`,
    display_name: "First Person",
    status: "active",
  }]);
});

test("to-do text lookup returns an exact terminal task instead of an open-task dump", async (context) => {
  const { registry, toolContext } = harness(context);
  const created = await registry.execute("todo_add", {
    text: "Lucas Trench", todo_group_id: 1, status: "todo",
    related_contact_id: null, planning_prompt_text: null, position: null,
  }, toolContext);
  await registry.execute("todo_update", { updates: [{
    personal_task_id: created.task.personal_task_id, status: "complete",
  }] }, toolContext);

  const listed = await registry.execute("todo_list", { queries: [{
    query_id: "lucas_trench", group: null, text_query: "Lucas trench",
    status: null, limit: 20,
  }] });
  assert.deepEqual(listed.results[0].tasks.map(({ personal_task_id, text, status }) => ({
    personal_task_id, text, status,
  })), [{
    personal_task_id: created.task.personal_task_id,
    text: "Lucas Trench",
    status: "complete",
  }]);
});

test("to-dos can link and unlink exact content-library items idempotently", async (context) => {
  const { store, registry, toolContext } = harness(context);
  const created = await registry.execute("todo_add", {
    text: "Review launch tutorial", todo_group_id: 1, status: "todo",
    related_contact_id: null, planning_prompt_text: null, position: null,
  }, toolContext);
  const database = store.requireReady();
  const content = database.prepare(`
    INSERT INTO content_items (content_group_id, sequence, title)
    VALUES (1, 1, 'Launch tutorial') RETURNING content_id
  `).get();
  const link = {
    personal_task_id: created.task.personal_task_id,
    content_id: Number(content.content_id),
    linked: true,
  };
  const input = { links: [link] };

  const linked = await registry.execute("todo_content_link_set", input, toolContext);
  assert.equal(linked.changed_count, 1);
  assert.equal(linked.results[0].linked, true);
  assert.deepEqual(linked.tasks[0].linked_content.map((item) => ({
    id: item.content_id, ref: item.content_ref, title: item.content_title,
  })), [{
    id: Number(content.content_id),
    ref: `agent-slayer://content-items/${Number(content.content_id)}`,
    title: "Launch tutorial",
  }]);
  assert.equal((await registry.execute("todo_content_link_set", input, toolContext)).changed_count, 0);

  const listed = await registry.execute("todo_list", { queries: [{
    query_id: "linked", group: null, status: null,
    personal_task_ids: [created.task.personal_task_id], limit: 20,
  }] });
  assert.equal(listed.results[0].tasks[0].linked_content[0].content_title, "Launch tutorial");

  const unlinked = await registry.execute("todo_content_link_set", {
    links: [{ ...link, linked: false }],
  }, toolContext);
  assert.equal(unlinked.changed_count, 1);
  assert.deepEqual(unlinked.tasks[0].linked_content, []);

  await assert.rejects(registry.execute("todo_content_link_set", { links: [
    link,
    { ...link, content_id: Number(content.content_id) + 999 },
  ] }, toolContext), /does not exist/);
  assert.equal(Number(database.prepare(`SELECT COUNT(*) AS count FROM todo_content_join
    WHERE personal_task_id = ?`).get(created.task.personal_task_id).count), 0);
});

test("to-do update batches stay atomic", async (context) => {
  const { registry, toolContext } = harness(context);
  const first = await registry.execute("todo_add", {
    text: "First", todo_group_id: 1, status: "todo", related_contact_id: null,
    planning_prompt_text: null, position: null,
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

test("one group-update tool renames groups and deletes emptied mistaken groups", async (context) => {
  const { store, registry, toolContext } = harness(context);
  const tools = definitions();
  assert.ok(tools.todo_group_update);
  assert.equal(Object.hasOwn(tools, "todo_group_rename"), false);
  assert.equal(Object.hasOwn(tools, "todo_group_archive"), false);
  assert.equal(tools.todo_group_update.annotations.destructiveHint, true);

  const intended = await registry.execute("todo_group_create", { name: "Construction" }, toolContext);
  const mistaken = await registry.execute("todo_group_create", { name: "217 Oakland" }, toolContext);
  const task = await registry.execute("todo_add", {
    text: "Frame kitchen ceiling", todo_group_id: mistaken.group.todo_group_id,
    status: "todo", related_contact_id: null, planning_prompt_text: null, position: null,
  }, toolContext);

  await assert.rejects(registry.execute("todo_group_update", { updates: [{
    todo_group_id: mistaken.group.todo_group_id, name: null, deleted: true,
  }] }, toolContext), /active task/u);

  await registry.execute("todo_update", { updates: [{
    personal_task_id: task.task.personal_task_id,
    todo_group_id: intended.group.todo_group_id,
  }] }, toolContext);
  const result = await registry.execute("todo_group_update", { updates: [{
    todo_group_id: intended.group.todo_group_id, name: "Construction projects", deleted: null,
  }, {
    todo_group_id: mistaken.group.todo_group_id, name: null, deleted: true,
  }] }, toolContext);

  assert.equal(result.updated_count, 2);
  assert.deepEqual(result.items.map(({ action }) => action), ["renamed", "deleted"]);
  assert.equal(result.items[0].group.name, "Construction projects");
  assert.equal(result.items[1].group.ref,
    `agent-slayer://todo-groups/${mistaken.group.todo_group_id}`);
  assert.ok(result.items[1].group.archived_at_utc);
  assert.equal(result.items[1].retained_terminal_task_count, 0);
  assert.equal(store.requireReady().prepare(`
    SELECT archived_at_utc FROM todo_groups WHERE todo_group_id = ?
  `).get(mistaken.group.todo_group_id).archived_at_utc, result.items[1].group.archived_at_utc);
});

test("group-update batches roll back every change when one deletion is invalid", async (context) => {
  const { store, registry, toolContext } = harness(context);
  const first = await registry.execute("todo_group_create", { name: "First group" }, toolContext);
  const active = await registry.execute("todo_group_create", { name: "Active group" }, toolContext);
  await registry.execute("todo_add", {
    text: "Still here", todo_group_id: active.group.todo_group_id,
    status: "todo", related_contact_id: null, planning_prompt_text: null, position: null,
  }, toolContext);

  await assert.rejects(registry.execute("todo_group_update", { updates: [{
    todo_group_id: first.group.todo_group_id, name: "Renamed group", deleted: null,
  }, {
    todo_group_id: active.group.todo_group_id, name: null, deleted: true,
  }] }, toolContext), /active task/u);

  assert.equal(store.requireReady().prepare(`
    SELECT name FROM todo_groups WHERE todo_group_id = ?
  `).get(first.group.todo_group_id).name, "First group");
});

test("daily-paper pin updates are group-bound, batched, and atomic", async (context) => {
  const { store, registry, toolContext } = harness(context);
  const first = await registry.execute("todo_group_create", { name: "Shopping" }, toolContext);
  const second = await registry.execute("todo_group_create", { name: "Packing" }, toolContext);
  const result = await registry.execute("todo_group_daily_paper_pin_set", { updates: [{
    todo_group_id: first.group.todo_group_id, daily_paper_pinned: true,
  }, {
    todo_group_id: second.group.todo_group_id, daily_paper_pinned: true,
  }] }, toolContext);
  assert.equal(result.updated_count, 2);
  assert.ok(result.items.every(({ group }) => group.daily_paper_pinned === 1));

  await assert.rejects(registry.execute("todo_group_daily_paper_pin_set", { updates: [{
    todo_group_id: first.group.todo_group_id, daily_paper_pinned: false,
  }, {
    todo_group_id: 999999, daily_paper_pinned: true,
  }] }, toolContext), /not found/u);
  assert.equal(store.requireReady().prepare(`
    SELECT daily_paper_pinned FROM todo_groups WHERE todo_group_id = ?
  `).get(first.group.todo_group_id).daily_paper_pinned, 1);
});
