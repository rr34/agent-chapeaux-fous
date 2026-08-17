import assert from "node:assert/strict";
import test from "node:test";
import { SlayerRuntime } from "../src/runtime.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

function completedTurn(overrides = {}) {
  return {
    text: "The tool returned hello.",
    threadId: "thread-1",
    turnId: "codex-turn-1",
    status: "completed",
    messages: [{ type: "agentMessage", phase: "final_answer", text: "The tool returned hello." }],
    events: [],
    usage: {
      before: null,
      after: null,
      windows: [],
      tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    },
    ...overrides,
  };
}

function runtimeConfig() {
  return {
    model: "test-model",
    reasoningEffort: "high",
    maxToolCalls: 4,
    systemPromptPath: "unused",
  };
}

function fakeTransport(runTurn) {
  return {
    id: "test-transport",
    displayName: "Test model",
    describeRequest(payload) {
      return {
        transport: this.id,
        model: payload.model,
        conversationId: payload.conversationId,
        baseInstructions: payload.baseInstructions,
        developerInstructions: payload.developerInstructions,
        input: [{ type: "text", text: payload.input }],
        tools: structuredClone(payload.tools),
      };
    },
    runTurn,
  };
}

test("the first model turn contains the exact request, context, and callable tools, and executes tools in that turn", async () => {
  const requests = [];
  let contextBuildInput;
  let toolExecutionContext;
  const attachment = {
    filename: "contacts.csv", mimeType: "text/csv", byteSize: 18,
    sha256: "attachment-sha", text: "name\nAlice\n",
  };
  const modelTransport = fakeTransport(async (payload) => {
      requests.push({
        model: payload.model,
        effort: payload.effort,
        conversationId: payload.conversationId,
        baseInstructions: payload.baseInstructions,
        developerInstructions: payload.developerInstructions,
        input: payload.input,
        tools: structuredClone(payload.tools),
      });
      const toolResponse = await payload.onToolCall({
        callId: "call-1",
        tool: "echo_value",
        arguments: { value: "hello" },
      });
      assert.equal(toolResponse.ok, true);
      assert.equal(toolResponse.result.value, "hello");
      return completedTurn();
    });
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
    async execute({ value }, context) {
      toolExecutionContext = context;
      return { value };
    },
  });
  const events = [];
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: {
      async build(requestId, requestText, options) {
        contextBuildInput = { requestId, requestText, options };
        return {
          text: `VISIBLE CONTEXT\n${options.attachment.text}`,
          profileFacts: [],
          activeProfileFactCount: 0,
          relevantProfileTypes: ["address"],
          relevantProfileQuestions: [{ factType: "address" }],
          history: [],
          contextBudget: { truncated: false },
          attachment: options.attachment,
        };
      },
    },
    ledger: { append(event) { events.push(event); } },
    config: runtimeConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  const result = await runtime.run({
    requestId: "request-1",
    requestEventId: "event-1",
    text: "Use the echo tool.",
    attachment,
  });

  assert.equal(result, "The tool returned hello.");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].tools, registry.toolDefinitions());
  assert.equal(requests[0].developerInstructions, "VISIBLE CONTEXT\nname\nAlice\n");
  assert.equal(requests[0].input, "Use the echo tool.");
  assert.equal(requests[0].baseInstructions, "SYSTEM PROMPT");
  assert.deepEqual(contextBuildInput, {
    requestId: "request-1",
    requestText: "Use the echo tool.",
    options: {
      attachment,
      nativeConversation: true,
      continuingConversation: false,
      conversationStartEventSeq: 0,
    },
  });
  assert.deepEqual(
    events.filter((event) => ["context.sent", "tools.sent", "model.request", "model.response", "model.usage", "tool.call", "tool.result"].includes(event.type)).map((event) => event.type),
    ["context.sent", "tools.sent", "model.request", "tool.call", "tool.result", "model.response", "model.usage"],
  );
  const recordedRequest = events.find((event) => event.type === "model.request");
  assert.equal(recordedRequest.payload.input[0].text, "Use the echo tool.");
  assert.deepEqual(recordedRequest.payload.tools, registry.toolDefinitions());
  const contextEvent = events.find((event) => event.type === "context.sent");
  assert.deepEqual(contextEvent.payload.relevantProfileTypes, ["address"]);
  assert.deepEqual(contextEvent.payload.relevantProfileQuestions, [{ factType: "address" }]);
  assert.equal(contextEvent.payload.attachment.filename, "contacts.csv");
  assert.equal(toolExecutionContext.attachment, attachment);
});

test("the runtime resumes the active native conversation without reinjecting transcript history", async () => {
  let modelRequest;
  let contextOptions;
  const modelTransport = fakeTransport(async (payload) => {
    modelRequest = payload;
    return completedTurn({ threadId: "thread-saved" });
  });
  const runtime = new SlayerRuntime({
    modelTransport,
    registry: new ToolRegistry(),
    contextBuilder: {
      async build(_requestId, _requestText, options) {
        contextOptions = options;
        return {
          text: "CURRENT CONTEXT ONLY",
          profileFacts: [],
          activeProfileFactCount: 0,
          relevantProfileTypes: [],
          relevantProfileQuestions: [],
          history: [],
          nativeConversation: { continuing: true },
          contextBudget: { truncated: false },
          attachment: null,
        };
      },
    },
    ledger: {
      activeModelConversation() {
        return { conversationId: "thread-saved", markerEventSeq: 42, reason: "continue" };
      },
      append() {},
    },
    config: runtimeConfig(),
  });
  runtime.systemPrompt = "prompt";

  await runtime.run({ requestId: "r2", requestEventId: "e2", text: "Continue." });

  assert.equal(modelRequest.conversationId, "thread-saved");
  assert.deepEqual(contextOptions, {
    attachment: null,
    nativeConversation: true,
    continuingConversation: true,
    conversationStartEventSeq: 42,
  });
});

test("a failed tool result is returned to the model transport instead of becoming a fabricated success", async () => {
  let toolResponse;
  const modelTransport = fakeTransport(async (payload) => {
      toolResponse = await payload.onToolCall({ callId: "bad-1", tool: "fails", arguments: {} });
      return completedTurn({ text: "The operation failed." });
    });
  const registry = new ToolRegistry();
  registry.register({
    name: "fails",
    description: "Always fails.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { throw new Error("expected failure"); },
  });
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: { async build() { return { text: "context", profileFacts: [], history: [], contextBudget: { truncated: false } }; } },
    ledger: { append() {} },
    config: runtimeConfig(),
  });
  runtime.systemPrompt = "prompt";
  assert.equal(await runtime.run({ requestId: "r", requestEventId: "e", text: "fail" }), "The operation failed.");
  assert.equal(toolResponse.ok, false);
  assert.match(toolResponse.error, /expected failure/);
});

test("strict tool schemas are enforced before application functions execute", async () => {
  let executions = 0;
  const registry = new ToolRegistry();
  registry.register({
    name: "bounded",
    description: "Accept a bounded number.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
      required: ["limit"],
    },
    async execute({ limit }) { executions += 1; return { limit }; },
  });
  await assert.rejects(registry.execute("bounded", { limit: 160 }), /limit must be at most 100/);
  await assert.rejects(registry.execute("bounded", { limit: 10, surprise: true }), /surprise is not allowed/);
  assert.equal(executions, 0);
});

test("tool-budget exhaustion is returned to the model so it can finish gracefully", async () => {
  const responses = [];
  const modelTransport = fakeTransport(async (payload) => {
    for (let index = 1; index <= 5; index += 1) {
      responses.push(await payload.onToolCall({
        callId: `call-${index}`,
        tool: "ping",
        arguments: {},
      }));
    }
    return completedTurn({ text: "I stopped after the tool budget was exhausted." });
  });
  const registry = new ToolRegistry();
  registry.register({
    name: "ping",
    description: "Return pong.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { return { pong: true }; },
  });
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: { async build() { return { text: "context", profileFacts: [], history: [], contextBudget: { truncated: false } }; } },
    ledger: { append() {} },
    config: runtimeConfig(),
  });
  runtime.systemPrompt = "prompt";
  assert.equal(
    await runtime.run({ requestId: "r", requestEventId: "e", text: "keep pinging" }),
    "I stopped after the tool budget was exhausted.",
  );
  assert.equal(responses.slice(0, 4).every(({ ok }) => ok), true);
  assert.equal(responses[4].ok, false);
  assert.match(responses[4].error, /Return a final answer now/);
});

test("a request can override the normal tool budget and pass a model-turn deadline", async () => {
  const toolResponses = [];
  let receivedLimits;
  const modelTransport = fakeTransport(async (payload) => {
    receivedLimits = { maxToolCalls: payload.maxToolCalls, runTimeoutMs: payload.runTimeoutMs };
    for (let index = 0; index < 6; index += 1) {
      toolResponses.push(await payload.onToolCall({
        callId: `call-${index}`,
        tool: "ping",
        arguments: {},
      }));
    }
    return completedTurn({ text: "All calls completed." });
  });
  const registry = new ToolRegistry();
  registry.register({
    name: "ping",
    description: "Return pong.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { return { pong: true }; },
  });
  const events = [];
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: {
      async build() {
        return {
          text: "context", profileFacts: [], activeProfileFactCount: 0,
          relevantProfileTypes: [], relevantProfileQuestions: [], history: [],
          contextBudget: { truncated: false }, attachment: null,
        };
      },
    },
    ledger: { append(event) { events.push(event); } },
    config: { ...runtimeConfig(), maxToolCalls: 2 },
  });
  runtime.systemPrompt = "prompt";
  assert.equal(await runtime.run({
    requestId: "request-custom-limits",
    requestEventId: "event-custom-limits",
    text: "Keep going.",
    runLimits: { maxToolCalls: null, timeoutMs: 90_000 },
  }), "All calls completed.");
  assert.deepEqual(receivedLimits, { maxToolCalls: null, runTimeoutMs: 90_000 });
  assert.equal(toolResponses.every(({ ok }) => ok), true);
  assert.deepEqual(
    events.find(({ type }) => type === "context.sent").payload.runLimits,
    { maxToolCalls: null, timeoutMs: 90_000 },
  );
});
