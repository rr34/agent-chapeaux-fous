import { createHash } from "node:crypto";
import { schemaProblem } from "./tools/registry.mjs";

const receiptInspectionTool = /(?:^|_)tool_receipt_(?:list|read)$/u;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function actionCandidates(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  return [
    result,
    ...Object.values(result).filter((value) => value && typeof value === "object" && !Array.isArray(value)),
  ];
}

function confirmationCandidate(result) {
  return actionCandidates(result)?.find((candidate) => (
    candidate.requiredAction === "REQUEST_USER_CONFIRMATION"
    || candidate.nextAction?.type === "request_user_confirmation"
    || candidate.nextAction?.onApproval != null
  )) ?? null;
}

function inspectActionHandoff({ toolDefinition, result, resolveProviderTool }) {
  if (!toolDefinition?.source?.startsWith("mcp:")) return { intended: false };
  const candidate = confirmationCandidate(result);
  if (!candidate) return { intended: false };
  const nextAction = candidate.nextAction;
  if (!nextAction || typeof nextAction !== "object" || Array.isArray(nextAction)) {
    return { intended: true, problem: "requiredAction=REQUEST_USER_CONFIRMATION requires a nextAction object" };
  }
  if (nextAction.type !== "request_user_confirmation") {
    return { intended: true, problem: "nextAction.type must be request_user_confirmation" };
  }
  if (typeof nextAction.instruction !== "string" || !nextAction.instruction.trim()) {
    return { intended: true, problem: "nextAction.instruction must be a nonempty string" };
  }
  const approval = nextAction.onApproval;
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) {
    return { intended: true, problem: "nextAction.onApproval must be an object" };
  }
  if (typeof approval.tool !== "string" || !approval.tool.trim()) {
    return { intended: true, problem: "nextAction.onApproval.tool must name a provider tool" };
  }
  if (!approval.arguments || typeof approval.arguments !== "object" || Array.isArray(approval.arguments)) {
    return { intended: true, problem: "nextAction.onApproval.arguments must be an object" };
  }
  const upstreamName = approval.tool.trim();
  const target = resolveProviderTool?.(upstreamName);
  if (!target || target.source !== toolDefinition.source || target.upstreamName !== upstreamName) {
    return { intended: true, problem: "nextAction.onApproval.tool must resolve to a current tool on the same MCP connection" };
  }
  const argumentsObject = structuredClone(approval.arguments);
  const problem = schemaProblem(argumentsObject, target.parameters ?? { type: "object" });
  if (problem) {
    return { intended: true, problem: `nextAction.onApproval.arguments do not match the target schema: ${problem}` };
  }
  return { intended: true, problem: null, candidate, approval, target, argumentsObject };
}

function providerExpiration(candidate) {
  const value = candidate.expiresAt ?? candidate.expires_at ?? null;
  return typeof value === "string" && value ? value : null;
}

// The provider owns the operation and plan. This reference binds only the
// provider-declared same-server invocation to a source receipt and user approval.
export function extractDeferredActionReference({
  tool,
  toolDefinition,
  result,
  requestId,
  receiptEventSeq = null,
  resolveProviderTool,
}) {
  const action = inspectActionHandoff({ toolDefinition, result, resolveProviderTool });
  if (!action.intended || action.problem) return null;
  const { target, argumentsObject } = action;
  const identity = JSON.stringify(canonical({
    source: toolDefinition.source,
    sourceTool: tool,
    targetTool: target.name,
    arguments: argumentsObject,
  }));
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  return {
    referenceId: `mcp-action:${digest}`,
    action: "provider-confirmed-action",
    sourceProvider: toolDefinition.source,
    sourceTool: tool,
    sourceUpstreamTool: toolDefinition.upstreamName ?? null,
    sourceRequestId: requestId,
    sourceReceiptEventSeq: Number.isSafeInteger(receiptEventSeq) ? receiptEventSeq : null,
    targetTool: target.name,
    targetUpstreamTool: target.upstreamName,
    arguments: argumentsObject,
    providerMetadata: {
      ready: true,
      status: typeof action.candidate.status === "string" ? action.candidate.status : null,
      expiresAt: providerExpiration(action.candidate),
    },
  };
}

export function deferredActionContractProblem({ toolDefinition, result, resolveProviderTool }) {
  const action = inspectActionHandoff({ toolDefinition, result, resolveProviderTool });
  return action.intended ? action.problem : null;
}

function receiptUsesReference(receipt, reference) {
  return Boolean(
    receipt?.ok
    && !receiptInspectionTool.test(receipt.tool ?? "")
    && receipt.tool === reference.targetTool
    && sameValue(receipt.arguments ?? {}, reference.arguments ?? {}),
  );
}

export function activeDeferredActionReferences(receipts, { now = Date.now() } = {}) {
  const references = receipts.flatMap((receipt) => {
    if (!receipt?.ok || receiptInspectionTool.test(receipt.tool ?? "")) return [];
    const stored = receipt.deferredActionReference;
    if (!stored) return [];
    return [{
      ...stored,
      sourceReceiptEventSeq: Number.isSafeInteger(stored.sourceReceiptEventSeq)
        ? stored.sourceReceiptEventSeq
        : receipt.receiptEventSeq,
    }];
  });
  const latestById = new Map();
  for (const reference of references) latestById.set(reference.referenceId, reference);
  return [...latestById.values()].filter((reference) => {
    const expiration = reference.providerMetadata?.expiresAt;
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
  toolName,
  argumentsObject,
  authorizedReferences,
  activeReferences = authorizedReferences,
) {
  const relevant = activeReferences.filter(({ targetTool }) => targetTool === toolName);
  if (relevant.length === 0) return null;
  const authorized = authorizedReferences.some((reference) => (
    reference.targetTool === toolName && sameValue(argumentsObject, reference.arguments)
  ));
  if (authorized) return null;
  return `Provider action ${toolName} must exactly match an active provider invocation authorized by the accepted TurnBrief. Never substitute a request ID, receipt ID, plan ID, arguments, or target tool.`;
}

export function matchingDeferredActionReferences(toolName, argumentsObject, references) {
  return references.filter((reference) => receiptUsesReference({
    tool: toolName,
    arguments: argumentsObject,
    ok: true,
  }, reference));
}

export function completionReceiptFindings({ receipts, authorizedActionReferences }) {
  const findings = [];
  for (const reference of authorizedActionReferences) {
    const completed = receipts.some((receipt) => receiptUsesReference(receipt, reference));
    if (!completed) {
      findings.push({
        code: "AUTHORIZED_MCP_ACTION_RECEIPT_REQUIRED",
        referenceId: reference.referenceId,
        message: `Authorized MCP action reference ${reference.referenceId} has no successful receipt for its exact provider-declared tool and arguments in this request.`,
        repairInstruction: `Execute only reference ${reference.referenceId} using its exact target tool and complete arguments. Do not substitute another identifier, tool, or argument object.`,
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
