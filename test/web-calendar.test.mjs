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

test("calendar week arrows move the selected weekday and loaded range by seven days", () => {
  assert.match(appSource, /aria-label="Previous week".*shiftLocalDate\(current, -7\)/);
  assert.match(appSource, /aria-label="Next week".*shiftLocalDate\(current, 7\)/);
  assert.match(appSource, /new URLSearchParams\(\{ date: selectedDate/);
  assert.doesNotMatch(appSource, /setSelectedDate\(data\.date\)/);
  assert.match(appSource, /<CalendarGrid id="calendar-grid"/);
  assert.match(calendarSource, /<section id=\{id\} className=\{\`two-week-grid/);
  assert.match(styles, /\.calendar-range-arrow \{[^}]*width: 100%/s);
});

test("calendar uses its day selection instead of separate date and paper controls", () => {
  assert.doesNotMatch(appSource, /className="compact-field"/);
  assert.match(appSource, /date: selectedDate, timeZone, paperSize: "letter"/);
  assert.match(appSource, /disabled=\{generating \|\| !selectedDay\}/);
});

test("screen and printable calendar days share a two-by-three aspect ratio", () => {
  assert.match(styles, /\.calendar-cell \{[^}]*aspect-ratio: 2 \/ 3;/);
  assert.match(styles, /\.calendar-cell \{[^}]*justify-content: flex-start;[^}]*align-items: stretch;/);
  assert.match(styles, /\.two-week-grid--compact \.calendar-cell \{[^}]*aspect-ratio: 2 \/ 3;/);
  assert.match(calendarSource, /const eventLimit = compact \? 3 : 8/);
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
