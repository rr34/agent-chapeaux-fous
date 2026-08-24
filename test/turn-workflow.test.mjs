import assert from "node:assert/strict";
import test from "node:test";
import { RequestCompiler } from "../src/request-compiler.mjs";
import { SlayerRuntime } from "../src/runtime.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

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

function brief({ auditRequired = true, authorizedArtifactIds = [] } = {}) {
  const source = { text: "Run the previously offered action.", sourceEventSeqs: [4, 9] };
  return {
    contractVersion: 1,
    requestType: "authorization",
    responseMode: "act",
    objective: "Create the reminder that the assistant just offered to create.",
    summary: "The user authorized the concrete action offered in the prior assistant turn.",
    requiredCapabilities: ["todos"],
    authorizedArtifactIds,
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

function fakeLedger({ actionArtifacts = [] } = {}) {
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
    activeActionArtifacts() { return structuredClone(actionArtifacts); },
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

function contextBuilder() {
  return {
    async build(_requestId, _requestText, options) {
      return {
        text: "BOUNDED APPLICATION CONTEXT",
        developerInstructions: "BOUNDED APPLICATION CONTEXT",
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
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) return completed(JSON.stringify(brief()), 20);
    if (index === 1) {
      assert.equal(payload.tools.some(({ name }) => name === "todo_create"), true);
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
  assert.deepEqual(requests.map(({ tools }) => tools.map(({ name }) => name)), [[], ["todo_create"], []]);
  assert.ok(requests[0].outputSchema);
  assert.equal(requests[0].input, "okay go ahead and do that.");
  assert.match(requests[0].developerInstructions, /I can create the reminder now/);
  assert.match(requests[0].developerInstructions, /Connected capability families/);
  assert.match(requests[1].developerInstructions, /Accepted TurnBrief/);
  assert.match(requests[2].developerInstructions, /todo_create/);
  assert.equal(ledger.events.some(({ type }) => type === "turn.brief"), true);
  assert.equal(ledger.events.some(({ type }) => type === "conversation.state"), true);
  assert.deepEqual(
    ledger.events.filter(({ type, phase }) => type === "agent.step" && phase === "start")
      .map(({ payload }) => payload.workflowStep),
    ["orientation", "execution", "audit"],
  );
  const operationIds = ledger.events
    .filter(({ type }) => type === "model.request")
    .map(({ operationId }) => operationId);
  assert.equal(new Set(operationIds).size, operationIds.length);
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
    ["orientation", "execution", "audit", "repair"],
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
      assert.match(payload.developerInstructions, /DIRECT_DRY_RUN_RECEIPT_REQUIRED/);
      return completed(JSON.stringify({
        contractVersion: 1,
        outcome: "complete",
        summary: "The historical receipt proves it.",
        satisfiedCriteria: ["Dry run completed."],
        remainingActions: [],
        repairInstructions: [],
      }), 10);
    }
    assert.match(payload.developerInstructions, /Call the actual dry-run operation/);
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
  const artifactEvent = ledger.events.find(({ type }) => type === "action.artifact");
  assert.equal(artifactEvent.payload.artifact.planId, "plan-current-273");
  assert.equal(artifactEvent.payload.artifact.sourceTool, "remote_accounting_import_account_tree");
});

test("approval binds execution to the exact active plan and blocks request-id substitution", async () => {
  const requests = [];
  const artifact = {
    contractVersion: 1,
    artifactId: "commit-plan:approved",
    kind: "commit_plan",
    status: "ready",
    sourceTool: "remote_accounting_import_account_tree",
    sourceRequestId: "request-dry-run",
    sourceReceiptEventSeq: 42,
    planId: "plan-exact-273",
    planArgumentName: "import_plan_id",
    readyToCommit: true,
    expiresAt: "2099-01-01T00:00:00.000Z",
    previewDigest: "sha256:273",
    summary: { accountsCreated: 273, currenciesCreated: 5 },
  };
  const ledger = fakeLedger({ actionArtifacts: [artifact] });
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
    ...brief({ authorizedArtifactIds: [artifact.artifactId] }),
    objective: "Commit the exact approved account-tree preview.",
    summary: "The user approved the commit-ready account-tree plan.",
    requiredCapabilities: ["integration:accounting"],
    completionCriteria: ["A successful commit receipt for the authorized artifact exists."],
  };
  const toolResponses = [];
  const modelTransport = transport(async (payload, index) => {
    if (index === 0) {
      assert.match(payload.developerInstructions, /plan-exact-273/);
      return completed(JSON.stringify(approvalBrief), 20);
    }
    if (index === 1) {
      assert.match(payload.developerInstructions, /commit-plan:approved/);
      toolResponses.push(await payload.onToolCall({
        callId: "guessed",
        tool: "remote_accounting_commit_account_tree_import",
        arguments: { import_plan_id: "request-dry-run" },
      }));
      toolResponses.push(await payload.onToolCall({
        callId: "exact",
        tool: "remote_accounting_commit_account_tree_import",
        arguments: { import_plan_id: artifact.planId },
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
  assert.equal(
    ledger.events.some(({ type, payload }) => (
      type === "action.artifact.status" && payload.status === "committed"
    )),
    true,
  );
});
