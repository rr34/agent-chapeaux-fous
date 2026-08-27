import assert from "node:assert/strict";
import test from "node:test";
import { ResultFilterBoundary } from "../src/search/result-filter.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

function filterRequest(overrides = {}) {
  return {
    collection_path: null,
    query: null,
    match_mode: "all_terms",
    include_fields: [],
    exclude_fields: [],
    max_items: 200,
    max_characters: 32768,
    ...overrides,
  };
}

test("read-only tool schemas require the search-data filter without changing provider arguments", async () => {
  let executedArguments;
  const registry = new ToolRegistry();
  registry.register({
    name: "records_read",
    description: "Read records.",
    annotations: { readOnlyHint: true },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { status: { type: "string" } },
      required: ["status"],
    },
    async execute(argumentsObject) {
      executedArguments = argumentsObject;
      return { records: [] };
    },
  });

  const definition = registry.toolDefinitions()[0];
  assert.equal(definition.inputSchema.required.includes("result_filter"), true);
  assert.equal(definition.inputSchema.properties.result_filter.additionalProperties, false);
  assert.equal(definition.annotations.readOnlyHint, true);

  await registry.execute("records_read", { status: "active" });
  assert.deepEqual(executedArguments, { status: "active" });
});

test("the result boundary deterministically searches, projects, and limits a record collection", () => {
  const boundary = new ResultFilterBoundary();
  const result = boundary.filterReadResult({
    records: [
      { id: 1, name: "Alpha", notes: "blue project", secret: "one" },
      { id: 2, name: "Beta", notes: "blue archive", secret: "two" },
      { id: 3, name: "Gamma", notes: "green project", secret: "three" },
    ],
    source_status: "complete",
  }, {
    requestId: "request-1",
    interactionId: "call-1",
    tool: "records_read",
    source: "test",
    filterRequest: filterRequest({
      query: "blue",
      match_mode: "phrase",
      include_fields: ["name", "notes"],
      exclude_fields: ["notes"],
      max_items: 1,
    }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.deliveredResult.records, [{ id: 1, name: "Alpha" }]);
  assert.equal(result.deliveredResult.source_status, "complete");
  assert.equal(result.receipt.protocol, "agent-slayer.search-data");
  assert.deepEqual(result.receipt.summary.prunedByReason, {
    query: 1,
    max_items: 1,
    fields: true,
  });
  assert.equal(result.receipt.summary.candidates, 3);
  assert.equal(result.receipt.summary.returned, 1);
});

test("the result boundary rejects an ambiguous collection instead of leaking unfiltered data", () => {
  const boundary = new ResultFilterBoundary();
  const result = boundary.filterReadResult({ first: [{ id: 1 }], second: [{ id: 2 }] }, {
    requestId: "request-2",
    interactionId: "call-2",
    tool: "records_read",
    source: "test",
    filterRequest: filterRequest({ query: "1" }),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /needs collection_path/);
  assert.deepEqual(Object.keys(result.deliveredResult), ["result_filter"]);
  assert.equal(result.receipt.status, "error");
});

test("identity filtering still emits a protocol receipt", () => {
  const boundary = new ResultFilterBoundary();
  const result = boundary.filterReadResult({ value: "small" }, {
    requestId: "request-3",
    interactionId: "call-3",
    tool: "single_read",
    source: "test",
    filterRequest: filterRequest(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.deliveredResult.value, "small");
  assert.equal(result.deliveredResult.result_filter.status, "complete");
  assert.equal(result.receipt.summary.candidates, null);
});

test("an oversized result without durable receipt paging fails closed", () => {
  const boundary = new ResultFilterBoundary();
  const result = boundary.filterReadResult({ value: "x".repeat(2000) }, {
    requestId: "request-4",
    interactionId: "call-4",
    tool: "single_read",
    source: "test",
    filterRequest: filterRequest({ max_characters: 1000 }),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /no durable receipt/);
  assert.deepEqual(Object.keys(result.deliveredResult), ["result_filter"]);
});
