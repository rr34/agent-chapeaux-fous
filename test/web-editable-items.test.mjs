import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const dailyPaper = fs.readFileSync(new URL("../web/src/components/DailyPaper.tsx", import.meta.url), "utf8");
const items = fs.readFileSync(new URL("../web/src/components/EditableItems.tsx", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
const dailyPaperService = fs.readFileSync(new URL("../src/daily-paper.mjs", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

test("timeline events use a reusable clickable editor with fresh versioned saves", () => {
  assert.match(items, /export function CalendarEventItem/);
  assert.match(dailyPaper, /<CalendarEventItem/);
  assert.match(app, /<DayTimeline[^>]+onChanged=\{reload\}/);
  assert.match(items, /onClick=\{\(\) => setEditing\(true\)\}/);
  assert.match(items, /api<\{ event: CalendarEvent \}>\(`\/api\/calendar-events\/\$\{eventId\}`\)/);
  assert.match(items, /version: event\.version/);
  assert.match(items, /method: "PATCH"/);
  assert.match(items, /event\.seriesId \?\? event\.id/);
  assert.match(items, /Changes apply to the whole series/);
  assert.match(dailyPaperService, /event\.seriesId != null \? \{ seriesId: event\.seriesId \}/);
  assert.match(server, /request\.method === "GET" && calendarMatch/);
});

test("one reusable to-do item keeps completion separate from click-to-edit", () => {
  assert.match(items, /export function TodoItem/);
  assert.match(app, /<TodoItem todo=\{todo\}/);
  assert.match(dailyPaper, /<TodoItem/);
  assert.match(app, /<ScheduledTodos[^>]+onChanged=\{reload\}/);
  assert.match(items, /className="todo-check"[^>]+onClick=\{\(\) => void toggle\(\)\}/);
  assert.match(items, /className="todo-item-content"[^>]+onClick=\{\(\) => setEditing\(true\)\}/);
  assert.match(items, /version: current\.version/);
  assert.match(items, /status: current\.status === "complete" \? "todo" : "complete"/);
  assert.match(items, /version: todo\.version/);
  assert.match(server, /request\.method === "GET" && todoMatch/);
});


test("routine agenda items open a reusable versioned editor directly", () => {
  const routines = fs.readFileSync(new URL("../web/src/components/RoutineCalendar.tsx", import.meta.url), "utf8");
  assert.match(items, /export function CalendarRoutineItem/);
  assert.match(routines, /<CalendarRoutineItem/);
  assert.ok(routines.includes("onChanged={reload}"));
  assert.ok(items.includes('className="routine-item-content" type="button" onClick={() => setEditing(true)}'));
  assert.ok(items.includes('api<{ routine: CalendarRoutine | null }>(`/api/calendar-routines/${routineId}`)'));
  assert.ok(items.includes("version: routine.version"));
  assert.ok(items.includes("recurrenceRule: draft.recurrenceRule"));
  assert.ok(server.includes('request.method === "GET" && routineMatch'));
});


test("events, to-dos, and routines preserve authored newlines everywhere they display", () => {
  assert.ok(dailyPaper.includes('className="multiline-item-text">{event.title}</span>'));
  assert.ok(items.includes('className="multiline-item-text">{routine.title}</strong>'));
  assert.ok(items.includes('className="multiline-item-text">{routine.description}</p>'));
  assert.ok(items.includes('className="multiline-item-text">{event.title}</strong>'));
  assert.ok(items.includes('className="multiline-item-text">{event.description}</p>'));
  assert.ok(items.includes('className="multiline-item-text">{text}</strong>'));
  assert.ok(styles.includes(".multiline-item-text { white-space: pre-wrap; overflow-wrap: anywhere; }"));
  assert.ok(styles.includes(".calendar-chip span { min-width: 0; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; }"));
});
