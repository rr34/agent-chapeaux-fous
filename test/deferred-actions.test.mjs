import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDeferredActionReferences,
  completionReceiptFindings,
  deferredActionContractProblem,
  deferredActionArgumentProblem,
  extractDeferredActionReference,
  matchingDeferredActionReferences,
  pendingConfirmationFindings,
  pendingConfirmationResponse,
} from "../src/deferred-actions.mjs";

function actionReference(overrides = {}) {
  return {
    referenceId: "prepared-change:one",
    state: "pending",
    sourceConnection: "mcp:accounting",
    sourceTool: "remote_accounting_import_account_tree",
    sourceRequestId: "request-dry-run",
    sourceReceiptEventSeq: 42,
    targetTool: "remote_accounting_commit_account_tree_import",
    targetUpstreamTool: "commit_account_tree_import",
    arguments: { import_plan_id: "plan-exact-123" },
    readiness: {
      ready: true,
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

test("an explicit same-provider next action produces an exact invocation reference", () => {
  const reference = extractDeferredActionReference({
    tool: "remote_accounting_import_account_tree",
    toolDefinition: {
      source: "mcp:accounting",
      upstreamName: "import_account_tree",
    },
    requestId: "request-dry-run",
    receiptEventSeq: 42,
    result: {
      contractVersion: 1,
      status: "ready",
      expiresAt: "2099-01-01T00:00:00.000Z",
      previewDigest: "sha256:preview",
      summary: { accountsCreated: 273 },
      preview: { deliberately: "provider-owned" },
      nextAction: {
        type: "request_user_confirmation",
        instruction: "Present the preview and ask the user to approve it.",
        onApproval: {
          tool: "commit_account_tree_import",
          arguments: { import_plan_id: "plan-exact-123" },
        },
      },
    },
    resolveProviderTool(upstreamName) {
      return {
        name: "remote_accounting_commit_account_tree_import",
        upstreamName,
        source: "mcp:accounting",
        parameters: {
          type: "object", additionalProperties: false,
          properties: { import_plan_id: { type: "string" } }, required: ["import_plan_id"],
        },
      };
    },
  });

  assert.equal(reference.state, "pending");
  assert.equal(reference.sourceConnection, "mcp:accounting");
  assert.equal(reference.targetTool, "remote_accounting_commit_account_tree_import");
  assert.deepEqual(reference.arguments, { import_plan_id: "plan-exact-123" });
  assert.equal(reference.sourceReceiptEventSeq, 42);
  assert.deepEqual(reference.readiness, {
    ready: true,
    status: "ready",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(Object.hasOwn(reference, "summary"), false);
  assert.equal(Object.hasOwn(reference, "previewDigest"), false);
  assert.equal(Object.hasOwn(reference, "status"), false);
});

test("a provider confirmation request with an incomplete handoff is a deterministic contract problem", () => {
  const input = {
    toolDefinition: { source: "mcp:accounting", upstreamName: "preview_transaction_import_job" },
    result: {
      contractVersion: 1,
      status: "success",
      job: {
        requiredAction: "REQUEST_USER_CONFIRMATION",
        nextAction: {
          onApproval: {
            tool: "commit_transaction_import_job",
            arguments: { import_job_id: "job-1", preview_digest: `sha256:${"a".repeat(64)}` },
          },
        },
      },
    },
    resolveProviderTool() {
      throw new Error("A handoff without its required type must fail before target resolution");
    },
  };

  assert.equal(
    deferredActionContractProblem(input),
    "nextAction.type must be request_user_confirmation",
  );
  assert.equal(extractDeferredActionReference({
    ...input,
    tool: "remote_accounting_preview_transaction_import_job",
    requestId: "request-preview",
  }), null);
});

test("stored provider references survive unrelated turns and disappear after exact execution or expiration", () => {
  const reference = actionReference();
  const sourceReceipt = {
    receiptEventSeq: 42,
    requestId: "request-dry-run",
    tool: "remote_accounting_import_account_tree",
    arguments: { dry_run: true },
    ok: true,
    result: { status: "ready" },
    deferredActionReference: reference,
  };
  const unrelatedReceipt = {
    receiptEventSeq: 43,
    requestId: "request-between",
    tool: "remote_calendar_list_events",
    arguments: {},
    ok: true,
    result: { events: [] },
  };
  const active = activeDeferredActionReferences([sourceReceipt, unrelatedReceipt], {
    now: Date.parse("2026-08-24T00:00:00Z"),
  });
  assert.equal(active.length, 1);
  assert.deepEqual(active[0].arguments, { import_plan_id: "plan-exact-123" });

  const executed = [sourceReceipt, unrelatedReceipt, {
    receiptEventSeq: 45,
    requestId: "request-approval",
    tool: "remote_accounting_commit_account_tree_import",
    arguments: { import_plan_id: "plan-exact-123" },
    ok: true,
    result: { status: "committed" },
  }];
  assert.deepEqual(activeDeferredActionReferences(executed), []);

  const expired = structuredClone(sourceReceipt);
  expired.deferredActionReference.readiness.expiresAt = "2020-01-01T00:00:00.000Z";
  assert.deepEqual(activeDeferredActionReferences([expired]), []);
});

test("older saved action references are presented as pending prepared changes", () => {
  const legacy = actionReference({
    referenceId: "mcp-action:legacy",
    sourceConnection: undefined,
    readiness: undefined,
    action: "provider-confirmed-action",
    sourceProvider: "mcp:accounting",
    providerMetadata: { ready: true, status: "ready", expiresAt: null },
  });
  const [normalized] = activeDeferredActionReferences([{
    receiptEventSeq: 50,
    requestId: "request-legacy",
    tool: legacy.sourceTool,
    arguments: {},
    ok: true,
    deferredActionReference: legacy,
  }]);
  assert.equal(normalized.referenceId, "prepared-change:legacy");
  assert.equal(normalized.state, "pending");
  assert.equal(normalized.sourceConnection, "mcp:accounting");
  assert.deepEqual(normalized.readiness, { ready: true, status: "ready", expiresAt: null });
  assert.equal(Object.hasOwn(normalized, "sourceProvider"), false);
  assert.equal(Object.hasOwn(normalized, "providerMetadata"), false);
});

test("opaque MCP arguments must match a provider reference selected by the TurnBrief", () => {
  const reference = actionReference();
  assert.equal(
    deferredActionArgumentProblem(
      reference.targetTool,
      reference.arguments,
      [reference],
      [reference],
    ),
    null,
  );
  assert.match(
    deferredActionArgumentProblem(
      reference.targetTool,
      { import_plan_id: "request-uuid-instead" },
      [reference],
      [reference],
    ),
    /does not match the exact prepared change/,
  );
  assert.deepEqual(
    matchingDeferredActionReferences(reference.targetTool, reference.arguments, [reference]),
    [reference],
  );
});

test("new provider confirmations suppress jargon and ask the user for a simple decision", () => {
  const reference = actionReference();
  assert.deepEqual(
    pendingConfirmationFindings([{
      tool: reference.sourceTool,
      ok: true,
      deferredActionReference: reference,
    }], []),
    [{
      code: "USER_CONFIRMATION_REQUIRED",
      referenceId: reference.referenceId,
      targetTool: reference.targetTool,
      message: "The requested change is prepared and is waiting for the user's yes-or-no confirmation.",
      repairInstruction: "Do not run or retry the prepared write in this request. Describe the concrete preview in plain language and ask the user to confirm it.",
    }],
  );

  const response = pendingConfirmationResponse([
    "It was blocked because there is no active provider authorization.",
    "",
    "- 7,987 transactions are prepared",
    "- 23 exceptions will remain unchanged",
    "",
    "The remaining blocker is activation of the provider's commit authorization.",
  ].join("\n"));
  assert.doesNotMatch(response, /authorization/iu);
  assert.match(response, /7,987 transactions/);
  assert.match(response, /answer yes or no/);

  const alreadyPlain = "The preview contains 13 transactions. Please confirm that exact deletion.";
  assert.equal(pendingConfirmationResponse(alreadyPlain), alreadyPlain);
});

test("receipt findings enforce only explicitly authorized MCP action references", () => {
  const reference = actionReference();
  const historicalOnly = [{
    tool: "tool_receipt_read", arguments: { receiptEventSeq: 42 }, ok: true,
    result: { chunk: '{"dryRun":true}' },
  }];
  assert.deepEqual(
    completionReceiptFindings({
      receipts: historicalOnly,
      confirmedActionReferences: [],
    }).map(({ code }) => code),
    [],
  );

  assert.deepEqual(
    completionReceiptFindings({
      receipts: historicalOnly,
      confirmedActionReferences: [reference],
    }).map(({ code }) => code),
    ["CONFIRMED_CHANGE_RECEIPT_REQUIRED"],
  );
});
