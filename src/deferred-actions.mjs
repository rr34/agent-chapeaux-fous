import { createHash } from "node:crypto";

const receiptInspectionTool = /(?:^|_)tool_receipt_(?:list|read)$/u;
const actionReadinessName = /^(?:readyTo(?<camel>[A-Z][A-Za-z0-9]*)|ready_to_(?<snake>[a-z0-9_]+))$/u;
const opaqueIdentifierName = /(?:PlanId|plan_id|ActionId|action_id)$/u;

function objectCandidates(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return [];
  return [
    result,
    ...Object.values(result).filter((value) => value && typeof value === "object" && !Array.isArray(value)),
  ];
}

function selectedEntry(value, namePattern) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.entries(value).find(([name]) => namePattern.test(name)) ?? null;
}

function snakeCase(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replaceAll("-", "_")
    .toLowerCase();
}

function providerCandidate(result) {
  for (const candidate of objectCandidates(result)) {
    const readiness = selectedEntry(candidate, actionReadinessName);
    const identifier = selectedEntry(candidate, opaqueIdentifierName);
    if (
      readiness?.[1] === true
      && typeof identifier?.[1] === "string"
      && identifier[1].trim()
    ) {
      const readinessMatch = readiness[0].match(actionReadinessName);
      const action = readinessMatch?.groups?.camel?.toLowerCase()
        ?? readinessMatch?.groups?.snake?.replaceAll("_", "-")
        ?? "execute";
      return { action, candidate, identifierName: identifier[0], opaqueId: identifier[1].trim() };
    }
  }
  return null;
}

export function providerActionReadiness(result) {
  for (const candidate of objectCandidates(result)) {
    const readiness = selectedEntry(candidate, actionReadinessName)?.[1];
    if (typeof readiness === "boolean") return readiness;
  }
  return null;
}

function providerExpiration(candidate) {
  const expiration = selectedEntry(candidate, /^(?:expiresAt|expires_at)$/u)?.[1];
  return typeof expiration === "string" && expiration ? expiration : null;
}

// This is a derived view over an immutable MCP receipt, not an agent-owned plan.
// The provider owns the referenced operation, payload, readiness, and lifecycle.
export function extractDeferredActionReference({
  tool,
  result,
  requestId,
  receiptEventSeq = null,
}) {
  const provider = providerCandidate(result);
  if (!provider) return null;
  const argumentName = snakeCase(provider.identifierName);
  const digest = createHash("sha256")
    .update(`${receiptEventSeq ?? "unknown"}\n${tool}\n${argumentName}\n${provider.opaqueId}`)
    .digest("hex")
    .slice(0, 24);
  return {
    referenceId: `mcp-action:${digest}`,
    action: provider.action,
    sourceTool: tool,
    sourceRequestId: requestId,
    sourceReceiptEventSeq: Number.isSafeInteger(receiptEventSeq) ? receiptEventSeq : null,
    argumentName,
    opaqueId: provider.opaqueId,
    providerMetadata: {
      ready: true,
      expiresAt: providerExpiration(provider.candidate),
    },
  };
}

function argumentValues(value, argumentNames, path = [], found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (argumentNames.has(key)) found.push({ path: childPath.join("."), name: key, value: child });
    else if (child && typeof child === "object") argumentValues(child, argumentNames, childPath, found);
  }
  return found;
}

function receiptUsesReference(receipt, reference) {
  if (!receipt?.ok || receiptInspectionTool.test(receipt.tool ?? "")) return false;
  return argumentValues(receipt.arguments, new Set([reference.argumentName]))
    .some(({ value }) => value === reference.opaqueId);
}

export function activeDeferredActionReferences(receipts, { now = Date.now() } = {}) {
  const references = receipts
    .filter((receipt) => receipt?.ok && !receiptInspectionTool.test(receipt.tool ?? ""))
    .map((receipt) => extractDeferredActionReference({
      tool: receipt.tool,
      result: receipt.result,
      requestId: receipt.requestId,
      receiptEventSeq: receipt.receiptEventSeq,
    }))
    .filter(Boolean);
  return references.filter((reference) => {
    const expiration = reference.providerMetadata.expiresAt;
    if (expiration) {
      const expiresAt = Date.parse(expiration);
      if (Number.isFinite(expiresAt) && expiresAt <= now) return false;
    }
    return !receipts.some((receipt) => (
      receipt.receiptEventSeq > reference.sourceReceiptEventSeq
      && receiptUsesReference(receipt, reference)
    ));
  });
}

export function deferredActionArgumentProblem(
  argumentsObject,
  authorizedReferences,
  activeReferences = authorizedReferences,
) {
  const knownNames = new Set(activeReferences.map(({ argumentName }) => argumentName));
  const supplied = argumentValues(argumentsObject, knownNames);
  if (supplied.length === 0) return null;
  const allowed = new Map(authorizedReferences.map((reference) => (
    [`${reference.argumentName}\n${reference.opaqueId}`, reference]
  )));
  const invalid = supplied.find(({ name, value }) => (
    typeof value !== "string" || !allowed.has(`${name}\n${value}`)
  ));
  if (!invalid) return null;
  return `Opaque MCP action argument ${invalid.path} must exactly match a provider reference authorized by the accepted TurnBrief. Never substitute a request ID, receipt ID, or guessed identifier.`;
}

export function matchingDeferredActionReferences(argumentsObject, references) {
  return references.filter((reference) => receiptUsesReference({
    tool: "direct_action",
    arguments: argumentsObject,
    ok: true,
  }, reference));
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
    || receipt.deferredActionReference?.providerMetadata?.ready === true;
}

export function completionReceiptFindings({ brief, receipts, authorizedActionReferences }) {
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
      receipt.providerActionReadiness === true
      && !receipt.deferredActionReference
    ))) {
      findings.push({
        code: "MCP_ACTION_REFERENCE_REQUIRED",
        message: "The provider reported a commit-ready result but its exact opaque action reference was not available in the direct receipt.",
        repairInstruction: "Use the provider operation that returns its exact commit identifier. Do not reconstruct, replay, or guess provider-owned state.",
      });
    }
  }
  for (const reference of authorizedActionReferences) {
    const completed = receipts.some((receipt) => receiptUsesReference(receipt, reference));
    if (!completed) {
      findings.push({
        code: "AUTHORIZED_MCP_ACTION_RECEIPT_REQUIRED",
        referenceId: reference.referenceId,
        message: `Authorized MCP action reference ${reference.referenceId} has no successful direct execution receipt in this request.`,
        repairInstruction: `Execute only reference ${reference.referenceId} using its exact opaque identifier. Do not substitute another identifier.`,
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
