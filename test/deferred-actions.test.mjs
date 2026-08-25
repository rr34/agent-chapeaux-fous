import assert from "node:assert/strict";
import test from "node:test";
import {
  activeDeferredActionReferences,
  completionReceiptFindings,
  deferredActionArgumentProblem,
  extractDeferredActionReference,
  matchingDeferredActionReferences,
} from "../src/deferred-actions.mjs";

function actionReference(overrides = {}) {
  return {
    referenceId: "mcp-action:one",
    action: "provider-confirmed-action",
    sourceProvider: "mcp:accounting",
    sourceTool: "remote_accounting_import_account_tree",
    sourceRequestId: "request-dry-run",
    sourceReceiptEventSeq: 42,
    targetTool: "remote_accounting_commit_account_tree_import",
    targetUpstreamTool: "commit_account_tree_import",
    arguments: { import_plan_id: "plan-exact-123" },
    providerMetadata: {
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

  assert.equal(reference.action, "provider-confirmed-action");
  assert.equal(reference.targetTool, "remote_accounting_commit_account_tree_import");
  assert.deepEqual(reference.arguments, { import_plan_id: "plan-exact-123" });
  assert.equal(reference.sourceReceiptEventSeq, 42);
  assert.deepEqual(reference.providerMetadata, {
    ready: true,
    status: "ready",
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(Object.hasOwn(reference, "summary"), false);
  assert.equal(Object.hasOwn(reference, "previewDigest"), false);
  assert.equal(Object.hasOwn(reference, "status"), false);
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
  expired.deferredActionReference.providerMetadata.expiresAt = "2020-01-01T00:00:00.000Z";
  assert.deepEqual(activeDeferredActionReferences([expired]), []);
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
    /Never substitute a request ID/,
  );
  assert.deepEqual(
    matchingDeferredActionReferences(reference.targetTool, reference.arguments, [reference]),
    [reference],
  );
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
      authorizedActionReferences: [],
    }).map(({ code }) => code),
    [],
  );

  assert.deepEqual(
    completionReceiptFindings({
      receipts: historicalOnly,
      authorizedActionReferences: [reference],
    }).map(({ code }) => code),
    ["AUTHORIZED_MCP_ACTION_RECEIPT_REQUIRED"],
  );
});
