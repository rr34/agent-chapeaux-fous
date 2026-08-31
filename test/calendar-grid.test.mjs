import assert from "node:assert/strict";
import test from "node:test";
import { sixWeekMonthDates } from "../public/calendar-grid.js";

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
