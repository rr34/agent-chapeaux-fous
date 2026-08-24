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

export function turnBriefSchema(capabilities) {
  const allowedCapabilities = [...new Set(capabilities)].sort();
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
      "requiredCapabilities", "authorizedActions", "prohibitedActions", "deferredActions",
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
  ].join("\n");
}

export function turnBriefInstructions(brief) {
  return [
    "# Accepted TurnBrief",
    "This source-grounded contract defines the current request. Execute its objective and authorized actions, respect prohibited and deferred actions, and continue until every completion criterion is satisfied or a genuinely new blocker is proven by a tool result. Do not re-infer a narrower task from the latest sentence alone.",
    JSON.stringify(brief, null, 2),
  ].join("\n");
}

export function auditContext({ brief, receipts, executorResponse }) {
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
    "## Proposed executor response",
    executorResponse,
  ].join("\n");
}

export const orientationInstructions = [
  "You are the orientation phase of Chapeaux Fous. Produce only the schema-constrained TurnBrief.",
  "Resolve the exact current request against the supplied recent conversation and rolling state.",
  "A short approval can authorize a concrete prior offer without repeating its wording. A correction changes only what it explicitly changes. An addition preserves the earlier objective. A question does not authorize a write.",
  "Select every capability family the executor may need. Keep the output concise, source-grounded, and explicit about completion.",
].join("\n");

export const auditInstructions = [
  "You are the completion-audit phase of Chapeaux Fous. Produce only the schema-constrained audit result.",
  "Judge completion from the TurnBrief and receipts, not from confidence or promises in the executor response.",
].join("\n");
