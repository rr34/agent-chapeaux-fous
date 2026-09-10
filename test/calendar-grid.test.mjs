import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { formatDisplayDate, formatDisplayTime } from "../public/presentation-format.js";
import {
  calendarDayTimeRangeLabel,
  calendarEventCellItem,
  calendarGridCellContents,
  occursDuringCalendarDay,
  scheduledTodoCellItem,
  sixWeekMonthDates,
  routinePatternSection,
  weeklyRoutinePattern,
} from "../public/calendar-grid.js";

test("routine sections follow frequency, including monthly rules expressed as weekdays", () => {
  for (const rule of ["FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,WE", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU"]) {
    assert.equal(routinePatternSection(rule), "weekly");
  }
  for (const rule of ["FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1", "FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=15", "FREQ=YEARLY;BYMONTH=9"]) {
    assert.equal(routinePatternSection(rule), "monthly");
  }
});

test("weekday patterns collapse repeated weeks while retaining daily, Sunday, overnight, and multiple-time slots", () => {
  const dates = sixWeekMonthDates(new Date(2026, 8, 10));
  const occurrence = (id, scheduledAtUtc, recurrenceRule, durationMinutes = 60) => ({
    routineId: id, scheduledAtUtc, recurrenceRule, durationMinutes, text: `Routine ${id}`, isAllDay: false,
  });
  const occurrences = dates.map(date => occurrence(1, new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9).toISOString(), "FREQ=DAILY"));
  occurrences.push(
    occurrence(2, "2026-09-06T14:00:00", "FREQ=WEEKLY;BYDAY=SU"),
    occurrence(2, "2026-09-13T14:00:00", "FREQ=WEEKLY;BYDAY=SU"),
    occurrence(3, "2026-09-07T23:00:00", "FREQ=WEEKLY;BYDAY=MO", 120),
    occurrence(4, "2026-09-04T12:00:00", "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=1"),
    occurrence(5, "2026-09-07T08:00:00", "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8,18"),
    occurrence(5, "2026-09-07T18:00:00", "FREQ=WEEKLY;BYDAY=MO;BYHOUR=8,18"),
  );
  const pattern = weeklyRoutinePattern(occurrences, dates);
  assert.equal(pattern.length, 7);
  for (const day of pattern) {
    assert.equal(day.filter(({ routineId }) => routineId === 1).length, 1);
    assert.equal(day.some(({ routineId }) => routineId === 4), false);
  }
  assert.equal(pattern[6].filter(({ routineId }) => routineId === 2).length, 1);
  assert.equal(pattern[0].filter(({ routineId }) => routineId === 5).length, 2);
  const continuation = pattern[1].find(({ routineId }) => routineId === 3);
  assert.equal(continuation.patternDay.getDay(), 2);
  assert.equal(calendarDayTimeRangeLabel(continuation.scheduledAtUtc, "2026-09-08T01:00:00", continuation.patternDay, localTime), "–01:00");
});

test("Routine renders separate patterns and edits or creates definitions in the selected section", async () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const dateSource = app.slice(app.indexOf("function localDateKey("), app.indexOf("\nfunction occursOnDay("));
  const routineSource = app.slice(app.indexOf("function routineCalendarDates("), app.indexOf("\nasync function publishRoutineRange("));
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [2026, 8, 10, 12])); } }
  const grids = [];
  const makeNode = (_tag, _className, textContent) => ({
    textContent, children: [], listeners: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  });
  const elements = Object.fromEntries([
    "routineWeekGrid", "routineGrid", "routineWeekAgenda", "routineMonthAgenda", "routineMonthHeading", "routineMonthDescription",
    "routineWeekAgendaDate", "routineWeekAgendaCount", "routineWeekAgendaList", "routineAgendaDate", "routineAgendaCount", "routineAgendaList",
    "todoRepeatEnabled", "todoRepeatFrequency", "todoRepeatPattern", "todoRepeatMonthDay",
  ].map(name => [name, makeNode()]));
  const occurrences = [
    { routineId: 1, text: "Bathe Ruby", scheduledAtUtc: "2026-09-06T14:00:00", recurrenceRule: "FREQ=WEEKLY;BYDAY=SU" },
    { routineId: 1, text: "Bathe Ruby", scheduledAtUtc: "2026-09-13T14:00:00", recurrenceRule: "FREQ=WEEKLY;BYDAY=SU" },
    { routineId: 2, text: "Monthly review", scheduledAtUtc: "2026-09-15T14:00:00", recurrenceRule: "FREQ=MONTHLY;BYMONTHDAY=15" },
  ];
  elements.todoRepeatWeekdays = { querySelectorAll: () => [] };
  let edited;
  let timing;
  const context = vm.createContext({
    Date: ClockDate, elements, sixWeekMonthDates, weeklyRoutinePattern, routinePatternSection,
    occursDuringCalendarDay, calendarDayTimeRangeLabel, scheduledTodoCellItem, formatDisplayDate, formatDisplayTime,
    node: makeNode, renderCalendarGrid: options => grids.push(options),
    describeTodoRecurrence: rule => rule, agentReferenceButton: () => makeNode(),
    openTodoEditor: (routine, _group, options) => { edited = { routine, options }; },
    todoTimingEditor: { load: value => { timing = value; }, values: () => timing },
    repeatAnchorWeekday: () => "SU", updateTodoRecurrenceEditor() {}, updateTodoClearScheduledVisibility() {},
    occurrences,
  });
  vm.runInContext(`${dateSource}\n${routineSource}
    let selectedRoutineDate = new Date(), selectedRoutineWeekDate = new Date(), selectedRoutineMonthDate = new Date();
    let selectedRoutineSection = "weekly";
    let todoGroups = [], todoRecurrenceDirty = false;
    let routineOccurrences = occurrences;
    let routineDefinitions = [{ id: 1, text: "Bathe Ruby", recurrenceRule: occurrences[0].recurrenceRule },
      { id: 2, text: "Monthly review", recurrenceRule: occurrences[2].recurrenceRule }];
    let routineWeekPattern = weeklyRoutinePattern(occurrences, routineCalendarDates());
    renderRoutine();`, context);
  const [week, month] = grids;
  assert.equal(week.container, elements.routineWeekGrid);
  assert.equal(week.dates.length, 7);
  assert.equal(week.dates[0].getDay(), 1);
  assert.equal(week.dates[6].getDay(), 0);
  assert.match(week.dayLabelForDate(week.dates[0]), /Mon/);
  assert.equal(week.todayKey, null);
  assert.equal(month.dates.length, 42);
  assert.deepEqual(Array.from(week.itemsForDate(week.dates[6]), item => item.text), ["Bathe Ruby"]);
  assert.equal(month.itemsForDate(new ClockDate(2026, 8, 6)).length, 0);
  assert.deepEqual(Array.from(month.itemsForDate(new ClockDate(2026, 8, 15)), item => item.text), ["Monthly review"]);
  week.onSelect(week.dates[6]);
  assert.equal(elements.routineWeekAgenda.open, true);
  elements.routineWeekAgendaList.children[0].children[0].listeners.click();
  assert.equal(edited.routine.id, 1);
  assert.equal(edited.options.routine, true);
  await context.openNewRoutine();
  assert.equal(elements.todoRepeatFrequency.value, "WEEKLY");
  assert.equal(timing.start.getDay(), 0);
  month.onSelect(new ClockDate(2026, 8, 15));
  assert.equal(elements.routineMonthAgenda.open, true);
  elements.routineAgendaList.children[0].children[0].listeners.click();
  assert.equal(edited.routine.id, 2);
  assert.equal(edited.options.routine, true);
  await context.openNewRoutine();
  assert.equal(elements.todoRepeatFrequency.value, "MONTHLY");
  assert.equal(elements.todoRepeatPattern.value, "month-day");
  assert.equal(elements.todoRepeatMonthDay.value, "15");
});

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

test("both calendar grids share top-aligned 2:3 days and reserve the green bar for all-day events", () => {
  const styles = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const eventRule = styles.match(/\.day-event \{([^}]*)\}/)?.[1] ?? "";
  const calendarDayRule = styles.match(/\.calendar-grid \.calendar-day \{([^}]*)\}/)?.[1] ?? "";
  assert.match(calendarDayRule, /display: flex;/);
  assert.match(calendarDayRule, /align-items: stretch;/);
  assert.match(calendarDayRule, /justify-content: flex-start;/);
  assert.match(calendarDayRule, /flex-direction: column;/);
  assert.match(calendarDayRule, /aspect-ratio: 2 \/ 3;/);
  assert.doesNotMatch(eventRule, /border-left/);
  assert.match(styles, /\.day-event\.all-day \{ border-left: 3px solid var\(--accent\); \}/);
});
