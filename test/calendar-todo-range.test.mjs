import assert from "node:assert/strict";
import test from "node:test";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("calendar range filtering finds published tasks beyond the backlog and includes Sunday but not the following Monday", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.target);
  try {
    const groupId = organizer.listTodoGroups().find(({ name }) => name === "Inbox").id;
    const insert = organizer.database.prepare(`
      INSERT INTO todo_personal (todo_group_id, text, status, sort_position, scheduled_at_utc, due_at_utc)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (let index = 0; index < 1000; index++) insert.run(groupId, `Backlog ${index}`, "todo", index, null, null);
    organizer.createRoutine({
      groupId, text: "Bathe Ruby", scheduledAtUtc: "2026-09-13T13:00:00.000Z",
      recurrenceRule: "FREQ=WEEKLY;BYDAY=SU", recurrenceTimeZone: "America/New_York",
    });
    const range = { from: "2026-09-14T04:00:00.000Z", to: "2026-09-21T04:00:00.000Z" };
    const published = organizer.publishRoutines(range);
    assert.equal(published.createdCount, 1);
    assert.equal(organizer.listTodos({ limit: 1000 }).some(({ text }) => text === "Bathe Ruby"), false);
    insert.run(groupId, "Monday boundary", "todo", 2000, range.from, null);
    insert.run(groupId, "Sunday late", "todo", 2001, "2026-09-21T03:59:59.000Z", null);
    insert.run(groupId, "Following Monday", "todo", 2002, range.to, null);
    insert.run(groupId, "Previous Sunday", "todo", 2003, "2026-09-14T03:59:59.000Z", null);
    insert.run(groupId, "Due this week", "todo", 2004, null, "2026-09-20T14:00:00.000Z");
    insert.run(groupId, "Completed", "complete", 2005, range.from, null);
    insert.run(groupId, "Scheduled and due", "unplanned", 2006, range.from, range.from);
    const visible = organizer.listTodos({ ...range, limit: 1000 });
    assert.deepEqual(visible.map(({ text }) => text), [
      "Bathe Ruby", "Monday boundary", "Sunday late", "Due this week", "Scheduled and due",
    ]);
    assert.equal(visible[0].scheduledAtUtc, "2026-09-20T13:00:00.000Z");
    assert.equal(organizer.publishRoutines(range).createdCount, 0);
    assert.equal(organizer.listTodos({ ...range, scope: "completed" })[0].text, "Completed");
    assert.equal(organizer.listTodos({ ...range, scope: "all" }).length, 6);
    for (const invalid of [{ from: range.from }, { to: range.to }, { from: range.to, to: range.from },
      { from: range.from, to: "2027-01-01T00:00:00Z" }]) {
      assert.throws(() => organizer.listTodos(invalid), /positive from\/to range/);
    }
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("calendar reads retain tasks continuing into a range and exclude those ending exactly at its start", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.target);
  try {
    const groupId = organizer.listTodoGroups().find(({ name }) => name === "Inbox").id;
    const insert = organizer.database.prepare(`
      INSERT INTO todo_personal (todo_group_id, text, status, scheduled_at_utc, duration_minutes)
      VALUES (?, ?, 'todo', ?, ?)
    `);
    const id = Number(insert.run(groupId, "Daddy time", "2026-09-14T21:00:00.000Z", 1620).lastInsertRowid);
    insert.run(groupId, "Ends at midnight", "2026-09-14T21:00:00.000Z", 420);
    insert.run(groupId, "No duration", "2026-09-14T21:00:00.000Z", null);
    insert.run(groupId, "Just into Tuesday", "2026-09-14T21:00:00.001Z", 420);
    const tuesday = organizer.listTodos({ from: "2026-09-15T04:00:00.000Z", to: "2026-09-16T04:00:00.000Z" });
    assert.deepEqual(tuesday.map(({ text }) => text), ["Daddy time", "Just into Tuesday"]);
    assert.equal(tuesday[0].id, id);
    assert.equal(tuesday[0].scheduledAtUtc, "2026-09-14T21:00:00.000Z");
    assert.equal(organizer.listTodos({ from: "2026-09-16T04:00:00.000Z", to: "2026-09-17T04:00:00.000Z" }).length, 0);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});
