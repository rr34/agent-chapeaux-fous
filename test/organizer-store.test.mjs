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
