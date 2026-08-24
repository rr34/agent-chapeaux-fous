import { createHash } from "node:crypto";

const receiptInspectionTool = /(?:^|_)tool_receipt_(?:list|read)$/u;
const planArgumentName = /^(?:import_?plan_?id|plan_?id)$/iu;

function selectedValue(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const name of names) {
    if (Object.hasOwn(value, name)) return value[name];
  }
  return undefined;
}

function planCandidate(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const candidates = [result, result.plan, result.importPlan, result.import_plan];
  return candidates.find((candidate) => (
    candidate && typeof candidate === "object" && !Array.isArray(candidate)
    && selectedValue(candidate, ["readyToCommit", "ready_to_commit"]) === true
    && typeof selectedValue(candidate, ["importPlanId", "import_plan_id", "planId", "plan_id"]) === "string"
    && selectedValue(candidate, ["importPlanId", "import_plan_id", "planId", "plan_id"]).trim()
  )) ?? null;
}

export function commitReadiness(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  for (const candidate of [result, result.plan, result.importPlan, result.import_plan]) {
    const value = selectedValue(candidate, ["readyToCommit", "ready_to_commit"]);
    if (typeof value === "boolean") return value;
  }
  return null;
}

function boundedSummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const serialized = JSON.stringify(value);
  return serialized.length <= 8_000 ? value : null;
}

export function extractCommitPlanArtifact({
  tool,
  result,
  requestId,
  receiptEventSeq = null,
}) {
  const candidate = planCandidate(result);
  if (!candidate) return null;
  const planId = selectedValue(candidate, ["importPlanId", "import_plan_id", "planId", "plan_id"]).trim();
  const digest = createHash("sha256")
    .update(`${requestId}\n${tool}\n${planId}`)
    .digest("hex")
    .slice(0, 24);
  const expiresAt = selectedValue(candidate, ["expiresAt", "expires_at"]);
  const previewDigest = selectedValue(candidate, ["previewDigest", "preview_digest"]);
  return {
    contractVersion: 1,
    artifactId: `commit-plan:${digest}`,
    kind: "commit_plan",
    status: "ready",
    sourceTool: tool,
    sourceRequestId: requestId,
    sourceReceiptEventSeq: Number.isSafeInteger(receiptEventSeq) ? receiptEventSeq : null,
    planId,
    planArgumentName: "import_plan_id",
    readyToCommit: true,
    expiresAt: typeof expiresAt === "string" && expiresAt ? expiresAt : null,
    previewDigest: typeof previewDigest === "string" && previewDigest ? previewDigest : null,
    summary: boundedSummary(selectedValue(result, ["summary"]) ?? selectedValue(candidate, ["summary"])),
  };
}

export function activeCommitPlanArtifacts(events, { now = Date.now() } = {}) {
  const byId = new Map();
  for (const event of events) {
    const artifactId = event.subjectId ?? event.payload?.artifact?.artifactId ?? event.payload?.artifactId;
    if (!artifactId) continue;
    if (event.type === "action.artifact" && event.payload?.artifact) {
      byId.set(artifactId, event.payload.artifact);
    } else if (event.type === "action.artifact.status" && byId.has(artifactId)) {
      byId.set(artifactId, { ...byId.get(artifactId), status: event.payload?.status ?? "invalidated" });
    }
  }
  return [...byId.values()].filter((artifact) => {
    if (artifact.kind !== "commit_plan" || artifact.status !== "ready") return false;
    if (!artifact.expiresAt) return true;
    const expiresAt = Date.parse(artifact.expiresAt);
    return !Number.isFinite(expiresAt) || expiresAt > now;
  });
}

function planArguments(value, path = [], found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (planArgumentName.test(key)) found.push({ path: childPath.join("."), value: child });
    else if (child && typeof child === "object") planArguments(child, childPath, found);
  }
  return found;
}

export function planArgumentProblem(argumentsObject, authorizedArtifacts) {
  const supplied = planArguments(argumentsObject);
  if (supplied.length === 0) return null;
  const allowed = new Set(authorizedArtifacts.map(({ planId }) => planId));
  const invalid = supplied.find(({ value }) => typeof value !== "string" || !allowed.has(value));
  if (!invalid) return null;
  return `Opaque plan argument ${invalid.path} must exactly match a commit-plan artifact authorized by the accepted TurnBrief. Never substitute a request ID, receipt ID, or guessed identifier.`;
}

export function matchingPlanArtifacts(argumentsObject, artifacts) {
  const supplied = new Set(planArguments(argumentsObject).map(({ value }) => value));
  return artifacts.filter(({ planId }) => supplied.has(planId));
}

function briefText(brief) {
  return JSON.stringify([
    brief.objective,
    brief.summary,
    brief.authorizedActions,
    brief.completionCriteria,
  ]);
}

function directDryRunReceipt(receipt) {
  if (!receipt?.ok || receiptInspectionTool.test(receipt.tool ?? "")) return false;
  return receipt.arguments?.dry_run === true
    || receipt.arguments?.dryRun === true
    || receipt.result?.dryRun === true
    || receipt.result?.dry_run === true
    || receipt.actionArtifact?.readyToCommit === true;
}

export function completionReceiptFindings({ brief, receipts, authorizedArtifacts }) {
  const findings = [];
  if (/\bdry[ -]?run\b/iu.test(briefText(brief))) {
    const directReceipts = receipts.filter(directDryRunReceipt);
    if (directReceipts.length === 0) {
      findings.push({
        code: "DIRECT_DRY_RUN_RECEIPT_REQUIRED",
        message: "The requested dry run has no successful direct dry-run tool receipt from this request. Historical receipt-list or receipt-read calls do not execute a new dry run.",
        repairInstruction: "Call the actual dry-run operation with the complete current input. Do not report the dry run as completed from historical receipts.",
      });
    } else if (directReceipts.some((receipt) => (
      /import/iu.test(receipt.tool ?? "")
      && receipt.commitReadiness === null
      && !receipt.actionArtifact
    ))) {
      findings.push({
        code: "IMPORT_DRY_RUN_READINESS_REQUIRED",
        message: "The import dry-run receipt does not state whether its preview is ready to commit and contains no preserved commit-plan artifact.",
        repairInstruction: "Run the current import dry-run contract that returns readyToCommit and, when true, an exact importPlanId. Do not invite approval without that result.",
      });
    }
  }
  for (const artifact of authorizedArtifacts) {
    const committed = receipts.some((receipt) => (
      receipt?.ok
      && !receiptInspectionTool.test(receipt.tool ?? "")
      && planArguments(receipt.arguments).some(({ value }) => value === artifact.planId)
    ));
    if (!committed) {
      findings.push({
        code: "AUTHORIZED_COMMIT_RECEIPT_REQUIRED",
        artifactId: artifact.artifactId,
        message: `Authorized commit artifact ${artifact.artifactId} has no successful direct commit receipt in this request.`,
        repairInstruction: `Commit only artifact ${artifact.artifactId} using its exact planId. Do not substitute another identifier.`,
      });
    }
  }
  return findings;
}

export function incompleteReceiptResponse(findings) {
  return [
    "I could not verify that the requested operation completed, so I did not treat it as completed.",
    "",
    ...findings.map(({ message }) => `- ${message}`),
  ].join("\n");
}
