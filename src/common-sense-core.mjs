import { schemaProblem } from "./tools/registry.mjs";
import { compactObjectReferenceContext, flatObjectReferences } from "./object-references.mjs";
import { compactReferenceSets, referenceSetObjectRefs } from "./reference-sets.mjs";

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
  objectSetRefs = [], relationshipSetRefs = [], objectTypes = [], requestId = "request",
} = {}) {
  const allowedCapabilities = [...new Set(capabilities)].sort();
  const allowedContextViews = [...new Set(contextViewIds)].sort();
  const allowedActionReferences = [...new Set(actionReferenceIds)].sort();
  const allowedObjectRefs = [...new Set(objectRefs)].sort();
  const objectRefValue = allowedObjectRefs.length
    ? { type: "string", enum: allowedObjectRefs }
    : { type: "string" };
  const allowedObjectTypes = [...new Set(objectTypes)].sort();
  const objectTypeValue = allowedObjectTypes.length
    ? { type: "string", enum: allowedObjectTypes }
    : text(200);
  const allowedObjectSetRefs = [...new Set(objectSetRefs)].sort();
  const allowedRelationshipSetRefs = [...new Set(relationshipSetRefs)].sort();
  const localObjectSetPattern = `^agent-slayer://requests/${encodeURIComponent(requestId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/object-sets/[A-Za-z0-9._~-]+$`;
  const localRelationshipSetPattern = `^agent-slayer://requests/${encodeURIComponent(requestId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/relationship-sets/[A-Za-z0-9._~-]+$`;
  const selectableSetRefs = (availableRefs, localPattern) => ({
    type: "array",
    maxItems: 100,
    uniqueItems: true,
    items: availableRefs.length
      ? { anyOf: [{ type: "string", enum: availableRefs }, { type: "string", pattern: localPattern }] }
      : { type: "string", pattern: localPattern },
  });
  const unresolvedTarget = {
    type: "object",
    additionalProperties: false,
    properties: {
      slot: { type: "string", pattern: "^[a-z][a-z0-9_]{0,79}$" },
      description: text(1_000),
      objectType: text(200),
      role: text(200),
      cardinality: { type: "string", enum: ["one", "many"] },
    },
    required: ["slot", "description", "objectType", "role", "cardinality"],
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      version: { type: "integer", enum: [1] },
      mode: {
        type: "string",
        enum: ["act", "answer", "clarify"],
        description: "Use act only when the requested end state requires an application mutation; use answer for read-only retrieval, analysis, explanation, or writing; use clarify only for a genuinely blocking ambiguity.",
      },
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
              description: "Only the exact supplied objects that the user intends this action to affect. Previously observed objects are evidence, not automatic targets; never copy a whole binding group merely because some members are relevant. Omit objects that have not been supplied as references.",
            },
            targetSetRefs: {
              ...selectableSetRefs(allowedObjectSetRefs, localObjectSetPattern),
              description: "Named exact object sets to which this action applies. Selecting a set selects every member exactly once.",
            },
            relationshipSetRefs: {
              ...selectableSetRefs(allowedRelationshipSetRefs, localRelationshipSetPattern),
              description: "Named exact directed relationship sets to preserve while carrying out this action. Never replace their edges with two independent object lists.",
            },
            unresolvedTargets: {
              type: "array",
              maxItems: 20,
              items: unresolvedTarget,
              description: "Target roles described by the user whose exact objects have not yet been supplied. Execution may resolve these through an owning read.",
            },
          },
          required: ["instruction", "targetRefs", "targetSetRefs", "relationshipSetRefs", "unresolvedTargets"],
        },
      },
      objectSets: {
        type: "array",
        maxItems: 50,
        description: "Request-local named sets assembled only from supplied exact object references.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            ref: { type: "string", pattern: localObjectSetPattern },
            display: text(500),
            memberRefs: { ...enumArray(allowedObjectRefs, 500), minItems: 1 },
          },
          required: ["ref", "display", "memberRefs"],
        },
      },
      relationshipSets: {
        type: "array",
        maxItems: 50,
        description: "Request-local exact directed edge sets assembled only from supplied object references.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            ref: { type: "string", pattern: localRelationshipSetPattern },
            display: text(500),
            relationshipType: { type: "string", pattern: "^[a-z][a-z0-9_.:-]{0,199}$" },
            fromType: {
              ...objectTypeValue,
              description: "Exact domain type required at every directed edge's fromRef endpoint.",
            },
            toType: {
              ...objectTypeValue,
              description: "Exact domain type required at every directed edge's toRef endpoint.",
            },
            edges: {
              type: "array", minItems: 1, maxItems: 500,
              items: {
                type: "object", additionalProperties: false,
                properties: {
                  fromRef: objectRefValue,
                  toRef: objectRefValue,
                },
                required: ["fromRef", "toRef"],
              },
            },
          },
          required: ["ref", "display", "relationshipType", "fromType", "toType", "edges"],
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
      "version", "mode", "objective", "conversationSummary", "actions", "objectSets",
      "relationshipSets", "constraints",
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
  availableReferenceSets = [],
  deferredActionReferences = [],
  explicitHats = [],
  localCalendar = null,
}) {
  const selected = selectedObjects(selectedObjectCandidates);
  const priorObjects = compactObjectReferenceContext(availableObjectReferences);
  const calendarText = typeof localCalendar === "string"
    ? localCalendar
    : JSON.stringify(localCalendar, null, 2);
  return [
    "# Common-sense orientation",
    "Understand the request as an ordinary conversation before thinking about execution. The current request and explicit composer selections outrank older conversational context. Produce the smallest useful intent core; do not invent safeguards, repeat generic cautions, choose exact tools, or perform the work.",
    "",
    "## Exact current request",
    JSON.stringify({ requestId, requestEventSeq, text: requestText }, null, 2),
    "",
    ...(selected.length ? [
      "## Explicit composer selections",
      "These objects were explicitly selected with the request. Treat words such as this, that, these, those, it, and them as referring to these selections when ordinary language supports it. The application will verify their exact identities after orientation.",
      JSON.stringify(selected, null, 2),
      "",
    ] : []),
    "## Brief relevant conversation",
    conversationSummary || (recentConversation.length
      ? JSON.stringify(recentConversation.map(sourceEntry), null, 2)
      : "No earlier conversation is needed to understand this request."),
    "",
    ...(priorObjects.length ? [
      "## Exact previously verified object references",
      "These are available identity evidence, not a target list. Put a stable reference in targetRefs only when the user intends that individual object to be affected by that action. Select individual members from a binding group; never copy the whole group merely because one or some members are relevant. Names without these bindings remain ordinary search text.",
      JSON.stringify(priorObjects, null, 2),
      "",
    ] : []),
    ...(availableReferenceSets.length ? [
      "## Exact selectable sets",
      "An object set preserves exact membership. A relationship set preserves exact directed pairs, relationship type, and the required domain type at each endpoint; it is not equivalent to two object sets. Select a whole set only when the user's request applies to every member or every listed edge.",
      JSON.stringify(compactReferenceSets(availableReferenceSets), null, 2),
      "",
    ] : []),
    ...(deferredActionReferences.length ? [
      "## Prepared changes awaiting confirmation",
      "Select an exact reference only when the user is clearly confirming that prepared change.",
      JSON.stringify(deferredActionReferences, null, 2),
      "",
    ] : []),
    ...(localCalendar ? [
      "## Local calendar for relative dates",
      calendarText,
      "",
    ] : []),
    ...(explicitHats.length ? [
      "## Explicitly invoked roles",
      JSON.stringify(explicitHats, null, 2),
      "",
    ] : []),
    "## Connected capability families",
    compactCapabilityCatalog(capabilityCatalog),
    "Select capability families, not tools. You may point directly to supplied objects and supplied sets. You may also define a request-local object set or relationship set from supplied object refs, then select that set from an action. For every relationship set, declare the actual fromType and toType and preserve that direction in every edge. Describe not-yet-supplied targets in unresolvedTargets so execution can resolve them through an owning read.",
  ].join("\n");
}

export function commonSenseExecutionInstructions(
  core, objectReferences, confirmedActionReferences = [], referenceSets = [],
) {
  return [
    "# Accepted common-sense core",
    "Carry out the ordinary-language objective below. The requested outcome, exact bound targets, and explicit constraints remain authoritative. Tool results are authoritative for current facts. When current evidence contradicts a factual premise in the request, explain the discrepancy and use the evidenced current scope; never fabricate missing records or silently replace an exact bound set or explicitly requested historical snapshot. Handle each action completely and use bulk tools for batch targets when available.",
    JSON.stringify(core, null, 2),
    "",
    "# Verified object bindings",
    "These are the exact application-verified identities relevant to the request. Use their IDs directly. Do not rediscover an explicitly selected object by searching its display name. A singleton tool must not silently choose one object from a batch; use a bulk-shaped operation or clearly report the limitation.",
    JSON.stringify(compactObjectReferenceContext(objectReferences), null, 2),
    "",
    "# Verified object and relationship sets",
    "Object sets are exact membership snapshots. Relationship sets are exact typed directed edge snapshots: preserve each fromRef → toRef pair and its fromType → toType contract; never infer a Cartesian product or collapse multiple targets to one endpoint.",
    JSON.stringify(compactReferenceSets(referenceSets), null, 2),
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
    "This request triggered a semantic audit because deterministic receipt checks were insufficient. Compare the accepted common-sense objective with literal receipts and the proposed response. The requested outcome and exact bound scope remain authoritative, while receipts are authoritative for current facts. An explicitly reconciled factual premise is not an omitted target; never demand nonexistent current records unless the request identifies an exact bound set or historical snapshot. Do not treat cancellation, archival, deletion, creation, or update as interchangeable unless the owning tool contract or receipt explicitly establishes that meaning.",
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
  "For a batch, write one action and directly select exact object refs or an exact object set. A binding is identity evidence, not proof that every member is a current target. Use separate actions only for genuinely different requested operations.",
  "When the request specifies pairings, preserve them as one typed directed relationship set with one exact fromRef/toRef edge per pairing and the actual fromType/toType contract. Never represent pairings as two independent lists, because that loses correspondence.",
  "You may define request-local sets only from object refs supplied in this orientation interaction. Put targets that still require search or resolution in unresolvedTargets instead of inventing refs.",
  "Select the smallest plausible capability-family set. A capability family says where execution belongs; exact tool selection happens later from exact schemas.",
  "Use contextRequests only for advertised read-only context that execution genuinely needs. Explicit composer selections are verified automatically.",
  "When the request names a weekday or relative calendar date that governs execution, record the literal, source event, IANA time zone, weekday, resolved local date, role, and affected field in temporalResolutions.",
  "Use mode act only when the requested end state requires an application mutation. Use answer for read-only retrieval, analysis, explanation, or writing, including work that needs read-only application tools. Use clarify only for a genuine unresolved ambiguity that blocks a correct result.",
].join("\n");

export const auditInstructions = [
  "You are the exceptional completion-audit phase of Time v3 Agent. Produce only the schema-constrained audit result.",
  "Judge the ordinary-language end state from tool receipts and tool contracts, not from confidence in the proposed response.",
  "Distinguish the requested outcome and exact bound scope from factual premises about current data. When authoritative receipts contradict a premise and the proposed response explicitly reconciles the discrepancy while covering the evidenced current scope, do not demand nonexistent records; preserve exact bound sets and explicitly requested historical snapshots.",
  "Unresolved target identity is not proof that a capability is unavailable. When a callable owning read can resolve the target and a callable mutation contract states the requested effect, require repair rather than reporting a terminal block.",
].join("\n");

export function coreTargetRefs(core, referenceSets = []) {
  return [...new Set([
    ...(core.actions ?? []).flatMap(({ targetRefs = [] }) => targetRefs),
    ...referenceSetObjectRefs(referenceSets),
  ])];
}

export function availableCoreObjectRefs(groups, selectedObjectCandidates = []) {
  return [...new Set([
    ...flatObjectReferences(groups).map(({ ref }) => ref),
    ...selectedObjectCandidates.map(({ ref }) => ref).filter(Boolean),
  ])];
}
