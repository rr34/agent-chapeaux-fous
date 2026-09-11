import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { requestCallCounts } from "../src/request-metrics.mjs";
import { aiEntryCost } from "../public/ai-usage.js";

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

test("completed response summary keeps saved counts alongside cost and tokens", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const source = app.slice(app.indexOf("function requestUsageLabel("), app.indexOf("\nfunction renderRequestSteps("));
  const pricing = { inputPerMillion: 1, cachedInputPerMillion: 0, cacheWritePerMillion: 0, outputPerMillion: 1 };
  const context = vm.createContext({ formatUsd: value => `$${value.toFixed(2)}`, aiEntryCost, storedAiPricing: () => pricing });
  vm.runInContext(source, context);
  const usage = { estimatedCostUsd: 99, tokenUsage: { inputTokens: 200000, outputTokens: 31369, totalTokens: 231369 },
    modelCallCount: 12, toolCallCount: 8 };
  assert.equal(context.requestUsageLabel(usage), "$0.23 estimated · 231,369 tokens · 12 LLM calls · 8 tool calls");
  assert.equal(context.requestUsageLabel(usage, null), "Set token prices · 231,369 tokens · 12 LLM calls · 8 tool calls");
  assert.equal(context.requestUsageLabel({ modelCallCount: 1, toolCallCount: 0 }), "1 LLM call · 0 tool calls");
  assert.equal(context.requestUsageLabel(null), "");
});
