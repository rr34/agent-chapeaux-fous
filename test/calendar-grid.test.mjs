import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  calendarEventCellItem,
  scheduledTodoCellItem,
  sixWeekMonthDates,
} from "../public/calendar-grid.js";

test("routine calendar always provides six Monday-first weeks around the current month", () => {
  const dates = sixWeekMonthDates(new Date(2026, 7, 15));
  assert.equal(dates.length, 42);
  assert.equal(dates[0].getDay(), 1);
  assert.equal(dates[0].getFullYear(), 2026);
  assert.equal(dates[0].getMonth(), 6);
  assert.equal(dates[0].getDate(), 27);
  assert.equal(dates.at(-1).getMonth(), 8);
  assert.equal(dates.at(-1).getDate(), 6);
});

test("compact calendar events show only their titles and mark only all-day events", () => {
  assert.deepEqual(calendarEventCellItem({
    title: "Timed planning session",
    isAllDay: false,
    status: "confirmed",
  }), {
    className: "day-event confirmed",
    text: "Timed planning session",
  });
  assert.deepEqual(calendarEventCellItem({
    title: "Company holiday",
    isAllDay: true,
    status: "confirmed",
  }), {
    className: "day-event all-day confirmed",
    text: "Company holiday",
  });
});

test("compact scheduled tasks omit time and all-day labels", () => {
  assert.deepEqual(scheduledTodoCellItem({ text: "Review proposal", isAllDay: false }), {
    className: "day-todo",
    text: "Review proposal",
  });
  assert.deepEqual(scheduledTodoCellItem({ text: "File receipts", isAllDay: true }), {
    className: "day-todo",
    text: "File receipts",
  });
});

test("calendar days are top-aligned at 2:3 and reserve the green bar for all-day events", () => {
  const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const eventRule = styles.match(/\.day-event \{([^}]*)\}/)?.[1] ?? "";
  const calendarDayRule = styles.match(/#calendar-grid \.calendar-day \{([^}]*)\}/)?.[1] ?? "";
  assert.match(calendarDayRule, /display: flex;/);
  assert.match(calendarDayRule, /align-items: stretch;/);
  assert.match(calendarDayRule, /justify-content: flex-start;/);
  assert.match(calendarDayRule, /flex-direction: column;/);
  assert.match(calendarDayRule, /aspect-ratio: 2 \/ 3;/);
  assert.doesNotMatch(eventRule, /border-left/);
  assert.match(styles, /\.day-event\.all-day \{ border-left: 3px solid var\(--accent\); \}/);
});
