import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const calendarSource = fs.readFileSync(
  new URL("../web/src/components/DailyPaper.tsx", import.meta.url),
  "utf8",
);
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");
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
  assert.match(calendarSource, /const visibleEvents = compact \? day\.events : day\.events\.slice\(0, eventLimit\)/);
  assert.match(calendarSource, /!compact && day\.events\.length > eventLimit/);
});

test("printable calendar shows every event with hanging-indented wrapped titles", () => {
  assert.match(calendarSource, /\{visibleEvents\.map\(\(event\) => \(/);
  assert.doesNotMatch(calendarSource, /compact \? 3/);
  assert.match(styles, /\.calendar-chip \{[^}]*align-items: flex-start;/s);
  assert.match(styles, /\.calendar-chip time \+ span \{[^}]*flex: 1 1 auto;/s);
});

test("daily paper appends handwriting worksheets with database primary keys", () => {
  assert.match(calendarSource, /const TODOS_PER_WORKSHEET = 5/);
  assert.match(calendarSource, /data-todo-id=\{todo\.todoId\}/);
  assert.match(calendarSource, /className="paper-todo-id">#\{todo\.todoId\}/);
  assert.match(calendarSource, /Write beside any item\./);
  assert.match(calendarSource, /className="paper-handwriting-space"/);
  assert.match(calendarSource, /<PaperCornerMarkers \/>/);
  assert.match(styles, /\.paper-handwriting-todos > li \{[^}]*border: 1\.5px solid/s);
  assert.match(calendarSource, /Handwriting sheets follow\./);
  assert.match(styles, /\.paper-corner-marker--bottom-right \{[^}]*border-radius: 50%/s);
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
