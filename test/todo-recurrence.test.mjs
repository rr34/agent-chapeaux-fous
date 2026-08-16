import assert from "node:assert/strict";
import test from "node:test";
import { buildTodoRecurrenceRule } from "../src/todo-recurrence.mjs";

test("structured recurrence becomes an RRULE without exposing RRULE syntax", () => {
  assert.equal(buildTodoRecurrenceRule({
    frequency: "WEEKLY", interval: 2, weekdays: ["TU", "FR"], count: 8,
  }), "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR;COUNT=8");
  assert.equal(buildTodoRecurrenceRule({
    frequency: "MONTHLY", interval: 1, until_date: "2026-12-31",
  }), "FREQ=MONTHLY;INTERVAL=1;UNTIL=20261231T235959");
  assert.throws(
    () => buildTodoRecurrenceRule({ frequency: "WEEKLY", interval: 1, weekdays: [] }),
    /at least one weekday/,
  );
  assert.throws(
    () => buildTodoRecurrenceRule({
      frequency: "DAILY", interval: 1, count: 2, until_date: "2026-12-31",
    }),
    /count or date/,
  );
});
