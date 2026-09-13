import assert from "node:assert/strict";
import test from "node:test";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("calendar events and to-dos have replaceable many-to-many links", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.target);
  try {
    const groupId = organizer.listTodoGroups().find(({ name }) => name === "Inbox").id;
    const bathe = organizer.createTodo({ text: "Bathe Ruby", groupId });
    const supplies = organizer.createTodo({ text: "Buy shampoo", groupId });
    const event = organizer.createCalendar({
      title: "Ruby care", startsAtUtc: "2026-09-20T19:30:00.000Z",
      endsAtUtc: "2026-09-20T20:00:00.000Z", timeZone: "America/New_York",
    });
    organizer.setCalendarEventTodoLinks(event.id, { links: [
      { todoId: bathe.id, relationshipKind: "work" },
      { todoId: supplies.id, relationshipKind: "context" },
    ] });
    const linked = organizer.getCalendar(event.id).linkedTodos;
    assert.deepEqual(linked.map(({ todoId, relationshipKind }) => [todoId, relationshipKind]), [
      [bathe.id, "work"], [supplies.id, "context"],
    ]);

    const deadline = organizer.createCalendar({
      title: "Due: Bathe Ruby", startsAtUtc: "2026-09-20T23:00:00.000Z",
      timeZone: "America/New_York",
    });
    organizer.setCalendarEventTodoLinks(deadline.id, {
      links: [{ todoId: bathe.id, relationshipKind: "deadline" }],
    });
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM calendar_events_todo_join WHERE personal_task_id = ?
    `).get(bathe.id).count, 2);

    organizer.setCalendarEventTodoLinks(event.id, {
      links: [{ todoId: bathe.id, relationshipKind: "context" }],
    });
    assert.deepEqual(organizer.getCalendar(event.id).linkedTodos.map(({ todoId, relationshipKind }) => ({
      todoId, relationshipKind,
    })), [{ todoId: bathe.id, relationshipKind: "context" }]);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("calendar routines generate idempotent events and never generate to-dos", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.target);
  try {
    organizer.createCalendarRoutine({
      title: "Bathe Ruby",
      startsAtUtc: "2026-09-13T19:30:00.000Z",
      endsAtUtc: "2026-09-13T20:00:00.000Z",
      timeZone: "America/New_York",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SU",
    });
    const range = { from: "2026-09-14T04:00:00.000Z", to: "2026-09-21T04:00:00.000Z" };
    const beforeTasks = organizer.listTodos({ scope: "all", limit: 1000 }).length;
    const generated = organizer.generateCalendarRoutines(range);
    assert.equal(generated.createdCount, 1);
    assert.equal(generated.events[0].title, "Bathe Ruby");
    assert.equal(generated.events[0].startsAtUtc, "2026-09-20T19:30:00.000Z");
    assert.equal(organizer.listTodos({ scope: "all", limit: 1000 }).length, beforeTasks);
    assert.deepEqual(organizer.generateCalendarRoutines(range), {
      createdCount: 0, existingCount: 1, events: [],
    });
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});
