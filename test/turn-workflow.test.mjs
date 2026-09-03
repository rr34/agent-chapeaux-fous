import assert from "node:assert/strict";
import test from "node:test";
import { RequestCompiler } from "../src/request-compiler.mjs";
import { SlayerRuntime } from "../src/runtime.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";

function usage(totalTokens) {
  return {
    tokenUsage: {
      inputTokens: totalTokens - 5,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 5,
      reasoningOutputTokens: 0,
      totalTokens,
    },
  };
}

function completed(text, totalTokens) {
  return {
    text,
    threadId: null,
    turnId: `turn-${totalTokens}`,
    status: "completed",
    messages: [],
    events: [],
    usage: usage(totalTokens),
  };
}

function identityResultFilter(overrides = {}) {
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

function brief({ auditRequired = true, confirmedActionReferenceIds = [] } = {}) {
  const source = { text: "Run the previously offered action.", sourceEventSeqs: [4, 9] };
  return {
    contractVersion: 1,
    requestType: "confirmation",
    responseMode: "act",
    objective: "Create the reminder that the assistant just offered to create.",
    summary: "The user confirmed the concrete action offered in the prior assistant turn.",
    requiredCapabilities: ["todos"],
    requiredTools: ["todo_create"],
    confirmedActionReferenceIds,
    contextRequests: [],
    receiptReferences: [],
    temporalResolutions: [],
    requestedActions: [source],
    prohibitedActions: [],
    deferredActions: [],
    constraints: [],
    unresolvedQuestions: [],
    completionCriteria: ["A successful todo_create receipt exists."],
    evidence: [source],
    audit: { required: auditRequired, reasons: auditRequired ? ["This is a write operation."] : [] },
    conversationState: {
      activeObjective: "Create the offered reminder.",
      openCommitments: [source],
      durableConstraints: [],
      unresolvedQuestions: [],
      relevantRequestIds: ["request-prior", "request-current"],
    },
  };
}

function fakeLedger({ actionReferences = [], toolReceipts = [] } = {}) {
  const events = [];
  const sequences = new Map([["event-current", 9]]);
  let nextSequence = 10;
  return {
    events,
    append(event) {
      const eventId = `event-${nextSequence}`;
      events.push({ ...event, eventId, eventSeq: nextSequence, occurredAtMs: nextSequence * 10 });
      sequences.set(eventId, nextSequence);
      nextSequence += 1;
      return eventId;
    },
    eventSequence(eventId) { return sequences.get(eventId) ?? null; },
    conversationBoundaryEventSeq() { return 0; },
    latestConversationState() { return null; },
    activeDeferredActionReferences() { return structuredClone(actionReferences); },
    toolReceiptList({ requestId, limit = 20 }) {
      const receipts = toolReceipts.filter((receipt) => requestId == null || receipt.requestId === requestId)
        .slice(0, limit);
      return { count: receipts.length, hasMore: false, nextBeforeEventSeq: null, receipts: structuredClone(receipts) };
    },
    recentConversation() {
      return [
        {
          eventSeq: 3, requestId: "request-prior", occurredAtUtc: "2026-08-24T13:40:00Z",
          role: "user", content: "Can you create that reminder?",
        },
        {
          eventSeq: 4, requestId: "request-prior", occurredAtUtc: "2026-08-24T13:40:01Z",
          role: "assistant", content: "I can create the reminder now. Say go ahead and I will do it.",
        },
      ];
    },
  };
}

test("a TurnBrief can skip the audit for declared read-only work and the trace says so", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registry.withCapability("todos").register({
    name: "todo_list",
    description: "List to-dos without changing them.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { return { todos: [] }; },
  });
  registry.registerContextView("todos", {
    id: "todos.active_groups",
    title: "Active to-do groups",
    description: "Existing active to-do groups and IDs.",
    maximumItems: 100,
    async execute() {
      return {
        heading: "Active to-do groups",
        text: "- [group 7] Wedding",
        data: { groups: [{ todoGroupId: 7, name: "Wedding" }] },
      };
    },
  });
  const readBrief = {
    ...brief({ auditRequired: false }),
    requestType: "informational",
    responseMode: "answer",
    objective: "List the current to-dos.",
    summary: "The user asked to read current to-dos.",
    requiredTools: ["todo_list"],
    contextRequests: ["todos.active_groups"],
    requestedActions: [],
    completionCriteria: ["Report the current to-do list."],
  };
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) {
      assert.match(payload.developerInstructions, /todos\.active_groups/);
      return completed(JSON.stringify(readBrief), 12);
    }
    assert.match(payload.developerInstructions, /\[group 7\] Wedding/);
    const response = await payload.onToolCall({
      callId: "read-todos",
      tool: "todo_list",
      arguments: { result_filter: identityResultFilter() },
    });
    assert.equal(response.ok, true);
    return completed("There are no current to-dos.", 18);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  assert.equal(await runtime.run({
    requestId: "request-read-todos", requestEventId: "event-current", text: "What are my to-dos?",
  }), "There are no current to-dos.");
  assert.equal(requests.length, 2);
  const skipped = ledger.events.find(({ type, phase, payload }) => (
    type === "agent.step" && phase === "end" && payload?.skipped
  ));
  assert.equal(skipped.name, "Audit skipped");
  assert.match(skipped.content, /declared read-only effects/);
});

test("a number-only reply continues the active briefing from selected live context", async () => {
  const requests = [];
  const ledger = fakeLedger();
  ledger.recentConversation = () => [{
    eventSeq: 7, requestId: "request-start", occurredAtUtc: "2026-09-03T03:19:31Z",
    role: "user", content: "Let's do the evening briefing.",
  }, {
    eventSeq: 8, requestId: "request-start", occurredAtUtc: "2026-09-03T03:19:50Z",
    role: "assistant", content: "What is your current weight?",
  }];
  ledger.latestConversationState = () => ({
    activeObjective: "Continue the Evening Briefing.",
    openCommitments: [], durableConstraints: [], unresolvedQuestions: [],
    relevantRequestIds: ["request-start"],
  });
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  const runId = "run-evening-briefing-1";
  registry.registerContextView("interaction-guides", {
    id: "interaction-guides.active_runs",
    title: "Active briefing runs",
    description: "Bounded current exchanges for active briefing runs.",
    maximumItems: 8,
    async execute() {
      return {
        heading: "Active briefing runs",
        text: [
          `- Briefing: Evening Briefing [interaction_guide_id=1; run_id=${runId}]`,
          "  Current exchange 1 [completion_mode=response_valid; progress_state=active]",
          "  Opening: What is your current weight?",
          "  Instructions: Record the supplied numeric value exactly without inferring a unit.",
        ].join("\n"),
        data: { runs: [{ runId, currentExchange: { stepNumber: 1 } }] },
      };
    },
  });
  let receivedArguments = null;
  registry.withCapability("interaction-guides").register({
    name: "interaction_guide_step_answer",
    description: "Record an answer in the exact active briefing exchange.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        run_id: { type: "string" }, step_number: { type: "integer" },
        answers: { type: "object" }, step_complete: { type: "boolean" },
        user_confirmed_advance: { type: "boolean" },
        completion_receipt_event_seqs: { type: "array", items: { type: "integer" } },
      },
      required: [
        "run_id", "step_number", "answers", "step_complete",
        "user_confirmed_advance", "completion_receipt_event_seqs",
      ],
    },
    async execute(argumentsObject) {
      receivedArguments = structuredClone(argumentsObject);
      return {
        recorded: true, step_complete: true, run_complete: false,
        run: { run_id: runId, current_step_number: 2 },
        current_step: { step_number: 2, opening_text: "How was your day?" },
      };
    },
  });
  const source = { text: "Record 74.8 as the current-weight answer.", sourceEventSeqs: [9] };
  const answerBrief = {
    ...brief(),
    requestType: "continuation",
    objective: "Continue the active Evening Briefing with the user's current-weight answer.",
    summary: "Record the exact number-only answer without inferring a unit.",
    requiredCapabilities: ["interaction-guides"],
    requiredTools: ["interaction_guide_step_answer"],
    contextRequests: ["interaction-guides.active_runs"],
    receiptReferences: [],
    requestedActions: [source],
    prohibitedActions: ["Do not infer a weight unit."],
    constraints: [source],
    completionCriteria: ["The active weight exchange records exactly 74.8 and advances."],
    evidence: [
      { text: "The assistant asked for current weight.", sourceEventSeqs: [8] },
      { text: "The user answered 74.8.", sourceEventSeqs: [9] },
    ],
    conversationState: {
      activeObjective: "Continue the Evening Briefing.",
      openCommitments: [], durableConstraints: [], unresolvedQuestions: [],
      relevantRequestIds: ["request-start"],
    },
  };
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) {
      assert.equal(payload.input, "74.8");
      assert.match(payload.developerInstructions, /What is your current weight\?/);
      assert.match(payload.developerInstructions, /interaction-guides\.active_runs/);
      return completed(JSON.stringify(answerBrief), 20);
    }
    if (index === 1) {
      assert.match(payload.developerInstructions, new RegExp(runId));
      const answer = await payload.onToolCall({
        callId: "answer-weight",
        tool: "interaction_guide_step_answer",
        arguments: {
          run_id: runId,
          step_number: 1,
          answers: { current_weight: 74.8 },
          step_complete: true,
          user_confirmed_advance: false,
          completion_receipt_event_seqs: [],
        },
      });
      assert.equal(answer.ok, true);
      return completed("Recorded 74.8. How was your day?", 25);
    }
    return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "complete",
      summary: "The current-weight answer was recorded and the briefing advanced.",
      satisfiedCriteria: ["The active weight exchange records exactly 74.8 and advances."],
      remainingActions: [],
      repairInstructions: [],
    }), 10);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  assert.equal(await runtime.run({
    requestId: "request-weight", requestEventId: "event-current", text: "74.8",
  }), "Recorded 74.8. How was your day?");
  assert.deepEqual(receivedArguments, {
    run_id: runId,
    step_number: 1,
    answers: { current_weight: 74.8 },
    step_complete: true,
    user_confirmed_advance: false,
    completion_receipt_event_seqs: [],
  });
  assert.equal(requests.length, 3);
  assert.equal(ledger.events.some(({ type, name }) => (
    type === "tool.call" && name === "tool_receipt_list"
  )), false);
});

test("a receipt-gated briefing answer finalizes tool selection from active-run context", async () => {
  const requests = [];
  const ledger = fakeLedger();
  ledger.recentConversation = () => [{
    eventSeq: 8, requestId: "request-briefing", occurredAtUtc: "2026-09-03T03:41:45Z",
    role: "assistant",
    content: "Please provide your Abs reps, Leg reps, Pull-ups reps, Push-ups reps, and Stretching minutes.",
  }];
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  const runId = "run-evening-exercise-1";
  registry.registerContextView("interaction-guides", {
    id: "interaction-guides.active_runs",
    title: "Active briefing runs",
    description: "Bounded current exchanges for active briefing runs.",
    maximumItems: 8,
    async execute() {
      return {
        heading: "Active briefing runs",
        text: [
          `- Briefing: Evening Briefing [run_id=${runId}]`,
          "  Current exchange 3 [progress_state=active]",
          "  Opening: Please provide your exercise values.",
          "  Contract: five exact log_add operations with tool_receipt completion.",
        ].join("\n"),
        data: {
          runs: [{
            runId,
            currentExchange: {
              stepNumber: 3,
              contract: {
                instructions: "Call `log_add` once for each supplied value.",
                completion: { mode: "tool_receipt" },
                operations: [],
              },
              contractSummary: {
                completionMode: "tool_receipt",
                operationTools: [],
                recoveryReadTools: [],
                legacyInstructionTools: ["log_add"],
              },
            },
          }],
        },
      };
    },
  });
  const logged = [];
  registry.withCapability("logs").register({
    name: "log_add",
    description: "Record one exercise log entry.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        tracker: { type: "string" }, number_value: { type: "number" }, unit: { type: "string" },
      },
      required: ["tracker", "number_value", "unit"],
    },
    async execute(argumentsObject) {
      logged.push(structuredClone(argumentsObject));
      return { created: true, entry: argumentsObject };
    },
  });
  let completionReceiptEventSeqs = [];
  registry.withCapability("interaction-guides").register({
    name: "interaction_guide_step_answer",
    description: "Record an answer and advance a receipt-gated briefing exchange.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        run_id: { type: "string" }, step_number: { type: "integer" },
        answers: { type: "object" }, step_complete: { type: "boolean" },
        user_confirmed_advance: { type: "boolean" },
        completion_receipt_event_seqs: { type: "array", items: { type: "integer" } },
      },
      required: [
        "run_id", "step_number", "answers", "step_complete",
        "user_confirmed_advance", "completion_receipt_event_seqs",
      ],
    },
    async execute(argumentsObject) {
      completionReceiptEventSeqs = argumentsObject.completion_receipt_event_seqs;
      return {
        recorded: true, step_complete: true, run_complete: false,
        run: { run_id: runId, current_step_number: 4 },
        current_step: { step_number: 4, opening_text: "How was your sleep?" },
      };
    },
  });
  const source = {
    text: "Record all five exercise values and continue the briefing.", sourceEventSeqs: [9],
  };
  const initialBrief = {
    ...brief(),
    requestType: "continuation",
    objective: "Record the supplied exercise values and continue the Evening Briefing.",
    summary: "The user answered the current exercise exchange.",
    requiredCapabilities: ["interaction-guides"],
    requiredTools: ["interaction_guide_step_answer"],
    contextRequests: ["interaction-guides.active_runs"],
    requestedActions: [source],
    completionCriteria: ["Five exercise log entries are created and the briefing advances."],
    evidence: [source],
  };
  const refinedBrief = {
    ...initialBrief,
    requiredCapabilities: ["interaction-guides", "logs"],
    requiredTools: ["interaction_guide_step_answer", "log_add"],
  };
  const values = [
    ["Abs", 100, "reps"],
    ["Leg reps", 50, "reps"],
    ["Pull-ups", 30, "reps"],
    ["Push-ups", 20, "reps"],
    ["Stretching", 10, "minutes"],
  ];
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(initialBrief), 20);
    if (index === 1) {
      assert.match(payload.developerInstructions, /Finalize orientation from selected read-only context/);
      assert.match(payload.developerInstructions, /"legacyInstructionTools": \[\s*"log_add"/);
      assert.equal(payload.outputSchema.properties.contextRequests.minItems, 1);
      assert.deepEqual(
        payload.outputSchema.properties.contextRequests.items.enum,
        ["interaction-guides.active_runs"],
      );
      return completed(JSON.stringify(refinedBrief), 20);
    }
    if (index === 2) {
      assert.deepEqual(
        new Set(payload.tools.map(({ name }) => name)),
        new Set(["interaction_guide_step_answer", "log_add"]),
      );
      for (const [tracker, numberValue, unit] of values) {
        const result = await payload.onToolCall({
          callId: `log-${tracker}`,
          tool: "log_add",
          arguments: { tracker, number_value: numberValue, unit },
        });
        assert.equal(result.ok, true);
      }
      const receiptEventSeqs = ledger.events.filter(({ type, name }) => (
        type === "tool.result" && name === "log_add"
      )).map(({ eventSeq }) => eventSeq);
      const answer = await payload.onToolCall({
        callId: "advance-exercise-exchange",
        tool: "interaction_guide_step_answer",
        arguments: {
          run_id: runId,
          step_number: 3,
          answers: {
            abs_reps: 100, leg_reps: 50, pull_ups_reps: 30,
            push_ups_reps: 20, stretching_minutes: 10,
          },
          step_complete: true,
          user_confirmed_advance: false,
          completion_receipt_event_seqs: receiptEventSeqs,
        },
      });
      assert.equal(answer.ok, true);
      return completed("Recorded all five exercise entries. How was your sleep?", 30);
    }
    return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "complete",
      summary: "All exercise logs were created and the briefing advanced.",
      satisfiedCriteria: refinedBrief.completionCriteria,
      remainingActions: [],
      repairInstructions: [],
    }), 10);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: { ...workflowConfig(), maxToolCalls: 8 },
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  assert.equal(await runtime.run({
    requestId: "request-exercise", requestEventId: "event-current",
    text: "100 abs, 50 leg reps, 30 pull-up reps, 20 push-up reps, 10 minutes of stretching",
  }), "Recorded all five exercise entries. How was your sleep?");
  assert.equal(requests.length, 4);
  assert.equal(logged.length, 5);
  assert.equal(completionReceiptEventSeqs.length, 5);
  assert.deepEqual(
    ledger.events.find(({ type }) => type === "turn.brief").payload.brief.requiredCapabilities,
    ["interaction-guides", "logs"],
  );
});

test("structured execution starts with orientation-selected tools and expands exactly within the accepted capability", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  let listCalls = 0;
  let verifyCalls = 0;
  registry.register({
    name: "remote_accounting_list_transactions",
    description: "List the current owner-scoped accounting transactions.",
    source: "mcp:accounting",
    annotations: { readOnlyHint: true },
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { listCalls += 1; return { transactionCount: 13 }; },
  });
  registry.register({
    name: "remote_accounting_verify_ledger",
    description: "Verify current accounting ledger invariants after inspecting transactions.",
    source: "mcp:accounting",
    annotations: { readOnlyHint: true },
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { verifyCalls += 1; return { valid: true }; },
  });
  const accountingBrief = {
    ...brief({ auditRequired: false }),
    requestType: "informational",
    responseMode: "answer",
    objective: "Count the accounting transactions and verify the ledger.",
    summary: "Inspect the transaction count and verify the ledger.",
    requiredCapabilities: ["integration:accounting"],
    requiredTools: ["remote_accounting_list_transactions"],
    requestedActions: [],
    completionCriteria: ["Report the transaction count and current ledger verification."],
  };
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) {
      assert.match(payload.developerInstructions, /remote_accounting_verify_ledger/);
      assert.doesNotMatch(payload.developerInstructions, /"inputSchema"/);
      return completed(JSON.stringify(accountingBrief), 20);
    }
    if (index === 1) {
      assert.deepEqual(payload.tools.map(({ name }) => name), [
        "remote_accounting_list_transactions",
        "request_tools",
      ]);
      const listed = await payload.onToolCall({
        callId: "list-transactions",
        tool: "remote_accounting_list_transactions",
        arguments: { result_filter: identityResultFilter() },
      });
      assert.equal(listed.ok, true);
      const expansion = await payload.onToolCall({
        callId: "request-ledger-verification",
        tool: "request_tools",
        arguments: { tools: ["remote_accounting_verify_ledger"] },
      });
      assert.equal(expansion.ok, true);
      return completed("Continuing with ledger verification.", 30);
    }
    assert.deepEqual(payload.tools.map(({ name }) => name), [
      "remote_accounting_list_transactions",
      "remote_accounting_verify_ledger",
    ]);
    assert.match(payload.developerInstructions, /Earlier execution evidence from this same user request/);
    assert.match(payload.developerInstructions, /"transactionCount":13/);
    const verified = await payload.onToolCall({
      callId: "verify-ledger",
      tool: "remote_accounting_verify_ledger",
      arguments: { result_filter: identityResultFilter() },
    });
    assert.equal(verified.ok, true);
    return completed("There are 13 transactions and the ledger is valid.", 30);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  assert.equal(await runtime.run({
    requestId: "request-accounting-verify",
    requestEventId: "event-current",
    text: "How many accounting transactions are there, and is the ledger valid?",
  }), "There are 13 transactions and the ledger is valid.");
  assert.equal(requests.length, 3);
  assert.equal(listCalls, 1);
  assert.equal(verifyCalls, 1);
  const expansions = ledger.events.filter(({ type }) => type === "tools.expansion.requested");
  assert.deepEqual(expansions[0].payload.tools, ["remote_accounting_verify_ledger"]);
  assert.equal(
    ledger.events.some(({ type, name }) => type === "agent.step" && name === "Audit skipped"),
    true,
  );
});

test("a generated repeatable exchange exposes only its authorized exchange-add tool", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  const calls = [];
  const register = (name, description) => registry.withCapability("interaction-guides").register({
    name,
    description,
    annotations: { readOnlyHint: name === "interaction_guide_get" },
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() {
      calls.push(name);
      return { created: true, guide: { interaction_guide_id: 9, version: 5 } };
    },
  });
  register("interaction_guide_get", "Fetch the exact Exchange Inbox briefing.");
  register("interaction_guide_step_add", "Append one exchange to a briefing.");
  register("interaction_guide_create", "Create a new briefing.");
  const source = { text: "Make the source exchange repeatable.", sourceEventSeqs: [9] };
  const exchangeBrief = {
    ...brief({ auditRequired: false }),
    requestType: "new_objective",
    responseMode: "act",
    objective: "Append one repeatable exchange to Exchange Inbox.",
    summary: "Create only one exchange in the generic inbox briefing.",
    requiredCapabilities: ["interaction-guides"],
    requiredTools: ["interaction_guide_step_add"],
    requestedActions: [source],
    completionCriteria: ["A successful interaction_guide_step_add receipt exists."],
    evidence: [source],
  };
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) {
      assert.match(payload.developerInstructions, /interaction_guide_step_add/);
      assert.doesNotMatch(payload.developerInstructions, /interaction_guide_get/);
      assert.doesNotMatch(payload.developerInstructions, /interaction_guide_create/);
      return completed(JSON.stringify(exchangeBrief), 20);
    }
    if (index === 1) {
      assert.deepEqual(payload.tools.map(({ name }) => name), ["interaction_guide_step_add"]);
      const added = await payload.onToolCall({
        callId: "add-exchange",
        tool: "interaction_guide_step_add",
        arguments: {},
      });
      assert.equal(added.ok, true);
      return completed("Created exchange in Exchange Inbox.", 30);
    }
    return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "complete",
      summary: "The exchange was created by the authorized tool.",
      satisfiedCriteria: ["A successful interaction_guide_step_add receipt exists."],
      remainingActions: [],
      repairInstructions: [],
    }), 10);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  assert.equal(await runtime.run({
    requestId: "request-repeatable-exchange",
    requestEventId: "event-current",
    text: "Create one exchange in Exchange Inbox.",
    allowedToolNames: ["interaction_guide_step_add"],
  }), "Created exchange in Exchange Inbox.");
  assert.deepEqual(calls, ["interaction_guide_step_add"]);
  assert.equal(requests.length, 3);
});

test("a same-execution provider confirmation reference cannot be consumed by tool selection or repair", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  let commits = 0;
  registry.register({
    name: "remote_accounting_preview_delete_transactions",
    upstreamName: "preview_delete_transactions",
    description: "Preview an exact transaction deletion and request user confirmation.",
    source: "mcp:accounting",
    annotations: { readOnlyHint: false, destructiveHint: false },
    parameters: {
      type: "object", additionalProperties: false,
      properties: { scope: { type: "string", const: "all" } }, required: ["scope"],
    },
    async execute() {
      return {
        contractVersion: 1,
        status: "ready",
        expiresAt: "2099-01-01T00:00:00.000Z",
        summary: { transactionCount: 13 },
        nextAction: {
          type: "request_user_confirmation",
          instruction: "Ask the user to confirm deletion of exactly 13 transactions.",
          onApproval: {
            tool: "commit_delete_transactions",
            arguments: { deletion_plan_id: "plan-13", preview_digest: `sha256:${"a".repeat(64)}` },
          },
        },
      };
    },
  });
  registry.register({
    name: "remote_accounting_commit_delete_transactions",
    upstreamName: "commit_delete_transactions",
    description: "Commit only an exact preview explicitly approved by the user.",
    source: "mcp:accounting",
    annotations: { readOnlyHint: false, destructiveHint: true },
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        deletion_plan_id: { type: "string" },
        preview_digest: { type: "string" },
      },
      required: ["deletion_plan_id", "preview_digest"],
    },
    async execute() { commits += 1; return { status: "committed" }; },
  });
  const source = { text: "Preview deletion and show me the exact confirmation.", sourceEventSeqs: [9] };
  const previewBrief = {
    ...brief({ auditRequired: false }),
    requestType: "new_objective",
    responseMode: "clarify",
    objective: "Preview deletion of all current accounting transactions and request confirmation.",
    summary: "Create the exact provider preview without committing it.",
    requiredCapabilities: ["integration:accounting"],
    requiredTools: [
      "remote_accounting_preview_delete_transactions",
      "remote_accounting_commit_delete_transactions",
    ],
    requestedActions: [source],
    prohibitedActions: ["Commit the deletion before the user approves the exact preview."],
    completionCriteria: ["The exact preview is reported and its commit remains unexecuted."],
    evidence: [source],
  };
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(previewBrief), 20);
    if (index === 1) {
      const preview = await payload.onToolCall({
        callId: "preview-delete",
        tool: "remote_accounting_preview_delete_transactions",
        arguments: { scope: "all" },
      });
      assert.equal(preview.ok, true);
      const forbiddenCommit = await payload.onToolCall({
        callId: "same-execution-commit",
        tool: "remote_accounting_commit_delete_transactions",
        arguments: preview.result.nextAction.onApproval.arguments,
      });
      assert.equal(forbiddenCommit.ok, false);
      assert.match(forbiddenCommit.error, /waiting for the user's confirmation/);
      return completed("The preview contains 13 transactions. Please confirm that exact deletion.", 30);
    }
    assert.match(payload.developerInstructions, /remote_accounting_commit_delete_transactions/);
    return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "repair_needed",
      summary: "The requested deletion has not executed.",
      satisfiedCriteria: ["The exact 13-transaction preview is available for confirmation."],
      remainingActions: ["Execute the deletion."],
      repairInstructions: ["Retry the commit."],
    }), 10);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  assert.equal(await runtime.run({
    requestId: "request-delete-preview",
    requestEventId: "event-current",
    text: "Preview deleting all transactions and show me what I need to confirm.",
  }), "The preview contains 13 transactions. Please confirm that exact deletion.");
  assert.equal(commits, 0);
  assert.equal(requests.length, 3);
});

function contextBuilder() {
  return {
    async build(_requestId, _requestText, options) {
      const prepared = options.preparedCapabilityContext ?? [];
      const developerInstructions = [
        "BOUNDED APPLICATION CONTEXT",
        ...prepared.map(({ heading, text }) => `# ${heading}\n${text}`),
      ].join("\n\n");
      return {
        text: developerInstructions,
        developerInstructions,
        requestAttachmentInput: null,
        profileFacts: [],
        activeProfileFactCount: 0,
        relevantProfileTypes: [],
        relevantProfileQuestions: [],
        history: [],
        contextBudget: { truncated: false },
        attachment: options.attachment ?? null,
      };
    },
  };
}

function workflowConfig() {
  return {
    model: "test-model",
    reasoningEffort: "xhigh",
    orientationReasoningEffort: "medium",
    auditReasoningEffort: "low",
    repairReasoningEffort: "high",
    turnWorkflowEnabled: true,
    maxToolCalls: 4,
    systemPromptPath: "unused",
  };
}

function transport(runTurn, requests) {
  return {
    id: "test-transport",
    displayName: "Test model",
    describeRequest(payload) {
      return {
        transport: this.id,
        model: payload.model,
        reasoningEffort: payload.effort,
        conversationId: payload.conversationId,
        developerInstructions: payload.developerInstructions,
        input: payload.input,
        callableTools: structuredClone(payload.tools),
        structuredOutput: payload.outputSchema ?? null,
      };
    },
    async runTurn(payload) {
      requests.push(payload);
      return runTurn(payload, requests.length - 1);
    },
  };
}

test("an invalid weekday/date TurnBrief is repaired before a mutation becomes callable", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  let executions = 0;
  registry.withCapability("todos").register({
    name: "todo_update",
    description: "Update an exact to-do schedule.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { scheduled_at_utc: { type: "string" } },
      required: ["scheduled_at_utc"],
    },
    async execute({ scheduled_at_utc }, toolContext) {
      executions += 1;
      assert.equal(toolContext.temporalResolutions[0].localDate, "2026-09-06");
      return { updated_count: 1, scheduled_at_utc };
    },
  });
  const invalid = {
    ...brief(),
    objective: "Schedule the Watch Jobs for Sunday, 2026-08-31.",
    summary: "Schedule the Watch Jobs on Sunday afternoon.",
    requiredTools: ["todo_update"],
    temporalResolutions: [{
      sourceText: "Sunday afternoon",
      sourceEventSeqs: [9],
      weekday: "Sunday",
      localDate: "2026-08-31",
      timeZone: "America/New_York",
      role: "target",
      appliesTo: "scheduled_at",
    }],
    requestedActions: [{ text: "Schedule the Watch Jobs Sunday afternoon.", sourceEventSeqs: [9] }],
    completionCriteria: ["A successful todo_update receipt schedules the tasks on Sunday."],
  };
  const corrected = structuredClone(invalid);
  corrected.objective = "Schedule the Watch Jobs for Sunday, 2026-09-06.";
  corrected.temporalResolutions[0].localDate = "2026-09-06";

  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(invalid), 20);
    if (index === 1) {
      assert.equal(executions, 0);
      assert.match(payload.developerInstructions, /Deterministic temporal validation rejected/);
      assert.match(payload.developerInstructions, /2026-08-31 is Monday, not Sunday/);
      return completed(JSON.stringify(corrected), 20);
    }
    if (index === 2) {
      assert.equal(executions, 0);
      assert.deepEqual(payload.tools.map(({ name }) => name), ["todo_update"]);
      assert.match(payload.developerInstructions, /2026-09-06/);
      const result = await payload.onToolCall({
        callId: "schedule-sunday",
        tool: "todo_update",
        arguments: { scheduled_at_utc: "2026-09-06T20:00:00.000Z" },
      });
      assert.equal(result.ok, true);
      return completed("Scheduled the Watch Jobs for Sunday.", 30);
    }
    assert.equal(executions, 1);
    return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "complete",
      summary: "The Sunday schedule update completed.",
      satisfiedCriteria: ["The successful receipt uses September 6."],
      remainingActions: [],
      repairInstructions: [],
    }), 10);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  assert.equal(await runtime.run({
    requestId: "request-sunday",
    requestEventId: "event-current",
    text: "Schedule all Watch Jobs Sunday afternoon.",
  }), "Scheduled the Watch Jobs for Sunday.");
  assert.equal(executions, 1);
  assert.equal(requests.length, 4);
  assert.deepEqual(
    ledger.events.filter(({ type }) => type === "turn.brief.validation").map(({ status }) => status),
    ["error", "complete"],
  );
  assert.equal(
    ledger.events.find(({ type }) => type === "turn.brief").payload.brief.temporalResolutions[0].localDate,
    "2026-09-06",
  );
});

test("a TurnBrief tool outside its selected capability is repaired before execution", async () => {
  const requests = [];
  const executions = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registry.withCapability("database").register({
    name: "tool_receipt_read",
    description: "Read one exact durable tool receipt.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { receiptEventSeq: { type: "integer" } },
      required: ["receiptEventSeq"],
    },
    async execute({ receiptEventSeq }) {
      executions.push({ tool: "tool_receipt_read", receiptEventSeq });
      return {
        moves: [{
          personal_task_id: 322,
          previous_scheduled_at_utc: "2026-09-02T11:00:00.000Z",
        }],
      };
    },
  });
  registry.withCapability("todos").register({
    name: "todo_update",
    description: "Update identified to-dos atomically.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { personal_task_id: { type: "integer" }, scheduled_at_utc: { type: "string" } },
      required: ["personal_task_id", "scheduled_at_utc"],
    },
    async execute(argumentsObject) {
      executions.push({ tool: "todo_update", ...argumentsObject });
      return { updated_count: 1, task: argumentsObject };
    },
  });
  const invalid = {
    ...brief(),
    requestType: "correction",
    objective: "Restore to-do #322 to its exact schedule before the prior batch move.",
    summary: "Restore only #322 to its prior schedule.",
    requiredCapabilities: ["todos"],
    requiredTools: ["tool_receipt_read", "todo_update"],
    requestedActions: [{ text: "Move #322 back to where it was.", sourceEventSeqs: [9] }],
    completionCriteria: ["The prior receipt is read and #322 is restored by todo_update."],
  };
  const corrected = structuredClone(invalid);
  corrected.requiredCapabilities = ["database", "todos"];

  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(invalid), 20);
    if (index === 1) {
      assert.deepEqual(executions, []);
      assert.match(payload.developerInstructions, /Deterministic capability validation rejected/);
      assert.match(payload.developerInstructions, /tool_receipt_read belongs to capability database/);
      return completed(JSON.stringify(corrected), 20);
    }
    if (index === 2) {
      assert.deepEqual(payload.tools.map(({ name }) => name), ["tool_receipt_read", "todo_update"]);
      const receipt = await payload.onToolCall({
        callId: "read-prior-move",
        tool: "tool_receipt_read",
        arguments: { receiptEventSeq: 19686, result_filter: identityResultFilter() },
      });
      assert.equal(receipt.ok, true);
      const update = await payload.onToolCall({
        callId: "restore-task",
        tool: "todo_update",
        arguments: {
          personal_task_id: 322,
          scheduled_at_utc: receipt.result.moves[0].previous_scheduled_at_utc,
        },
      });
      assert.equal(update.ok, true);
      return completed("Restored #322 to its prior schedule.", 30);
    }
    assert.deepEqual(executions, [
      { tool: "tool_receipt_read", receiptEventSeq: 19686 },
      {
        tool: "todo_update",
        personal_task_id: 322,
        scheduled_at_utc: "2026-09-02T11:00:00.000Z",
      },
    ]);
    return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "complete",
      summary: "The exact prior schedule was restored.",
      satisfiedCriteria: ["The receipt was read and the task was updated."],
      remainingActions: [],
      repairInstructions: [],
    }), 10);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  assert.equal(await runtime.run({
    requestId: "request-restore-task",
    requestEventId: "event-current",
    text: "Move #322 back to where it was.",
  }), "Restored #322 to its prior schedule.");
  assert.equal(requests.length, 4);
  assert.deepEqual(
    ledger.events.filter(({ type }) => type === "turn.brief.validation").map(({ status }) => status),
    ["error", "complete"],
  );
  assert.deepEqual(
    ledger.events.find(({ type }) => type === "turn.brief").payload.brief.requiredCapabilities,
    ["database", "todos"],
  );
});

function todoRegistry(executions) {
  const registry = new ToolRegistry();
  registry.register({
    name: "todo_create",
    description: "Create a todo.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { title: { type: "string" } },
      required: ["title"],
    },
    async execute(argumentsObject) {
      executions.push(argumentsObject);
      return { todoId: 42, ...argumentsObject };
    },
  });
  return registry;
}

test("orientation resolves a short approval, execution acts from the TurnBrief, and audit verifies the receipt", async () => {
  const requests = [];
  const executions = [];
  const ledger = fakeLedger();
  const registry = todoRegistry(executions);
  registry.withCapability("files").register({
    name: "file_read",
    description: "Read an unrelated file.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { file_id: { type: "integer" } }, required: ["file_id"],
    },
    async execute() { return { content: "unrelated" }; },
  });
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(brief()), 20);
    if (index === 1) {
      assert.deepEqual(
        payload.tools.map(({ name }) => name),
        ["todo_create"],
      );
      const result = await payload.onToolCall({
        callId: "todo-call", tool: "todo_create", arguments: { title: "Offered reminder" },
      });
      assert.equal(result.ok, true);
      return completed("Created the reminder.", 50);
    }
    return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "complete",
      summary: "The receipt proves the reminder was created.",
      satisfiedCriteria: ["A successful todo_create receipt exists."],
      remainingActions: [],
      repairInstructions: [],
    }), 10);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  const result = await runtime.run({
    requestId: "request-current",
    requestEventId: "event-current",
    text: "okay go ahead and do that.",
  });

  assert.equal(result, "Created the reminder.");
  assert.deepEqual(executions, [{ title: "Offered reminder" }]);
  assert.deepEqual(requests.map(({ effort }) => effort), ["medium", "xhigh", "low"]);
  assert.deepEqual(
    requests.map(({ tools }) => tools.map(({ name }) => name)),
    [[], ["todo_create"], []],
  );
  assert.ok(requests[0].outputSchema);
  assert.equal(requests[0].input, "okay go ahead and do that.");
  assert.match(requests[0].developerInstructions, /I can create the reminder now/);
  assert.match(requests[0].developerInstructions, /Connected capability families/);
  assert.match(requests[1].developerInstructions, /Accepted TurnBrief/);
  assert.match(requests[2].developerInstructions, /todo_create/);
  assert.match(requests[2].developerInstructions, /Complete callable-tool snapshot from execution/);
  assert.equal(ledger.events.some(({ type }) => type === "turn.brief"), true);
  assert.equal(ledger.events.some(({ type }) => type === "conversation.state"), true);
  const orientationStart = ledger.events.findIndex(({ type, phase, payload }) => (
    type === "agent.step" && phase === "start" && payload?.workflowStep === "orientation"
  ));
  const orientationFilter = ledger.events.findIndex(({ type, name }) => (
    type === "search.filter" && name === "Orient request context filter"
  ));
  assert.equal(orientationStart < orientationFilter, true);
  assert.deepEqual(
    ledger.events.filter(({ type, phase }) => type === "agent.step" && phase === "start")
      .map(({ payload }) => payload.workflowStep),
    ["orientation", "context_preparation", "execution", "audit"],
  );
  const operationIds = ledger.events
    .filter(({ type }) => type === "model.request")
    .map(({ operationId }) => operationId);
  assert.equal(new Set(operationIds).size, operationIds.length);
});

test("structured execution cannot fish in unrelated capabilities when an MCP operation is absent", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registry.withCapability("database-write").register({
    name: "database_write",
    description: "Write only explicitly allowlisted native content tables.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { throw new Error("database_write must not be called"); },
  });
  registry.register({
    name: "remote_accounting_list_transactions",
    description: "List owner-scoped accounting transactions; this tool does not delete them.",
    source: "mcp:accounting",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { return { transactions: [] }; },
  });
  const accountingBrief = {
    ...brief(),
    objective: "Delete the 13 confirmed accounting transactions.",
    summary: "The user confirmed deletion of the reviewed accounting transactions.",
    requiredCapabilities: ["integration:accounting"],
    requiredTools: ["remote_accounting_list_transactions"],
    completionCriteria: ["A successful accounting transaction-deletion receipt exists."],
  };
  const blockedResponse = "No supported accounting transaction-deletion operation is callable.";
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(accountingBrief), 20);
    if (index === 1) {
      assert.deepEqual(
        payload.tools.map(({ name }) => name),
        ["remote_accounting_list_transactions"],
      );
      return completed(blockedResponse, 30);
    }
    assert.match(payload.developerInstructions, /Complete callable-tool snapshot from execution/);
    assert.match(payload.developerInstructions, /remote_accounting_list_transactions/);
    assert.doesNotMatch(payload.developerInstructions, /database_write/);
    return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "blocked",
      summary: "The complete callable accounting tool snapshot contains no transaction-deletion operation.",
      satisfiedCriteria: [],
      remainingActions: ["Delete the confirmed transactions when the accounting MCP publishes that workflow."],
      repairInstructions: [],
    }), 10);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  assert.equal(await runtime.run({
    requestId: "request-accounting-delete",
    requestEventId: "event-current",
    text: "Delete all 13 transactions.",
  }), blockedResponse);
  assert.equal(requests.length, 3);
  assert.equal(ledger.events.some(({ type }) => type === "tools.expansion.requested"), false);
});

test("a failed completion audit adds a bounded repair call without repeating successful writes", async () => {
  const requests = [];
  const executions = [];
  const ledger = fakeLedger();
  const registry = todoRegistry(executions);
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(brief()), 20);
    if (index === 1) {
      const result = await payload.onToolCall({
        callId: "todo-call", tool: "todo_create", arguments: { title: "Offered reminder" },
      });
      assert.equal(result.ok, true);
      return completed("I think that should be done.", 50);
    }
    if (index === 2) return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "repair_needed",
      summary: "The write succeeded, but the response does not clearly report the result.",
      satisfiedCriteria: ["A successful todo_create receipt exists."],
      remainingActions: ["Report the created reminder clearly."],
      repairInstructions: ["Do not call todo_create again; use the existing receipt."],
    }), 10);
    assert.equal(payload.maxToolCalls, 0);
    assert.match(payload.developerInstructions, /Earlier execution evidence from this same user request/);
    assert.match(payload.developerInstructions, /"todoId":42/);
    assert.doesNotMatch(payload.developerInstructions, /I think that should be done\./);
    assert.match(payload.developerInstructions, /satisfiedCriteria and successful receipts/);
    assert.match(payload.developerInstructions, /one coherent final response/);
    assert.match(payload.developerInstructions, /completed during this same user request/);
    return completed("Created “Offered reminder” as todo 42.", 30);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  const result = await runtime.run({
    requestId: "request-current",
    requestEventId: "event-current",
    text: "okay go ahead and do that.",
    runLimits: { maxToolCalls: 1, timeoutMs: 60_000 },
  });

  assert.equal(result, "Created “Offered reminder” as todo 42.");
  assert.deepEqual(executions, [{ title: "Offered reminder" }]);
  assert.deepEqual(requests.map(({ effort }) => effort), ["medium", "xhigh", "low", "high"]);
  assert.deepEqual(
    ledger.events.filter(({ type, phase }) => type === "agent.step" && phase === "start")
      .map(({ payload }) => payload.workflowStep),
    ["orientation", "context_preparation", "execution", "audit", "repair"],
  );
});

test("a successful repair reports work from execution and repair in one cumulative response", async () => {
  const requests = [];
  const executions = [];
  const ledger = fakeLedger();
  const registry = todoRegistry(executions);
  const source = { text: "Create the Alpha and Beta reminders.", sourceEventSeqs: [9] };
  const twoReminderBrief = {
    ...brief(),
    requestType: "new_objective",
    objective: "Create the Alpha and Beta reminders.",
    summary: "Create two reminders.",
    requestedActions: [
      { text: "Create the Alpha reminder.", sourceEventSeqs: [9] },
      { text: "Create the Beta reminder.", sourceEventSeqs: [9] },
    ],
    completionCriteria: [
      "A successful todo_create receipt exists for Alpha.",
      "A successful todo_create receipt exists for Beta.",
    ],
    evidence: [source],
  };
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(twoReminderBrief), 20);
    if (index === 1) {
      const result = await payload.onToolCall({
        callId: "create-alpha", tool: "todo_create", arguments: { title: "Alpha" },
      });
      assert.equal(result.ok, true);
      return completed("Created the Alpha reminder, but I could not create Beta.", 50);
    }
    if (index === 2) return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "repair_needed",
      summary: "Alpha was created, but Beta remains to be created.",
      satisfiedCriteria: ["A successful todo_create receipt exists for Alpha."],
      remainingActions: ["Create the Beta reminder."],
      repairInstructions: ["Create Beta without repeating the successful Alpha write."],
    }), 10);
    assert.doesNotMatch(payload.developerInstructions, /Created the Alpha reminder, but I could not create Beta\./);
    assert.match(payload.developerInstructions, /A successful todo_create receipt exists for Alpha\./);
    assert.match(payload.developerInstructions, /satisfiedCriteria and successful receipts/);
    assert.match(payload.developerInstructions, /one coherent final response/);
    assert.match(payload.developerInstructions, /without narrating internal execution, audit, failure, retry, or repair history/);
    const result = await payload.onToolCall({
      callId: "create-beta", tool: "todo_create", arguments: { title: "Beta" },
    });
    assert.equal(result.ok, true);
    return completed("Created both reminders: Alpha and Beta.", 30);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  const result = await runtime.run({
    requestId: "request-two-reminders",
    requestEventId: "event-current",
    text: "Create the Alpha and Beta reminders.",
  });

  assert.equal(result, "Created both reminders: Alpha and Beta.");
  assert.deepEqual(executions, [{ title: "Alpha" }, { title: "Beta" }]);
  assert.equal(requests.length, 4);
});

test("a historical receipt cannot masquerade as a new dry run and repair preserves the real plan", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  let dryRuns = 0;
  registry.register({
    name: "tool_receipt_read",
    description: "Read an old receipt.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { receiptEventSeq: { type: "integer" } }, required: ["receiptEventSeq"],
    },
    async execute() { return { chunk: '{"dryRun":true,"plannedCount":273}' }; },
  });
  registry.register({
    name: "remote_accounting_import_account_tree",
    description: "Dry-run an account-tree import and create a durable commit plan.",
    source: "mcp:accounting",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        accounts: { type: "array", items: { type: "object", additionalProperties: true } },
        dry_run: { type: "boolean" },
      },
      required: ["accounts", "dry_run"],
    },
    async execute() {
      dryRuns += 1;
      return {
        dryRun: true,
        readyToCommit: true,
        importPlanId: "plan-current-273",
        expiresAt: "2099-01-01T00:00:00.000Z",
        previewDigest: "sha256:273",
        summary: { accountsCreated: 273, currenciesCreated: 5 },
      };
    },
  });
  const dryRunBrief = {
    ...brief({ auditRequired: false }),
    requestType: "new_objective",
    objective: "Perform a new dry run of the account-tree import.",
    summary: "Dry-run the current account tree.",
    requiredCapabilities: ["database", "integration:accounting"],
    requiredTools: ["tool_receipt_read", "remote_accounting_import_account_tree"],
    requestedActions: [{ text: "Dry-run the current import.", sourceEventSeqs: [9] }],
    completionCriteria: ["A successful direct dry-run receipt exists."],
  };
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(dryRunBrief), 20);
    if (index === 1) {
      const historical = await payload.onToolCall({
        callId: "historical", tool: "tool_receipt_read",
        arguments: { receiptEventSeq: 42, result_filter: identityResultFilter() },
      });
      assert.equal(historical.ok, true);
      return completed("Dry run completed: 273 accounts.", 50);
    }
    if (index === 2) {
      return completed(JSON.stringify({
        contractVersion: 1,
        outcome: "repair_needed",
        summary: "A historical receipt does not prove this requested operation ran.",
        satisfiedCriteria: [],
        remainingActions: ["Run the provider's current preview operation."],
        repairInstructions: ["Call the current MCP operation instead of reading another receipt."],
      }), 10);
    }
    assert.match(payload.developerInstructions, /Call the current MCP operation/);
    const direct = await payload.onToolCall({
      callId: "direct-dry-run",
      tool: "remote_accounting_import_account_tree",
      arguments: { accounts: [{ full_name: "Assets" }], dry_run: true },
    });
    assert.equal(direct.ok, true);
    assert.equal(direct.result.importPlanId, "plan-current-273");
    return completed("New dry run completed and its exact commit plan was preserved.", 40);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: { ...workflowConfig(), maxToolCalls: 4 },
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  const result = await runtime.run({
    requestId: "request-dry-run",
    requestEventId: "event-current",
    text: "Run a new dry run of the account tree.",
  });

  assert.equal(result, "New dry run completed and its exact commit plan was preserved.");
  assert.equal(dryRuns, 1);
  assert.equal(ledger.events.some(({ type }) => type.startsWith("action.artifact")), false);
  const directReceipt = ledger.events.find(({ type, name }) => (
    type === "tool.result" && name === "remote_accounting_import_account_tree"
  ));
  assert.equal(directReceipt.payload.result.importPlanId, "plan-current-273");
});

test("provider-guided missing inputs survive repair instead of being replaced by a domain guard", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registry.register({
    name: "tool_receipt_read",
    description: "Read historical evidence without executing the provider operation.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { receiptEventSeq: { type: "integer" } }, required: ["receiptEventSeq"],
    },
    async execute() { return { chunk: '{"historicalPreview":true}' }; },
  });
  registry.register({
    name: "remote_accounting_provider_preview",
    description: "Run the current provider preview after all provider-required unit scales are supplied.",
    source: "mcp:accounting",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { unit_scales: { type: "object", additionalProperties: { type: "integer" } } },
      required: ["unit_scales"],
    },
    async execute() { return { status: "ready" }; },
  });
  const providerBrief = {
    ...brief(),
    requestType: "new_objective",
    objective: "Run the provider's current validation preview.",
    summary: "Validate the current provider input.",
    requiredCapabilities: ["database", "integration:accounting"],
    requiredTools: ["tool_receipt_read", "remote_accounting_provider_preview"],
    completionCriteria: ["Report the current provider result or its exact missing inputs."],
  };
  const missingInputResponse = "I need the five unit scales required by the provider before I can run its current preview.";
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(providerBrief), 20);
    if (index === 1) {
      await payload.onToolCall({
        callId: "historical", tool: "tool_receipt_read", arguments: { receiptEventSeq: 42 },
      });
      return completed("The provider preview passed.", 50);
    }
    if (index === 2) return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "repair_needed",
      summary: "Historical evidence did not execute the current provider operation.",
      satisfiedCriteria: [],
      remainingActions: ["Follow the provider contract for the current input."],
      repairInstructions: ["Ask for any exact provider-required inputs that are still missing."],
    }), 10);
    return completed(missingInputResponse, 30);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  const result = await runtime.run({
    requestId: "request-provider-preview",
    requestEventId: "event-current",
    text: "Run the provider's current validation preview.",
  });

  assert.equal(result, missingInputResponse);
  assert.equal(ledger.events.some(({ type }) => type === "completion.guard"), false);
});

test("a terminal tool contract failure is preserved in receipts and deterministically suppresses repair", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registry.registerCapability({
    id: "integration:accounting",
    title: "Accounting",
    summary: "Accounting MCP integration.",
    aliases: ["accounting"],
    source: "mcp:accounting",
  });
  const toolFailure = {
    contractVersion: 1,
    kind: "contract_mismatch",
    code: "MCP_ARTIFACT_REQUIRED_METHOD_NOT_SUPPORTED",
    terminalForCurrentRequest: true,
    retry: "after_provider_or_connection_change",
    serverName: "accounting",
    capabilityId: "integration:accounting",
    transportId: "transaction_import",
    contractFingerprint: "a".repeat(64),
    step: "begin",
    method: "POST",
    path: "/mcp/artifacts",
    httpStatus: 405,
  };
  registry.register({
    name: "remote_accounting_upload_transaction_import_file",
    description: "Upload the canonical transaction file through Accounting's advertised artifact transport.",
    source: "mcp:accounting",
    capabilityId: "integration:accounting",
    annotations: {
      readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true,
    },
    parameters: {
      type: "object", additionalProperties: false,
      properties: { file_id: { type: "integer" } }, required: ["file_id"],
    },
    async execute() {
      const error = new Error("accounting artifact begin returned HTTP 405");
      error.toolFailure = toolFailure;
      throw error;
    },
  });
  const source = { text: "Import the prepared transaction file.", sourceEventSeqs: [9] };
  const importBrief = {
    ...brief(),
    requestType: "new_objective",
    objective: "Import the prepared transaction file into Accounting.",
    summary: "The user requested the prepared accounting-file import.",
    requiredCapabilities: ["integration:accounting"],
    requiredTools: ["remote_accounting_upload_transaction_import_file"],
    requestedActions: [source],
    completionCriteria: ["The provider accepts the complete artifact or the exact blocker is reported."],
    evidence: [source],
  };
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(importBrief), 20);
    if (index === 1) {
      const result = await payload.onToolCall({
        callId: "upload-call",
        tool: "remote_accounting_upload_transaction_import_file",
        arguments: { file_id: 218 },
      });
      assert.equal(result.ok, false);
      assert.deepEqual(result.toolFailure, toolFailure);
      return completed("The Accounting upload could not start.", 50);
    }
    if (index === 2) {
      assert.match(payload.developerInstructions, /TERMINAL_TOOL_CONTRACT_FAILURE/);
      assert.match(payload.developerInstructions, /MCP_ARTIFACT_REQUIRED_METHOD_NOT_SUPPORTED/);
      return completed(JSON.stringify({
        contractVersion: 1,
        outcome: "repair_needed",
        summary: "The artifact still needs to be uploaded.",
        satisfiedCriteria: [],
        remainingActions: ["Retry the artifact upload."],
        repairInstructions: ["Retry the same upload operation."],
      }), 10);
    }
    throw new Error("A terminal contract mismatch must not enter repair");
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  const result = await runtime.run({
    requestId: "request-accounting-import",
    requestEventId: "event-current",
    text: "Import the prepared transaction file.",
  });

  assert.equal(requests.length, 3);
  assert.match(result, /The Accounting upload could not start/);
  assert.match(result, /POST \/mcp\/artifacts/);
  assert.match(result, /HTTP 405/);
  assert.match(result, /will not be retried until the integration is refreshed/);
  const failedReceipt = ledger.events.find(({ type, name }) => (
    type === "tool.result" && name === "remote_accounting_upload_transaction_import_file"
  ));
  assert.deepEqual(failedReceipt.payload.toolFailure, toolFailure);
  const retryGuard = ledger.events.find(({ type }) => type === "tool.retry.blocked");
  assert.equal(retryGuard.payload.findings[0].toolFailure.code, toolFailure.code);
});

test("an MCP preview cannot ask for approval without a valid durable action handoff", async () => {
  const requests = [];
  const ledger = fakeLedger();
  const registry = new ToolRegistry();
  registry.registerCapability({
    id: "integration:accounting",
    title: "Accounting",
    summary: "Accounting MCP integration.",
    aliases: ["accounting"],
    source: "mcp:accounting",
  });
  const previewResult = {
    contractVersion: 1,
    status: "success",
    job: {
      import_job_id: "2a54bf58-b967-4f9e-a54d-d4f0c8402a99",
      preview_digest: `sha256:${"c".repeat(64)}`,
      ready_to_commit: true,
      requiredAction: "REQUEST_USER_CONFIRMATION",
      nextAction: {
        onApproval: {
          tool: "commit_transaction_import_job",
          arguments: {
            import_job_id: "2a54bf58-b967-4f9e-a54d-d4f0c8402a99",
            preview_digest: `sha256:${"c".repeat(64)}`,
          },
        },
      },
    },
  };
  registry.register({
    name: "remote_accounting_preview_transaction_import_job",
    description: "Create the final provider-owned transaction import preview.",
    source: "mcp:accounting",
    upstreamName: "preview_transaction_import_job",
    capabilityId: "integration:accounting",
    annotations: {
      readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false,
    },
    parameters: {
      type: "object", additionalProperties: false,
      properties: { import_job_id: { type: "string" } }, required: ["import_job_id"],
    },
    outputSchema: { type: "object" },
    async execute() { return structuredClone(previewResult); },
  });
  registry.register({
    name: "remote_accounting_commit_transaction_import_job",
    description: "Commit one exact transaction import preview.",
    source: "mcp:accounting",
    upstreamName: "commit_transaction_import_job",
    capabilityId: "integration:accounting",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        import_job_id: { type: "string" }, preview_digest: { type: "string" },
      },
      required: ["import_job_id", "preview_digest"],
    },
    async execute() { throw new Error("The malformed preview must never become callable approval"); },
  });
  const source = { text: "Prepare the final transaction import preview.", sourceEventSeqs: [9] };
  const previewBrief = {
    ...brief(),
    requestType: "new_objective",
    objective: "Prepare the final transaction import preview.",
    summary: "Create the Accounting preview and report whether it can be approved.",
    requiredCapabilities: ["integration:accounting"],
    requiredTools: ["remote_accounting_preview_transaction_import_job"],
    requestedActions: [source],
    completionCriteria: ["A valid provider confirmation handoff is durably preserved."],
    evidence: [source],
  };
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(previewBrief), 20);
    if (index === 1) {
      const result = await payload.onToolCall({
        callId: "preview-call",
        tool: "remote_accounting_preview_transaction_import_job",
        arguments: { import_job_id: previewResult.job.import_job_id },
      });
      assert.equal(result.ok, false);
      assert.equal(result.toolFailure.code, "MCP_FINAL_CONFIRMATION_INVALID");
      assert.equal(result.toolFailure.terminalForCurrentRequest, true);
      assert.deepEqual(result.result, previewResult);
      return completed("The preview is ready; please approve it.", 50);
    }
    if (index === 2) {
      assert.match(payload.developerInstructions, /MCP_FINAL_CONFIRMATION_INVALID/);
      return completed(JSON.stringify({
        contractVersion: 1,
        outcome: "repair_needed",
        summary: "The preview result requested confirmation.",
        satisfiedCriteria: [],
        remainingActions: ["Ask the user to approve it."],
        repairInstructions: ["Present the preview for approval."],
      }), 10);
    }
    throw new Error("A malformed provider action handoff must not enter repair");
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  const result = await runtime.run({
    requestId: "request-preview",
    requestEventId: "event-current",
    text: "Prepare the final transaction import preview.",
  });

  assert.equal(requests.length, 3);
  assert.doesNotMatch(result, /please approve/i);
  assert.match(result, /did not return a usable final yes-or-no step/);
  assert.match(result, /saved the result instead of retrying/);
  const receipt = ledger.events.find(({ type, name }) => (
    type === "tool.result" && name === "remote_accounting_preview_transaction_import_job"
  ));
  assert.deepEqual(receipt.payload.result, previewResult);
  assert.equal(receipt.payload.deferredActionReference, undefined);
  assert.equal(receipt.payload.toolFailure.code, "MCP_FINAL_CONFIRMATION_INVALID");
  assert.equal(ledger.events.some(({ type }) => type === "tool.retry.blocked"), true);
});

test("a continuation recovers an opaque provider job ID from the receipt index without asking the user", async () => {
  const requests = [];
  const priorJobId = "2a54bf58-b967-4f9e-a54d-d4f0c8402a99";
  const priorReceiptEventSeq = 42;
  const ledger = fakeLedger({
    toolReceipts: [{
      receiptEventSeq: priorReceiptEventSeq,
      requestId: "request-prior",
      occurredAtUtc: "2026-08-28T02:46:50.000Z",
      tool: "remote_accounting_preview_transaction_import_job",
      status: "complete",
      ok: true,
      resultCharacters: 1200,
      argumentCharacters: 56,
      error: null,
    }],
  });
  const registry = new ToolRegistry();
  registry.registerCapability({
    id: "database", title: "Database", summary: "Read durable tool receipts.", source: "local",
  });
  registry.registerCapability({
    id: "integration:accounting", title: "Accounting", summary: "Accounting MCP integration.",
    aliases: ["accounting"], source: "mcp:accounting",
  });
  registry.register({
    name: "tool_receipt_read",
    description: "Page an exact durable tool receipt.",
    capabilityId: "database",
    annotations: { readOnlyHint: true },
    parameters: {
      type: "object", additionalProperties: false,
      properties: { receiptEventSeq: { type: "integer" } }, required: ["receiptEventSeq"],
    },
    async execute({ receiptEventSeq }) {
      assert.equal(receiptEventSeq, priorReceiptEventSeq);
      return {
        chunk: JSON.stringify({
          outcome: {
            ok: true,
            result: {
              status: "success",
              job: { import_job_id: priorJobId, preview_digest: `sha256:${"d".repeat(64)}` },
            },
          },
        }),
      };
    },
  });
  const recoveredPreview = {
    contractVersion: 1,
    status: "success",
    job: {
      import_job_id: priorJobId,
      preview_digest: `sha256:${"e".repeat(64)}`,
      ready_to_commit: true,
      requiredAction: "REQUEST_USER_CONFIRMATION",
      nextAction: {
        type: "request_user_confirmation",
        instruction: "Ask the user to approve this exact recovered preview.",
        onApproval: {
          tool: "commit_transaction_import_job",
          arguments: { import_job_id: priorJobId, preview_digest: `sha256:${"e".repeat(64)}` },
        },
      },
    },
  };
  registry.register({
    name: "remote_accounting_preview_transaction_import_job",
    description: "Regenerate the final durable preview for an existing import job.",
    source: "mcp:accounting",
    upstreamName: "preview_transaction_import_job",
    capabilityId: "integration:accounting",
    annotations: {
      readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false,
    },
    parameters: {
      type: "object", additionalProperties: false,
      properties: { import_job_id: { type: "string" } }, required: ["import_job_id"],
    },
    async execute({ import_job_id }) {
      assert.equal(import_job_id, priorJobId);
      return structuredClone(recoveredPreview);
    },
  });
  registry.register({
    name: "remote_accounting_commit_transaction_import_job",
    description: "Commit the exact approved recovered preview.",
    source: "mcp:accounting",
    upstreamName: "commit_transaction_import_job",
    capabilityId: "integration:accounting",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { import_job_id: { type: "string" }, preview_digest: { type: "string" } },
      required: ["import_job_id", "preview_digest"],
    },
    async execute() { throw new Error("Approval belongs to the next user request"); },
  });
  const source = { text: "Resume the existing Accounting import without asking me for its ID.", sourceEventSeqs: [9] };
  const recoveryBrief = {
    ...brief(),
    requestType: "continuation",
    objective: "Recover the existing import job and regenerate its final preview.",
    summary: "Use the prior provider receipt instead of asking the user for an opaque identifier.",
    requiredCapabilities: ["database", "integration:accounting"],
    requiredTools: ["tool_receipt_read", "remote_accounting_preview_transaction_import_job"],
    receiptReferences: [{
      receiptEventSeq: priorReceiptEventSeq,
      tool: "remote_accounting_preview_transaction_import_job",
      reason: "Recover the existing provider import job identifier.",
    }],
    requestedActions: [source],
    completionCriteria: ["A fresh valid provider-owned approval reference is preserved."],
    evidence: [source],
  };
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) {
      assert.match(payload.developerInstructions, /Recent durable tool receipt index/);
      assert.match(payload.developerInstructions, new RegExp(`"receiptEventSeq": ${priorReceiptEventSeq}`));
      assert.match(payload.developerInstructions, /instead of asking the user to supply an opaque ID/);
      return completed(JSON.stringify(recoveryBrief), 20);
    }
    if (index === 1) {
      assert.match(payload.developerInstructions, /"receiptEventSeq": 42/);
      assert.match(payload.developerInstructions, /"tool": "remote_accounting_preview_transaction_import_job"/);
      const receipt = await payload.onToolCall({
        callId: "read-prior-preview",
        tool: "tool_receipt_read",
        arguments: { receiptEventSeq: priorReceiptEventSeq, result_filter: identityResultFilter() },
      });
      assert.equal(receipt.ok, true);
      const preview = await payload.onToolCall({
        callId: "recover-preview",
        tool: "remote_accounting_preview_transaction_import_job",
        arguments: { import_job_id: priorJobId },
      });
      assert.equal(preview.ok, true);
      return completed("I recovered the existing job and regenerated its preview. Please approve this exact preview.", 50);
    }
    return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "complete",
      summary: "The recovered preview produced a valid provider-owned approval reference.",
      satisfiedCriteria: ["The user was not asked for an opaque identifier."],
      remainingActions: [],
      repairInstructions: [],
    }), 10);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  const result = await runtime.run({
    requestId: "request-recover-import",
    requestEventId: "event-current",
    text: "Resume the existing Accounting import without asking me for its ID.",
  });

  assert.match(result, /recovered the existing job/);
  const previewReceipt = ledger.events.find(({ type, name }) => (
    type === "tool.result" && name === "remote_accounting_preview_transaction_import_job"
  ));
  assert.equal(previewReceipt.payload.deferredActionReference.targetTool,
    "remote_accounting_commit_transaction_import_job");
  assert.deepEqual(previewReceipt.payload.deferredActionReference.arguments,
    recoveredPreview.job.nextAction.onApproval.arguments);
});

test("approval binds execution to the exact active plan and blocks request-id substitution", async () => {
  const requests = [];
  const actionReference = {
    referenceId: "prepared-change:approved",
    state: "pending",
    sourceConnection: "mcp:accounting",
    sourceTool: "remote_accounting_import_account_tree",
    sourceRequestId: "request-dry-run",
    sourceReceiptEventSeq: 42,
    targetTool: "remote_accounting_commit_account_tree_import",
    targetUpstreamTool: "commit_account_tree_import",
    arguments: { import_plan_id: "plan-exact-273" },
    readiness: { ready: true, expiresAt: "2099-01-01T00:00:00.000Z" },
  };
  const ledger = fakeLedger({ actionReferences: [actionReference] });
  const commits = [];
  const registry = new ToolRegistry();
  registry.register({
    name: "remote_accounting_commit_account_tree_import",
    description: "Commit one exact durable account-tree plan.",
    source: "mcp:accounting",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { import_plan_id: { type: "string" } }, required: ["import_plan_id"],
    },
    async execute(argumentsObject) {
      commits.push(argumentsObject);
      return { status: "committed", accountsCreated: 273, currenciesCreated: 5 };
    },
  });
  const approvalBrief = {
    ...brief({ confirmedActionReferenceIds: [actionReference.referenceId] }),
    objective: "Commit the exact approved account-tree preview.",
    summary: "The user approved the commit-ready account-tree plan.",
    requiredCapabilities: ["integration:accounting"],
    requiredTools: ["remote_accounting_commit_account_tree_import"],
    completionCriteria: ["A successful receipt for the authorized MCP action exists."],
  };
  const toolResponses = [];
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) {
      assert.match(payload.developerInstructions, /plan-exact-273/);
      return completed(JSON.stringify(approvalBrief), 20);
    }
    if (index === 1) {
      assert.match(payload.developerInstructions, /prepared-change:approved/);
      toolResponses.push(await payload.onToolCall({
        callId: "guessed",
        tool: "remote_accounting_commit_account_tree_import",
        arguments: { import_plan_id: "request-dry-run" },
      }));
      toolResponses.push(await payload.onToolCall({
        callId: "exact",
        tool: "remote_accounting_commit_account_tree_import",
        arguments: actionReference.arguments,
      }));
      return completed("Committed the exact approved plan.", 50);
    }
    return completed(JSON.stringify({
      contractVersion: 1,
      outcome: "complete",
      summary: "The exact authorized plan has a successful commit receipt.",
      satisfiedCriteria: ["The authorized plan was committed."],
      remainingActions: [],
      repairInstructions: [],
    }), 10);
  }, requests);
  const runtime = new SlayerRuntime({
    modelTransport,
    registry,
    contextBuilder: contextBuilder(),
    requestCompiler: new RequestCompiler(),
    ledger,
    config: workflowConfig(),
  });
  runtime.systemPrompt = "SYSTEM PROMPT";

  const result = await runtime.run({
    requestId: "request-approval",
    requestEventId: "event-current",
    text: "Go ahead and execute the import.",
  });

  assert.equal(result, "Committed the exact approved plan.");
  assert.equal(toolResponses[0].ok, false);
  assert.match(toolResponses[0].error, /does not match the exact prepared change/);
  assert.equal(toolResponses[1].ok, true);
  assert.deepEqual(commits, [{ import_plan_id: "plan-exact-273" }]);
  assert.equal(ledger.events.some(({ type }) => type.startsWith("action.artifact")), false);
});
