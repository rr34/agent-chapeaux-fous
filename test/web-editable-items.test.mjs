import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const dailyPaper = fs.readFileSync(new URL("../web/src/components/DailyPaper.tsx", import.meta.url), "utf8");
const items = fs.readFileSync(new URL("../web/src/components/EditableItems.tsx", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
const dailyPaperService = fs.readFileSync(new URL("../src/daily-paper.mjs", import.meta.url), "utf8");

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
