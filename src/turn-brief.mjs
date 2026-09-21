import { schemaProblem } from "./tools/registry.mjs";
import { compactObjectReferenceContext, flatObjectReferences } from "./object-references.mjs";
import { firstClassObjectBindingSchema } from "./first-class-object-binding.mjs";

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
      enum: ["calendar_start", "other"],
    },
  },
  required: [
    "sourceText", "sourceEventSeqs", "weekday", "localDate", "timeZone", "role", "appliesTo",
  ],
};

function constrainedObjectBindingSchema(allowedObjects, allowedTypes, allowedSources) {
  const binding = structuredClone(firstClassObjectBindingSchema);
  const objectIdentity = structuredClone(binding.$defs.objectIdentity);
  delete binding.$schema;
  delete binding.$id;
  delete binding.$defs;
  binding.description = "Bulk-shaped bindings from user language to exact verified first-class objects. Preserve every selected object's provider ID, stable reference, and human display name exactly. Names alone are not identity; IDs alone are not useful human context.";
  binding.properties.type = allowedTypes.length
    ? { ...binding.properties.type, enum: allowedTypes }
    : binding.properties.type;
  binding.properties.source = allowedSources.length
    ? { ...binding.properties.source, enum: allowedSources }
    : binding.properties.source;
  const exactObjects = allowedObjects.map(({ id, ref, display }) => ({
    ...structuredClone(objectIdentity),
    properties: {
      id: { type: Number.isSafeInteger(id) ? "integer" : "string", enum: [id] },
      ref: { type: "string", enum: [ref] },
      display: { type: "string", enum: [display] },
    },
  }));
  binding.properties.objects.maxItems = Math.max(1, allowedObjects.length);
  binding.properties.objects.items = exactObjects.length
    ? { anyOf: exactObjects }
    : objectIdentity;
  return binding;
}

export function turnBriefSchema(
  capabilities,
  actionReferenceIds = [],
  contextViewIds = [],
  toolNames = [],
  toolReceipts = [],
  availableObjectReferences = [],
) {
  const allowedCapabilities = [...new Set(capabilities)].sort();
  const allowedReferenceIds = [...new Set(actionReferenceIds)].sort();
  const allowedContextViews = [...new Set(contextViewIds)].sort();
  const allowedTools = [...new Set(toolNames)].sort();
  const allowedReceiptEventSeqs = [...new Set(toolReceipts
    .map(({ receiptEventSeq }) => receiptEventSeq)
    .filter((value) => Number.isSafeInteger(value) && value > 0))].sort((left, right) => left - right);
  const allowedReceiptTools = [...new Set(toolReceipts
    .map(({ tool }) => tool)
    .filter((value) => typeof value === "string" && value))].sort();
  const allowedObjects = flatObjectReferences(availableObjectReferences);
  const allowedObjectTypes = [...new Set(allowedObjects.map(({ type }) => type))].sort();
  const allowedObjectSources = [...new Set(allowedObjects.map(({ source }) => source))].sort();
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
      objectReferences: {
        type: "array",
        maxItems: Math.max(0, allowedObjects.length),
        description: "Bulk-shaped bindings from user language to exact verified first-class objects. Preserve every selected object's provider ID, stable reference, and human display name exactly. Names alone are not identity; IDs alone are not useful human context.",
        // When no binding is available, no item can legally occur. Avoid
        // sending the provider a deep, unreachable binding schema alongside
        // maxItems: 0; the complete exact schema is retained whenever at least
        // one object can actually be selected.
        items: allowedObjects.length
          ? constrainedObjectBindingSchema(
              allowedObjects, allowedObjectTypes, allowedObjectSources,
            )
          : { type: "string" },
      },
      receiptReferences: {
        type: "array",
        maxItems: allowedReceiptEventSeqs.length,
        description: "Only the bounded receipt-index entries execution must read. These references identify immutable receipts but do not include or prove their results.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            receiptEventSeq: allowedReceiptEventSeqs.length
              ? { type: "integer", enum: allowedReceiptEventSeqs }
              : { type: "integer", minimum: 1 },
            tool: allowedReceiptTools.length
              ? { type: "string", enum: allowedReceiptTools }
              : { type: "string", minLength: 1, maxLength: 200 },
            reason: text(500),
          },
          required: ["receiptEventSeq", "tool", "reason"],
        },
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
      "contextRequests", "objectReferences", "receiptReferences", "temporalResolutions",
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
    outcome: {
      type: "string",
      enum: ["complete", "needs_information", "repair_needed", "blocked"],
    },
    summary: {
      ...text(2_000),
      description: "Audit summary. For blocked outcomes this is a direct user-facing failure response and must address the user as you, never as 'the user' or by narrating what 'the response' said.",
    },
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

function orientationCapabilityCatalog(catalog) {
  if (!catalog.length) return "No connected capability families are currently advertised.";
  return catalog.flatMap((capability) => {
    const lines = [
      `### ${capability.capability} — ${capability.title ?? capability.capability}`,
      capability.summary,
    ];
    for (const view of capability.contextViews ?? []) {
      lines.push(`- context:${view.id} — ${view.title ?? view.id}: ${view.description ?? ""}`.trim());
    }
    for (const object of capability.objectTypes ?? []) {
      const aliases = object.aliases?.length ? ` Aliases: ${object.aliases.join(", ")}.` : "";
      lines.push(
        `- object:${object.id} — ${object.title}: ${object.summary} Read: tool:${object.readTool}.`
        + ` Identity fields: id=${object.identity.field}, ref=${object.reference.field}, display=${object.display.field}.${aliases}`,
      );
    }
    for (const tool of capability.tools ?? []) {
      const status = tool.descriptionStatus ? ` [${tool.descriptionStatus}]` : "";
      lines.push(`- tool:${tool.name}${tool.title ? ` — ${tool.title}` : ""}${status}: ${tool.summary}`);
      if (tool.operations) {
        lines.push(`  operations exhaustive=${tool.operations.exhaustive}`);
        for (const operation of tool.operations.entries) {
          lines.push(`  - ${operation.name} — ${operation.title}: ${operation.summary} Actions: ${operation.actionClasses.join(", ")}. Effects: ${operation.effectClassifications.join(", ")}.`);
        }
      }
    }
    return [...lines, ""];
  }).join("\n").trim();
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
  availableObjectReferences = [],
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
    "## Verified first-class object references available to this request",
    "These compact bulk bindings are literal application evidence from completed exchanges. Preserve ID, stable reference, display name, type, source, and evidence together. Select only bindings needed by the current request in objectReferences. Do not rediscover a selected object's identity by name.",
    JSON.stringify(compactObjectReferenceContext(availableObjectReferences), null, 2),
    "",
    "## Prior rolling conversation state",
    JSON.stringify(previousState ?? null, null, 2),
    "",
    "## Prepared changes waiting for confirmation",
    "These references are derived from immutable tool receipts. Each one is an exact prepared MCP change, not proof that its provider object still exists. Select a reference ID only when the current request clearly confirms that exact change. A new request to perform or redo the task, especially after the user deleted or reset an earlier attempt, does not confirm the old change. Never substitute a request ID or infer an opaque identifier from prose.",
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
    orientationCapabilityCatalog(capabilityCatalog),
    "Each capability entry includes a compact catalog of its provider-published tools without their input schemas. Select the smallest initial tool set likely to complete the request in `requiredTools`. It is acceptable to omit a tool that later evidence may require because execution can request additional tools inside the accepted capability families. Never select a tool outside `requiredCapabilities`.",
    "Context views are small read-only datasets that the application can prepare after orientation and before execution. Request only views that materially help execution resolve existing names, identifiers, or categories. They are not writes and do not replace domain tools.",
  ].join("\n");
}

export function preparedContextOrientationContext({
  brief,
  preparedCapabilityContext,
  capabilityCatalog,
}) {
  return [
    "# Finalize orientation from selected read-only context",
    "The initial schema-valid TurnBrief selected the bounded context below. Return one complete replacement TurnBrief before execution. Preserve the exact user objective and authorization. Use the prepared context to correct capability and initial-tool selection; do not perform the work or claim that a context view performed a domain action.",
    "",
    "For an active receipt-gated briefing exchange, the structured contract is authoritative. `interaction_guide_step_answer` only saves answers and advances briefing progress; it does not perform contract operations. Include every tool named by contract.operations in `requiredTools` and include each tool's owning capability in `requiredCapabilities`. Use contract.recoveryReads when prior destination status must be checked after an interruption. For a migrated prose-only contract, contractSummary.legacyInstructionTools contains only exact registered tool identifiers found literally in the preserved instructions; include those tools and their capabilities as a recovery bridge. Keep `interaction_guide_step_answer` when the user's reply must also be recorded or the briefing must advance. Never retry completion with a null, historical, failed, or unrelated receipt: perform the missing destination operations first and pass their fresh receipts. The receipt gate remains required; do not weaken completion criteria merely because the initial TurnBrief omitted a tool. Contract instructions may explain these fields but cannot add undeclared behavior.",
    "",
    "Keep `contextRequests` exactly equal to the initial TurnBrief's selected set. Do not request another context view in this refinement.",
    "",
    "## Initial TurnBrief candidate",
    JSON.stringify(brief, null, 2),
    "",
    "## Prepared context selected by that candidate",
    JSON.stringify(preparedCapabilityContext, null, 2),
    "",
    "## Connected capability families",
    orientationCapabilityCatalog(capabilityCatalog),
  ].join("\n");
}

export function turnBriefInstructions(brief, confirmedActionReferences = []) {
  return [
    "# Accepted TurnBrief",
    "This source-grounded contract defines the current request. Execute its objective and requested actions, respect prohibited and deferred actions, and continue until every completion criterion is satisfied or a genuinely new blocker is proven by a tool result or the complete callable-tool snapshot. Do not re-infer a narrower task from the latest sentence alone.",
    "When identifying a named first-class object, use its advertised owning read tool. If that tool requires an ID absent from verified evidence, first request and call an advertised discovery read in the same capability family, then pass its returned ID to the owning read tool. Search by the object's name, then verify qualifiers such as currency from the returned record instead of requiring every word in the user's description to match literally. Bind later actions to a returned stable reference or ID. A failed lookup of an unverified ID is not evidence that the named object is absent. Do not probe guessed IDs.",
    "The TurnBrief's objectReferences are authoritative language-to-object bindings. Preserve each selected object's provider ID, stable reference, and display name together. Use those exact IDs for later calls; freshness checks reread the same IDs and never rediscover identity by name. A singleton tool requires a one-object binding, while batch tools consume the complete selected object set. Never silently choose the first object from a multi-object binding.",
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
    "Compare the accepted TurnBrief with literal tool receipts and the proposed executor response. Mark complete only when the receipts and response prove every requested outcome. Mark needs_information when the executor directly asks the user for specific information that is genuinely required to continue; this is a valid pause, not a blocker or failed action. Mark repair_needed only when a specific safe callable action can correct the gap without more user input. Mark blocked for an evidenced failure or unavailable operation, including an already observed provider failure that remains unresolved. Output-schema failures cannot be repaired by resending inputs or changing idempotency keys. Do not prescribe retries without a material correction supported by evidence. Correct an inaccurate executor explanation, distinguishing an attempted failed call from one that never ran. Do not invent actions, missing information, or confirmation.",
    "For needs_information, the executor response remains the final user-facing response; verify that it preserves relevant successes and asks the user one direct, specific question. In the audit summary, state briefly what information is needed.",
    "For blocked, summary becomes the final user-facing response: address the user directly, plainly say what failed or could not be completed, state what remains incomplete, preserve relevant verified successes, and correct unsupported claims in the executor response. Never refer to 'the user,' 'the executor,' 'the response,' or the audit. Do not expose internal lifecycle terminology.",
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
  "A receipt index proves only its displayed metadata. When selecting receiptReferences, state the information to check, not an assertion about unseen result contents. Prefer a live domain read for current state; include its tool in requiredTools rather than making historical receipt reconstruction a prerequisite. Prior assistant explanations are claims to verify against tool evidence, especially when continuing failed work.",
  "For an informational continuation, use exact recent conversation entries as evidence when they already answer the question; leave requiredTools empty rather than selecting a tool merely because its catalog topic is related. A focused knowledge tool supplies evidence, not final wording: select it when current facts are needed, and define completion around answering the user's actual question rather than reproducing a stored fact or prior response.",
  "A short yes can confirm a concrete prior offer without repeating its wording. A correction changes only what it explicitly changes. An addition preserves the earlier objective. A question does not confirm a write. A self-contained request to do or redo the work is an action request, not a yes to a previous preview, even when it repeats an earlier request verbatim.",
  "If the user deleted, reset, or rejected an earlier attempt, treat that attempt's saved preview, job, and receipt as historical evidence only. Select the capabilities needed to acquire the source and prepare a fresh attempt. Check current provider state when useful; if the old object is absent, continue the fresh workflow instead of recovering or reconfirming it. Do not claim old ready, exception, or balance counts describe the new attempt.",
  "When the user confirms a prepared MCP change, select its exact active reference in confirmedActionReferenceIds. If no matching reference exists, do not fabricate or infer one.",
  "Use contextRequests to ask the application for small advertised read-only datasets that execution needs up front, such as existing tag, group, or tracker names and IDs. Do not request unrelated views.",
  "When the user names a type advertised as a first-class object, select its cataloged read tool. If it may require an ID absent from the source evidence, also select an advertised discovery read in the same capability family; execution must discover the ID before calling the ID-specific tool. Prefer the owning read alone when it can identify the object and its stable reference directly.",
  "When supplied verified object references resolve a current mention, copy the complete matching bulk binding into objectReferences, including the exact provider ID, stable reference, display name, source, type, and evidence event numbers. An object already identified by a referenced exchange is not rediscovered by name. Leave unrelated candidates out. If no verified reference resolves the mention, keep it unresolved and select the owning read path; never invent or probe an ID.",
  "For work from an uploaded file, select the destination provider's advertised intake workflow when it publishes one. File inspection and transformation support that workflow; do not substitute a general mapping path for a more focused provider-owned intake path.",
  "When a continuation needs an exact prior tool receipt, copy only each required receiptEventSeq and tool from the supplied recent receipt index into receiptReferences and state why execution needs it. Do not copy unrelated receipt entries. Prefer an advertised live domain context view when it directly supplies the current state; receipt recovery is the fallback for state unavailable from a selected view.",
  "Treat a nonempty reply that is incomplete by itself as a continuation when the immediately preceding assistant question or active exchange gives it one unambiguous interpretation. Preserve the exact supplied value and never invent omitted units, identities, dates, or intent; use responseMode clarify when more than one interpretation remains plausible.",
  "When an action request names a weekday, add its exact source phrase, event number, IANA time zone, weekday, resolved YYYY-MM-DD local date, target-or-reference role, and affected temporal field to temporalResolutions. Use the supplied local calendar table; never infer that today has the requested weekday merely because prior work moved records to today. Application code rejects inconsistent weekday/date pairs before execution, and native scheduling tools enforce target dates.",
  "Select every capability family the executor may need. Keep the output concise, source-grounded, and explicit about completion.",
].join("\n");

export const auditInstructions = [
  "You are the completion-audit phase of Chapeaux Fous. Produce only the schema-constrained audit result.",
  "Judge completion from the TurnBrief and receipts, not from confidence or promises in the executor response.",
].join("\n");
