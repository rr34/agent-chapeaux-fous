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
    action: "commit",
    sourceTool: "remote_accounting_import_account_tree",
    sourceRequestId: "request-dry-run",
    sourceReceiptEventSeq: 42,
    argumentName: "import_plan_id",
    opaqueId: "plan-exact-123",
    providerMetadata: {
      ready: true,
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

test("commit-ready MCP results produce only a derived opaque action reference", () => {
  const reference = extractDeferredActionReference({
    tool: "remote_accounting_import_account_tree",
    requestId: "request-dry-run",
    receiptEventSeq: 42,
    result: {
      readyToCommit: true,
      importPlanId: "plan-exact-123",
      expiresAt: "2099-01-01T00:00:00.000Z",
      previewDigest: "sha256:preview",
      summary: { accountsCreated: 273 },
      preview: { deliberately: "provider-owned" },
    },
  });

  assert.equal(reference.action, "commit");
  assert.equal(reference.opaqueId, "plan-exact-123");
  assert.equal(reference.argumentName, "import_plan_id");
  assert.equal(reference.sourceReceiptEventSeq, 42);
  assert.deepEqual(reference.providerMetadata, {
    ready: true,
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(Object.hasOwn(reference, "summary"), false);
  assert.equal(Object.hasOwn(reference, "previewDigest"), false);
  assert.equal(Object.hasOwn(reference, "status"), false);
});

test("active references are derived from receipts and disappear after execution or provider expiration", () => {
  const sourceReceipt = {
    receiptEventSeq: 42,
    requestId: "request-dry-run",
    tool: "remote_accounting_import_account_tree",
    arguments: { dry_run: true },
    ok: true,
    result: {
      readyToCommit: true,
      importPlanId: "plan-exact-123",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
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
  assert.equal(active[0].opaqueId, "plan-exact-123");

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
  expired.result.expiresAt = "2020-01-01T00:00:00.000Z";
  assert.deepEqual(activeDeferredActionReferences([expired]), []);
});

test("opaque MCP arguments must match a provider reference selected by the TurnBrief", () => {
  const reference = actionReference();
  assert.equal(
    deferredActionArgumentProblem(
      { import_plan_id: reference.opaqueId },
      [reference],
      [reference],
    ),
    null,
  );
  assert.match(
    deferredActionArgumentProblem(
      { import_plan_id: "request-uuid-instead" },
      [reference],
      [reference],
    ),
    /Never substitute a request ID/,
  );
  assert.deepEqual(
    matchingDeferredActionReferences({ import_plan_id: reference.opaqueId }, [reference]),
    [reference],
  );
});

test("historical receipt inspection cannot satisfy a current dry-run or deferred-action contract", () => {
  const reference = actionReference();
  const dryRunBrief = {
    objective: "Perform a dry run.", summary: "Dry run it.",
    authorizedActions: [], completionCriteria: ["Dry run completed."],
  };
  const historicalOnly = [{
    tool: "tool_receipt_read", arguments: { receiptEventSeq: 42 }, ok: true,
    result: { chunk: '{"dryRun":true}' },
  }];
  assert.deepEqual(
    completionReceiptFindings({
      brief: dryRunBrief,
      receipts: historicalOnly,
      authorizedActionReferences: [],
    }).map(({ code }) => code),
    ["DIRECT_DRY_RUN_RECEIPT_REQUIRED"],
  );

  const commitBrief = {
    objective: "Execute it.", summary: "Approved.", authorizedActions: [], completionCriteria: [],
  };
  assert.deepEqual(
    completionReceiptFindings({
      brief: commitBrief,
      receipts: historicalOnly,
      authorizedActionReferences: [reference],
    }).map(({ code }) => code),
    ["AUTHORIZED_MCP_ACTION_RECEIPT_REQUIRED"],
  );
});
