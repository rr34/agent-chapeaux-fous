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
    return { intended: true, problem: "nextAction.onApproval.tool must name an MCP tool" };
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

function mcpExpiration(candidate) {
  const value = candidate.expiresAt ?? candidate.expires_at ?? null;
  return typeof value === "string" && value ? value : null;
}

// This binds the MCP's exact final call to its source receipt and the user's
// one yes-or-no confirmation.
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
    referenceId: `prepared-change:${digest}`,
    state: "pending",
    sourceConnection: toolDefinition.source,
    sourceTool: tool,
    sourceUpstreamTool: toolDefinition.upstreamName ?? null,
    sourceRequestId: requestId,
    sourceReceiptEventSeq: Number.isSafeInteger(receiptEventSeq) ? receiptEventSeq : null,
    targetTool: target.name,
    targetUpstreamTool: target.upstreamName,
    arguments: argumentsObject,
    readiness: {
      ready: true,
      status: typeof action.candidate.status === "string" ? action.candidate.status : null,
      expiresAt: mcpExpiration(action.candidate),
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
    const normalized = {
      ...stored,
      referenceId: String(stored.referenceId).replace(/^mcp-action:/u, "prepared-change:"),
      state: "pending",
      sourceConnection: stored.sourceConnection ?? stored.sourceProvider,
      readiness: stored.readiness ?? stored.providerMetadata ?? {},
      sourceReceiptEventSeq: Number.isSafeInteger(stored.sourceReceiptEventSeq)
        ? stored.sourceReceiptEventSeq
        : receipt.receiptEventSeq,
    };
    delete normalized.action;
    delete normalized.sourceProvider;
    delete normalized.providerMetadata;
    return [normalized];
  });
  const latestById = new Map();
  for (const reference of references) latestById.set(reference.referenceId, reference);
  return [...latestById.values()].filter((reference) => {
    const expiration = reference.readiness?.expiresAt;
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
  confirmedReferences,
  activeReferences = confirmedReferences,
) {
  const relevant = activeReferences.filter(({ targetTool }) => targetTool === toolName);
  if (relevant.length === 0) return null;
  const confirmedForTool = confirmedReferences.filter(({ targetTool }) => targetTool === toolName);
  const confirmed = confirmedForTool.some((reference) => (
    reference.targetTool === toolName && sameValue(argumentsObject, reference.arguments)
  ));
  if (confirmed) return null;
  if (confirmedForTool.length > 0) {
    return "This call does not match the exact prepared change the user confirmed. Do not retry with guessed or substituted identifiers or arguments; use only the exact saved invocation.";
  }
  return "This prepared write is waiting for the user's confirmation and cannot run in the same request that prepared it. Do not retry it now. Tell the user what the preview contains and ask for a simple yes or no. Never mention internal references, TurnBriefs, or invocation details.";
}

export function pendingConfirmationFindings(receipts, confirmedReferences = []) {
  const confirmedIds = new Set(confirmedReferences.map(({ referenceId }) => referenceId));
  const seen = new Set();
  return receipts.flatMap((receipt) => {
    const reference = receipt?.ok ? receipt.deferredActionReference : null;
    if (!reference?.referenceId
      || confirmedIds.has(reference.referenceId)
      || seen.has(reference.referenceId)) return [];
    seen.add(reference.referenceId);
    return [{
      code: "USER_CONFIRMATION_REQUIRED",
      referenceId: reference.referenceId,
      targetTool: reference.targetTool,
      message: "The requested change is prepared and is waiting for the user's yes-or-no confirmation.",
      repairInstruction: "Do not run or retry the prepared write in this request. Describe the concrete preview in plain language and ask the user to confirm it.",
    }];
  });
}

const internalConfirmationJargon = /(?:\bauthorization\b|accepted\s+TurnBrief|provider\s+invocation|MCP\s+action\s+reference|active\s+provider)/iu;

export function pendingConfirmationResponse(proposedResponse) {
  const proposed = String(proposedResponse ?? "").trim();
  if (proposed
    && !internalConfirmationJargon.test(proposed)
    && /\b(?:confirm|confirmation|yes\s+or\s+no|should\s+I|proceed)\b/iu.test(proposed)) {
    return proposed;
  }
  const paragraphs = proposed
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !internalConfirmationJargon.test(paragraph));
  const concreteResponse = paragraphs.join("\n\n");
  const question = "Please confirm whether I should carry out the exact prepared change. You only need to answer yes or no; you do not need to provide an ID or anything technical.";
  return concreteResponse ? `${concreteResponse}\n\n${question}` : [
    "The requested change is prepared, but it has not run yet.",
    "",
    question,
  ].join("\n");
}

export function matchingDeferredActionReferences(toolName, argumentsObject, references) {
  return references.filter((reference) => receiptUsesReference({
    tool: toolName,
    arguments: argumentsObject,
    ok: true,
  }, reference));
}

export function completionReceiptFindings({ receipts, confirmedActionReferences }) {
  const findings = [];
  for (const reference of confirmedActionReferences) {
    const completed = receipts.some((receipt) => receiptUsesReference(receipt, reference));
    if (!completed) {
      findings.push({
        code: "CONFIRMED_CHANGE_RECEIPT_REQUIRED",
        referenceId: reference.referenceId,
        message: `Confirmed prepared change ${reference.referenceId} has no successful receipt for its exact saved tool and arguments in this request.`,
        repairInstruction: `Execute only the confirmed prepared change ${reference.referenceId}, using its exact saved tool and arguments. Do not substitute anything.`,
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
