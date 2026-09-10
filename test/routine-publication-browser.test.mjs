import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { formatDisplayDate } from "../public/presentation-format.js";
import { scheduledTodoCellItem } from "../public/calendar-grid.js";

process.env.TZ = "America/New_York";
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const dates = app.slice(app.indexOf("function addDays("), app.indexOf("\nfunction occursOnDay("));
const publish = app.slice(app.indexOf("async function publishRoutineRange("), app.indexOf("\nfunction setCalendarSearchMode("));
const refresh = app.slice(app.indexOf("async function refreshCalendar("), app.indexOf("\nfunction routineCalendarDates("));

function element() {
  return { hidden: true, children: [], value: "old search", textContent: "",
    replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } };
}

function browser(api) {
  const elements = Object.fromEntries([
    "routinePublishStatus", "calendarPublication", "calendarPublicationStatus",
    "publishRoutineThisWeek", "publishRoutineNextWeek", "calendarSearch", "calendarGrid",
  ].map(name => [name, element()]));
  const context = vm.createContext({
    Date, elements, api, formatDisplayDate,
    node: (tag, className, text) => ({ tag, className, text }),
    switchView(view) { context.view = view; },
    setCalendarSearchMode(enabled) { context.searchMode = enabled; },
    updateCalendarSchedulingMode() {}, renderCalendar() {}, searchCalendarEvents() {},
  });
  vm.runInContext(`let calendarRangeStart, selectedCalendarDate, calendarEvents, activeTodos, todoGroups, todoGuides;
    let calendarSchedulingTodo = null; let publishedCalendarTodoIds = new Set();\n${dates}\n${publish}\n${refresh}`, context);
  return context;
}

test("publication opens the actual calendar week and highlights exactly the 12 newly saved items", async () => {
  const todos = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1, text: index === 11 ? "Bathe Ruby" : `Routine ${index + 1}`,
    scheduledAtUtc: `2026-09-${14 + (index % 7)}T13:00:00.000Z`, isAllDay: false,
  }));
  const context = browser(async (url, options) => {
    assert.equal(url, "/api/routines/publish");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), {
      from: "2026-09-14T04:00:00.000Z", to: "2026-09-21T04:00:00.000Z",
    });
    return { createdCount: 12, existingCount: 2, todos };
  });
  await context.publishRoutineRange(new Date(2026, 8, 14), new Date(2026, 8, 21));
  assert.match(context.elements.routinePublishStatus.textContent, /Created 12 scheduled to-dos/);
  assert.match(context.elements.routinePublishStatus.textContent, /2 items were already published/);
  assert.equal(vm.runInContext("publishedCalendarTodoIds.size", context), 12);
  assert.equal(vm.runInContext("publishedCalendarTodoIds.has(12)", context), true);
  assert.equal(vm.runInContext("publishedCalendarTodoIds.has(13)", context), false);
  assert.equal(context.elements.calendarPublication.hidden, false);
  assert.match(context.elements.calendarPublicationStatus.textContent, /Newly added items are highlighted/);
  assert.equal(scheduledTodoCellItem(todos[11], { highlighted: true }).className, "day-todo routine-published");
  assert.equal(scheduledTodoCellItem(todos[11]).className, "day-todo");
  assert.equal(context.view, "calendar");
  assert.equal(context.searchMode, false);
  assert.equal(context.elements.calendarSearch.value, "");
  assert.equal(vm.runInContext("calendarRangeStart.toISOString()", context), "2026-09-14T04:00:00.000Z");
  assert.equal(vm.runInContext("selectedCalendarDate.getDay()", context), 1);
});

test("a repeat publication clears old highlights and a failed publication stays on the routine screen", async () => {
  let result = { createdCount: 1, existingCount: 0, todos: [
    { id: 1, text: "Bathe Ruby", scheduledAtUtc: "2026-09-20T13:00:00.000Z", isAllDay: false },
  ] };
  const context = browser(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const run = () => context.publishRoutineRange(new Date(2026, 8, 14), new Date(2026, 8, 21));
  await run();
  result = { createdCount: 0, existingCount: 1, todos: [] };
  await run();
  assert.equal(vm.runInContext("publishedCalendarTodoIds.size", context), 0);
  assert.doesNotMatch(context.elements.calendarPublicationStatus.textContent, /Newly added items are highlighted/);
  assert.match(context.elements.routinePublishStatus.textContent, /Created 0.*1 item was already published/);
  result = new Error("Server unreachable");
  context.view = "routine";
  await run();
  assert.equal(context.view, "routine");
  assert.equal(context.elements.routinePublishStatus.textContent, "Server unreachable");
  assert.equal(context.elements.publishRoutineNextWeek.disabled, false);
});

test("calendar reads only its displayed range and preserves an unscheduled task being placed", async () => {
  let taskRequest;
  const context = browser(async url => {
    if (url.startsWith("/api/todos?")) taskRequest = new URL(url, "https://example.test");
    return { todos: [], events: [], groups: [], guides: [] };
  });
  context.elements.calendarSearch.value = "";
  vm.runInContext("calendarRangeStart = new Date(2026, 8, 14); calendarSchedulingTodo = { id: 123, scheduledAtUtc: null };", context);
  await context.refreshCalendar();
  assert.equal(taskRequest.searchParams.get("from"), "2026-09-14T04:00:00.000Z");
  assert.equal(taskRequest.searchParams.get("to"), "2026-09-28T04:00:00.000Z");
  assert.equal(vm.runInContext("calendarSchedulingTodo.id", context), 123);
});

test("next-week button keeps Monday boundaries on Sundays and across daylight-saving changes", () => {
  const handler = app.slice(app.indexOf('elements.publishRoutineNextWeek.addEventListener("click"'), app.indexOf('\nelements.newTodoGroup.addEventListener('));
  for (const [today, from, to] of [
    ["2026-09-13T12:00:00-04:00", "2026-09-14T04:00:00.000Z", "2026-09-21T04:00:00.000Z"],
    ["2026-10-25T12:00:00-04:00", "2026-10-26T04:00:00.000Z", "2026-11-02T05:00:00.000Z"],
    ["2026-03-01T12:00:00-05:00", "2026-03-02T05:00:00.000Z", "2026-03-09T04:00:00.000Z"],
  ]) {
    class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [today])); } }
    let range;
    vm.runInNewContext(`${dates}\n${handler}`, {
      Date: ClockDate,
      elements: { publishRoutineNextWeek: { addEventListener: (_event, callback) => callback() } },
      publishRoutineRange: (start, end) => { range = [start.toISOString(), end.toISOString()]; },
    });
    assert.deepEqual(range, [from, to]);
  }
});
