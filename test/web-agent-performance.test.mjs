import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("../web/src/App.tsx", import.meta.url), "utf8");
const hooks = fs.readFileSync(new URL("../web/src/hooks.ts", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");

test("the computer web client uses a bounded incremental request feed", () => {
  assert.match(app, /useRequestFeed\(25, 3000\)/);
  assert.doesNotMatch(app, /api\/requests\?limit=50/);
  assert.match(hooks, /afterEventSeq=\$\{cursor\.current\}/);
  assert.match(hooks, /if \(inFlight\.current\) return inFlight\.current/);
  assert.match(hooks, /document\.visibilityState === "visible"/);
  assert.match(app, /setOptimisticRequests\(\(current\) => \[request,/);
});

test("accepted web requests are acknowledged before the deferred queue wake-up", () => {
  assert.match(server, /sendJson\(response, 202, created\);\s+queue\.notify\(\);/);
});
