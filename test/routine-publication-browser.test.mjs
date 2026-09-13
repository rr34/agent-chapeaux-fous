import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { calendarEventCellItem } from "../public/calendar-grid.js";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

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

test("calendar loads to-dos only as link targets, not as scheduled calendar items", () => {
  assert.match(app, /api\("\/api\/todos\?scope=all&limit=1000"\)/);
  assert.match(app, /linkedTodos/);
  assert.doesNotMatch(app, /todosScheduledOnDay/);
  assert.doesNotMatch(app, /todosDueOnDay/);
});
