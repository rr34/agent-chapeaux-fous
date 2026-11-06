import assert from "node:assert/strict";
import test from "node:test";
import { requestCallCounts } from "../src/request-metrics.mjs";

const event = (type, payload = {}, operationId = "exchange", phase = "point") => ({ type, payload, operationId, phase });
const start = () => event("model.request", {}, "exchange", "start");
const call = () => event("model.call", {}, "exchange", "start");
const response = count => event("model.response", {
  protocolEvents: Array.from({ length: count }, () => ({ type: "response.completed" })),
});
test("counts round trips once across persisted call, response, and usage events", () => {
  const events = [start(), call(), call(), response(2), event("model.usage", { modelCallCount: 2 }),
    event("tool.call", {}, "tool-1", "start"), event("tool.result", {}, "tool-1", "end"),
    event("tool.call", {}, "tool-2", "error")];
  assert.deepEqual(requestCallCounts(JSON.parse(JSON.stringify(events))), { modelCallCount: 2, toolCallCount: 2 });
});

test("recovers legacy round trips and separately counts restarted exchanges with reused IDs", () => {
  assert.deepEqual(requestCallCounts([
    start(), response(5), event("model.usage"),
    start(), response(3), event("model.usage"),
    event("model.usage", {}, "usage-only"),
  ]), { modelCallCount: 9, toolCallCount: 0 });
});

test("counts in-flight and failed calls without requiring a usage event", () => {
  assert.equal(requestCallCounts([start()]).modelCallCount, 1);
  assert.equal(requestCallCounts([start(), call(), call()]).modelCallCount, 2);
  assert.equal(requestCallCounts([start(), call(), call(), response(1),
    event("model.usage", { modelCallCount: 2 })]).modelCallCount, 2);
  assert.equal(requestCallCounts([start(), event("model.usage", { modelCallCount: 0 })]).modelCallCount, 0);
  assert.deepEqual(requestCallCounts([]), { modelCallCount: 0, toolCallCount: 0 });
});
