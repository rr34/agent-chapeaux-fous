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

function brief({ auditRequired = true, authorizedActionReferenceIds = [] } = {}) {
  const source = { text: "Run the previously offered action.", sourceEventSeqs: [4, 9] };
  return {
    contractVersion: 1,
    requestType: "authorization",
    responseMode: "act",
    objective: "Create the reminder that the assistant just offered to create.",
    summary: "The user authorized the concrete action offered in the prior assistant turn.",
    requiredCapabilities: ["todos"],
    authorizedActionReferenceIds,
    contextRequests: [],
    authorizedActions: [source],
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

function fakeLedger({ actionReferences = [] } = {}) {
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
    contextRequests: ["todos.active_groups"],
    authorizedActions: [],
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
    assert.match(payload.developerInstructions, /Earlier tool receipts from this same user request/);
    assert.match(payload.developerInstructions, /"todoId":42/);
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
    authorizedActions: [{ text: "Dry-run the current import.", sourceEventSeqs: [9] }],
    completionCriteria: ["A successful direct dry-run receipt exists."],
  };
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(dryRunBrief), 20);
    if (index === 1) {
      const historical = await payload.onToolCall({
        callId: "historical", tool: "tool_receipt_read", arguments: { receiptEventSeq: 42 },
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

test("approval binds execution to the exact active plan and blocks request-id substitution", async () => {
  const requests = [];
  const actionReference = {
    referenceId: "mcp-action:approved",
    action: "provider-confirmed-action",
    sourceProvider: "mcp:accounting",
    sourceTool: "remote_accounting_import_account_tree",
    sourceRequestId: "request-dry-run",
    sourceReceiptEventSeq: 42,
    targetTool: "remote_accounting_commit_account_tree_import",
    targetUpstreamTool: "commit_account_tree_import",
    arguments: { import_plan_id: "plan-exact-273" },
    providerMetadata: { ready: true, expiresAt: "2099-01-01T00:00:00.000Z" },
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
    ...brief({ authorizedActionReferenceIds: [actionReference.referenceId] }),
    objective: "Commit the exact approved account-tree preview.",
    summary: "The user approved the commit-ready account-tree plan.",
    requiredCapabilities: ["integration:accounting"],
    completionCriteria: ["A successful receipt for the authorized MCP action exists."],
  };
  const toolResponses = [];
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) {
      assert.match(payload.developerInstructions, /plan-exact-273/);
      return completed(JSON.stringify(approvalBrief), 20);
    }
    if (index === 1) {
      assert.match(payload.developerInstructions, /mcp-action:approved/);
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
  assert.match(toolResponses[0].error, /Never substitute a request ID/);
  assert.equal(toolResponses[1].ok, true);
  assert.deepEqual(commits, [{ import_plan_id: "plan-exact-273" }]);
  assert.equal(ledger.events.some(({ type }) => type.startsWith("action.artifact")), false);
});
