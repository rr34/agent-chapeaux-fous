import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  calendarDayTimeRangeLabel,
  calendarEventCellItem,
  calendarGridCellContents,
  occursDuringCalendarDay,
  routinePatternSection,
  sixWeekMonthDates,
  weeklyRoutinePattern,
} from "../public/calendar-grid.js";

const localTime = (value) => {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

test("routine sections follow their calendar recurrence frequency", () => {
  for (const rule of ["FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,WE", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU"]) {
    assert.equal(routinePatternSection(rule), "weekly");
  }
  for (const rule of ["FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1", "FREQ=YEARLY;BYMONTH=9"]) {
    assert.equal(routinePatternSection(rule), "monthly");
  }
});

test("calendar-routine previews collapse repeated weeks without becoming to-dos", () => {
  const dates = sixWeekMonthDates(new Date(2026, 8, 10));
  const occurrence = (routineId, startsAtUtc, recurrenceRule, endsAtUtc = null) => ({
    routineId, startsAtUtc, endsAtUtc, recurrenceRule, title: `Routine ${routineId}`, isAllDay: false,
  });
  const occurrences = dates.map((date) => occurrence(
    1,
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9).toISOString(),
    "FREQ=DAILY",
  ));
  occurrences.push(
    occurrence(2, "2026-09-06T14:00:00", "FREQ=WEEKLY;BYDAY=SU"),
    occurrence(2, "2026-09-13T14:00:00", "FREQ=WEEKLY;BYDAY=SU"),
    occurrence(3, "2026-09-07T23:00:00", "FREQ=WEEKLY;BYDAY=MO", "2026-09-08T01:00:00"),
    occurrence(4, "2026-09-04T12:00:00", "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1"),
  );
  const pattern = weeklyRoutinePattern(occurrences, dates);
  assert.equal(pattern.length, 7);
  for (const day of pattern) {
    assert.equal(day.filter(({ routineId }) => routineId === 1).length, 1);
    assert.equal(day.some(({ routineId }) => routineId === 4), false);
  }
  assert.equal(pattern[6].filter(({ routineId }) => routineId === 2).length, 1);
  const continuation = pattern[1].find(({ routineId }) => routineId === 3);
  assert.equal(calendarDayTimeRangeLabel(
    continuation.startsAtUtc, continuation.endsAtUtc, continuation.patternDay, localTime,
  ), "–01:00");
});

test("calendar-day overlap and labels handle cross-midnight events", () => {
  const startsAt = "2026-09-04T17:00:00";
  const endsAt = "2026-09-05T14:00:00";
  assert.equal(occursDuringCalendarDay(startsAt, endsAt, new Date(2026, 8, 4)), true);
  assert.equal(occursDuringCalendarDay(startsAt, endsAt, new Date(2026, 8, 5)), true);
  assert.equal(occursDuringCalendarDay(startsAt, endsAt, new Date(2026, 8, 6)), false);
  assert.equal(calendarDayTimeRangeLabel(startsAt, endsAt, new Date(2026, 8, 4), localTime), "17:00–");
  assert.equal(calendarDayTimeRangeLabel(startsAt, endsAt, new Date(2026, 8, 5), localTime), "–14:00");
  assert.equal(occursDuringCalendarDay(
    "2026-08-31T17:00:00", "2026-09-01T00:00:00", new Date(2026, 8, 1),
  ), false);
});

test("routine calendar always provides six Monday-first weeks", () => {
  const dates = sixWeekMonthDates(new Date(2026, 7, 15));
  assert.equal(dates.length, 42);
  assert.equal(dates[0].getDay(), 1);
  assert.equal(dates[0].toISOString().slice(0, 10), "2026-07-27");
  assert.equal(dates.at(-1).toISOString().slice(0, 10), "2026-09-06");
});

test("compact calendar events can identify newly generated routine events", () => {
  assert.deepEqual(calendarEventCellItem({
    title: "Timed planning session", isAllDay: false, status: "confirmed",
  }), { className: "day-event confirmed", text: "Timed planning session" });
  assert.deepEqual(calendarEventCellItem({
    title: "Company holiday", isAllDay: true, status: "confirmed",
  }, { highlighted: true }), {
    className: "day-event all-day confirmed routine-published",
    text: "Company holiday",
    title: "Newly generated from a calendar routine",
  });
});

test("calendar cells reserve their final row for overflow", () => {
  const items = Array.from({ length: 10 }, (_, index) => ({ text: `Item ${index + 1}` }));
  const contents = calendarGridCellContents(items);
  assert.deepEqual(contents.items, items.slice(0, 7));
  assert.equal(contents.hiddenCount, 3);
});

test("calendar grids keep the all-day event accent", () => {
  const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const eventRule = styles.match(/\.day-event \{([^}]*)\}/)?.[1] ?? "";
  const calendarDayRule = styles.match(/\.calendar-grid \.calendar-day \{([^}]*)\}/)?.[1] ?? "";
  assert.match(calendarDayRule, /aspect-ratio: 2 \/ 3;/);
  assert.doesNotMatch(eventRule, /border-left/);
  assert.match(styles, /\.day-event\.all-day \{ border-left: 3px solid var\(--accent\); \}/);
});
