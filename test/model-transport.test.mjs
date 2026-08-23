import assert from "node:assert/strict";
import test from "node:test";
import { assertModelTransport, createModelTransport } from "../src/model-transport.mjs";

test("a model adapter must implement the complete Slayer transport boundary", () => {
  assert.throws(
    () => assertModelTransport({ id: "incomplete", displayName: "Incomplete" }),
    /does not implement start/,
  );

  const transport = {
    id: "complete",
    displayName: "Complete",
    async start() {},
    async close() {},
    health() { return { ready: true }; },
    describeRequest(request) { return request; },
    async runTurn() { return { text: "done" }; },
  };
  assert.equal(assertModelTransport(transport), transport);
});

test("the OpenAI Responses adapter is selected entirely through configuration", async () => {
  const transport = await createModelTransport({
    modelTransport: "openai-responses",
    openAIApiKey: "sk_test_secret_value_123456",
    openAIBaseUrl: "https://api.openai.com/v1",
    openAIRequestTimeoutMs: 600000,
    openAIContextWindowTokens: 1050000,
    openAIImageDetail: "original",
    aiPricing: {
      inputPerMillion: 2, cachedInputPerMillion: 0.2, cacheWritePerMillion: 2.5, outputPerMillion: 12,
    },
  });
  assert.equal(transport.id, "openai-responses");
  assert.equal(transport.health().ready, true);
  assert.doesNotMatch(JSON.stringify(transport.health()), /sk_test_secret/);
});
