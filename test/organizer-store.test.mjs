import assert from "node:assert/strict";
import test from "node:test";
import { OrganizerInputError, OrganizerStore } from "../src/organizer-store.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("calendar events use the existing tables with optimistic concurrency", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const created = organizer.createCalendar({
      title: "Dentist",
      startsAtUtc: "2026-08-18T19:00:00.000Z",
      endsAtUtc: "2026-08-18T20:00:00.000Z",
      timeZone: "America/New_York",
    });
    assert.equal(created.status, "confirmed");
    assert.equal(organizer.listCalendar({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    }).some(({ id }) => id === created.id), true);

    const updated = organizer.updateCalendar(created.id, {
      version: created.version,
      title: "Dental cleaning",
      status: "tentative",
    });
    assert.equal(updated.title, "Dental cleaning");
    assert.throws(
      () => organizer.updateCalendar(created.id, { version: created.version, title: "Stale" }),
      (error) => error instanceof OrganizerInputError && error.statusCode === 409,
    );
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("grouped and recurring todos use the existing task tables", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Health" });
    const created = organizer.createTodo({
      text: "Weekly review",
      groupId: group.id,
      scheduledAtUtc: "2026-08-17T04:00:00.000Z",
      dueAtUtc: "2026-08-17T20:00:00.000Z",
      isAllDay: true,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      recurrenceTimeZone: "America/New_York",
    });
    assert.equal(created.groupName, "Health");
    assert.equal(created.isAllDay, true);
    assert.ok(created.routineId);

    const completed = organizer.updateTodo(created.id, {
      version: created.version,
      status: "complete",
    });
    assert.ok(completed.completedAtUtc);
    const generated = organizer.listTodos({ scope: "active" })
      .find((todo) => todo.routineId === created.routineId);
    assert.ok(generated);
    assert.equal(generated.isAllDay, true);
    assert.ok(new Date(generated.scheduledAtUtc) > new Date(created.scheduledAtUtc));
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("recurrence can be added, edited, and removed through todo updates", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Home" });
    const created = organizer.createTodo({
      text: "Water plants",
      groupId: group.id,
      scheduledAtUtc: "2026-08-18T12:00:00.000Z",
    });
    assert.equal(created.routineId, null);

    const recurring = organizer.updateTodo(created.id, {
      version: created.version,
      recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR;COUNT=8",
      recurrenceTimeZone: "America/New_York",
    });
    assert.ok(recurring.routineId);
    assert.equal(recurring.recurrenceRule, "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR;COUNT=8");

    const edited = organizer.updateTodo(created.id, {
      version: recurring.version,
      text: "Water all plants",
      recurrenceRule: "FREQ=MONTHLY;INTERVAL=1;UNTIL=20261231T235959Z",
      recurrenceTimeZone: "America/New_York",
    });
    assert.equal(edited.routineId, recurring.routineId);
    assert.equal(edited.recurrenceRule, "FREQ=MONTHLY;INTERVAL=1;UNTIL=20261231T235959Z");
    assert.equal(organizer.database.prepare(
      "SELECT text FROM todo_routines WHERE todo_routine_id = ?",
    ).get(recurring.routineId).text, "Water all plants");

    const oneTime = organizer.updateTodo(created.id, {
      version: edited.version,
      recurrenceRule: null,
      recurrenceTimeZone: null,
    });
    assert.equal(oneTime.routineId, null);
    assert.equal(oneTime.recurrenceRule, null);
    assert.ok(organizer.database.prepare(
      "SELECT disabled_at_utc FROM todo_routines WHERE todo_routine_id = ?",
    ).get(recurring.routineId).disabled_at_utc);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("group reordering atomically normalizes every task position", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Ordered work" });
    const tasks = ["First", "Second", "Third", "Fourth"]
      .map((text) => organizer.createTodo({ text, groupId: group.id }));

    organizer.reorderTodos(group.id, {
      orderedTodoIds: [tasks[3].id, tasks[0].id, tasks[1].id, tasks[2].id],
    });
    organizer.reorderTodos(group.id, {
      orderedTodoIds: [tasks[2].id, tasks[0].id],
    });

    const ordered = organizer.listTodos({ scope: "all" }).filter(({ groupId }) => groupId === group.id);
    assert.deepEqual(ordered.map(({ text }) => text), ["Fourth", "Third", "Second", "First"]);
    assert.deepEqual(ordered.map(({ sortPosition }) => sortPosition), [10, 20, 30, 40]);
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM activity_events WHERE event_type = 'personal_todo.reordered'
    `).get().count, 2);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("renaming a group preserves membership and updates alphabetical ordering", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Zulu" });
    const task = organizer.createTodo({ text: "Keeps its group ID", groupId: group.id });
    const result = organizer.renameTodoGroup(group.id, { name: "Alpha" });
    assert.equal(result.group.previousName, "Zulu");
    assert.equal(result.group.name, "Alpha");
    assert.equal(organizer.getTodo(task.id).groupName, "Alpha");
    assert.deepEqual(
      organizer.listTodoGroups().map(({ name }) => name),
      ["Alpha", "Development", "Inbox"],
    );
    assert.throws(
      () => organizer.renameTodoGroup(group.id, { name: "Development" }),
      (error) => error.statusCode === 409 && /already exists/.test(error.message),
    );
    assert.throws(
      () => organizer.renameTodoGroup(1, { name: "Incoming" }),
      (error) => error.statusCode === 409 && /cannot be renamed/.test(error.message),
    );
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("archiving a group fails on active tasks and preserves terminal task history", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Temporary" });
    const active = organizer.createTodo({ text: "Still active", groupId: group.id });
    const completed = organizer.createTodo({
      text: "Already done", groupId: group.id, status: "complete", sequence: 7,
    });
    assert.throws(
      () => organizer.archiveTodoGroup(group.id),
      (error) => error.statusCode === 409 && /active task/.test(error.message),
    );

    organizer.updateTodo(active.id, { version: active.version, status: "ignore" });
    const result = organizer.archiveTodoGroup(group.id);
    assert.equal(result.retainedTerminalTaskCount, 2);
    assert.equal(organizer.listTodoGroups().some(({ id }) => id === group.id), false);
    assert.ok(organizer.listTodoGroups({ includeArchived: true }).find(({ id }) => id === group.id)?.archivedAtUtc);
    const retained = [organizer.getTodo(active.id), organizer.getTodo(completed.id)];
    assert.deepEqual(retained.map(({ groupName }) => groupName), ["Temporary", "Temporary"]);
    assert.deepEqual(retained.map(({ sequence }) => sequence), [null, 7]);
    assert.ok(retained.every(({ groupArchivedAtUtc }) => groupArchivedAtUtc));
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});
