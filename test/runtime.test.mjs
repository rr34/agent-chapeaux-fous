import assert from "node:assert/strict";
import test from "node:test";
import { SlayerRuntime } from "../src/runtime.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

test("the first model request contains exact callable tools and tool results return to the same exchange", async () => {
  const requests = [];
  const responses = [
    {
      id: "response-1",
      output: [{ type: "function_call", call_id: "call-1", name: "echo_value", arguments: "{\"value\":\"hello\"}" }],
    },
    {
      id: "response-2",
      output_text: "The tool returned hello.",
      output: [{ type: "message", content: [{ type: "output_text", text: "The tool returned hello." }] }],
    },
  ];
  const modelClient = {
    async create(payload) {
      requests.push(structuredClone(payload));
      return responses.shift();
    },
  };
  const registry = new ToolRegistry();
  registry.register({
    name: "echo_value",
    description: "Return the supplied value.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { value: { type: "string" } },
      required: ["value"],
    },
    async execute({ value }) { return { value }; },
  });
  const events = [];
  const runtime = new SlayerRuntime({
    modelClient,
    registry,
    contextBuilder: { async build() { return { text: "VISIBLE CONTEXT", profile: "profile", history: [] }; } },
    ledger: { append(event) { events.push(event); } },
    config: {
      model: "test-model",
      reasoningEffort: "none",
      maxToolRounds: 4,
      systemPromptPath: "unused",
    },
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  const result = await runtime.run({
    requestId: "request-1",
    requestEventId: "event-1",
    text: "Use the echo tool.",
  });

  assert.equal(result, "The tool returned hello.");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].tools, registry.modelTools());
  assert.equal(requests[0].input[0].content[0].text, "VISIBLE CONTEXT");
  assert.equal(requests[0].input[1].content[0].text, "Use the echo tool.");
  assert.ok(requests[1].input.some((item) => item.type === "function_call" && item.call_id === "call-1"));
  assert.ok(requests[1].input.some((item) => item.type === "function_call_output" && item.call_id === "call-1" && item.output.includes("hello")));
  assert.deepEqual(
    events.filter((event) => ["context.sent", "tools.sent", "model.request", "model.response", "tool.call", "tool.result"].includes(event.type)).map((event) => event.type),
    ["context.sent", "tools.sent", "model.request", "model.response", "tool.call", "tool.result", "model.request", "model.response"],
  );
});

test("a failed tool result is returned to the model instead of becoming a fabricated success", async () => {
  const requests = [];
  const modelClient = {
    async create(payload) {
      requests.push(structuredClone(payload));
      if (requests.length === 1) {
        return { output: [{ type: "function_call", call_id: "bad-1", name: "fails", arguments: "{}" }] };
      }
      return { output_text: "The operation failed.", output: [] };
    },
  };
  const registry = new ToolRegistry();
  registry.register({
    name: "fails",
    description: "Always fails.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { throw new Error("expected failure"); },
  });
  const runtime = new SlayerRuntime({
    modelClient, registry,
    contextBuilder: { async build() { return { text: "context", profile: "", history: [] }; } },
    ledger: { append() {} },
    config: { model: "test", reasoningEffort: "none", maxToolRounds: 3, systemPromptPath: "unused" },
  });
  runtime.systemPrompt = "prompt";
  assert.equal(await runtime.run({ requestId: "r", requestEventId: "e", text: "fail" }), "The operation failed.");
  const output = requests[1].input.find((item) => item.type === "function_call_output");
  assert.match(output.output, /"ok":false/);
  assert.match(output.output, /expected failure/);
});
