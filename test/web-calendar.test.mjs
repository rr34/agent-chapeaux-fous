import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const appSource = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const calendarSource = fs.readFileSync(
  new URL("../web/src/components/DailyPaper.tsx", import.meta.url),
  "utf8",
);
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("calendar days select the detailed timeline and linked to-dos", () => {
  assert.match(calendarSource, /onSelect\?: \(localDate: string\) => void/);
  assert.match(calendarSource, /onClick=\{\(\) => onSelect\(day\.localDate\)\}/);
  assert.match(calendarSource, /aria-pressed=\{isSelected\}/);
  assert.match(appSource, /events=\{selectedEvents\}/);
  assert.match(appSource, /todos=\{selectedTodos\}/);
});

test("screen calendar days use a two-by-three aspect ratio without enlarging the PDF grid", () => {
  assert.match(styles, /\.calendar-cell \{[^}]*aspect-ratio: 2 \/ 3;/);
  assert.match(styles, /\.two-week-grid--compact \.calendar-cell \{[^}]*aspect-ratio: auto;/);
  assert.match(calendarSource, /const eventLimit = compact \? 3 : 8/);
});
