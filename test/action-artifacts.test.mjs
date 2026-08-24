import assert from "node:assert/strict";
import test from "node:test";
import {
  activeCommitPlanArtifacts,
  completionReceiptFindings,
  extractCommitPlanArtifact,
  matchingPlanArtifacts,
  planArgumentProblem,
} from "../src/action-artifacts.mjs";

function commitArtifact(overrides = {}) {
  return {
    contractVersion: 1,
    artifactId: "commit-plan:one",
    kind: "commit_plan",
    status: "ready",
    sourceTool: "remote_accounting_import_account_tree",
    sourceRequestId: "request-dry-run",
    sourceReceiptEventSeq: 42,
    planId: "plan-exact-123",
    planArgumentName: "import_plan_id",
    readyToCommit: true,
    expiresAt: "2099-01-01T00:00:00.000Z",
    previewDigest: "sha256:preview",
    summary: { accountsCreated: 273 },
    ...overrides,
  };
}

test("commit-ready tool results become compact durable action artifacts", () => {
  const artifact = extractCommitPlanArtifact({
    tool: "remote_accounting_import_account_tree",
    requestId: "request-dry-run",
    receiptEventSeq: 42,
    result: {
      readyToCommit: true,
      importPlanId: "plan-exact-123",
      expiresAt: "2099-01-01T00:00:00.000Z",
      previewDigest: "sha256:preview",
      summary: { accountsCreated: 273 },
      preview: { deliberately: "not copied into the artifact" },
    },
  });

  assert.equal(artifact.kind, "commit_plan");
  assert.equal(artifact.planId, "plan-exact-123");
  assert.equal(artifact.sourceReceiptEventSeq, 42);
  assert.deepEqual(artifact.summary, { accountsCreated: 273 });
  assert.equal(Object.hasOwn(artifact, "preview"), false);
});

test("active artifacts survive unrelated events and disappear after commit or expiration", () => {
  const ready = commitArtifact();
  const events = [
    { type: "action.artifact", subjectId: ready.artifactId, payload: { artifact: ready } },
    { type: "request.received", subjectId: null, payload: {} },
  ];
  assert.deepEqual(activeCommitPlanArtifacts(events, { now: Date.parse("2026-08-24T00:00:00Z") }), [ready]);

  const committed = [...events, {
    type: "action.artifact.status",
    subjectId: ready.artifactId,
    payload: { artifactId: ready.artifactId, status: "committed" },
  }];
  assert.deepEqual(activeCommitPlanArtifacts(committed), []);

  const expired = commitArtifact({ expiresAt: "2020-01-01T00:00:00.000Z" });
  assert.deepEqual(activeCommitPlanArtifacts([
    { type: "action.artifact", subjectId: expired.artifactId, payload: { artifact: expired } },
  ]), []);
});

test("opaque plan arguments must match an artifact selected by the TurnBrief", () => {
  const artifact = commitArtifact();
  assert.equal(planArgumentProblem({ import_plan_id: artifact.planId }, [artifact]), null);
  assert.match(
    planArgumentProblem({ import_plan_id: "request-uuid-instead" }, [artifact]),
    /Never substitute a request ID/,
  );
  assert.deepEqual(matchingPlanArtifacts({ import_plan_id: artifact.planId }, [artifact]), [artifact]);
});

test("historical receipt inspection cannot satisfy a current dry-run or commit contract", () => {
  const artifact = commitArtifact();
  const dryRunBrief = {
    objective: "Perform a dry run of the import.", summary: "Dry run it.",
    authorizedActions: [], completionCriteria: ["Dry run completed."],
  };
  const historicalOnly = [{
    tool: "tool_receipt_read", arguments: { receiptEventSeq: 42 }, ok: true,
    result: { chunk: '{"dryRun":true}' },
  }];
  assert.deepEqual(
    completionReceiptFindings({ brief: dryRunBrief, receipts: historicalOnly, authorizedArtifacts: [] })
      .map(({ code }) => code),
    ["DIRECT_DRY_RUN_RECEIPT_REQUIRED"],
  );

  const commitBrief = {
    objective: "Commit it.", summary: "Approved.", authorizedActions: [], completionCriteria: [],
  };
  assert.deepEqual(
    completionReceiptFindings({ brief: commitBrief, receipts: historicalOnly, authorizedArtifacts: [artifact] })
      .map(({ code }) => code),
    ["AUTHORIZED_COMMIT_RECEIPT_REQUIRED"],
  );
});
