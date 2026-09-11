import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
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

test("totals count a usage event once and ignore historical cost estimates", () => {
  const entry = { eventSeq: 3, inputTokens: 1000000, cachedInputTokens: 0,
    cacheWriteTokens: 0, outputTokens: 0, totalTokens: 1000000, recordedEstimatedCostUsd: 99 };
  assert.deepEqual(summarizeAiUsage([entry, { ...entry }], prices), { cost: 1, tokens: 1000000 });
  assert.deepEqual(summarizeAiUsage([entry], null), { cost: null, tokens: 1000000 });
  assert.deepEqual(summarizeAiUsage([], null), { cost: null, tokens: 0 });
  assert.deepEqual(summarizeAiUsage([entry, { ...entry, eventSeq: 4 }], prices), { cost: 2, tokens: 2000000 });
});

test("saving and clearing prices on the screen immediately recalculates response estimates", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const saved = new Map();
  const handlers = {};
  const display = { dataset: { usage: JSON.stringify({ provider: "openai", estimatedCostUsd: 99,
    tokenUsage: { inputTokens: 1000000, outputTokens: 0, totalTokens: 1000000 } }) } };
  const elements = {
    aiPricingForm: { addEventListener: (name, callback) => { handlers.submit = callback; } },
    resetAiPricing: { addEventListener: (name, callback) => { handlers.clear = callback; } },
    aiUsageStatus: {}, aiInputPrice: { value: "" }, aiCachedInputPrice: { value: "" },
    aiCacheWritePrice: { value: "" }, aiOutputPrice: { value: "" },
  };
  const context = vm.createContext({
    normalizePricing, normalizePricingBook, pricingForTier, aiEntryCost, elements, aiPricingStorageKey: "test-prices",
    localStorage: { getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    window: { addEventListener: (name, callback) => { handlers.storage = callback; } },
    requestNodes: new Map([["request", { querySelector: () => display }]]),
    setTextContent: (node, text) => { node.textContent = text; }, renderAiUsage() {},
    formatUsd: value => `$${value.toFixed(2)}`,
  });
  vm.runInContext(app.slice(app.indexOf("function requestUsageLabel("), app.indexOf("\nfunction renderRequestSteps(")), context);
  vm.runInContext(app.slice(app.indexOf("function storedAiPricing("), app.indexOf("\nfunction meteredAiEntry(")), context);
  vm.runInContext(app.slice(app.indexOf('elements.aiPricingForm.addEventListener("submit",'),
    app.indexOf('elements.closeTrace.addEventListener')), context);
  assert.equal(context.storedAiPricing(prices), null, "A fallback rate card must never be used");
  handlers.submit({ preventDefault() {} });
  assert.equal(saved.size, 0, "Blank inputs must not be saved as free pricing");
  elements.aiInputPrice.value = "1";
  elements.aiCachedInputPrice.value = "0.1";
  elements.aiCacheWritePrice.value = "2";
  elements.aiOutputPrice.value = "3";
  handlers.submit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(saved.get("test-prices")), { unrecorded: prices });
  assert.match(display.textContent, /^\$1.00 estimated/);
  handlers.clear();
  assert.equal(saved.size, 0);
  assert.match(display.textContent, /^Set token prices/);
  assert.doesNotMatch(display.textContent, /\$99|\$0.00/);
  saved.set("test-prices", "invalid-json");
  assert.equal(context.storedAiPricing(), null);
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
