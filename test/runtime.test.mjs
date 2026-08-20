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
        input: [
          { type: "text", text: payload.input },
          ...(payload.requestAttachmentInput
            ? [{ type: "text", text: payload.requestAttachmentInput }]
            : []),
        ],
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
        requestAttachmentInput: payload.requestAttachmentInput,
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
          developerInstructions: "VISIBLE CONTEXT",
          requestAttachmentInput: `# Attached request file\n${options.attachment.text}`,
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
  assert.equal(requests[0].developerInstructions, "VISIBLE CONTEXT");
  assert.match(requests[0].requestAttachmentInput, /name\nAlice/);
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
      capabilities: ["all"],
    },
  });
  assert.deepEqual(
    events.filter((event) => ["context.sent", "tools.sent", "model.request", "model.response", "model.usage", "tool.call", "tool.result"].includes(event.type)).map((event) => event.type),
    ["context.sent", "tools.sent", "model.request", "tool.call", "tool.result", "model.response", "model.usage"],
  );
  const recordedRequest = events.find((event) => event.type === "model.request");
  assert.equal(recordedRequest.payload.input[0].text, "Use the echo tool.");
  assert.match(recordedRequest.payload.input[1].text, /name\nAlice/);
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
    capabilities: ["all"],
  });
  assert.equal(modelRequest.developerInstructions, "CURRENT CONTEXT ONLY");
  assert.equal(modelRequest.requestAttachmentInput, null);
});

test("the request compiler limits callable tools and runtime rejects out-of-scope calls", async () => {
  let modelRequest;
  let rejectedCall;
  const modelTransport = fakeTransport(async (payload) => {
    modelRequest = payload;
    rejectedCall = await payload.onToolCall({ callId: "wrong-tool", tool: "beta", arguments: {} });
    return completedTurn({ text: "Only the selected tool was callable." });
  });
  const registry = new ToolRegistry();
  for (const name of ["alpha", "beta"]) {
    registry.register({
      name,
      description: name,
      parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
      async execute() { return { name }; },
    });
  }
  const events = [];
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    requestCompiler: {
      async compile({ tools }) {
        return {
          tools: tools.filter(({ name }) => name === "alpha"),
          capabilities: ["test"],
          instructionCapabilities: ["test"],
          reasons: ["test:request"],
          fallbackAll: false,
          followsPriorTurn: false,
          availableToolCount: tools.length,
          instructions: "USE ALPHA",
        };
      },
    },
    contextBuilder: {
      async build() {
        return {
          text: "BOUNDED CONTEXT", profileFacts: [], activeProfileFactCount: 0,
          relevantProfileTypes: [], relevantProfileQuestions: [], history: [],
          contextBudget: { truncated: false }, attachment: null,
        };
      },
    },
    ledger: { append(event) { events.push(event); } },
    config: runtimeConfig(),
  });
  runtime.systemPrompt = "CORE";

  assert.equal(
    await runtime.run({ requestId: "scoped", requestEventId: "scoped-event", text: "Use alpha." }),
    "Only the selected tool was callable.",
  );
  assert.deepEqual(modelRequest.tools.map(({ name }) => name), ["alpha"]);
  assert.equal(modelRequest.developerInstructions, "USE ALPHA\n\nBOUNDED CONTEXT");
  assert.equal(rejectedCall.ok, false);
  assert.match(rejectedCall.error, /not callable for this request/);
  const toolsEvent = events.find(({ type }) => type === "tools.sent");
  assert.equal(toolsEvent.payload.count, 1);
  assert.equal(toolsEvent.payload.availableCount, 2);
  assert.equal(toolsEvent.payload.delivery, "sent");
  assert.ok(toolsEvent.payload.schemaBytes > 0);
});

test("the runtime expands deferred capabilities and continues the same user request", async () => {
  const modelRequests = [];
  let betaExecutions = 0;
  const modelTransport = fakeTransport(async (payload) => {
    modelRequests.push(payload);
    if (modelRequests.length === 1) {
      const expansion = await payload.onToolCall({
        callId: "expand-beta",
        tool: "request_capabilities",
        arguments: { capabilities: ["beta"] },
      });
      assert.equal(expansion.ok, true);
      return completedTurn({
        text: "Capability expansion requested.",
        threadId: "thread-1",
        turnId: "codex-turn-1",
      });
    }
    const executed = await payload.onToolCall({
      callId: "run-beta",
      tool: "beta_action",
      arguments: {},
    });
    assert.equal(executed.ok, true);
    return completedTurn({
      text: "The deferred beta action completed.",
      threadId: "thread-2",
      turnId: "codex-turn-2",
    });
  });
  const registry = new ToolRegistry();
  for (const name of ["alpha_action", "beta_action"]) {
    registry.register({
      name,
      description: name,
      parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
      async execute() {
        if (name === "beta_action") betaExecutions += 1;
        return { name };
      },
    });
  }
  const requestCapabilities = {
    name: "request_capabilities",
    description: "Load beta.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        capabilities: { type: "array", items: { type: "string", enum: ["beta"] } },
      },
      required: ["capabilities"],
    },
    strict: true,
    source: "local",
    upstreamName: null,
  };
  const events = [];
  const contextOptions = [];
  let conversationMarker;
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    requestCompiler: {
      async compile({ tools, capabilityOverride }) {
        if (capabilityOverride) {
          return {
            tools,
            capabilities: ["alpha", "beta"],
            instructionCapabilities: [],
            reasons: ["beta:application-override"],
            fallbackAll: false,
            followsPriorTurn: false,
            availableToolCount: tools.length,
            deferredCapabilities: [],
            capabilityCatalog: [],
            instructions: "BETA IS NOW CALLABLE",
          };
        }
        return {
          tools: [tools.find(({ name }) => name === "alpha_action"), requestCapabilities],
          capabilities: ["alpha"],
          instructionCapabilities: [],
          reasons: ["alpha:request"],
          fallbackAll: false,
          followsPriorTurn: false,
          availableToolCount: tools.length,
          deferredCapabilities: ["beta"],
          capabilityCatalog: [{ capability: "beta", toolCount: 1, summary: "Beta actions." }],
          instructions: "BETA CAN BE REQUESTED",
        };
      },
    },
    contextBuilder: {
      async build(_requestId, _text, options) {
        contextOptions.push(options);
        return {
          text: "context", profileFacts: [], activeProfileFactCount: 0,
          relevantProfileTypes: [], relevantProfileQuestions: [], history: [],
          contextBudget: { truncated: false }, attachment: null,
        };
      },
    },
    ledger: {
      append(event) { events.push(event); },
      markConversationStarted(marker) { conversationMarker = marker; },
    },
    config: runtimeConfig(),
  });
  runtime.systemPrompt = "prompt";

  const answer = await runtime.run({
    requestId: "expand-request",
    requestEventId: "expand-event",
    text: "Use the beta capability.",
  });

  assert.equal(answer, "The deferred beta action completed.");
  assert.equal(modelRequests.length, 2);
  assert.equal(modelRequests[0].conversationId, null);
  assert.equal(modelRequests[1].conversationId, null);
  assert.equal(modelRequests[0].input, "Use the beta capability.");
  assert.deepEqual(modelRequests[0].tools.map(({ name }) => name), ["alpha_action", "request_capabilities"]);
  assert.deepEqual(modelRequests[1].tools.map(({ name }) => name), ["alpha_action", "beta_action"]);
  assert.match(modelRequests[1].input, /Original user request:\nUse the beta capability\./);
  assert.equal(contextOptions[1].nativeConversation, false);
  assert.equal(modelRequests[1].maxToolCalls, 3);
  assert.equal(betaExecutions, 1);
  assert.equal(events.some(({ type }) => type === "tools.expansion.requested"), true);
  assert.equal(conversationMarker.conversationId, "thread-2");
  assert.deepEqual(conversationMarker.capabilities, ["alpha", "beta"]);
});

test("late capability expansion preserves earlier same-request tool receipts without repeating work", async () => {
  const modelRequests = [];
  let alphaExecutions = 0;
  let betaExecutions = 0;
  const modelTransport = fakeTransport(async (payload) => {
    modelRequests.push(payload);
    if (modelRequests.length === 1) {
      const alpha = await payload.onToolCall({
        callId: "read-alpha",
        tool: "alpha_read",
        arguments: { id: 3 },
      });
      assert.deepEqual(alpha, { ok: true, result: { id: 3, scope: "project-3" } });
      const expansion = await payload.onToolCall({
        callId: "expand-beta-late",
        tool: "request_capabilities",
        arguments: { capabilities: ["beta"] },
      });
      assert.equal(expansion.ok, true);
      return completedTurn({ text: "Continuing.", threadId: "first-thread" });
    }
    assert.match(payload.developerInstructions, /Earlier tool receipts from this same user request/);
    assert.match(payload.developerInstructions, /"tool":"alpha_read"/);
    assert.match(payload.developerInstructions, /"scope":"project-3"/);
    const beta = await payload.onToolCall({
      callId: "write-beta",
      tool: "beta_write",
      arguments: { project: 3 },
    });
    assert.equal(beta.ok, true);
    return completedTurn({ text: "Finished from the earlier read.", threadId: "second-thread" });
  });
  const registry = new ToolRegistry();
  registry.register({
    name: "alpha_read", description: "read alpha",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { id: { type: "integer" } }, required: ["id"],
    },
    async execute({ id }) { alphaExecutions += 1; return { id, scope: `project-${id}` }; },
  });
  registry.register({
    name: "beta_write", description: "write beta",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { project: { type: "integer" } }, required: ["project"],
    },
    async execute({ project }) { betaExecutions += 1; return { project, written: true }; },
  });
  const expansionTool = {
    name: "request_capabilities", description: "Load beta.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { capabilities: { type: "array", items: { type: "string", enum: ["beta"] } } },
      required: ["capabilities"],
    },
    strict: true, source: "local", upstreamName: null,
  };
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    requestCompiler: {
      async compile({ tools, capabilityOverride }) {
        return capabilityOverride ? {
          tools, capabilities: ["alpha", "beta"], instructionCapabilities: [],
          reasons: ["expanded"], fallbackAll: false, followsPriorTurn: false,
          availableToolCount: tools.length, deferredCapabilities: [], capabilityCatalog: [], instructions: "",
        } : {
          tools: [tools.find(({ name }) => name === "alpha_read"), expansionTool],
          capabilities: ["alpha"], instructionCapabilities: [], reasons: ["initial"],
          fallbackAll: false, followsPriorTurn: false, availableToolCount: tools.length,
          deferredCapabilities: ["beta"], capabilityCatalog: [], instructions: "",
        };
      },
    },
    contextBuilder: {
      async build() {
        return {
          text: "bounded", profileFacts: [], activeProfileFactCount: 0,
          relevantProfileTypes: [], relevantProfileQuestions: [], history: [],
          contextBudget: { truncated: false }, attachment: null,
        };
      },
    },
    ledger: { append() {}, markConversationStarted() {} },
    config: runtimeConfig(),
  });
  runtime.systemPrompt = "prompt";

  const answer = await runtime.run({
    requestId: "late-expand", requestEventId: "late-expand-event",
    text: "Read alpha, then use what you learn to write beta.",
  });
  assert.equal(answer, "Finished from the earlier read.");
  assert.equal(modelRequests.length, 2);
  assert.equal(alphaExecutions, 1);
  assert.equal(betaExecutions, 1);
});

test("a capability change starts a fresh thread with bounded prior conversation context", async () => {
  let contextOptions;
  let modelConversationId;
  let startedMarker;
  const registry = new ToolRegistry();
  registry.register({
    name: "alpha", description: "alpha",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { return {}; },
  });
  const runtime = new SlayerRuntime({
    modelTransport: fakeTransport(async (payload) => {
      modelConversationId = payload.conversationId;
      return completedTurn({ threadId: "old-thread" });
    }),
    registry,
    requestCompiler: {
      async compile({ tools }) {
        return {
          tools, capabilities: ["alpha"], instructionCapabilities: [], reasons: ["alpha:request"],
          fallbackAll: false, followsPriorTurn: false, availableToolCount: tools.length, instructions: "",
        };
      },
    },
    contextBuilder: {
      async build(_requestId, _requestText, options) {
        contextOptions = options;
        return {
          text: "PRIOR EXCHANGE", profileFacts: [], activeProfileFactCount: 0,
          relevantProfileTypes: [], relevantProfileQuestions: [], history: [{ role: "assistant", content: "prior" }],
          contextBudget: { truncated: false }, attachment: null,
        };
      },
    },
    ledger: {
      currentModelConversation() {
        return { conversationId: "old-thread", markerEventSeq: 40, capabilities: ["email"] };
      },
      recentConversation() { return [{ role: "assistant", content: "prior" }]; },
      activeModelConversation() {
        return { conversationId: null, markerEventSeq: 40, reason: "tools_changed" };
      },
      markConversationStarted(marker) { startedMarker = marker; },
      append() {},
    },
    config: runtimeConfig(),
  });
  runtime.systemPrompt = "CORE";

  await runtime.run({ requestId: "changed", requestEventId: "event", text: "Switch domains." });
  assert.equal(modelConversationId, null);
  assert.deepEqual(contextOptions, {
    attachment: null,
    nativeConversation: false,
    continuingConversation: false,
    conversationStartEventSeq: 40,
    capabilities: ["alpha"],
  });
  assert.equal(startedMarker.conversationId, "old-thread");
  assert.deepEqual(startedMarker.capabilities, ["alpha"]);
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

test("a video request can select a one-turn model and reasoning override", async () => {
  let received;
  const events = [];
  const runtime = new SlayerRuntime({
    modelTransport: fakeTransport(async (payload) => {
      received = { model: payload.model, effort: payload.effort, instructions: payload.developerInstructions };
      return completedTurn({ text: "Rendered." });
    }),
    registry: new ToolRegistry(),
    contextBuilder: {
      async build() {
        return { text: "bounded", profileFacts: [], history: [], contextBudget: { truncated: false } };
      },
    },
    ledger: { append(event) { events.push(event); } },
    config: runtimeConfig(),
  });
  runtime.systemPrompt = "prompt";
  await runtime.run({
    requestId: "video-request",
    requestEventId: "video-event",
    text: "Make the video.",
    model: "gpt-5.6-sol",
    effort: "high",
    supplementalInstructions: "EXACT SOURCE",
  });
  assert.deepEqual(received, {
    model: "gpt-5.6-sol",
    effort: "high",
    instructions: "bounded\n\nEXACT SOURCE",
  });
  assert.equal(events.find(({ type }) => type === "model.response").actorName, "gpt-5.6-sol");
});
