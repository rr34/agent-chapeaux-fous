import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerDatabaseTools } from "../src/tools/database-tools.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { localDateUtcBounds } from "../src/todo-schedule-operations.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("local calendar-date boundaries honor daylight-saving changes", () => {
  assert.deepEqual(
    localDateUtcBounds({ localDate: "2026-03-08", timeZone: "America/New_York" }),
    {
      localDate: "2026-03-08",
      timeZone: "America/New_York",
      startsAtUtc: "2026-03-08T05:00:00.000Z",
      endsAtUtc: "2026-03-09T04:00:00.000Z",
    },
  );
  assert.deepEqual(
    localDateUtcBounds({ localDate: "2026-11-01", timeZone: "America/New_York" }),
    {
      localDate: "2026-11-01",
      timeZone: "America/New_York",
      startsAtUtc: "2026-11-01T04:00:00.000Z",
      endsAtUtc: "2026-11-02T05:00:00.000Z",
    },
  );
});

test("todo_list filters single completion and schedule timestamps by local date", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const database = store.requireReady();
  const insert = database.prepare(`
    INSERT INTO personal_tasks (
      todo_group_id, text, status, scheduled_at_utc, completed_at_utc
    ) VALUES (1, ?, ?, ?, ?)
  `);
  insert.run("Completed before local day", "complete", null, "2026-11-01T03:59:59.999Z");
  insert.run("Completed at local-day start", "complete", null, "2026-11-01T04:00:00.000Z");
  insert.run("Completed near local-day end", "complete", null, "2026-11-02T04:59:59.999Z");
  insert.run("Completed at next local day", "complete", null, "2026-11-02T05:00:00.000Z");
  insert.run("Scheduled before local day", "todo", "2026-03-08T04:59:59.999Z", null);
  insert.run("Scheduled at local-day start", "todo", "2026-03-08T05:00:00.000Z", null);
  insert.run("Scheduled near local-day end", "todo", "2026-03-09T03:59:59.999Z", null);
  insert.run("Scheduled at next local day", "todo", "2026-03-09T04:00:00.000Z", null);

  const registry = new ToolRegistry();
  registerTodoTools(registry, store, new Ledger(store));
  const [groupContext] = await registry.prepareContext(["todos.active_groups"]);
  assert.deepEqual(groupContext.data.groups.map(({ todoGroupId, name }) => ({ todoGroupId, name })), [
    { todoGroupId: 2, name: "Development" },
    { todoGroupId: 1, name: "Inbox" },
  ]);
  assert.match(groupContext.text, /\[group 2\] Development/);
  assert.doesNotMatch(groupContext.text, /Completed before local day/);
  const definition = registry.toolDefinitions().find(({ name }) => name === "todo_list");
  assert.deepEqual(
    Object.keys(definition.inputSchema.properties).filter((name) => name.endsWith("_on_date")),
    ["completed_on_date", "scheduled_on_date"],
  );

  const completed = await registry.execute("todo_list", {
    group: null,
    status: null,
    completed_on_date: "2026-11-01",
    scheduled_on_date: null,
    time_zone: "America/New_York",
    limit: 20,
  });
  assert.deepEqual(completed.tasks.map(({ text }) => text), [
    "Completed near local-day end",
    "Completed at local-day start",
  ]);
  assert.equal(completed.filters.completed_on_date, "2026-11-01");

  const scheduled = await registry.execute("todo_list", {
    group: null,
    status: null,
    completed_on_date: null,
    scheduled_on_date: "2026-03-08",
    time_zone: "America/New_York",
    limit: 20,
  });
  assert.deepEqual(scheduled.tasks.map(({ text }) => text), [
    "Scheduled at local-day start",
    "Scheduled near local-day end",
  ]);
  assert.equal(scheduled.filters.scheduled_on_date, "2026-03-08");

  await assert.rejects(
    registry.execute("todo_list", {
      group: null,
      status: null,
      completed_on_date: "2026-11-01",
      scheduled_on_date: null,
      time_zone: null,
      limit: 20,
    }),
    /timeZone is required/,
  );
});

test("todo_group_list exposes every active group including empty catchalls", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, new Ledger(store));

  const result = await registry.execute("todo_group_list", {});
  assert.deepEqual(result.groups, [
    { todo_group_id: 2, name: "Development", uses_sequence: 0, archived_at_utc: null, open_task_count: 0 },
    { todo_group_id: 1, name: "Inbox", uses_sequence: 0, archived_at_utc: null, open_task_count: 0 },
  ]);
});

test("native todo tools place new and existing tasks at exact 1-based positions", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, ledger);
  const definitions = Object.fromEntries(
    registry.toolDefinitions().map((definition) => [definition.name, definition.inputSchema]),
  );
  assert.equal(Object.hasOwn(definitions.todo_add.properties, "position"), true);
  assert.deepEqual(definitions.todo_position_set.required, ["personal_task_id", "position"]);

  const first = await registry.execute("todo_add", {
    text: "First task", group: "Development", scheduled_at_utc: null, due_at_utc: null,
  });
  const second = await registry.execute("todo_add", {
    text: "Second task", group: "Development", scheduled_at_utc: null, due_at_utc: null,
  });
  const top = await registry.execute("todo_add", {
    text: "New top task", group: "Development", scheduled_at_utc: null, due_at_utc: null,
    position: 1,
  });
  assert.equal(top.task.sort_position, 10);

  const moved = await registry.execute("todo_position_set", {
    personal_task_id: second.task.personal_task_id,
    position: 2,
  }, { requestId: "reorder-task", callId: "move-second" });
  assert.equal(moved.changed, true);
  assert.equal(moved.previous_position, 3);
  assert.equal(moved.position, 2);
  assert.equal(moved.task_count, 3);
  assert.equal(moved.task.sort_position, 20);

  const rows = store.requireReady().prepare(`
    SELECT personal_task_id, sort_position
    FROM personal_tasks WHERE todo_group_id = 2
    ORDER BY sort_position, personal_task_id
  `).all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { personal_task_id: top.task.personal_task_id, sort_position: 10 },
    { personal_task_id: second.task.personal_task_id, sort_position: 20 },
    { personal_task_id: first.task.personal_task_id, sort_position: 30 },
  ]);
  assert.equal(store.requireReady().prepare(`
    SELECT COUNT(*) AS count FROM activity_events
    WHERE event_type = 'personal_todo.reordered' AND actor_name = 'todo_position_set'
  `).get().count, 1);

  await assert.rejects(
    registry.execute("todo_position_set", {
      personal_task_id: first.task.personal_task_id,
      position: 4,
    }),
    /position must be between 1 and 3/,
  );
  const unchanged = await registry.execute("todo_position_set", {
    personal_task_id: top.task.personal_task_id,
    position: 1,
  });
  assert.equal(unchanged.changed, false);
});

test("sequenced groups backfill tasks and assign the next number through native tools", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, new Ledger(store));

  const first = await registry.execute("todo_add", {
    text: "First unnumbered", group: "Development", scheduled_at_utc: null, due_at_utc: null,
  });
  const second = await registry.execute("todo_add", {
    text: "Second unnumbered", group: "Development", scheduled_at_utc: null, due_at_utc: null,
  });
  assert.equal(first.task.sequence, null);
  assert.equal(second.task.sequence, null);

  const enabled = await registry.execute("todo_group_sequence_set", {
    name: "Development", uses_sequence: true,
  }, { requestId: "sequence-mode", callId: "enable" });
  assert.equal(enabled.group.uses_sequence, 1);
  assert.equal(enabled.assigned_task_count, 2);

  const third = await registry.execute("todo_add", {
    text: "Automatically numbered", group: "Development", scheduled_at_utc: null, due_at_utc: null,
  });
  assert.equal(third.task.sequence, 3);
  assert.deepEqual(
    store.requireReady().prepare(`
      SELECT sequence FROM personal_tasks WHERE todo_group_id = 2 ORDER BY sort_position
    `).all().map(({ sequence }) => sequence),
    [1, 2, 3],
  );
  const listed = await registry.execute("todo_list", {
    group: "Development", status: null, limit: 20,
  });
  assert.deepEqual(listed.tasks.map(({ sequence }) => sequence), [3, 2, 1]);

  await registry.execute("todo_group_sequence_set", {
    name: "Development", uses_sequence: false,
  }, { requestId: "sequence-mode", callId: "disable" });
  const unnumbered = await registry.execute("todo_add", {
    text: "Unnumbered again", group: "Development", scheduled_at_utc: null, due_at_utc: null,
  });
  assert.equal(unnumbered.task.sequence, null);
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
    text: "Disposable task", group: "Development", scheduled_at_utc: null, due_at_utc: null,
  }, { requestId: "delete-group", callId: "add" });
  await assert.rejects(
    registry.execute("todo_group_archive", { name: "Development" }, { requestId: "archive-group", callId: "archive" }),
    /active task/,
  );
  await registry.execute("todo_update", {
    personal_task_id: created.task.personal_task_id, text: null, group: null, status: "complete",
    scheduled_at_utc: null, due_at_utc: null,
  }, { requestId: "delete-group", callId: "complete" });
  const archived = await registry.execute(
    "todo_group_archive", { name: "Development" }, { requestId: "archive-group", callId: "archive" },
  );
  assert.equal(archived.archived, true);
  assert.equal(archived.retained_terminal_task_count, 1);
  const task = store.requireReady().prepare(`
    SELECT todo_group.name, todo_group.archived_at_utc
    FROM personal_tasks AS task JOIN todo_groups AS todo_group USING (todo_group_id)
    WHERE task.personal_task_id = ?
  `).get(created.task.personal_task_id);
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
    text: "Rename-safe task", group: "Development", scheduled_at_utc: null, due_at_utc: null,
  }, { requestId: "rename-group", callId: "add" });
  const renamed = await registry.execute("todo_group_rename", {
    current_name: "Development", new_name: "Engineering",
  }, { requestId: "rename-group", callId: "rename" });
  assert.equal(renamed.previous_name, "Development");
  assert.equal(renamed.group.name, "Engineering");
  const listed = await registry.execute("todo_list", { group: "Engineering", status: null, limit: 20 });
  assert.deepEqual(listed.tasks.map(({ personal_task_id }) => personal_task_id), [created.task.personal_task_id]);
  await assert.rejects(
    registry.execute("todo_group_rename", {
      current_name: "Inbox", new_name: "Incoming",
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
    scheduled_at_utc: null,
    due_at_utc: null,
  }, { requestId: "request-1", requestEventId: request.eventId, callId: "call-add" });

  assert.equal(created.created, true);
  assert.equal(created.task.todo_groups.name, "Development");
  assert.equal(created.task.text, "Flip the Tesla charging outlet");
  const listed = await registry.execute("todo_list", { group: "Development", status: null, limit: 20 });
  assert.deepEqual(listed.tasks.map((task) => task.text), ["Flip the Tesla charging outlet"]);

  const updated = await registry.execute("todo_update", {
    personal_task_id: created.task.personal_task_id,
    text: null,
    group: null,
    status: "complete",
    scheduled_at_utc: null,
    due_at_utc: null,
  }, { requestId: "request-1", callId: "call-update" });
  assert.equal(updated.task.status, "complete");
  assert.ok(updated.task.completed_at_utc);
});

test("todo_add associates a newly resolved contact with the task", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const database = store.requireReady();
  const contact = database.prepare(`
    INSERT INTO contacts (display_name, given_name, source, external_id)
    VALUES ('Kristen', 'Kristen', 'agent-slayer-manual', 'kristen-test')
    RETURNING contact_id
  `).get();
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, new Ledger(store));

  const created = await registry.execute("todo_add", {
    text: "Kristen — Seiko watch battery and band",
    group: "Development",
    related_contact_id: Number(contact.contact_id),
    scheduled_at_utc: null,
    due_at_utc: null,
  }, { requestId: "contact-task", callId: "add" });

  assert.equal(created.task.related_contact_id, Number(contact.contact_id));
  assert.equal(database.prepare(`
    SELECT related_contact_id FROM personal_tasks WHERE personal_task_id = ?
  `).get(created.task.personal_task_id).related_contact_id, Number(contact.contact_id));
  const cleared = await registry.execute("todo_update", {
    personal_task_id: created.task.personal_task_id,
    text: null,
    group: null,
    related_contact_id: null,
    status: null,
    scheduled_at_utc: null,
    due_at_utc: null,
  });
  assert.equal(cleared.task.related_contact_id, null);
  await assert.rejects(
    registry.execute("todo_add", {
      text: "Unknown contact task",
      group: "Development",
      related_contact_id: 999_999,
      scheduled_at_utc: null,
      due_at_utc: null,
    }),
    /Related contact 999999 does not exist/,
  );
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
    scheduled_at_utc: "2026-08-17T13:00:00.000Z",
    due_at_utc: null,
    recurrence: {
      frequency: "WEEKLY", interval: 1, weekdays: ["MO"], count: 6,
      until_date: null, time_zone: "America/New_York",
    },
  }, { requestId: "recurring", callId: "add-recurring" });
  assert.ok(created.task.todo_routine_id);
  assert.equal(created.task.todo_routines.recurrence_rule, "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=6");

  const changed = await registry.execute("todo_recurrence_set", {
    personal_task_id: created.task.personal_task_id,
    enabled: true,
    recurrence: {
      frequency: "WEEKLY", interval: 2, weekdays: ["TU", "FR"], count: null,
      until_date: "2026-12-31", time_zone: "America/New_York",
    },
  }, { requestId: "recurring", callId: "change-recurring" });
  assert.equal(
    changed.task.todo_routines.recurrence_rule,
    "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR;UNTIL=20261231T235959",
  );

  const completed = await registry.execute("todo_update", {
    personal_task_id: created.task.personal_task_id, text: null, group: null, status: "complete",
    scheduled_at_utc: null, due_at_utc: null,
  }, { requestId: "recurring", callId: "complete-recurring" });
  assert.ok(completed.generated_task.personal_task_id);
  assert.equal(store.requireReady().prepare(
    "SELECT todo_routine_id FROM personal_tasks WHERE personal_task_id = ?",
  ).get(completed.generated_task.personal_task_id).todo_routine_id, created.task.todo_routine_id);
  assert.equal(store.requireReady().prepare(`
    SELECT COUNT(*) AS count FROM activity_events
    WHERE event_type = 'personal_todo.generated' AND subject_id = ?
  `).get(String(completed.generated_task.personal_task_id)).count, 1);
});

test("native todo tools keep Routine entries as repeating templates", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, new Ledger(store));

  await registry.execute("todo_group_create", { name: "Routine" });
  await assert.rejects(registry.execute("todo_add", {
    text: "One-time item in the wrong place",
    group: "Routine",
    scheduled_at_utc: "2026-09-04T13:00:00.000Z",
    due_at_utc: null,
  }), /must repeat/);
  const created = await registry.execute("todo_add", {
    text: "First Friday review",
    group: "Routine",
    scheduled_at_utc: "2026-09-04T13:00:00.000Z",
    due_at_utc: null,
    recurrence: {
      frequency: "MONTHLY", interval: 1, weekdays: [], month: null, month_day: null,
      ordinal_weekday: { ordinal: 1, weekday: "FR" }, count: null,
      until_date: null, time_zone: "UTC",
    },
  });
  assert.equal(
    created.task.todo_routines.recurrence_rule,
    "FREQ=MONTHLY;INTERVAL=1;BYDAY=FR;BYSETPOS=1",
  );
  await assert.rejects(registry.execute("todo_update", {
    personal_task_id: created.task.personal_task_id,
    text: null, group: null, status: "complete",
    scheduled_at_utc: null, due_at_utc: null,
  }), /must remain active repeating templates/);
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
    scheduled_at_utc: "2026-08-22T04:00:00.000Z",
    is_all_day: true,
    due_at_utc: null,
  }, { requestId: "all-day", callId: "add" });
  assert.equal(created.task.is_all_day, 1);

  const updated = await registry.execute("todo_update", {
    personal_task_id: created.task.personal_task_id,
    text: null,
    group: null,
    status: null,
    scheduled_at_utc: null,
    is_all_day: false,
    due_at_utc: null,
  }, { requestId: "all-day", callId: "make-timed" });
  assert.equal(updated.task.is_all_day, 0);
});

test("todo_move_overdue_to_today shifts all overdue active tasks in one tool call", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const registry = new ToolRegistry();
  registerTodoTools(registry, store, new Ledger(store));

  const first = await registry.execute("todo_add", {
    text: "First overdue task",
    group: "Inbox",
    scheduled_at_utc: "2026-08-15T13:00:00.000Z",
    due_at_utc: "2026-08-16T14:00:00.000Z",
  }, { requestId: "move-overdue", callId: "add-first" });
  const second = await registry.execute("todo_add", {
    text: "Second overdue task",
    group: "Development",
    scheduled_at_utc: "2026-08-16T04:00:00.000Z",
    is_all_day: true,
    due_at_utc: null,
  }, { requestId: "move-overdue", callId: "add-second" });

  const result = await registry.execute("todo_move_overdue_to_today", {
    local_date: "2026-08-17",
    time_zone: "America/New_York",
  }, { requestId: "move-overdue", callId: "move-all" });

  assert.equal(result.moved_count, 2);
  assert.deepEqual(
    result.tasks.map(({ personal_task_id }) => personal_task_id),
    [first.task.personal_task_id, second.task.personal_task_id],
  );
  assert.deepEqual(
    result.tasks.map(({ scheduled_at_utc }) => scheduled_at_utc),
    ["2026-08-17T13:00:00.000Z", "2026-08-17T04:00:00.000Z"],
  );
  assert.equal(result.tasks[0].due_at_utc, "2026-08-18T14:00:00.000Z");
  assert.equal(store.requireReady().prepare(`
    SELECT COUNT(*) AS count FROM activity_events
    WHERE event_type = 'personal_todos.moved_to_today'
      AND actor_name = 'todo_move_overdue_to_today'
  `).get().count, 1);
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
    scheduled_at_utc: null,
    due_at_utc: null,
  }, { requestId: "request-create-group", requestEventId: request.eventId, callId: "call-create-group" });

  assert.equal(created.created, true);
  assert.deepEqual(created.group_resolution, {
    requested_group: "Development",
    actual_group: "Inbox",
    requested_group_found: false,
    used_inbox_fallback: true,
    ask_to_create_requested_group: true,
  });
  assert.equal(created.task.todo_groups.name, "Inbox");
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
    personal_task_id: created.task.personal_task_id,
    text: null,
    group: "Development",
    status: null,
    scheduled_at_utc: null,
    due_at_utc: null,
  }, { requestId: "request-create-group", callId: "call-move" });
  assert.equal(moved.task.todo_groups.name, "Development");
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
    steps: [],
    eventCount: 2,
    scriptSelectable: true,
    structuredInteractionSelectable: true,
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
