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
      semanticType: {
        ...text(200),
        description: "Ordinary-language kind of target to resolve, not a capability resource type or storage representation.",
      },
      role: text(200),
      cardinality: { type: "string", enum: ["one", "many"] },
    },
    required: ["slot", "description", "semanticType", "role", "cardinality"],
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
        description: "The requested work. One action may target many objects; do not split a batch into one action per object. The application assigns each accepted action a stable identity. Orientation names semantic outcome roles only when the request itself already establishes their meaning and bound independently of later resource and tool selection.",
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
              description: "Target roles described by the user whose exact objects have not yet been supplied. Describe their ordinary-language semantic kind without choosing a capability resource type; execution may resolve them through an owning read. Do not invent an unresolved target for a tag label, relationship, field value, or other qualifier.",
            },
            outcomes: {
              type: "array",
              maxItems: 20,
              description: "Compact semantic outcome roles whose final-state meaning and cardinality are already established by the request or an exact selected set. Describe one requested result once even when it contains many details. Do not choose a capability resource type, row shape, tool result type, or other concrete representation; execution binds authoritative resource types from owning tool contracts and receipts. Never invent an outcome for a tag, relationship, field value, lifecycle effect, receipt, or possible implementation.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  description: {
                    ...text(1_000),
                    description: "The requested final-state role and composition of this semantic result in ordinary language, without prescribing resource types, tools, or storage mechanics.",
                  },
                  targetRefs: {
                    ...enumArray(allowedObjectRefs, 500),
                    description: "Exact supplied existing objects that fill this semantic outcome role. Keep empty for results that do not exist yet or whose identities owning reads must resolve. The application derives their resource types from verified bindings.",
                  },
                  cardinality: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      minimum: { type: "integer", minimum: 0, maximum: 10000 },
                      maximum: { type: ["integer", "null"], minimum: 0, maximum: 10000 },
                      basis: {
                        type: "string",
                        enum: ["request", "inferred"],
                        description: "request means the exact request or exact selected set establishes this bound independently of execution. inferred is advisory semantic context only: it never restricts calls, competes for automatic receipt correlation, or proves completion failure.",
                      },
                    },
                    required: ["minimum", "maximum", "basis"],
                  },
                },
                required: ["description", "targetRefs", "cardinality"],
              },
            },
          },
          required: [
            "instruction", "targetRefs", "targetSetRefs", "relationshipSetRefs",
            "unresolvedTargets", "outcomes",
          ],
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
    outcome: {
      type: "string",
      enum: ["complete", "needs_information", "repair_needed", "blocked"],
      description: "Use complete only when receipts prove the requested end state. Use needs_information when a material user-controlled choice or value is still required; callable tools do not resolve that missing intent. Use repair_needed only when the remaining work can proceed now from existing authorization and evidence without another user answer. Use blocked only for a terminal operational or authorization barrier that repair cannot resolve in this request.",
    },
    requiresUserInput: {
      type: "boolean",
      description: "True when correct continuation requires the user to supply or choose material information that is not established by the request, context, or receipts. Tool availability is irrelevant to this value.",
    },
    missingInformation: {
      ...textList(12, 1_000),
      description: "Exact material questions or choices only the user can resolve. When nonempty, requiresUserInput must be true and the outcome is needs_information.",
    },
    summary: text(2_000),
    satisfied: textList(30),
    remaining: textList(30),
    repairInstructions: {
      ...textList(30),
      description: "Application work that can execute immediately without new user input. Keep empty for complete and needs_information outcomes; asking the user is not a repair instruction.",
    },
  },
  required: [
    "version", "outcome", "requiresUserInput", "missingInformation", "summary", "satisfied",
    "remaining", "repairInstructions",
  ],
};

export function normalizeCompletionAudit(value) {
  const requiresUserInput = value.requiresUserInput === true
    || value.outcome === "needs_information"
    || value.missingInformation.length > 0;
  if (!requiresUserInput) return value;
  return {
    ...value,
    outcome: "needs_information",
    requiresUserInput: true,
    repairInstructions: [],
  };
}

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

function matchedCapabilityAliases(entry, requestText) {
  const text = String(requestText ?? "").normalize("NFKC").replaceAll(/[_-]+/g, " ");
  return (entry.aliases ?? []).filter((alias) => {
    const normalized = String(alias).normalize("NFKC").replaceAll(/[_-]+/g, " ");
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "iu").test(text);
  });
}

function compactCapabilityCatalog(catalog, requestText) {
  if (!catalog.length) return "No connected capability families are currently available.";
  return catalog.map((entry) => {
    const matchedAliases = matchedCapabilityAliases(entry, requestText);
    const views = (entry.contextViews ?? []).map((view) => (
      `  context:${view.id} — ${view.description ?? view.title ?? view.id}`
    ));
    const operationNames = (operations = {}) => Object.entries(operations)
      .map(([name, operation]) => operation.available === true
        ? name.toLocaleUpperCase("en-US")
        : `${name.toLocaleUpperCase("en-US")}=UNAVAILABLE`)
      .join("/");
    const resources = [
      ...(entry.objectTypes ?? []).map((resource) => ({
        ...resource, catalogKind: "object",
      })),
      ...(entry.relationships ?? [])
        .filter(({ management }) => management === "user")
        .map((resource) => ({ ...resource, catalogKind: "relationship" })),
    ].filter(({ operations }) => operations).map((resource) => (
      `  ${resource.catalogKind}:${resource.id} [${operationNames(resource.operations)}]`
    ));
    return [
      `- ${entry.capability}${entry.title ? ` (${entry.title})` : ""}: ${entry.summary}`,
      ...(matchedAliases.length
        ? [`  matched request vocabulary: ${matchedAliases.map((alias) => JSON.stringify(alias)).join(", ")} (declared capability alias)`]
        : []),
      ...resources,
      ...views,
    ].join("\n");
  }).join("\n");
}

function selectedObjects(selectedObjectCandidates) {
  return selectedObjectCandidates.map(({
    mention, type, source, id, ref, display, occurrenceStartsAtUtc,
  }) => ({
    mention, type, source, id, ref, display,
    ...(occurrenceStartsAtUtc ? { occurrenceStartsAtUtc } : {}),
  }));
}

function selectedCalendarOccurrenceScopes(selectedObjectCandidates) {
  return selectedObjectCandidates.flatMap(({
    type, id, ref, display, occurrenceStartsAtUtc,
  }) => occurrenceStartsAtUtc ? [{ type, id, ref, display, occurrenceStartsAtUtc }] : []);
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
      "These objects were explicitly selected with the request. Treat words such as this, that, these, those, it, and them as referring to these selections when ordinary language supports it. The application will verify their exact identities after orientation. For a calendar selection, occurrenceStartsAtUtc identifies the exact computed occurrence the user checked; it establishes one-occurrence rather than whole-series scope, and multiple qualified selections from the same event remain distinct.",
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
    compactCapabilityCatalog(capabilityCatalog, requestText),
    "Select capability families, not tools. Exact matched request vocabulary is strong routing evidence for the relevant part of the request when a generic noun could otherwise fit another family; prefer the declared alias unless the request explicitly names a different owner. Catalog resources explain family scope, but orientation must not choose a resource type or tool representation for a semantic outcome; execution binds representation from owning contracts and receipts. Catalog relationships describe edges and must never be recast as outcomes. You may point directly to supplied objects and supplied sets. You may also define a request-local object set or relationship set from supplied object refs, then select that set from an action. For every relationship set, declare the actual fromType and toType and preserve that direction in every edge. Describe not-yet-supplied targets in unresolvedTargets so execution can resolve them through an owning read. Keep a requested relationship, tag assignment, field change, or other non-object final state in the ordinary-language action and constraints; do not invent an outcome object for it.",
  ].join("\n");
}

export function toolSelectionSchema({ toolNames = [] } = {}) {
  const allowed = [...new Set(toolNames)].sort();
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      version: { type: "integer", enum: [1] },
      summary: {
        ...text(1_200),
        description: "A short operational approach connected to the accepted intent. State what the selected tools are expected to accomplish, without predicting arguments, result shapes, or tool order.",
      },
      selectedTools: {
        type: "array",
        maxItems: Math.min(32, allowed.length),
        uniqueItems: true,
        items: allowed.length ? { type: "string", enum: allowed } : { type: "string" },
        description: "The smallest exact initial tool set needed to begin carrying out the accepted intent. An empty list is valid when no tool is needed.",
      },
    },
    required: ["version", "summary", "selectedTools"],
  };
}

export function toolSelectionContext({
  requestText,
  core,
  capabilityCatalog,
  objectReferences = [],
  referenceSets = [],
  confirmedActionReferences = [],
  preparedCapabilityContext = [],
  recentToolReceipts = [],
  capabilityGuidance = "",
}) {
  return [
    "# Schema-free tool selection",
    "Choose the smallest exact initial tool set that can begin carrying out the accepted intent. The catalog contains provider-published routing summaries, not callable schemas. Do not invent arguments, required fields, result shapes, tool order, safeguards, or missing facts. Execution will receive the selected exact schemas, may refine this approach from those contracts and results, and may request another tool from the accepted capability families when evidence shows it is needed.",
    "",
    "## Exact current request",
    requestText,
    "",
    "## Accepted common-sense core",
    JSON.stringify(core, null, 2),
    "",
    "## Verified object bindings",
    JSON.stringify(compactObjectReferenceContext(objectReferences), null, 2),
    "",
    "## Verified object and relationship sets",
    JSON.stringify(compactReferenceSets(referenceSets), null, 2),
    "",
    "## Confirmed prepared changes",
    JSON.stringify(confirmedActionReferences, null, 2),
    "",
    ...(preparedCapabilityContext.length ? [
      "## Prepared bounded context",
      JSON.stringify(preparedCapabilityContext, null, 2),
      "",
    ] : []),
    ...(recentToolReceipts.length ? [
      "## Relevant earlier receipts",
      JSON.stringify(recentToolReceipts, null, 2),
      "",
    ] : []),
    ...(capabilityGuidance ? [
      "## Accepted capability guidance",
      capabilityGuidance,
      "",
    ] : []),
    "## Available exact tools (compact routing metadata only)",
    JSON.stringify(capabilityCatalog, null, 2),
  ].join("\n");
}

export function commonSenseExecutionInstructions(
  core, objectReferences, confirmedActionReferences = [], referenceSets = [],
  selectedObjectCandidates = [],
) {
  const selectedOccurrences = selectedCalendarOccurrenceScopes(selectedObjectCandidates);
  return [
    "# Accepted common-sense core",
    "Carry out the ordinary-language objective below. The requested outcome, exact bound targets, and explicit constraints remain authoritative. Tool results are authoritative for current facts. When current evidence contradicts a factual premise in the request, explain the discrepancy and use the evidenced current scope; never fabricate missing records or silently replace an exact bound set or explicitly requested historical snapshot. Handle each action completely and use bulk tools for batch targets when available. A successful owning-domain read is sufficient evidence for facts it returned: do not use generic database, schema, or receipt tools to rediscover, validate, recount, or reinterpret those same facts. Use those generic reads only for a specific required fact absent from the current owning result. For non-completeness-sensitive bulk analysis, project read results to the needed fields with result_filter, including nested dot paths, and retain the correlation and pagination fields needed to judge completeness.",
    JSON.stringify(core, null, 2),
    "",
    "# Verified object bindings",
    "These are the exact application-verified identities relevant to the request. Use their IDs directly. Do not rediscover an explicitly selected object by searching its display name. A singleton tool must not silently choose one object from a batch; use a bulk-shaped operation or clearly report the limitation.",
    JSON.stringify(compactObjectReferenceContext(objectReferences), null, 2),
    "",
    ...(selectedOccurrences.length ? [
      "# Exact selected calendar occurrences",
      "Each entry is a separate composer-selected occurrence, even when several entries share one recurring-master ref. Use the master ID with the exact occurrenceStartsAtUtc as the original occurrence identity. This selection establishes occurrence scope; do not ask whether the user meant the whole series.",
      JSON.stringify(selectedOccurrences, null, 2),
      "",
    ] : []),
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
  selectedObjectCandidates = [],
}) {
  const selectedOccurrences = selectedCalendarOccurrenceScopes(selectedObjectCandidates);
  return [
    "# Exceptional completion audit",
    "This request triggered a semantic audit because deterministic receipt checks were insufficient. Compare the accepted common-sense objective with literal receipts and the proposed response. The requested outcome and exact bound scope remain authoritative, while receipts are authoritative for current facts. Mechanically correlated object references are one evidence channel: fewer correlated references than an orientation outcome names is an evidence gap, not proof that fewer objects were affected. Inspect exact bound mutation arguments, literal per-item or aggregate results, owning contracts, and successful reads together. An explicitly reconciled factual premise is not an omitted target; never demand nonexistent current records unless the request identifies an exact bound set or historical snapshot. Do not treat cancellation, archival, deletion, creation, or update as interchangeable unless the owning tool contract or receipt explicitly establishes that meaning.",
    "",
    "## Audit reasons",
    JSON.stringify(reasons, null, 2),
    "",
    "## Accepted common-sense core",
    JSON.stringify(core, null, 2),
    "",
    ...(selectedOccurrences.length ? [
      "## Exact selected calendar occurrences",
      JSON.stringify(selectedOccurrences, null, 2),
      "",
    ] : []),
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
  "When the user plainly rejects an object the agent just created by mistake, include removal of that mistaken object in the requested end state; do not reduce the correction to emptying or ignoring it.",
  "Use outcomes only for semantic result roles whose meaning and cardinality are already established by the exact request or an exact selected set. The application assigns stable action and outcome identities after orientation; do not manufacture correlation IDs. One requested result containing six listed details is one outcome, while six independently requested results may be six outcomes or one outcome with cardinality six.",
  "Never choose or emit a capability resource type for an outcome. Do not predict the row, provider object, tool, or result shape that execution will discover; owning tool contracts and successful receipts bind that representation later. A tag, relationship, field value, lifecycle effect, receipt, or tool result is not an outcome object merely because it is part of the requested final state. Preserve it in the action instruction or an exact relationship set.",
  "When the user only confirms one supplied provider-prepared change, preserve its reference ID on the action but do not create an outcome that merely restates execution, commitment, sending, deletion, or another effect of that confirmed change. Its exact successful receipt proves that effect.",
  "Use cardinality basis=request only when the exact request or an exact selected set establishes the bound independently of execution. Use basis=inferred sparingly for genuinely useful semantic structure; inferred outcomes are advisory and never restrict tool calls, compete for automatic receipt correlation, or prove that completion failed.",
  "A list of unresolved names, email addresses, search keys, or other lookup values does not by itself establish the number of distinct first-class objects: several keys may resolve to one object, one key may resolve to several, or current evidence may change whether creation is needed. Do not turn the input-list length into basis=request outcome cardinality unless the request independently requires that many distinct objects.",
  "For a batch, write one action and directly select exact object refs or an exact object set. A binding is identity evidence, not proof that every member is a current target. Use separate actions only for genuinely different requested operations.",
  "When the request specifies pairings, preserve them as one typed directed relationship set with one exact fromRef/toRef edge per pairing and the actual fromType/toType contract. Never represent pairings as two independent lists, because that loses correspondence.",
  "You may define request-local sets only from object refs supplied in this orientation interaction. Put targets that still require search or resolution in unresolvedTargets instead of inventing refs; describe only their ordinary-language semantic kind, never a capability resource type.",
  "Select the smallest plausible capability-family set. A capability family says where execution belongs; exact tool selection happens later from exact schemas.",
  "Use contextRequests only for advertised read-only context that execution genuinely needs. Explicit composer selections are verified automatically.",
  "When the request names a weekday or relative calendar date that governs execution, record the literal, source event, IANA time zone, weekday, resolved local date, role, and affected field in temporalResolutions.",
  "Use mode act only when the requested end state requires an application mutation. Use answer for read-only retrieval, analysis, explanation, or writing, including work that needs read-only application tools. Use clarify only for a genuine unresolved ambiguity that blocks a correct result.",
].join("\n");

export const toolSelectionInstructions = [
  "You are the schema-free tool-selection phase of Time v3 Agent. Produce only the schema-constrained selection brief.",
  "Preserve the accepted common-sense intent. Select exact tools only from the supplied compact provider-published catalog.",
  "Choose the smallest useful initial set. Do not infer fields from schemas, because no callable schemas are present; do not predict arguments, results, call order, or implementation details.",
  "The summary is a short operational bridge from intent to execution, not a plan that constrains execution. Execution may refine it after reading exact contracts and tool results.",
].join("\n");

export const auditInstructions = [
  "You are the exceptional completion-audit phase of Time v3 Agent. Produce only the schema-constrained audit result.",
  "Judge the ordinary-language end state from tool receipts and tool contracts, not from confidence in the proposed response.",
  "Treat missing or partial mechanical outcome-reference correlation as an evidence question, never as proof that zero or fewer objects were affected. Exact bound mutation arguments and literal successful results may prove the requested effect even when a tool does not repeat every unchanged object binding in its output.",
  "Distinguish the requested outcome and exact bound scope from factual premises about current data. When authoritative receipts contradict a premise and the proposed response explicitly reconciles the discrepancy while covering the evidenced current scope, do not demand nonexistent records; preserve exact bound sets and explicitly requested historical snapshots.",
  "Interpret ordinary delete, remove, and archive language through the owning resourceLifecycle supplied with callable tools. When that lifecycle declares delete as archival, disabling, cancellation, or another inactive retained state, a successful receipt proving that state satisfies an ordinary delete request. Require the response to state the literal retained-state effect; never claim permanent erasure. Demand physical erasure only when the user explicitly distinguishes it from the published lifecycle or that lifecycle itself declares permanent deletion.",
  "Apply the ordinary meaning of qualitative filters such as morning when every evidenced candidate is clearly inside or outside the term; do not invent a missing numeric boundary. If a genuinely borderline candidate would materially change the action, use needs_information for that user-controlled boundary, never repair_needed for another pass over the same evidence.",
  "When correct continuation requires a material choice or value that only the user can supply, set requiresUserInput=true, list the exact missingInformation, and use outcome=needs_information. The existence of callable read or mutation tools does not make an unknown user preference repairable. Asking the user is not repair work.",
  "Use repair_needed only when every input needed for the remaining application work is already established and that work can proceed immediately without another user answer.",
  "Unresolved target identity is not proof that a capability is unavailable. When a callable owning read can resolve the target and a callable mutation contract states the requested effect, require repair rather than reporting a terminal block.",
].join("\n");

export function coreTargetRefs(core, referenceSets = []) {
  return [...new Set([
    ...(core.actions ?? []).flatMap(({ targetRefs = [] }) => targetRefs),
    ...referenceSetObjectRefs(referenceSets),
  ])];
}

export function intentContinuityProblem(core) {
  const actionIds = new Set();
  for (const action of core.actions ?? []) {
    if (actionIds.has(action.actionId)) return `duplicate actionId ${action.actionId}`;
    actionIds.add(action.actionId);
    const outcomeIds = new Set();
    for (const outcome of action.outcomes ?? action.outcomeObjects ?? []) {
      if (outcomeIds.has(outcome.outcomeId)) {
        return `duplicate outcomeId ${outcome.outcomeId} in action ${action.actionId}`;
      }
      outcomeIds.add(outcome.outcomeId);
      const { minimum, maximum } = outcome.cardinality ?? {};
      if (maximum !== null && maximum < minimum) {
        return `outcome ${action.actionId}.${outcome.outcomeId} has maximum below minimum`;
      }
    }
  }
  return null;
}

export function connectCoreIntent(core) {
  return {
    ...core,
    actions: (core.actions ?? []).map((action, actionIndex) => {
      const { outcomeObjects: legacyOutcomes, ...semanticAction } = action;
      return {
        ...semanticAction,
        actionId: `action_${actionIndex + 1}`,
        outcomes: (action.outcomes ?? legacyOutcomes ?? []).map((outcome, outcomeIndex) => ({
          ...outcome,
          outcomeId: `outcome_${outcomeIndex + 1}`,
        })),
      };
    }),
  };
}

export function availableCoreObjectRefs(groups, selectedObjectCandidates = []) {
  return [...new Set([
    ...flatObjectReferences(groups).map(({ ref }) => ref),
    ...selectedObjectCandidates.map(({ ref }) => ref).filter(Boolean),
  ])];
}
