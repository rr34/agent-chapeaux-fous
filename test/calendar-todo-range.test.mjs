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
    organizer.updateTodo(supplies.id, { version: supplies.version, status: "archive" });
    assert.deepEqual(organizer.getCalendar(event.id).linkedTodos.map(({ todoId }) => todoId), [bathe.id]);
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM calendar_events_todo_join
      WHERE calendar_event_id = ? AND personal_task_id = ?
    `).get(event.id, supplies.id).count, 1);

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

test("calendar events order linked to-dos like the ordinary to-do list", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.target);
  try {
    const group = organizer.createTodoGroup({ name: "Sequenced event work" });
    const highSequence = organizer.createTodo({ text: "Ninth task", groupId: group.id, sequence: 9 });
    const lowSequence = organizer.createTodo({ text: "Second task", groupId: group.id, sequence: 2 });
    const unsequenced = organizer.createTodo({ text: "Unnumbered task", groupId: group.id });
    const event = organizer.createCalendar({
      title: "Sequenced work", startsAtUtc: "2026-09-20T19:30:00.000Z",
      endsAtUtc: "2026-09-20T20:00:00.000Z", timeZone: "America/New_York",
    });
    organizer.setCalendarEventTodoLinks(event.id, { links: [
      { todoId: unsequenced.id, relationshipKind: "work" },
      { todoId: lowSequence.id, relationshipKind: "work" },
      { todoId: highSequence.id, relationshipKind: "work" },
    ] });

    const expected = [highSequence.id, lowSequence.id, unsequenced.id];
    assert.deepEqual(organizer.getCalendar(event.id).linkedTodos.map(({ todoId }) => todoId), expected);
    assert.deepEqual(organizer.listCalendar({
      from: "2026-09-20T00:00:00.000Z", to: "2026-09-21T00:00:00.000Z",
    })[0].linkedTodos.map(({ todoId }) => todoId), expected);
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
      createdCount: 0, existingCount: 1, movedTodoCount: 0, rollovers: [], events: [],
    });
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("calendar routines copy planning prompts only when each concrete event is generated", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.target);
  try {
    const created = organizer.createCalendarRoutine({
      title: "Planning window",
      startsAtUtc: "2026-09-13T15:00:00.000Z",
      endsAtUtc: "2026-09-13T16:00:00.000Z",
      timeZone: "America/New_York",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SU",
      planningPromptText: "What should happen this week?",
    }).routine;
    const first = organizer.generateCalendarRoutines({
      from: "2026-09-13T00:00:00.000Z", to: "2026-09-20T00:00:00.000Z",
    }).events[0];
    organizer.updateCalendarRoutine(created.id, {
      version: created.version,
      planningPromptText: "What should happen next week?",
    });
    const second = organizer.generateCalendarRoutines({
      from: "2026-09-20T00:00:00.000Z", to: "2026-09-27T00:00:00.000Z",
    }).events[0];
    assert.equal(organizer.getCalendar(first.id).planningPromptText, "What should happen this week?");
    assert.equal(second.planningPromptText, "What should happen next week?");
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("routine generation rolls unfinished work to the earliest usable occurrence only", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.target);
  try {
    const routine = organizer.createCalendarRoutine({
      title: "Admin block",
      startsAtUtc: "2026-09-06T17:00:00.000Z",
      endsAtUtc: "2026-09-06T18:00:00.000Z",
      timeZone: "America/New_York",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SU",
    }).routine;
    const range = {
      from: "2026-09-06T04:00:00.000Z",
      to: "2026-09-28T04:00:00.000Z",
    };
    const clock = { nowUtc: "2026-09-12T16:00:00.000Z" };
    const first = organizer.generateCalendarRoutines(range, clock);
    const [past, next, later] = first.events;
    assert.equal(past.calendarRoutineId, routine.id);

    const groupId = organizer.listTodoGroups().find(({ name }) => name === "Inbox").id;
    const unfinished = organizer.createTodo({ text: "Return admin call", groupId });
    const completed = organizer.createTodo({ text: "File paid invoice", groupId });
    const deadline = organizer.createTodo({ text: "Submit permit", groupId });
    organizer.setCalendarEventTodoLinks(past.id, { links: [
      { todoId: unfinished.id, relationshipKind: "work" },
      { todoId: completed.id, relationshipKind: "work" },
      { todoId: deadline.id, relationshipKind: "deadline" },
    ] });
    organizer.updateTodo(completed.id, { version: completed.version, status: "complete" });

    const generated = organizer.generateCalendarRoutines(range, clock);
    assert.equal(generated.createdCount, 0);
    assert.equal(generated.movedTodoCount, 1);
    assert.deepEqual(generated.rollovers, [{
      todoId: unfinished.id,
      calendarRoutineId: routine.id,
      fromEventIds: [past.id],
      toEventId: next.id,
    }]);
    assert.deepEqual(organizer.getCalendar(past.id).linkedTodos
      .map(({ todoId, relationshipKind }) => [todoId, relationshipKind]), [
      [completed.id, "work"], [deadline.id, "deadline"],
    ]);
    assert.deepEqual(organizer.getCalendar(next.id).linkedTodos
      .map(({ todoId, relationshipKind }) => [todoId, relationshipKind]), [
      [unfinished.id, "work"],
    ]);
    assert.equal(organizer.getCalendar(later.id).linkedTodos.length, 0);
    assert.equal(organizer.generateCalendarRoutines(range, clock).movedTodoCount, 0);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("task-side work placement moves within one routine and preserves other links", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.target);
  try {
    organizer.createCalendarRoutine({
      title: "Admin block",
      startsAtUtc: "2026-09-13T17:00:00.000Z",
      endsAtUtc: "2026-09-13T18:00:00.000Z",
      timeZone: "America/New_York",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SU",
    });
    const generated = organizer.generateCalendarRoutines({
      from: "2026-09-13T04:00:00.000Z",
      to: "2026-09-28T04:00:00.000Z",
    }, { nowUtc: "2026-09-12T16:00:00.000Z" });
    const [first, second] = generated.events;
    const standalone = organizer.createCalendar({
      title: "Permit deadline", startsAtUtc: "2026-09-25T21:00:00.000Z",
      timeZone: "America/New_York",
    });
    const groupId = organizer.listTodoGroups().find(({ name }) => name === "Inbox").id;
    const todo = organizer.createTodo({ text: "Admin catch-up", groupId });
    organizer.placeTodoCalendarLinks({ placements: [
      { todoId: todo.id, eventId: first.id, relationshipKind: "work" },
      { todoId: todo.id, eventId: standalone.id, relationshipKind: "deadline" },
    ] });

    const moved = organizer.placeTodoCalendarLinks({ placements: [{
      todoId: todo.id, eventId: second.id, relationshipKind: "work",
    }] });
    assert.deepEqual(moved.placements[0].removedEventIds, [first.id]);
    assert.deepEqual(organizer.getTodoCalendarLinks(todo.id, {
      after: "2026-09-12T16:00:00.000Z",
    }).links.map(({ eventId, relationshipKind }) => [eventId, relationshipKind]), [
      [second.id, "work"], [standalone.id, "deadline"],
    ]);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});
