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
      scheduledAtUtc: "2026-08-17T13:00:00.000Z",
      dueAtUtc: "2026-08-17T14:00:00.000Z",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      recurrenceTimeZone: "America/New_York",
    });
    assert.equal(created.groupName, "Health");
    assert.ok(created.routineId);

    const completed = organizer.updateTodo(created.id, {
      version: created.version,
      status: "complete",
    });
    assert.ok(completed.completedAtUtc);
    const generated = organizer.listTodos({ scope: "active" })
      .find((todo) => todo.routineId === created.routineId);
    assert.ok(generated);
    assert.ok(new Date(generated.scheduledAtUtc) > new Date(created.scheduledAtUtc));
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
