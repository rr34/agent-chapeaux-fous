import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
// Run the browser functions themselves without booting the unrelated DOM views.
const pollSource = app.slice(app.indexOf("async function poll("), app.indexOf("\npoll(loadHealth,"));
const healthSource = app.slice(app.indexOf("async function loadHealth("), app.indexOf("\nfunction renderIntegrations("));

test("polling schedules another read only after the prior read settles, including failures", async () => {
  const timers = [];
  const context = vm.createContext({ setTimeout: (callback, delay) => timers.push({ callback, delay }) });
  vm.runInContext(pollSource, context);
  let reject;
  let calls = 0;
  const pending = new Promise((_, fail) => { reject = fail; });
  const running = context.poll(() => { calls++; return pending; }, 1500);
  assert.equal(calls, 1);
  assert.equal(timers.length, 0);
  reject(new Error("Connection timed out"));
  await running;
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1500);
  await timers.shift().callback();
  assert.equal(calls, 2);
  assert.equal(timers.length, 1);
});

test("failed health reads clear stale readiness and successful reads restore the status", async () => {
  const classes = new Set(["ready"]);
  const runtime = { classList: {
    remove: name => classes.delete(name), add: name => classes.add(name),
    toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
  } };
  let reachable = false;
  const context = vm.createContext({
    Date, AbortSignal,
    elements: { runtime, usage: { classList: { toggle() {} } } },
    healthUsageLabel: () => "", renderIntegrations() {}, updateEventInviteDraftAvailability() {},
    fetch: async (url, options) => {
      assert.equal(url, "/health");
      assert.equal(options.cache, "no-store");
      assert.ok(options.signal instanceof AbortSignal);
      if (!reachable) throw new TypeError("Failed to fetch");
      return { status: 200, json: async () => ({ ready: true, runtime: { commit: "abc123" }, model: {} }) };
    },
  });
  vm.runInContext(`let lastHealth = null;\n${healthSource}`, context);
  await context.loadHealth();
  assert.equal(runtime.textContent, "Server unreachable");
  assert.equal(classes.has("ready"), false);
  assert.equal(vm.runInContext("lastHealth.httpStatus", context), null);
  reachable = true;
  await context.loadHealth();
  assert.equal(runtime.textContent, "Git commit: abc123");
  assert.equal(classes.has("ready"), true);
});
