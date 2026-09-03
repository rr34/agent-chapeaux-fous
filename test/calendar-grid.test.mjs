import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  calendarDayTimeRangeLabel,
  calendarEventCellItem,
  calendarGridCellContents,
  occursDuringCalendarDay,
  scheduledTodoCellItem,
  sixWeekMonthDates,
} from "../public/calendar-grid.js";

const localTime = (value) => {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

test("cross-day time labels show only the boundary that applies to each day", () => {
  const startsAt = "2026-09-04T17:00:00";
  const endsAt = "2026-09-05T14:00:00";
  assert.equal(occursDuringCalendarDay(startsAt, endsAt, new Date(2026, 8, 4)), true);
  assert.equal(occursDuringCalendarDay(startsAt, endsAt, new Date(2026, 8, 5)), true);
  assert.equal(calendarDayTimeRangeLabel(
    startsAt, endsAt, new Date(2026, 8, 4), localTime,
  ), "17:00–");
  assert.equal(calendarDayTimeRangeLabel(
    startsAt, endsAt, new Date(2026, 8, 5), localTime,
  ), "–14:00");
  assert.equal(calendarDayTimeRangeLabel(
    startsAt, endsAt, new Date(2026, 8, 6), localTime,
  ), "");
});

test("same-day and middle-day time labels remain unambiguous", () => {
  assert.equal(calendarDayTimeRangeLabel(
    "2026-09-04T09:00:00", "2026-09-04T11:00:00", new Date(2026, 8, 4), localTime,
  ), "09:00–11:00");
  assert.equal(calendarDayTimeRangeLabel(
    "2026-09-03T17:00:00", "2026-09-05T14:00:00", new Date(2026, 8, 4), localTime,
  ), "Continues");
  assert.equal(calendarDayTimeRangeLabel(
    "2026-09-04T17:00:00", "2026-09-05T00:00:00", new Date(2026, 8, 4), localTime,
  ), "17:00–");
});

test("tall calendar cells use all eight rows before summarizing overflow", () => {
  const items = Array.from({ length: 8 }, (_, index) => ({ text: `Item ${index + 1}` }));
  assert.deepEqual(calendarGridCellContents(items), { items, hiddenCount: 0 });

  const overflowing = [...items, { text: "Item 9" }, { text: "Item 10" }];
  const contents = calendarGridCellContents(overflowing);
  assert.deepEqual(contents.items, overflowing.slice(0, 7));
  assert.equal(contents.hiddenCount, 3);
});

test("calendar-day overlap includes a cross-midnight item on every day it occupies", () => {
  const startsAt = "2026-08-31T17:00:00";
  const endsAt = "2026-09-01T20:00:00";
  assert.equal(occursDuringCalendarDay(startsAt, endsAt, new Date(2026, 7, 31)), true);
  assert.equal(occursDuringCalendarDay(startsAt, endsAt, new Date(2026, 8, 1)), true);
  assert.equal(occursDuringCalendarDay(startsAt, endsAt, new Date(2026, 8, 2)), false);
});

test("an item ending at midnight does not occupy the following day", () => {
  assert.equal(occursDuringCalendarDay(
    "2026-08-31T17:00:00",
    "2026-09-01T00:00:00",
    new Date(2026, 8, 1),
  ), false);
});

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
  assert.deepEqual(scheduledTodoCellItem({
    text: "Finish MariaDB cleanup",
    routineText: "Regular Work Window",
    routinePublicationMode: "calendar",
  }), {
    className: "day-todo",
    text: "Regular Work Window — Finish MariaDB cleanup",
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
