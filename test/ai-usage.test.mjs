import assert from "node:assert/strict";
import test from "node:test";
import { aiEntryCost, normalizePricing, normalizePricingBook, pricingForTier,
  summarizeAiUsage, llmCallCountForUsage, llmCallCountLabel, usageFromTrace } from "../public/ai-usage.js";
import { Ledger } from "../src/ledger.mjs";

const protocolEvents = count => Array.from({ length: count }, () => ({ type: "response.completed" }));
const prices = { inputPerMillion: 1, cachedInputPerMillion: 0.1, cacheWritePerMillion: 2, outputPerMillion: 3 };

test("cost uses only entered prices and bills each token category once", () => {
  const usage = { inputTokens: 1200, cachedInputTokens: 400, cacheWriteTokens: 500,
    outputTokens: 200, reasoningOutputTokens: 100, totalTokens: 1400, recordedEstimatedCostUsd: 999 };
  assert.equal(aiEntryCost(usage, prices), 0.00194);
  assert.equal(aiEntryCost({ ...usage, modelCallCount: 30, toolCallCount: 50 }, prices), 0.00194);
  assert.equal(aiEntryCost(usage, null), null);
  assert.equal(aiEntryCost(usage, {}), null);
  assert.equal(aiEntryCost({ ...usage, cachedInputTokens: 1300 }, prices), null);
  assert.equal(aiEntryCost({ ...usage, inputTokens: null }, prices), null);
  assert.equal(aiEntryCost(usage, Object.fromEntries(Object.keys(prices).map(key => [key, 0]))), 0);
});

test("unset or blank prices are unavailable, while explicit zero prices are valid", () => {
  for (const value of [null, {}, [], { ...prices, outputPerMillion: null },
    { ...prices, outputPerMillion: "" }, { ...prices, outputPerMillion: " " },
    { ...prices, outputPerMillion: -1 }, { ...prices, outputPerMillion: Infinity }]) {
    assert.equal(normalizePricing(value), null);
  }
  assert.deepEqual(normalizePricing({ ...prices, outputPerMillion: "0" }), { ...prices, outputPerMillion: 0 });
});

test("tier price books calculate each provider service tier separately", () => {
  const free = Object.fromEntries(Object.keys(prices).map(key => [key, 0]));
  const book = { default: prices, "incentivized-tier": free };
  const usage = {
    usageByServiceTier: [
      { serviceTier: "default", tokenUsage: { inputTokens: 1000000, outputTokens: 0 } },
      { serviceTier: "incentivized-tier", tokenUsage: { inputTokens: 2000000, outputTokens: 0 } },
    ],
  };
  assert.deepEqual(normalizePricingBook(book), book);
  assert.equal(pricingForTier(book, "incentivized-tier").inputPerMillion, 0);
  assert.equal(aiEntryCost(usage, book), 1);
  assert.equal(aiEntryCost(usage, { default: prices }), null);
});

test("price books preserve user-entered cards for newly observed service tiers", () => {
  const book = { priority: prices, "future-tier": { ...prices, outputPerMillion: "4" } };
  assert.deepEqual(normalizePricingBook(book), {
    priority: prices,
    "future-tier": { ...prices, outputPerMillion: 4 },
  });
  assert.equal(pricingForTier(book, "priority").inputPerMillion, 1);
});

test("totals count a usage event once and ignore historical cost estimates", () => {
  const entry = { eventSeq: 3, inputTokens: 1000000, cachedInputTokens: 0,
    cacheWriteTokens: 0, outputTokens: 0, totalTokens: 1000000, recordedEstimatedCostUsd: 99 };
  assert.deepEqual(summarizeAiUsage([entry, { ...entry }], prices), { cost: 1, tokens: 1000000 });
  assert.deepEqual(summarizeAiUsage([entry], null), { cost: null, tokens: 1000000 });
  assert.deepEqual(summarizeAiUsage([], null), { cost: null, tokens: 0 });
  assert.deepEqual(summarizeAiUsage([entry, { ...entry, eventSeq: 4 }], prices), { cost: 2, tokens: 2000000 });
});

test("usage counts round trips, not tool calls or aggregate rows", () => {
  assert.equal(llmCallCountForUsage({}, { protocolEvents: [{ type: "response.completed",
    outputTypes: Array(7).fill("function_call") }] }), 1);
  assert.equal(llmCallCountForUsage({}, { protocolEvents: protocolEvents(5) }), 5);
  assert.equal(llmCallCountForUsage({ modelCallCount: 6 }, { protocolEvents: protocolEvents(5) }), 6);
  assert.equal(llmCallCountLabel([{ modelCallCount: 1 }, { modelCallCount: 5 }]), "6 LLM calls");
  assert.equal(llmCallCountLabel([{ modelCallCount: 1 }]), "1 LLM call");
  assert.equal(llmCallCountForUsage({}), null);
  assert.equal(llmCallCountLabel([{ modelCallCount: null }]), "LLM call count unavailable");
});

test("restarted operations use their own preceding response when reconstructing usage", () => {
  const event = (eventSeq, type, payload) => ({ eventSeq, type, payload, operationId: "reused", turnId: "request" });
  const entries = usageFromTrace([
    event(1, "model.response", { protocolEvents: protocolEvents(5) }),
    event(2, "model.usage", {}),
    event(3, "model.request", {}),
    event(4, "model.response", { protocolEvents: protocolEvents(2) }),
    event(5, "model.usage", {}),
  ]);
  assert.deepEqual(entries.map(entry => entry.modelCallCount), [5, 2]);
  assert.equal(llmCallCountLabel(entries), "7 LLM calls");
});

test("usage API includes round-trip counts and selects only the matching preceding response", () => {
  let query;
  const ledger = new Ledger({ requireReady: () => ({ prepare(sql) {
    query = sql;
    return { all() { return [{
      event_seq: 8, turn_id: "request", payload_json: JSON.stringify({
        tokenUsage: { totalTokens: 100 },
        usageByServiceTier: [{ serviceTier: "incentivized-tier", tokenUsage: { totalTokens: 100 } }],
      }),
      response_payload_json: JSON.stringify({ protocolEvents: protocolEvents(4) }),
    }]; } };
  } }) });
  const usage = ledger.modelUsage()[0];
  assert.equal(usage.modelCallCount, 4);
  assert.equal(usage.usageByServiceTier[0].serviceTier, "incentivized-tier");
  assert.match(query, /SELECT MAX\(candidate.event_seq\)/);
  assert.match(query, /candidate.event_seq < usage_event.event_seq/);
  assert.match(query, /candidate.turn_id <=> usage_event.turn_id/);
});

test("usage API exposes per-round-trip metrics when the provider trace recorded them", () => {
  const ledger = new Ledger({ requireReady: () => ({ prepare() {
    return { all() { return [{
      event_seq: 9,
      turn_id: "request",
      occurred_at_utc: "2026-11-01T12:00:00.000Z",
      payload_json: JSON.stringify({ tokenUsage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 } }),
      response_model: "gpt-test",
      response_payload_json: JSON.stringify({ protocolEvents: [{
        type: "response.completed", model: "gpt-test-2026", serviceTier: "priority", status: "completed", elapsedMs: 432,
        usage: { inputTokens: 13, cachedInputTokens: 3, cacheWriteTokens: 0, outputTokens: 5,
          reasoningOutputTokens: 2, totalTokens: 18 },
      }] }),
    }]; } };
  } }) });
  assert.deepEqual(ledger.modelUsage()[0].calls, [{
    callIndex: 1,
    model: "gpt-test-2026",
    serviceTier: "priority",
    status: "completed",
    elapsedMs: 432,
    inputTokens: 13,
    cachedInputTokens: 3,
    cacheWriteTokens: 0,
    outputTokens: 5,
    reasoningOutputTokens: 2,
    totalTokens: 18,
  }]);
});
