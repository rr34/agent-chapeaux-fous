import assert from "node:assert/strict";
import test from "node:test";
import { sameRequestReceiptInstructions, SlayerRuntime } from "../src/runtime.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

const receipt = (receiptEventSeq, result, overrides = {}) => ({
  receiptEventSeq, tool: "provider_query", ok: true, arguments: {}, result, ...overrides,
});
const entries = (text) => text.split("\n\n").filter((block) => block.startsWith("{")).map(JSON.parse);

test("large early discovery preserves later record IDs, mutation failures, and verification", () => {
  const records = [501, 502, 503, 504].map((note_id) => ({
    note_id, task_id: 100, Note: "Recorded work ".repeat(60),
  }));
  const receipts = [
    receipt(1, { schema: "x".repeat(22_000) }, { tool: "provider_describe" }),
    receipt(2, { task_id: 200, description: "Destination" }),
    receipt(3, { records, schema_contexts: [{ verbose: "x".repeat(40_000) }] }),
    receipt(4, undefined, {
      tool: "provider_mutate", ok: false,
      arguments: { operations: records.map(({ note_id }) => ({ note_id, task_id: 200 })) },
      error: "Provider rejected the write", toolFailure: { code: "RETRY_REQUIRED" },
    }),
    receipt(5, { records }),
  ];
  const before = structuredClone(receipts);
  const text = sameRequestReceiptInstructions(receipts);
  const projected = entries(text);
  assert.ok(text.length <= 24_000);
  assert.deepEqual(projected.map(({ receiptEventSeq }) => receiptEventSeq), [1, 2, 3, 4, 5]);
  assert.equal(projected[0].evidenceStoredInDurableReceipt, true);
  assert.equal(projected[1].evidence.task_id, 200);
  assert.deepEqual(projected[2].evidence.records, records);
  assert.deepEqual(projected[3].arguments, receipts[3].arguments);
  assert.equal(projected[3].error, receipts[3].error);
  assert.equal(projected[3].toolFailure.code, "RETRY_REQUIRED");
  assert.deepEqual(projected[4].evidence.records, records);
  assert.doesNotMatch(text, /schema_contexts/);
  assert.deepEqual(receipts, before);
});

test("oversized recent arguments do not hide smaller earlier receipts", () => {
  const text = sameRequestReceiptInstructions([
    receipt(1, { opaque_reference: "prepared-result" }, {
      deferredActionReference: { referenceId: "confirmation-reference" },
    }),
    receipt(2, { large: "z".repeat(50_000) }, { arguments: { input: "y".repeat(50_000) } }),
  ], 2_000);
  assert.ok(text.length <= 2_000);
  const projected = entries(text);
  assert.equal(projected[0].evidence.opaque_reference, "prepared-result");
  assert.equal(projected[0].deferredActionReference.referenceId, "confirmation-reference");
  assert.equal(projected[1].evidenceStoredInDurableReceipt, true);
  assert.deepEqual(projected[1].arguments.input, {
    storedAt: "/arguments/input", type: "string", characters: 50000,
  });
});

test("continuation budgets remain bounded with many receipts or very small limits", () => {
  const receipts = Array.from({ length: 100 }, (_, index) => receipt(index + 1, { id: index }));
  for (const maximum of [0, 200, 2_000, 24_000]) {
    const text = sameRequestReceiptInstructions(receipts, maximum);
    assert.ok(text.length <= maximum);
    const projected = entries(text);
    if (projected.length) assert.equal(projected.at(-1).receiptEventSeq, 100);
    if (maximum === 2_000) {
      const sourceIndex = JSON.parse(text.split("\n\n")[1].split(": ").slice(1).join(": "));
      assert.deepEqual(sourceIndex["provider_query:complete"], receipts.map(({ receiptEventSeq }) => receiptEventSeq));
    }
  }
  assert.equal(sameRequestReceiptInstructions([]), "");
});

test("pending expansion allows already advertised tools and rejects tools not yet advertised", async () => {
  const registry = new ToolRegistry();
  const executions = [];
  for (const name of ["alpha_write", "beta_write"]) {
    registry.register({
      name, description: name, annotations: { readOnlyHint: false },
      parameters: { type: "object", properties: {}, additionalProperties: false, required: [] },
      async execute() { executions.push(name); return { completed: name }; },
    });
  }
  const expansionTool = {
    name: "request_tools", description: "Load beta.",
    inputSchema: {
      type: "object", properties: { tools: { type: "array", items: { type: "string" } } },
      required: ["tools"], additionalProperties: false,
    },
    strict: true, source: "local", upstreamName: null,
  };
  let attempts = 0;
  const events = [];
  const runtime = new SlayerRuntime({
    registry,
    modelTransport: {
      id: "test", displayName: "Test model",
      describeRequest: (payload) => ({ ...payload, callableTools: payload.tools }),
      async runTurn(payload) {
        attempts += 1;
        if (attempts === 1) {
          assert.equal((await payload.onToolCall({
            callId: "expand", tool: "request_tools", arguments: { tools: ["beta_write"] },
          })).ok, true);
          assert.equal((await payload.onToolCall({
            callId: "alpha", tool: "alpha_write", arguments: {},
          })).ok, true);
          const unavailable = await payload.onToolCall({
            callId: "beta-too-soon", tool: "beta_write", arguments: {},
          });
          assert.equal(unavailable.ok, false);
          assert.match(unavailable.error, /not callable/);
        } else {
          assert.match(payload.developerInstructions, /"completed":"alpha_write"/);
          assert.equal((await payload.onToolCall({
            callId: "beta", tool: "beta_write", arguments: {},
          })).ok, true);
        }
        return {
          text: attempts === 1 ? "" : "Completed both writes.",
          conversationId: `test-${attempts}`, status: "completed", messages: [], events: [], usage: {},
        };
      },
    },
    requestCompiler: {
      async compile({ tools, toolOverride }) {
        const expanded = toolOverride.includes("beta_write");
        return {
          tools: expanded ? tools : [tools.find(({ name }) => name === "alpha_write"), expansionTool],
          capabilities: ["provider"], instructionCapabilities: [], instructions: "", reasons: [],
          deferredTools: expanded ? [] : [{ name: "beta_write" }],
          deferredCapabilities: [], capabilityCatalog: [],
        };
      },
    },
    contextBuilder: { async build() { return { text: "Bounded context" }; } },
    ledger: {
      append(event) { events.push(event); return events.length; },
      eventSequence(id) { return id; },
    },
    config: { model: "test", reasoningEffort: "low", turnWorkflowEnabled: false, maxToolCalls: 4 },
  });
  runtime.systemPrompt = "Test request";
  const result = await runtime.run({
    requestId: "expansion", requestEventId: "request-event", text: "Complete both writes.",
    capabilityOverride: ["provider"], toolOverride: ["alpha_write"],
  });
  assert.equal(result, "Completed both writes.");
  assert.equal(attempts, 2);
  assert.deepEqual(executions, ["alpha_write", "beta_write"]);
  assert.ok(events.some(({ type, name, status }) => type === "tool.result" && name === "alpha_write" && status === "complete"));
});
