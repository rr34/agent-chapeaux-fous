import assert from "node:assert/strict";
import test from "node:test";
import { defaultCatchUpSettings, catchUpScopeFromSettings, catchUpRequestText } from "../public/catch-up-settings.js";

const now = new Date("2026-09-10T16:00:00Z");
const zone = "America/New_York";
test("relative journal dates and weekday horizons resolve afresh when a check-in starts", () => {
  const settings = { ...defaultCatchUpSettings, logsDay: "yesterday" };
  const scope = catchUpScopeFromSettings(settings, now, zone);
  assert.equal(scope.logs_date, "2026-09-09");
  assert.equal(scope.plan_through_date, "2026-09-11");
  assert.equal(scope.events_before_utc, null);
  assert.equal(Object.hasOwn(scope, "todos_before_utc"), false);
  assert.equal(catchUpScopeFromSettings(settings, new Date("2026-09-11T16:00:00Z"), zone).logs_date, "2026-09-10");
  assert.equal(catchUpScopeFromSettings(settings, new Date("2026-09-12T16:00:00Z"), zone).plan_through_date, "2026-09-18");
});
test("disabled categories do not validate or leak unused custom inputs into the request", () => {
  const scope = catchUpScopeFromSettings({ ...defaultCatchUpSettings,
    logsEnabled: false, logsDay: "date", logsDate: "bad", planEnabled: false,
    eventsEnabled: true,
  }, now, zone);
  assert.equal(scope.logs_date, null);
  assert.equal(Object.hasOwn(scope, "todos_before_utc"), false);
  const text = catchUpRequestText(scope);
  assert.match(text, /Journal logs: disabled/);
  assert.match(text, /Event planning: disabled/);
  assert.match(text, /2026-09-10T16:00:00.000Z/);
  assert.match(text, /one question at a time and wait/);
  assert.doesNotMatch(text, /bad/);
});
test("invalid dates, future journal dates and empty scopes cannot start catch-up", () => {
  assert.throws(() => catchUpScopeFromSettings({ ...defaultCatchUpSettings, logsDay: "date", logsDate: "2026-02-30" }, now, zone), /valid calendar date/);
  assert.throws(() => catchUpScopeFromSettings({ ...defaultCatchUpSettings, logsDay: "date", logsDate: "2026-09-11" }, now, zone), /past day/);
  assert.throws(() => catchUpScopeFromSettings({ ...defaultCatchUpSettings, logsEnabled: false, planEnabled: false, eventsEnabled: false }, now, zone), /at least one/);
});
