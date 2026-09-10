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
