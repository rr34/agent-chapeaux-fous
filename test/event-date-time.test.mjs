import assert from "node:assert/strict";
import test from "node:test";

import {
  combineLocalDateTime,
  durationMinutes,
  formatDurationClock,
  formatDurationMinutes,
  parseDurationClock,
  shiftLocalDateTime,
  splitLocalDateTime,
  updateEventTiming,
} from "../public/event-date-time.js";

test("event date and 24-hour time fields combine and split", () => {
  assert.equal(combineLocalDateTime("2026-08-19", "17:45"), "2026-08-19T17:45");
  assert.equal(combineLocalDateTime("2026-08-19", "5:45"), "");
  assert.equal(combineLocalDateTime("2026-08-19", "24:00"), "");
  assert.deepEqual(splitLocalDateTime(new Date(2026, 7, 19, 17, 45)), {
    date: "2026-08-19",
    time: "17:45",
  });
});

test("a suggested event end is one hour after its start, including date rollover", () => {
  assert.deepEqual(shiftLocalDateTime("2026-08-19", "17:45", 60), {
    date: "2026-08-19",
    time: "18:45",
  });
  assert.deepEqual(shiftLocalDateTime("2026-08-19", "23:30", 60), {
    date: "2026-08-20",
    time: "00:30",
  });
});

test("event durations are expressed in hours and minutes", () => {
  assert.equal(durationMinutes("2026-08-19T17:45", "2026-08-19T19:15"), 90);
  assert.equal(formatDurationMinutes(60), "1 hour");
  assert.equal(formatDurationMinutes(90), "1 hour 30 minutes");
  assert.equal(formatDurationMinutes(45), "45 minutes");
  assert.equal(parseDurationClock("01:30"), 90);
  assert.equal(parseDurationClock("125:05"), 7505);
  assert.equal(parseDurationClock("00:00"), null);
  assert.equal(parseDurationClock("1:75"), null);
  assert.equal(formatDurationClock(90), "01:30");
});

test("event timing keeps duration stable when the start changes", () => {
  assert.deepEqual(updateEventTiming({
    startsAt: "2026-08-19T09:00",
    endsAt: "2026-08-19T10:30",
    duration: "01:30",
  }, "start", "2026-08-19T11:15"), {
    startsAt: "2026-08-19T11:15",
    endsAt: "2026-08-19T12:45",
    duration: "01:30",
  });
});

test("event timing recalculates duration from the end", () => {
  assert.deepEqual(updateEventTiming({
    startsAt: "2026-08-19T09:00",
    endsAt: "2026-08-19T10:00",
    duration: "01:00",
  }, "end", "2026-08-19T11:45"), {
    startsAt: "2026-08-19T09:00",
    endsAt: "2026-08-19T11:45",
    duration: "02:45",
  });
});

test("event timing recalculates the end from duration, including date rollover", () => {
  assert.deepEqual(updateEventTiming({
    startsAt: "2026-08-19T23:30",
    endsAt: "2026-08-20T00:30",
    duration: "01:00",
  }, "duration", "02:15"), {
    startsAt: "2026-08-19T23:30",
    endsAt: "2026-08-20T01:45",
    duration: "02:15",
  });
});
