import { schemaProblem } from "./tools/registry.mjs";
import { compactObjectReferenceContext, flatObjectReferences } from "./object-references.mjs";

const text = (maximum = 2_000) => ({ type: "string", minLength: 1, maxLength: maximum });
const textList = (maximumItems = 12, maximumText = 1_000) => ({
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
const temporalResolution = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceText: text(500),
    sourceEventSeqs,
    weekday: {
      type: "string",
      enum: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    },
    localDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    timeZone: text(200),
    role: { type: "string", enum: ["target", "reference"] },
    appliesTo: { type: "string", enum: ["calendar_start", "other"] },
  },
  required: [
    "sourceText", "sourceEventSeqs", "weekday", "localDate", "timeZone", "role", "appliesTo",
  ],
};

function enumArray(values, maximumItems = values.length) {
  const allowed = [...new Set(values)].sort();
  return {
    type: "array",
    maxItems: Math.max(0, Math.min(maximumItems, allowed.length)),
    uniqueItems: true,
    items: allowed.length ? { type: "string", enum: allowed } : { type: "string" },
  };
}

export function commonSenseCoreSchema({
  capabilities = [], contextViewIds = [], actionReferenceIds = [], objectRefs = [],
} = {}) {
  const allowedCapabilities = [...new Set(capabilities)].sort();
  const allowedContextViews = [...new Set(contextViewIds)].sort();
  const allowedActionReferences = [...new Set(actionReferenceIds)].sort();
  const allowedObjectRefs = [...new Set(objectRefs)].sort();
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      version: { type: "integer", enum: [1] },
      mode: { type: "string", enum: ["act", "answer", "clarify"] },
      objective: {
        ...text(2_000),
        description: "The ordinary-language end state the user wants, without tool or protocol terminology.",
      },
      conversationSummary: {
        ...text(1_000),
        description: "Only the small amount of conversational context needed to understand this request.",
      },
      actions: {
        type: "array",
        maxItems: 30,
        description: "The requested work. One action may target many objects; do not split a batch into one action per object.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            instruction: text(1_500),
            targetRefs: {
              ...enumArray(allowedObjectRefs, 500),
              description: "Exact supplied object references involved in this action. Omit objects that have not been supplied as references.",
            },
          },
          required: ["instruction", "targetRefs"],
        },
      },
      constraints: {
        ...textList(12, 1_000),
        description: "Only constraints stated by the user or essential to preserving the requested meaning. Do not invent generic guard prose.",
      },
      questions: {
        ...textList(6, 1_000),
        description: "Only genuine ambiguities that prevent a correct answer or action.",
      },
      capabilities: {
        ...enumArray(allowedCapabilities, 12),
        description: "The smallest connected capability-family set that could carry out the understood request. Do not select exact tools.",
      },
      contextRequests: {
        ...enumArray(allowedContextViews, 12),
        description: "Optional bounded read-only context that materially helps execution. Explicit composer selections are verified automatically and are not requested here.",
      },
      confirmedActionReferenceIds: {
        ...enumArray(allowedActionReferences, 20),
        description: "Exact prepared changes clearly confirmed by this request.",
      },
      temporalResolutions: {
        type: "array",
        maxItems: 20,
        description: "Literal local-date resolutions needed for time-relative execution.",
        items: temporalResolution,
      },
    },
    required: [
      "version", "mode", "objective", "conversationSummary", "actions", "constraints",
      "questions", "capabilities", "contextRequests", "confirmedActionReferenceIds",
      "temporalResolutions",
    ],
  };
}

export const completionAuditSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "integer", enum: [1] },
    outcome: { type: "string", enum: ["complete", "needs_information", "repair_needed", "blocked"] },
    summary: text(2_000),
    satisfied: textList(30),
    remaining: textList(30),
    repairInstructions: textList(30),
  },
  required: ["version", "outcome", "summary", "satisfied", "remaining", "repairInstructions"],
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
    role: entry.role,
    content: entry.content,
  };
}

function compactCapabilityCatalog(catalog) {
  if (!catalog.length) return "No connected capability families are currently available.";
  return catalog.map((entry) => {
    const views = (entry.contextViews ?? []).map((view) => (
      `  context:${view.id} — ${view.description ?? view.title ?? view.id}`
    ));
    return [
      `- ${entry.capability}${entry.title ? ` (${entry.title})` : ""}: ${entry.summary}`,
      ...views,
    ].join("\n");
  }).join("\n");
}

function selectedObjects(selectedObjectCandidates) {
  return selectedObjectCandidates.map(({ mention, type, source, id, ref, display }) => ({
    mention, type, source, id, ref, display,
  }));
}

export function commonSenseContext({
  requestId,
  requestEventSeq,
  requestText,
  recentConversation,
  conversationSummary = null,
  capabilityCatalog,
  selectedObjectCandidates = [],
  availableObjectReferences = [],
  deferredActionReferences = [],
  explicitHats = [],
  localCalendar = null,
}) {
  return [
    "# Common-sense orientation",
    "Understand the request as an ordinary conversation before thinking about execution. The current request and explicit composer selections outrank older conversational context. Produce the smallest useful intent core; do not invent safeguards, repeat generic cautions, choose exact tools, or perform the work.",
    "",
    "## Exact current request",
    JSON.stringify({ requestId, requestEventSeq, text: requestText }, null, 2),
    "",
    "## Explicit composer selections",
    "These objects were explicitly selected with the request. Treat words such as this, that, these, those, it, and them as referring to these selections when ordinary language supports it. The application will verify their exact identities after orientation.",
    JSON.stringify(selectedObjects(selectedObjectCandidates), null, 2),
    "",
    "## Brief relevant conversation",
    conversationSummary || JSON.stringify(recentConversation.map(sourceEntry), null, 2),
    "",
    "## Exact previously verified object references",
    "Use these only when the current request actually refers to them. Put every relevant stable reference in the corresponding action's targetRefs. Names without these bindings remain ordinary search text.",
    JSON.stringify(compactObjectReferenceContext(availableObjectReferences), null, 2),
    "",
    ...(deferredActionReferences.length ? [
      "## Prepared changes awaiting confirmation",
      "Select an exact reference only when the user is clearly confirming that prepared change.",
      JSON.stringify(deferredActionReferences, null, 2),
      "",
    ] : []),
    ...(localCalendar ? [
      "## Local calendar for relative dates",
      String(localCalendar),
      "",
    ] : []),
    "## Explicitly invoked roles",
    JSON.stringify(explicitHats, null, 2),
    "",
    "## Connected capability families",
    compactCapabilityCatalog(capabilityCatalog),
    "Select capability families, not tools. Batch work is one action with a list of targetRefs when the same change applies to all targets.",
  ].join("\n");
}

export function commonSenseExecutionInstructions(core, objectReferences, confirmedActionReferences = []) {
  return [
    "# Accepted common-sense core",
    "Carry out the ordinary-language objective below. The exact current user request remains authoritative. Preserve explicit constraints, handle each action completely, and use bulk tools for batch targets when available.",
    JSON.stringify(core, null, 2),
    "",
    "# Verified object bindings",
    "These are the exact application-verified identities relevant to the request. Use their IDs directly. Do not rediscover an explicitly selected object by searching its display name. A singleton tool must not silently choose one object from a batch; use a bulk-shaped operation or clearly report the limitation.",
    JSON.stringify(compactObjectReferenceContext(objectReferences), null, 2),
    "",
    "# Confirmed prepared changes",
    "Only these exact provider-owned prepared changes are confirmed. Copy their opaque values exactly.",
    JSON.stringify(confirmedActionReferences, null, 2),
    "",
    "Tool schemas own domain validation, atomicity, partial-success behavior, and provider workflow semantics. Use those contracts directly. Ask one concise question only when the accepted core or a tool result proves that necessary information is missing.",
  ].join("\n");
}

export function auditContext({
  core, receipts, executorResponse, deterministicFindings = [], reasons = [], callableTools = [],
}) {
  return [
    "# Exceptional completion audit",
    "This request triggered a semantic audit because deterministic receipt checks were insufficient. Compare the accepted common-sense objective with literal receipts and the proposed response. Do not treat cancellation, archival, deletion, creation, or update as interchangeable unless the owning tool contract or receipt explicitly establishes that meaning.",
    "",
    "## Audit reasons",
    JSON.stringify(reasons, null, 2),
    "",
    "## Accepted common-sense core",
    JSON.stringify(core, null, 2),
    "",
    "## Tool receipts",
    JSON.stringify(receipts, null, 2),
    "",
    "## Deterministic findings",
    JSON.stringify(deterministicFindings, null, 2),
    "",
    "## Callable tools",
    JSON.stringify(callableTools, null, 2),
    "",
    "## Proposed response",
    executorResponse,
  ].join("\n");
}

export const commonSenseInstructions = [
  "You are the common-sense orientation phase of Time v3 Agent. Produce only the schema-constrained intent core.",
  "Prioritize the exact current request and any explicit composer selections. Use older conversation only to resolve genuine references or continuations.",
  "Describe the end state in ordinary language. Do not select tools, write audit policy, copy tool protocols, manufacture prohibitions, or turn preservation of unrelated state into verbose constraints.",
  "For a batch, write one action whose targetRefs contains the complete supplied target set. Use separate actions only for genuinely different requested operations.",
  "Select the smallest plausible capability-family set. A capability family says where execution belongs; exact tool selection happens later from exact schemas.",
  "Use contextRequests only for advertised read-only context that execution genuinely needs. Explicit composer selections are verified automatically.",
  "When the request names a weekday or relative calendar date that governs execution, record the literal, source event, IANA time zone, weekday, resolved local date, role, and affected field in temporalResolutions.",
  "Use mode clarify only for a genuine unresolved ambiguity that blocks a correct result. Otherwise prefer act for requested application work and answer for explanation or writing that needs no application mutation.",
].join("\n");

export const auditInstructions = [
  "You are the exceptional completion-audit phase of Time v3 Agent. Produce only the schema-constrained audit result.",
  "Judge the ordinary-language end state from tool receipts and tool contracts, not from confidence in the proposed response.",
].join("\n");

export function coreTargetRefs(core) {
  return [...new Set((core.actions ?? []).flatMap(({ targetRefs = [] }) => targetRefs))];
}

export function availableCoreObjectRefs(groups, selectedObjectCandidates = []) {
  return [...new Set([
    ...flatObjectReferences(groups).map(({ ref }) => ref),
    ...selectedObjectCandidates.map(({ ref }) => ref).filter(Boolean),
  ])];
}
