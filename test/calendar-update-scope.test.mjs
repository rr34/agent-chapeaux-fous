import assert from "node:assert/strict";
import test from "node:test";
import { registerCalendarTools } from "../src/tools/calendar-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

const update = {
  calendar_event_id: 2877,
  title: null,
  description: "Plans for this Saturday only",
  location_text: null,
  starts_at_utc: null,
  ends_at_utc: null,
  time_zone: null,
  is_all_day: null,
  status: null,
};

test("calendar updates reject missing or invalid scope before accessing data", async () => {
  const registry = new ToolRegistry();
  registerCalendarTools(registry, {
    requireReady() { assert.fail("Invalid scope must be rejected before accessing data"); },
  }, {}, {});
  await assert.rejects(registry.execute("calendar_event_update", update), /scope is required/);
  for (const scope of [null, "occurrence", "all", ""]) {
    await assert.rejects(registry.execute("calendar_event_update", { ...update, scope }), /scope/);
  }
});

test("calendar scope mismatches cannot write data or receipts and explain the available choice", async () => {
  const registry = new ToolRegistry();
  let row = { calendar_event_id: 2877, recurrence_rule: "FREQ=WEEKLY;COUNT=12" };
  const database = {
    prepare(sql) {
      assert.match(sql, /^SELECT /, "A rejected scope must not write data");
      return { get: () => row };
    },
    exec() { assert.fail("A rejected scope must not begin a mutation transaction"); },
  };
  registerCalendarTools(registry, { requireReady: () => database }, {}, {
    append() { assert.fail("A rejected scope must not record a successful mutation"); },
  });
  await assert.rejects(registry.execute("calendar_event_update", { ...update, scope: "event" }), error => {
    assert.match(error.message, /calendar_event_occurrence_update/);
    assert.match(error.message, /scope=series/);
    assert.match(error.message, /just this occurrence or the whole series/);
    return true;
  });
  for (const recurrenceId of [null, "2026-09-04T21:00:00.000Z"]) {
    row = { ...row, recurrence_rule: null, ical_recurrence_id: recurrenceId };
    await assert.rejects(registry.execute("calendar_event_update", { ...update, scope: "series" }), /Use scope=event/);
  }
});

test("routine disable treats nullable update fields as unchanged", async () => {
  const registry = new ToolRegistry();
  const row = {
    calendar_routine_id: 14,
    title: "Morning Exercise",
    description: "Start the day moving",
    location_text: "Home gym",
    first_starts_at_utc: "2026-09-14T10:00:00.000Z",
    first_ends_at_utc: "2026-09-14T10:45:00.000Z",
    time_zone: "America/New_York",
    is_all_day: 0,
    recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    planning_prompt_text: "Which workout will you do?",
    disabled_at_utc: "2026-10-26T02:35:57.409Z",
    created_at_utc: "2026-09-01T00:00:00.000Z",
    updated_at_utc: "2026-10-26T02:35:57.409Z",
  };
  const database = { prepare: () => ({ get: () => row }) };
  const organizer = {
    updateCalendarRoutine(id, input) {
      assert.equal(id, 14);
      assert.deepEqual(input, {
        version: "2026-09-01T00:00:00.000Z",
        disabled: true,
      });
      return { id };
    },
  };
  registerCalendarTools(registry, { requireReady: () => database }, organizer, {});

  const result = await registry.execute("calendar_routine_update", {
    calendar_routine_id: 14,
    version: "2026-09-01T00:00:00.000Z",
    title: null,
    description: null,
    location_text: null,
    starts_at_utc: null,
    ends_at_utc: null,
    time_zone: null,
    is_all_day: null,
    recurrence: null,
    planning_prompt_text: null,
    disabled: true,
  });
  assert.equal(result.routine.description, "Start the day moving");
  assert.equal(result.routine.first_ends_at_utc, "2026-09-14T10:45:00.000Z");
});

test("routine update maps empty strings to explicit clear operations", async () => {
  const registry = new ToolRegistry();
  const row = {
    calendar_routine_id: 14,
    title: "Morning Exercise",
    first_starts_at_utc: "2026-09-14T10:00:00.000Z",
    time_zone: "America/New_York",
    is_all_day: 0,
    recurrence_rule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    created_at_utc: "2026-09-01T00:00:00.000Z",
    updated_at_utc: "2026-10-26T02:35:57.409Z",
  };
  const database = { prepare: () => ({ get: () => row }) };
  const organizer = {
    updateCalendarRoutine(id, input) {
      assert.equal(id, 14);
      assert.deepEqual(input, {
        version: "2026-10-26T02:35:57.409Z",
        description: "",
        location: "",
        endsAtUtc: null,
        planningPromptText: "",
      });
      return { id };
    },
  };
  registerCalendarTools(registry, { requireReady: () => database }, organizer, {});

  await registry.execute("calendar_routine_update", {
    calendar_routine_id: 14,
    version: "2026-10-26T02:35:57.409Z",
    description: "",
    location_text: "",
    ends_at_utc: "",
    planning_prompt_text: "",
  });
});
