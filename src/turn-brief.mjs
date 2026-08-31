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
const weekdayNames = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const temporalResolution = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceText: text(500),
    sourceEventSeqs,
    weekday: { type: "string", enum: weekdayNames },
    localDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    timeZone: text(200),
    role: { type: "string", enum: ["target", "reference"] },
    appliesTo: {
      type: "string",
      enum: ["scheduled_at", "due_at", "calendar_start", "other"],
    },
  },
  required: [
    "sourceText", "sourceEventSeqs", "weekday", "localDate", "timeZone", "role", "appliesTo",
  ],
};

export function turnBriefSchema(capabilities, actionReferenceIds = [], contextViewIds = [], toolNames = []) {
  const allowedCapabilities = [...new Set(capabilities)].sort();
  const allowedReferenceIds = [...new Set(actionReferenceIds)].sort();
  const allowedContextViews = [...new Set(contextViewIds)].sort();
  const allowedTools = [...new Set(toolNames)].sort();
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      contractVersion: { type: "integer", enum: [1] },
      requestType: {
        type: "string",
        enum: [
          "new_objective", "continuation", "confirmation", "correction",
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
      requiredTools: {
        type: "array",
        maxItems: allowedTools.length,
        uniqueItems: true,
        description: "Smallest initial set of advertised tools likely to complete the objective. Execution may request additional tools only from the accepted capability families.",
        items: allowedTools.length
          ? { type: "string", enum: allowedTools }
          : { type: "string" },
      },
      confirmedActionReferenceIds: {
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
      temporalResolutions: {
        type: "array",
        maxItems: 20,
        description: "Source-referenced local calendar dates for named weekdays that govern this request. Action requests naming a weekday must resolve it here; application code validates the weekday/date pair before execution.",
        items: temporalResolution,
      },
      requestedActions: { type: "array", maxItems: 20, items: sourcedStatement },
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
      "requiredCapabilities", "requiredTools", "confirmedActionReferenceIds", "requestedActions",
      "contextRequests", "temporalResolutions",
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
  recentToolReceipts = [],
  explicitHats = [],
}) {
  return [
    "# Orientation source",
    "Interpret the current user request against these literal application-owned sources. The ledger remains authoritative. The prior rolling state is a replaceable index, not proof; retain or change it only when supported by source event numbers. Never broaden the requested scope.",
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
    "## Prepared changes waiting for confirmation",
    "These references are derived from immutable tool receipts. Each one is an exact prepared MCP change. Select a reference ID only when the current request clearly confirms that exact change. Never substitute a request ID or infer an opaque identifier from prose.",
    JSON.stringify(deferredActionReferences, null, 2),
    "",
    "## Recent durable tool receipt index",
    "This bounded index deliberately omits arguments and results. When the current request continues prior tool work and an MCP-owned identifier is absent from the conversation or active action references, select the database capability and tool_receipt_read for the relevant receipt instead of asking the user to supply an opaque ID. A historical receipt is evidence, not confirmation: use the exact saved state with an advertised recovery, read, or preview operation and regenerate a valid final handoff before asking the user.",
    JSON.stringify(recentToolReceipts, null, 2),
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
    "Each capability entry includes a compact catalog of its provider-published tools without their input schemas. Select the smallest initial tool set likely to complete the request in `requiredTools`. It is acceptable to omit a tool that later evidence may require because execution can request additional tools inside the accepted capability families. Never select a tool outside `requiredCapabilities`.",
    "Context views are small read-only datasets that the application can prepare after orientation and before execution. Request only views that materially help execution resolve existing names, identifiers, or categories. They are not writes and do not replace domain tools.",
  ].join("\n");
}

export function turnBriefInstructions(brief, confirmedActionReferences = []) {
  return [
    "# Accepted TurnBrief",
    "This source-grounded contract defines the current request. Execute its objective and requested actions, respect prohibited and deferred actions, and continue until every completion criterion is satisfied or a genuinely new blocker is proven by a tool result or the complete callable-tool snapshot. Do not re-infer a narrower task from the latest sentence alone.",
    JSON.stringify(brief, null, 2),
    "",
    "# Confirmed prepared changes",
    "A listed entry is the exact saved MCP call the user confirmed. Copy its opaque values exactly; never use a request ID, receipt ID, or guessed value. A historical receipt is evidence only and does not confirm or execute a change.",
    JSON.stringify(confirmedActionReferences, null, 2),
    "",
    "# User-facing language boundary",
    "TurnBriefs, saved invocation details, and internal confirmation state are application machinery, never explanations or requests for the user. If a prepared change needs confirmation, describe the actual change and ask for a plain yes or no; never ask the user for an internal identifier or technical object.",
  ].join("\n");
}

export function auditContext({
  brief, receipts, executorResponse, deterministicFindings = [], auditEffects = [], callableTools = [],
}) {
  return [
    "# Completion audit input",
    "Compare the accepted TurnBrief with literal tool receipts and the proposed executor response. Mark complete only when the receipts and response prove every requested outcome. Mark repair_needed when safe callable work remains. Mark blocked only for a new evidenced blocker. Do not invent actions or confirmation.",
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
  "For an informational continuation, use exact recent conversation entries as evidence when they already answer the question; leave requiredTools empty rather than selecting a tool merely because its catalog topic is related. A focused knowledge tool supplies evidence, not final wording: select it when current facts are needed, and define completion around answering the user's actual question rather than reproducing a stored fact or prior response.",
  "A short yes can confirm a concrete prior offer without repeating its wording. A correction changes only what it explicitly changes. An addition preserves the earlier objective. A question does not confirm a write.",
  "When the user confirms a prepared MCP change, select its exact active reference in confirmedActionReferenceIds. If no matching reference exists, do not fabricate or infer one.",
  "Use contextRequests to ask the application for small advertised read-only datasets that execution needs up front, such as existing tag, group, or tracker names and IDs. Do not request unrelated views.",
  "When an action request names a weekday, add its exact source phrase, event number, IANA time zone, weekday, resolved YYYY-MM-DD local date, target-or-reference role, and affected temporal field to temporalResolutions. Use the supplied local calendar table; never infer that today has the requested weekday merely because prior work moved records to today. Application code rejects inconsistent weekday/date pairs before execution, and native scheduling tools enforce target dates.",
  "Select every capability family the executor may need. Keep the output concise, source-grounded, and explicit about completion.",
].join("\n");

export const auditInstructions = [
  "You are the completion-audit phase of Chapeaux Fous. Produce only the schema-constrained audit result.",
  "Judge completion from the TurnBrief and receipts, not from confidence or promises in the executor response.",
].join("\n");
