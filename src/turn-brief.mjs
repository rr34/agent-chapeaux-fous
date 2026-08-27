import { schemaProblem } from "./tools/registry.mjs";

const text = (maximum = 4_000) => ({ type: "string", minLength: 1, maxLength: maximum });
const textList = (maximumItems = 20, maximumText = 1_000) => ({
  type: "array",
  maxItems: maximumItems,
  items: text(maximumText),
});
const sourceEventSeqs = {
  type: "array",
  minItems: 1,
  maxItems: 20,
  uniqueItems: true,
  items: { type: "integer", minimum: 1 },
};
const sourcedStatement = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: text(1_000),
    sourceEventSeqs,
  },
  required: ["text", "sourceEventSeqs"],
};

export function turnBriefSchema(capabilities, actionReferenceIds = [], contextViewIds = []) {
  const allowedCapabilities = [...new Set(capabilities)].sort();
  const allowedReferenceIds = [...new Set(actionReferenceIds)].sort();
  const allowedContextViews = [...new Set(contextViewIds)].sort();
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      contractVersion: { type: "integer", enum: [1] },
      requestType: {
        type: "string",
        enum: [
          "new_objective", "continuation", "authorization", "correction",
          "clarification", "addition", "cancellation", "informational",
        ],
      },
      responseMode: { type: "string", enum: ["act", "answer", "clarify"] },
      objective: text(),
      summary: text(2_000),
      requiredCapabilities: {
        type: "array",
        maxItems: Math.max(1, allowedCapabilities.length),
        uniqueItems: true,
        items: { type: "string", enum: allowedCapabilities },
      },
      authorizedActionReferenceIds: {
        type: "array",
        maxItems: allowedReferenceIds.length,
        uniqueItems: true,
        items: allowedReferenceIds.length
          ? { type: "string", enum: allowedReferenceIds }
          : { type: "string" },
      },
      contextRequests: {
        type: "array",
        maxItems: allowedContextViews.length,
        uniqueItems: true,
        items: allowedContextViews.length
          ? { type: "string", enum: allowedContextViews }
          : { type: "string" },
      },
      authorizedActions: { type: "array", maxItems: 20, items: sourcedStatement },
      prohibitedActions: textList(),
      deferredActions: textList(),
      constraints: { type: "array", maxItems: 30, items: sourcedStatement },
      unresolvedQuestions: textList(),
      completionCriteria: textList(30),
      evidence: { type: "array", maxItems: 30, items: sourcedStatement },
      audit: {
        type: "object",
        additionalProperties: false,
        properties: {
          required: { type: "boolean" },
          reasons: textList(10),
        },
        required: ["required", "reasons"],
      },
      conversationState: {
        type: "object",
        additionalProperties: false,
        properties: {
          activeObjective: { type: ["string", "null"], maxLength: 4_000 },
          openCommitments: { type: "array", maxItems: 30, items: sourcedStatement },
          durableConstraints: { type: "array", maxItems: 30, items: sourcedStatement },
          unresolvedQuestions: textList(30),
          relevantRequestIds: {
            type: "array",
            maxItems: 30,
            uniqueItems: true,
            items: { type: "string", minLength: 8, maxLength: 64 },
          },
        },
        required: [
          "activeObjective", "openCommitments", "durableConstraints",
          "unresolvedQuestions", "relevantRequestIds",
        ],
      },
    },
    required: [
      "contractVersion", "requestType", "responseMode", "objective", "summary",
      "requiredCapabilities", "authorizedActionReferenceIds", "authorizedActions",
      "contextRequests",
      "prohibitedActions", "deferredActions",
      "constraints", "unresolvedQuestions", "completionCriteria", "evidence", "audit",
      "conversationState",
    ],
  };
}

export const completionAuditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    contractVersion: { type: "integer", enum: [1] },
    outcome: { type: "string", enum: ["complete", "repair_needed", "blocked"] },
    summary: text(2_000),
    satisfiedCriteria: textList(30),
    remainingActions: textList(30),
    repairInstructions: textList(30),
  },
  required: [
    "contractVersion", "outcome", "summary", "satisfiedCriteria",
    "remainingActions", "repairInstructions",
  ],
};

export function parseStructuredModelOutput(value, schema, label) {
  let parsed;
  try {
    parsed = JSON.parse(String(value ?? ""));
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${error.message}`);
  }
  const problem = schemaProblem(parsed, schema, label);
  if (problem) throw new Error(`${label} did not match its contract: ${problem}`);
  return parsed;
}

function sourceEntry(entry) {
  return {
    eventSeq: entry.eventSeq,
    requestId: entry.requestId,
    occurredAtUtc: entry.occurredAtUtc,
    role: entry.role,
    content: entry.content,
  };
}

export function orientationContext({
  requestId,
  requestEventSeq,
  recentConversation,
  previousState,
  fallbackCheckpoint,
  capabilityCatalog,
  deferredActionReferences = [],
  explicitHats = [],
}) {
  return [
    "# Orientation source",
    "Interpret the current user request against these literal application-owned sources. The ledger remains authoritative. The prior rolling state is a replaceable index, not proof; retain or change it only when supported by source event numbers. Never broaden authorization.",
    "",
    "## Current request identity",
    JSON.stringify({ requestId, requestEventSeq }),
    "",
    "## Exact recent conversation entries",
    JSON.stringify(recentConversation.map(sourceEntry), null, 2),
    "",
    "## Prior rolling conversation state",
    JSON.stringify(previousState ?? null, null, 2),
    "",
    "## Active MCP-owned deferred actions",
    "These references are derived from immutable tool receipts. The MCP owns each operation, its data, readiness, expiration, validation, and execution. Select a reference ID only when the current request authorizes that exact provider operation. Never substitute a request ID or infer an opaque identifier from prose.",
    JSON.stringify(deferredActionReferences, null, 2),
    "",
    ...(fallbackCheckpoint ? [
      "## Bounded fallback checkpoint",
      fallbackCheckpoint,
      "",
    ] : []),
    "## Explicitly spoken hats",
    JSON.stringify(explicitHats, null, 2),
    "",
    "## Connected capability families",
    JSON.stringify(capabilityCatalog, null, 2),
    "Context views are small read-only datasets that the application can prepare after orientation and before execution. Request only views that materially help execution resolve existing names, identifiers, or categories. They are not writes and do not replace domain tools.",
  ].join("\n");
}

export function turnBriefInstructions(brief, authorizedActionReferences = []) {
  return [
    "# Accepted TurnBrief",
    "This source-grounded contract defines the current request. Execute its objective and authorized actions, respect prohibited and deferred actions, and continue until every completion criterion is satisfied or a genuinely new blocker is proven by a tool result or the complete callable-tool snapshot. Do not re-infer a narrower task from the latest sentence alone.",
    JSON.stringify(brief, null, 2),
    "",
    "# Authorized MCP action references",
    "These references contain only the opaque invocation data returned by an MCP. The MCP remains authoritative for the operation and its lifecycle. Copy an opaque identifier only from an authorized reference; never use a request ID, receipt ID, or guessed value. A historical receipt inspection is evidence only and does not execute the provider action.",
    JSON.stringify(authorizedActionReferences, null, 2),
  ].join("\n");
}

export function auditContext({
  brief, receipts, executorResponse, deterministicFindings = [], auditEffects = [], callableTools = [],
}) {
  return [
    "# Completion audit input",
    "Compare the accepted TurnBrief with literal tool receipts and the proposed executor response. Mark complete only when the receipts and response prove every requested outcome. Mark repair_needed when safe callable work remains. Mark blocked only for a new evidenced blocker. Do not invent actions or authorization.",
    "",
    "## Accepted TurnBrief",
    JSON.stringify(brief, null, 2),
    "",
    "## Tool receipts from execution",
    JSON.stringify(receipts, null, 2),
    "",
    "## Deterministic receipt findings",
    JSON.stringify(deterministicFindings, null, 2),
    "These findings are application-enforced. A historical receipt read cannot satisfy a missing direct action receipt.",
    "",
    "## Successful calls with declared or unknown effects",
    JSON.stringify(auditEffects, null, 2),
    "",
    "## Complete callable-tool snapshot from execution",
    JSON.stringify(callableTools, null, 2),
    "This is the complete set of application functions callable in the executor's final interaction. It may prove that no supported callable operation was available. Interpret only the published names, descriptions, ownership, and annotations; do not invent provider workflow semantics.",
    "",
    "## Proposed executor response",
    executorResponse,
  ].join("\n");
}

export const orientationInstructions = [
  "You are the orientation phase of Chapeaux Fous. Produce only the schema-constrained TurnBrief.",
  "Resolve the exact current request against the supplied recent conversation and rolling state.",
  "A short approval can authorize a concrete prior offer without repeating its wording. A correction changes only what it explicitly changes. An addition preserves the earlier objective. A question does not authorize a write.",
  "When approval concerns an MCP-owned deferred operation, select its exact active reference in authorizedActionReferenceIds. If no matching reference exists, do not fabricate or infer one.",
  "Use contextRequests to ask the application for small advertised read-only datasets that execution needs up front, such as existing tag, group, or tracker names and IDs. Do not request unrelated views.",
  "Select every capability family the executor may need. Keep the output concise, source-grounded, and explicit about completion.",
].join("\n");

export const auditInstructions = [
  "You are the completion-audit phase of Chapeaux Fous. Produce only the schema-constrained audit result.",
  "Judge completion from the TurnBrief and receipts, not from confidence or promises in the executor response.",
].join("\n");
