import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const routines = fs.readFileSync(new URL("../web/src/components/RoutineCalendar.tsx", import.meta.url), "utf8");
const editableItems = fs.readFileSync(new URL("../web/src/components/EditableItems.tsx", import.meta.url), "utf8");
const calendar = fs.readFileSync(new URL("../web/src/components/DailyPaper.tsx", import.meta.url), "utf8");

test("React routines use calendar grids for weekly and monthly patterns", () => {
  assert.match(routines, /weeklyRoutineDays/);
  assert.match(routines, /monthlyRoutineDays/);
  assert.match(routines, /<CalendarGrid days=\{weeklyDays\}/);
  assert.match(routines, /<CalendarGrid days=\{monthlyDays\}/);
  assert.match(calendar, /ariaLabel\?: string/);
});

test("React routines generate bounded event ranges into the regular calendar", () => {
  assert.match(routines, /api<CalendarRoutineGeneration>\("\/api\/calendar-routines\/generate"/);
  assert.match(routines, /"Rest of this week"/);
  assert.match(routines, /"Next week"/);
  assert.match(app, /setCalendarGenerationNotice\(message\); go\("calendar"\)/);
  assert.match(routines, /events were.*already present/);
});

test("React routines expose a creation dialog from the page heading", () => {
  assert.match(routines, />Add routine<\/button>/);
  assert.match(routines, /<CalendarRoutineEditor onClose=/);
  assert.match(editableItems, /creating \? "\/api\/calendar-routines"/);
  assert.match(editableItems, /method: creating \? "POST" : "PATCH"/);
});
