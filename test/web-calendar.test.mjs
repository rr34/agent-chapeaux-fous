import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const calendarSource = fs.readFileSync(
  new URL("../web/src/components/DailyPaper.tsx", import.meta.url),
  "utf8",
);
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
const trackerScheduleSource = fs.readFileSync(new URL("../web/src/components/TrackerSchedule.tsx", import.meta.url), "utf8");
const serverSource = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
const organizerSource = fs.readFileSync(new URL("../src/organizer-store.mjs", import.meta.url), "utf8");
const dateFormatSource = fs.readFileSync(new URL("../web/src/date-format.ts", import.meta.url), "utf8");

test("calendar days select the detailed timeline and linked to-dos", () => {
  assert.match(calendarSource, /onSelect\?: \(localDate: string\) => void/);
  assert.match(calendarSource, /onClick=\{\(\) => onSelect\(day\.localDate\)\}/);
  assert.match(calendarSource, /aria-pressed=\{isSelected\}/);
  assert.match(appSource, /events=\{selectedEvents\}/);
  assert.match(appSource, /todos=\{selectedTodos\}/);
});

test("calendar week arrows move only the displayed range and Today restores today", () => {
  assert.match(appSource, /rangeDate: displayDate/);
  assert.match(appSource, /aria-label="Previous week".*setDisplayDate.*shiftLocalDate\(current, -7\)/);
  assert.match(appSource, /aria-label="Next week".*setDisplayDate.*shiftLocalDate\(current, 7\)/);
  assert.doesNotMatch(appSource, /aria-label="Previous week".*setSelectedDate/);
  assert.doesNotMatch(appSource, /aria-label="Next week".*setSelectedDate/);
  assert.match(appSource, />Today<\/button>/);
  assert.match(appSource, /setSelectedDate\(date\); setDisplayDate\(date\);/);
  assert.doesNotMatch(appSource, /setSelectedDate\(data\.date\)/);
  assert.match(appSource, /<CalendarGrid id="calendar-grid"/);
  assert.match(calendarSource, /<section id=\{id\} className=\{\`two-week-grid/);
  assert.match(styles, /\.calendar-range-arrow \{[^}]*width: 100%/s);
});

test("calendar marks the first displayed day with its month and ISO week", () => {
  assert.match(calendarSource, /calendarRangeMarkerLabel\(days\[0\]\.localDate\)/);
  assert.match(calendarSource, /calendar-range-marker/);
  assert.match(calendarSource, /\`\$\{monthLabel\} \(week \$\{week\}\)\`/);
  assert.match(styles, /\.calendar-range-marker \{[^}]*writing-mode: vertical-rl;[^}]*transform: rotate\(180deg\);/s);
});

test("calendar uses its day selection instead of separate date and paper controls", () => {
  assert.doesNotMatch(appSource, /className="compact-field"/);
  assert.match(appSource, /date: selectedDate, rangeDate: displayDate, timeZone, paperSize: "letter"/);
  assert.match(appSource, /disabled=\{generating \|\| !data\}/);
});

test("print preview follows the selected calendar day immediately", () => {
  assert.match(appSource, /const previewModel = useMemo<DailyPaperModel \| null>/);
  assert.match(appSource, /date: selectedDate/);
  assert.match(appSource, /heading: formatLocalDate\(selectedDate\)/);
  assert.match(appSource, /todayEvents: selectedEvents/);
  assert.match(appSource, /scheduledTodos: selectedTodos/);
  assert.match(appSource, /<DailyPaper model=\{previewModel\} preview \/>/);
});

test("screen and printable calendar days share a two-by-three aspect ratio", () => {
  assert.match(styles, /\.calendar-cell \{[^}]*aspect-ratio: 2 \/ 3;/);
  assert.match(styles, /\.calendar-cell \{[^}]*justify-content: flex-start;[^}]*align-items: stretch;/);
  assert.match(styles, /\.two-week-grid--compact \.calendar-cell \{[^}]*aspect-ratio: 2 \/ 3;/);
  assert.match(calendarSource, /const visibleEvents = compact \? orderedEvents : orderedEvents\.slice\(0, eventLimit\)/);
  assert.match(calendarSource, /!compact && day\.events\.length > eventLimit/);
});

test("printable calendar shows every event with hanging-indented wrapped titles", () => {
  assert.match(calendarSource, /\{visibleEvents\.map\(\(event\) => \(/);
  assert.doesNotMatch(calendarSource, /compact \? 3/);
  assert.match(styles, /\.calendar-chip \{[^}]*align-items: flex-start;/s);
  assert.match(styles, /\.calendar-chip time \+ span \{[^}]*flex: 1 1 auto;/s);
});

test("daily paper keeps identified to-dos under their single heading in the larger right column", () => {
  const paperLayout = calendarSource.slice(calendarSource.indexOf("export function DailyPaper"));
  assert.doesNotMatch(calendarSource, /TodoWorksheet|Handwriting sheets follow|TODOS_PER_WORKSHEET/);
  assert.match(calendarSource, /className="paper-day-left"/);
  assert.ok(paperLayout.indexOf("Today’s timeline") < paperLayout.indexOf("Trackers"));
  assert.match(calendarSource, /<PrintableTodos todos=\{model\.scheduledTodos\} \/>/);
  assert.match(calendarSource, /return `personal_task_id:\$\{todo\.todoId\}`/);
  assert.match(calendarSource, /data-object-reference=\{todoPrintIdentifier\(todo\)\}/);
  assert.match(calendarSource, /className="paper-todo-id">\{todoPrintIdentifier\(todo\)\}/);
  assert.match(calendarSource, /Blank writing area for \$\{todoPrintIdentifier\(todo\)\}/);
  assert.match(calendarSource, /className="paper-handwriting-space"/);
  assert.match(styles, /\.paper-day-columns \{[^}]*grid-template-columns: minmax\(0, \.9fr\) minmax\(0, 1\.4fr\)/s);
  assert.match(styles, /\.paper-todo-cards > li \{[^}]*border: 1px solid/s);
});

test("journal trackers expose basic daily, weekly, and monthly RRULE controls", () => {
  assert.match(appSource, /<TrackerSchedule tracker=\{tracker\} onChanged=\{reload\}/);
  assert.match(trackerScheduleSource, /<option value="off">Not scheduled<\/option>/);
  assert.match(trackerScheduleSource, /<option value="daily">Daily<\/option>/);
  assert.match(trackerScheduleSource, /<option value="weekly">Weekly<\/option>/);
  assert.match(trackerScheduleSource, /<option value="monthly">Monthly<\/option>/);
  assert.match(trackerScheduleSource, /method: "PATCH"/);
  assert.match(trackerScheduleSource, /weekdays: frequency === "weekly"/);
  assert.match(serverSource, /journal-trackers\\\/\(\\d\+\)\\\/schedule/);
  assert.match(serverSource, /catchUp\.setTrackerSchedule/);
  assert.match(organizerSource, /askingRecurrenceRule: row\.asking_recurrence_rule/);
  assert.match(styles, /\.tracker-schedule \{/);
});

test("daily paper renders RRULE-driven tracker status", () => {
  assert.match(calendarSource, /<h2>Trackers<\/h2>/);
  assert.match(calendarSource, /<ScheduledTrackers trackers=\{model\.scheduledTrackers\}/);
  assert.match(calendarSource, /tracker\.logged \? "✓" : ""/);
  assert.match(calendarSource, /trackerCadenceLabel\(tracker\)/);
  assert.match(styles, /\.paper-trackers \{/);
});

test("React calendar and printed paper use the day-first date contract", () => {
  assert.match(dateFormatSource, /weekday.*day.*month.*year/s);
  assert.match(dateFormatSource, /hourCycle: "h23"/);
  assert.match(calendarSource, /Printed \{formatDisplayDate\(model\.generatedAtUtc/);
  assert.match(calendarSource, /For \{formatLocalDate\(model\.date\)\}/);
  assert.match(calendarSource, /<strong>\{day\.dayNumber\}<\/strong>/);
  assert.doesNotMatch(dateFormatSource, /padStart\(2/);
  assert.doesNotMatch(calendarSource, /dateStyle: "medium"/);
});
