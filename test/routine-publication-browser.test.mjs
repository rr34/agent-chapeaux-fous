import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { calendarEventCellItem } from "../public/calendar-grid.js";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("routine generation publishes calendar events and highlights those events", () => {
  assert.match(app, /api\("\/api\/calendar-routines\/generate"/);
  assert.match(app, /Created \$\{result\.createdCount\} calendar/);
  assert.match(app, /generatedCalendarEventIds = new Set\(result\.events\.map/);
  assert.doesNotMatch(app, /scheduledTodoCellItem/);

  const event = { title: "Bathe Ruby", isAllDay: false, status: "confirmed" };
  assert.equal(calendarEventCellItem(event, { highlighted: true }).className,
    "day-event confirmed routine-published");
  assert.equal(calendarEventCellItem(event).className, "day-event confirmed");
});

test("calendar routine controls expose bounded weekly generation", () => {
  assert.match(app, /publishRoutineRange\(from, addDays\(from, 7\)\)/);
  assert.match(app, /calendarRangeStart = startOfWeek\(from\)/);
  assert.match(app, /selectedCalendarDate = new Date\(from\)/);
  assert.match(app, /events were.*already present/);
});

test("to-dos own calendar placement while the event editor remains event-focused", () => {
  assert.match(app, /openTodoCalendar\(todo\)/);
  assert.match(app, /\/api\/todos\/\$\{todoId\}\/calendar-links/);
  assert.match(app, /linkedTodos/);
  assert.match(app, /node\("details", "agenda-event-todos"\)/);
  assert.match(app, /checklist\.open = true/);
  assert.match(app, /for \(const todo of calendarEvent\.linkedTodos\)/);
  assert.match(app, /completed \? "☑" : "☐"/);
  assert.match(html, /shifts this todo from another work event in the same routine/u);
  assert.doesNotMatch(app, /eventTodoLinkList/);
  assert.doesNotMatch(app, /calendar-events\/\$\{savedId\}\/todo-links/);
  assert.doesNotMatch(app, /todosScheduledOnDay/);
  assert.doesNotMatch(app, /todosDueOnDay/);
});
