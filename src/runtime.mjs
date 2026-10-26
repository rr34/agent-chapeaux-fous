import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { canonicalizeAgentName } from "./agent-name.mjs";
import { formatUserFacingDates } from "../public/presentation-format.js";
import {
  completionReceiptFindings,
  deferredActionContractProblem,
  deferredActionArgumentProblem,
  extractDeferredActionReference,
  incompleteReceiptResponse,
  pendingConfirmationFindings,
  pendingConfirmationResponse,
} from "./deferred-actions.mjs";
import {
  requestCapabilityCatalog,
  capabilityForTool,
} from "./request-compiler.mjs";
import {
  readResultFilterSchema,
  ResultFilterBoundary,
  splitReadResultFilter,
} from "./search/result-filter.mjs";
import { mcpResultDetails } from "./tools/mcp-tools.mjs";
import { schemaProblem } from "./tools/registry.mjs";
import {
  availableCoreObjectRefs,
  auditContext,
  auditInstructions,
  commonSenseContext,
  commonSenseCoreSchema,
  commonSenseExecutionInstructions,
  commonSenseInstructions,
  completionAuditSchema,
  coreTargetRefs,
  normalizeCompletionAudit,
  parseStructuredModelOutput,
} from "./common-sense-core.mjs";
import {
  temporalConsistencyFindings,
  temporalRepairContext,
} from "./temporal-consistency.mjs";
import {
  currentRequestAttachmentObjectReferences,
  explicitReferenceObjectCatalog,
  flatObjectReferences,
  mergeObjectReferenceGroups,
  objectReferenceGroupsFromToolResult,
  objectReferenceProtectedFields,
  relevantObjectReferenceCatalog,
  unresolvedSelectedObjectCandidates,
} from "./object-references.mjs";
import {
  objectInputBindingProblem,
} from "./object-input-bindings.mjs";
import {
  mergeReferenceSets,
  objectReferenceSets,
  orientationReferenceSetProblem,
  recordedReferenceSets,
  referenceSetObjectRefs,
  selectedReferenceSets,
} from "./reference-sets.mjs";

function argumentsObject(value) {
  if (value == null) return {};
  if (typeof value === "string") return JSON.parse(value || "{}");
  if (typeof value === "object" && !Array.isArray(value)) return value;
  throw new Error("Tool arguments must be a JSON object");
}

function callableToolsFingerprint(tools) {
  return createHash("sha256").update(JSON.stringify(tools)).digest("hex");
}

function selectedObjectCapability(selection) {
  const source = String(selection?.source ?? "");
  if (source.startsWith("mcp:")) return `integration:${source.slice(4)}`;
  if (!source.startsWith("native:")) return null;
  const owner = source.slice("native:".length);
  return ({
    calendar: "calendar",
    contacts: "contacts",
    todos: "todos",
    journal: "journal",
    files: "files",
    profile: "profile",
  })[owner] ?? owner;
}

function objectReferenceGroupsForRefs(groups, refs) {
  const selected = new Set(refs);
  return (groups ?? []).flatMap((group) => {
    const objects = (group.objects ?? []).filter(({ ref }) => selected.has(ref));
    return objects.length ? [{ ...group, role: group.role ?? "subject", objects }] : [];
  });
}

function selectedObjectCandidateGroups(candidates, sourceEventSeq) {
  const byIdentityDomain = new Map();
  for (const candidate of candidates ?? []) {
    if (!candidate?.ref || candidate.id == null || !candidate.type || !candidate.source) continue;
    const key = JSON.stringify([candidate.type, candidate.source]);
    const group = byIdentityDomain.get(key) ?? {
      mention: "Explicit composer selections",
      role: "subject",
      type: candidate.type,
      source: candidate.source,
      objects: [],
      sourceEventSeqs: Number.isSafeInteger(sourceEventSeq) ? [sourceEventSeq] : [],
    };
    group.objects.push({ id: candidate.id, ref: candidate.ref, display: candidate.display });
    byIdentityDomain.set(key, group);
  }
  return mergeObjectReferenceGroups([...byIdentityDomain.values()]);
}

const operationalContinuationCue = /(?:^\s*you\s+can\b|\b(?:again|approve|confirm|continue|earlier|existing|go\s+ahead|it|last|previous(?:ly)?|prior|proceed|resume|same|that|them|these|this|those)\b)/iu;
const localCalendarCue = /(?:\b(?:today|tomorrow|yesterday|tonight|morning|afternoon|evening|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\b(?:this|next|last)\s+(?:day|week|month|year|weekend)\b|\b\d{4}-\d{2}-\d{2}\b)/iu;

function needsPriorOperationalEvidence(requestText, selectedObjectCandidates, referencedExchanges) {
  if ((referencedExchanges ?? []).length) return true;
  // A current composer selection establishes what words such as "this" mean;
  // it does not make separately named targets or prior exact relationship sets
  // irrelevant. Mixed requests commonly select one endpoint and refer to the
  // other endpoint through the immediately preceding result.
  return operationalContinuationCue.test(String(requestText ?? ""));
}

function needsLocalCalendar(requestText) {
  return localCalendarCue.test(String(requestText ?? ""));
}

function exceptionalAuditReasons({ core, receipts, registry, findings, requestText }) {
  const reasons = [...findings.map(({ code, message }) => ({ code, message }))];
  if (receipts.some(({ tool, ok }) => tool === "reference_set_record" && !ok)) {
    reasons.push({
      code: "REFERENCE_SET_RECORD_FAILED",
      message: "Execution attempted but failed to preserve an exact object or relationship set needed for later reference.",
    });
  }
  const domainReceipts = receipts.filter(({ tool }) => (
    !["request_capabilities", "request_tools", "reference_set_record"].includes(tool)
  ));
  const successful = domainReceipts.filter(({ ok }) => ok);
  const failed = domainReceipts.filter(({ ok }) => !ok);
  if (failed.length) {
    reasons.push({
      code: "TOOL_FAILURE_REQUIRES_SEMANTIC_REVIEW",
      message: "At least one domain tool failed; determine whether later receipts recovered the requested outcome.",
    });
  }
  if (core.mode === "act" && core.actions.length > 0 && successful.length === 0) {
    reasons.push({
      code: "ACTION_WITHOUT_SUCCESSFUL_RECEIPT",
      message: "The accepted action has no successful domain-tool receipt.",
    });
  }
  if (core.mode === "act" && core.actions.length > 0 && successful.length > 0
    && !successful.some(({ tool }) => registry.get(tool)?.annotations?.readOnlyHint === false)) {
    reasons.push({
      code: "ACTION_WITHOUT_MUTATION_RECEIPT",
      message: "The accepted action has successful reads but no tool receipt declaring a mutation.",
    });
  }
  for (const receipt of successful) {
    const annotations = registry.get(receipt.tool)?.annotations;
    if (annotations?.destructiveHint === true) {
      reasons.push({
        code: "DESTRUCTIVE_TOOL_RECEIPT",
        message: `${receipt.tool} declares destructive effects.`,
      });
    } else if (annotations?.readOnlyHint !== true && annotations?.readOnlyHint !== false) {
      reasons.push({
        code: "UNKNOWN_TOOL_EFFECTS",
        message: `${receipt.tool} does not declare whether it is read-only.`,
      });
    }
  }
  const destructiveLanguage = [requestText, ...core.actions.map(({ instruction }) => instruction)]
    .join("\n");
  if (/\b(?:delete|destroy|erase|purge)\b/iu.test(destructiveLanguage)) {
    reasons.push({
      code: "DESTRUCTIVE_INTENT_SEMANTICS",
      message: "The request uses destructive language; verify that the tool outcome has the same domain meaning.",
    });
  }
  return [...new Map(reasons.map((reason) => [reason.code, reason])).values()];
}

function callableToolCatalog(tools) {
  return tools
    .filter(({ name }) => !["request_capabilities", "request_tools"].includes(name))
    .map(({ name, title, description, source, upstreamName, capabilityId, capability, annotations }) => {
      const resourceLifecycle = (capability?.resources ?? []).flatMap((resource) => (
        Object.entries(resource.operations ?? {})
          .filter(([, operation]) => operation.available === true && operation.tool === name)
          .map(([operationName, operation]) => ({
            resource: resource.id,
            kind: resource.kind,
            management: resource.management,
            operation: operationName,
            batch: operation.batch,
            ...(operation.note ? { note: operation.note } : {}),
          }))
      ));
      return {
        name,
        title: title ?? null,
        description,
        source,
        upstreamName: upstreamName ?? null,
        capabilityId: capabilityId ?? null,
        annotations: annotations ?? null,
        ...(resourceLifecycle.length ? { resourceLifecycle } : {}),
      };
    });
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function canonicalToolArguments(value) {
  if (Array.isArray(value)) return value.map(canonicalToolArguments);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalToolArguments(value[key])]),
    );
  }
  return value;
}

function connectionReferenceSets(requestId, result, sourceEventSeq) {
  if (!Number.isSafeInteger(sourceEventSeq) || !Array.isArray(result?.results)) return [];
  const definitions = new Map();
  const objectGroups = new Map();
  const relation = (left, right) => {
    const types = new Set([left.type, right.type]);
    if (types.has("todos.personal_task") && types.has("video.content_item")) {
      const from = left.type === "todos.personal_task" ? left : right;
      const to = left.type === "video.content_item" ? left : right;
      return { relationshipType: "todo_content_link", from, to };
    }
    if (types.has("todos.personal_task") && types.has("contacts.contact")) {
      const from = left.type === "todos.personal_task" ? left : right;
      const to = left.type === "contacts.contact" ? left : right;
      return { relationshipType: "todo_related_contact", from, to };
    }
    if (types.has("calendar.event") && types.has("todos.personal_task")) {
      const from = left.type === "calendar.event" ? left : right;
      const to = left.type === "todos.personal_task" ? left : right;
      return { relationshipType: "calendar_todo_context", from, to };
    }
    if (types.has("calendar.event") && types.has("contacts.contact")) {
      const from = left.type === "calendar.event" ? left : right;
      const to = left.type === "contacts.contact" ? left : right;
      return { relationshipType: "calendar_contact_other", from, to };
    }
    return null;
  };
  for (const resultItem of result.results.filter(({ linked }) => linked === true)) {
    const selected = relation(resultItem.from, resultItem.to);
    if (!selected) continue;
    for (const object of [selected.from, selected.to]) {
      const key = JSON.stringify([object.type, object.source]);
      const group = objectGroups.get(key) ?? {
        mention: "Objects in a completed direct connection",
        role: "relationship_endpoint",
        type: object.type,
        source: object.source,
        objects: [],
        sourceEventSeqs: [sourceEventSeq],
      };
      if (!group.objects.some(({ ref }) => ref === object.ref)) {
        group.objects.push({ id: object.id, ref: object.ref, display: object.display });
      }
      objectGroups.set(key, group);
    }
    const key = `${selected.relationshipType}\u0000${selected.from.type}\u0000${selected.to.type}`;
    const definition = definitions.get(key) ?? {
      display: `Completed ${selected.relationshipType} connections`,
      relationshipType: selected.relationshipType,
      fromType: selected.from.type,
      toType: selected.to.type,
      edges: [],
    };
    definition.edges.push({ fromRef: selected.from.ref, toRef: selected.to.ref });
    definitions.set(key, definition);
  }
  if (!definitions.size) return [];
  return recordedReferenceSets({
    requestId,
    relationshipSets: [...definitions.values()],
    availableObjectReferences: [...objectGroups.values()],
  });
}

function toolAttemptKey(name, args) {
  return `${name}\n${JSON.stringify(canonicalToolArguments(args))}`;
}

function receiptAttemptKey(receipt) {
  const argumentsObject = receipt?.resultFilter
    ? { ...(receipt.arguments ?? {}), result_filter: receipt.resultFilter }
    : receipt?.arguments;
  return toolAttemptKey(receipt?.tool, argumentsObject);
}

function regexEscape(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function responseWithCreatedTodoSequences(response, receipts) {
  const text = String(response ?? "").trim();
  const sequencedTasks = new Map();
  for (const receipt of receipts ?? []) {
    if (receipt?.tool !== "todo_add" || receipt.ok !== true) continue;
    const task = receipt.result?.task;
    const sequence = String(task?.sequence ?? "").trim();
    if (!/^\d+$/u.test(sequence)) continue;
    const groupName = String(task?.group_name ?? "").trim();
    const key = `${groupName}\n${sequence}`;
    sequencedTasks.set(key, { groupName, sequence });
  }
  const missing = [...sequencedTasks.values()].filter(({ sequence }) => {
    const number = regexEscape(sequence);
    return !new RegExp(`(?:#\\s*${number}\\b|\\bsequence(?:\\s+number)?\\s*(?:is|:|#)?\\s*${number}\\b)`, "iu").test(text);
  });
  if (missing.length === 0) return text;
  const references = missing.map(({ groupName, sequence }) => (
    `**${groupName ? `${groupName} ` : ""}#${sequence}**`
  ));
  const sequenceNotice = missing.length === 1
    ? `Sequence number: ${references[0]}.`
    : ["Sequence numbers:", ...references.map((reference) => `- ${reference}`)].join("\n");
  return text ? `${text}\n\n${sequenceNotice}` : sequenceNotice;
}

function recentToolReceiptIndex(ledger, recentConversation, maximumReceipts = 16) {
  if (typeof ledger?.toolReceiptList !== "function") return [];
  const requestIds = [...new Set(
    [...recentConversation].reverse().map(({ requestId }) => requestId).filter(Boolean),
  )];
  const receipts = [];
  for (const requestId of requestIds) {
    const page = ledger.toolReceiptList({ requestId, limit: Math.min(6, maximumReceipts) });
    for (const receipt of page.receipts ?? []) {
      receipts.push({
        receiptEventSeq: receipt.receiptEventSeq,
        requestId: receipt.requestId,
        occurredAtUtc: receipt.occurredAtUtc,
        tool: receipt.tool,
        status: receipt.status,
        ok: receipt.ok,
      });
      if (receipts.length >= maximumReceipts) return receipts;
    }
  }
  return receipts;
}

function priorReceiptInstructions(receipts) {
  if (!receipts.length) return "";
  return [
    "# Recent durable receipt index",
    "This compact index is execution evidence for conversational continuations. It does not contain arguments or results. Use tool_receipt_read only when the current request actually needs an opaque value or exact prior outcome; do not treat the index itself as proof and do not repeat the original action to recover evidence.",
    JSON.stringify(receipts, null, 2),
  ].join("\n");
}

const toolFailureKinds = new Set([
  "authentication_failure",
  "contract_mismatch",
  "provider_rejection",
  "provider_state_conflict",
  "transient_provider_failure",
  "transport_failure",
]);

function boundedFailureString(value, maximumLength = 2048) {
  return typeof value === "string" && value.length > 0 && value.length <= maximumLength
    ? value
    : null;
}

function normalizedToolFailure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.contractVersion !== 1
    || !toolFailureKinds.has(value.kind)
    || !/^[A-Z][A-Z0-9_]{2,127}$/.test(value.code ?? "")
    || typeof value.terminalForCurrentRequest !== "boolean") {
    return null;
  }
  const requiredStrings = [
    "retry", "serverName", "capabilityId", "transportId", "contractFingerprint", "step",
  ];
  if (requiredStrings.some((field) => boundedFailureString(value[field]) === null)) return null;
  if (!/^[0-9a-f]{64}$/.test(value.contractFingerprint)) return null;
  const method = value.method == null ? null : boundedFailureString(value.method, 32);
  const requestPath = value.path == null ? null : boundedFailureString(value.path);
  const httpStatus = value.httpStatus == null ? null : Number(value.httpStatus);
  if ((value.method != null && method === null)
    || (value.path != null && requestPath === null)
    || (httpStatus !== null && (!Number.isSafeInteger(httpStatus) || httpStatus < 100 || httpStatus > 599))) {
    return null;
  }
  return {
    contractVersion: 1,
    kind: value.kind,
    code: value.code,
    terminalForCurrentRequest: value.terminalForCurrentRequest,
    retry: value.retry,
    serverName: value.serverName,
    capabilityId: value.capabilityId,
    transportId: value.transportId,
    contractFingerprint: value.contractFingerprint,
    step: value.step,
    method,
    path: requestPath,
    httpStatus,
  };
}

export function terminalToolFailureFindings(receipts) {
  return receipts.flatMap((receipt) => {
    const toolFailure = normalizedToolFailure(receipt?.toolFailure);
    if (!toolFailure?.terminalForCurrentRequest) return [];
    return [{
      code: "TERMINAL_TOOL_CONTRACT_FAILURE",
      tool: receipt.tool,
      message: `${receipt.tool} encountered ${toolFailure.code}; the unchanged operation is terminal for this request.`,
      repairInstruction: "Do not retry this operation or substitute another transport. Preserve earlier receipts and report the MCP or connection change required before retrying.",
      terminalForCurrentRequest: true,
      toolFailure,
    }];
  });
}

function repeatedToolFailure(receipts, name, message, definition, toolArguments) {
  const readOnly = definition?.annotations?.readOnlyHint === true;
  const attemptKey = toolAttemptKey(name, toolArguments);
  // A different read argument may correct an invalid identifier; repeated write errors stay terminal.
  if (!receipts.some((receipt) => receipt.tool === name && !receipt.ok && receipt.error === message
    && (!readOnly || toolAttemptKey(name, receipt.arguments) === attemptKey))) return null;
  const serverName = definition?.source?.replace(/^mcp:/u, "") || "Application tool";
  return {
    contractVersion: 1, kind: "provider_rejection", code: "REPEATED_TOOL_ERROR",
    terminalForCurrentRequest: true, retry: "after_underlying_error_is_corrected_in_a_new_request",
    serverName, capabilityId: definition?.capabilityId || "native",
    transportId: name, contractFingerprint: createHash("sha256").update(message).digest("hex"),
    step: "repeated_tool_error", method: null, path: null, httpStatus: null,
  };
}

function terminalToolFailureNotice(findings) {
  const failure = findings[0]?.toolFailure;
  if (!failure) return "";
  if (failure.step === "tool_result_validation") {
    return `${failure.serverName} returned a result that failed its tool's output contract. The operation was attempted; this error does not prove whether it changed data. Use the verification results above for the observed state. Further attempts are blocked until the provider is corrected and its tools are rediscovered.`;
  }
  if (failure.step === "repeated_tool_error") {
    return `${failure.serverName} repeatedly failed with the same error. Automatic retries have stopped. The requested work remains incomplete unless confirmed by successful receipts; the underlying error needs correction before another attempt.`;
  }
  if (failure.step === "final_confirmation_handoff") {
    return `${failure.serverName} finished the preview but did not return a usable final yes-or-no step. Nothing was changed, and Agent Slayer saved the result instead of retrying. Refresh the integration after ${failure.serverName} is corrected, then try again.`;
  }
  const operation = [failure.method, failure.path].filter(Boolean).join(" ");
  const status = failure.httpStatus == null ? failure.code : `HTTP ${failure.httpStatus}`;
  return [
    `Transfer status: ${failure.serverName} did not honor its advertised artifact-transfer contract`,
    operation ? ` for ${operation}` : "",
    ` (${status}). The unchanged transfer will not be retried until the integration is refreshed after the MCP changes. Earlier successful steps remain recorded.`,
  ].join("");
}

const internalBlockedResponseNarration = /\b(?:the user|the executor|the (?:executor|proposed|repaired) response|(?:completion|post-repair|semantic) audit|audit (?:outcome|result|summary)|(?:execution|mutation|repaired|tool) receipts?|repair(?:ed)? (?:attempt|outcome|response))\b/iu;

function protectedReadResultFields(toolDefinition, toolDefinitions) {
  return [...new Set([
    ...objectReferenceProtectedFields(toolDefinition, toolDefinitions),
    ...(toolDefinition?.readResultProtectedFields ?? []),
  ])];
}

function blockedAuditResponse(audit) {
  const summary = String(audit?.summary ?? "").trim();
  if (summary && !internalBlockedResponseNarration.test(summary)) return summary;
  const satisfied = audit?.satisfied ?? audit?.satisfiedCriteria;
  const remainingActions = audit?.remaining ?? audit?.remainingActions;
  const partial = Array.isArray(satisfied) && satisfied.length > 0;
  const opening = partial
    ? "I completed part of the request, but I couldn't complete everything requested."
    : "I couldn't complete the request.";
  const remaining = Array.isArray(remainingActions)
    ? remainingActions.map((action) => String(action).trim()).filter(Boolean)
    : [];
  return remaining.length
    ? [opening, "", "Still incomplete:", ...remaining.map((action) => `- ${action}`)].join("\n")
    : opening;
}

function finalConfirmationHandoffFailure(toolName, toolDefinition) {
  const source = String(toolDefinition?.source ?? "mcp:unknown");
  const native = source === "local";
  const serverName = source.startsWith("mcp:") ? source.slice(4) : source;
  const contractFingerprint = createHash("sha256").update(JSON.stringify(canonicalToolArguments({
    source,
    upstreamName: toolDefinition?.upstreamName ?? null,
    parameters: toolDefinition?.parameters ?? null,
    outputSchema: toolDefinition?.outputSchema ?? null,
  }))).digest("hex");
  return {
    contractVersion: 1,
    kind: "contract_mismatch",
    code: native ? "NATIVE_FINAL_CONFIRMATION_INVALID" : "MCP_FINAL_CONFIRMATION_INVALID",
    terminalForCurrentRequest: true,
    retry: native
      ? "after_native_contract_correction_and_application_restart"
      : "after_provider_contract_correction_and_integration_refresh",
    serverName,
    capabilityId: toolDefinition?.capabilityId ?? `integration:${serverName}`,
    transportId: native ? "native-tool-registry" : "mcp-control-plane",
    contractFingerprint,
    step: "final_confirmation_handoff",
    method: null,
    path: null,
    httpStatus: null,
    sourceTool: toolName,
  };
}

function joinedInstructions(...sections) {
  return sections.map((section) => String(section ?? "").trim()).filter(Boolean).join("\n\n");
}

function compactWorkingContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const fields = [
    "active_frontdoor_id", "active_item_id", "active_task_id", "current_project_id",
    "ActiveContextVersion", "context_version", "active_scope", "breadcrumb",
  ];
  return Object.fromEntries(fields.filter((name) => Object.hasOwn(value, name)).map((name) => [name, value[name]]));
}

function continuationEvidence(value) {
  if (Array.isArray(value)) return value.map(continuationEvidence);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).flatMap(([name, child]) => {
    // Old receipts may contain retired schema attachments; keep them out of continuation context.
    if (["schema_contexts", "schemaProjection", "result_filter"].includes(name)) return [];
    if (name === "working_context") return [[name, compactWorkingContext(child)]];
    return [[name, continuationEvidence(child)]];
  }));
}

function continuationReceipt(receipt) {
  const compact = {
    receiptEventSeq: receipt.receiptEventSeq ?? null,
    tool: receipt.tool,
    status: receipt.ok ? "complete" : "error",
    arguments: receipt.arguments,
    ...(Object.hasOwn(receipt, "result") ? { evidence: continuationEvidence(receipt.result) } : {}),
    ...(receipt.error ? { error: receipt.error } : {}),
    ...(receipt.toolFailure ? { toolFailure: receipt.toolFailure } : {}),
    ...(receipt.deferredActionReference ? { deferredActionReference: receipt.deferredActionReference } : {}),
  };
  return compact;
}

function structuralEvidenceSummary(value, pointer = "", depth = 0, budget = { nodes: 1500 }) {
  const stored = () => ({
    storedAt: pointer || "/", type: Array.isArray(value) ? "array" : typeof value,
    ...(typeof value === "string" ? { characters: value.length }
      : Array.isArray(value) ? { items: value.length } : {}),
  });
  // Summarize whole values with exact source paths; never cut prose or a JSON
  // record into a prefix, and never manufacture a semantic interpretation.
  if (--budget.nodes < 0 || depth > 10 || (typeof value === "string" && value.length > 512)) return stored();
  if (Array.isArray(value)) return value.map((child, index) => structuralEvidenceSummary(child, `${pointer}/${index}`, depth + 1, budget));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key, structuralEvidenceSummary(child, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, depth + 1, budget),
  ]));
  return value;
}

export function sameRequestReceiptInstructions(receipts, maximumCharacters = 24_000) {
  if (!receipts.length) return "";
  const header = [
    "# Earlier execution evidence from this same user request",
    "Each source-referenced entry below is the compact canonical continuation projection of one durable tool receipt. Treat successful entries as completed actions, continue from their evidence, and do not repeat them unless the user explicitly asked for repetition.",
    "Entries marked evidenceStoredInDurableReceipt are structural summaries, not complete results. storedAt identifies a whole value retained in the durable receipt projection; no text prefix or inferred meaning replaces it. Read missing evidence only when needed. The receipt index preserves every source and outcome even when its detail does not fit. Never repeat an action to recover evidence.",
  ].join("\n");
  const index = {};
  for (const receipt of receipts) {
    const key = `${receipt.tool}:${receipt.ok ? "complete" : "error"}`;
    (index[key] ??= []).push(receipt.receiptEventSeq ?? null);
  }
  const sourceIndex = `Receipt index (tool:outcome → source event numbers): ${JSON.stringify(index)}`;
  // Reserve room for references before admitting any large result. Spend the
  // remaining space on recent evidence first, then render in original order.
  // An early schema discovery must not displace later records or write receipts.
  const blocks = [];
  let characters = header.length + sourceIndex.length + 2;
  if (characters > maximumCharacters) return "";
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const receipt = receipts[index];
    const reference = JSON.stringify({
      receiptEventSeq: receipt.receiptEventSeq ?? null,
      tool: receipt.tool,
      status: receipt.ok ? "complete" : "error",
      evidenceStoredInDurableReceipt: true,
    });
    if (characters + reference.length + 2 > maximumCharacters) continue;
    blocks.push({ index, text: reference });
    characters += reference.length + 2;
  }
  for (const block of blocks) {
    const projection = continuationReceipt(receipts[block.index]);
    const summary = JSON.stringify({ ...structuralEvidenceSummary(projection), evidenceStoredInDurableReceipt: true });
    if (characters + summary.length - block.text.length <= maximumCharacters) {
      characters += summary.length - block.text.length;
      block.text = summary;
    }
  }
  for (const block of blocks) {
    const exact = JSON.stringify(continuationReceipt(receipts[block.index]));
    const additionalCharacters = exact.length - block.text.length;
    if (characters + additionalCharacters > maximumCharacters) continue;
    block.text = exact;
    characters += additionalCharacters;
  }
  return [
    header, sourceIndex,
    ...blocks.reverse().map(({ text }) => text),
  ].join("\n\n");
}

function inlineToolResult(toolResult, { tool, receiptEventSeq, maximumCharacters }) {
  const serialized = JSON.stringify(toolResult ?? null);
  if (serialized.length <= maximumCharacters || !Number.isSafeInteger(receiptEventSeq)) {
    return { deliveredResult: toolResult, fullResultCharacters: serialized.length, paged: false };
  }
  return {
    deliveredResult: {
      full_result_stored_in_receipt: true,
      receipt_event_seq: receiptEventSeq,
      tool,
      full_result_characters: serialized.length,
      continuation: "Call tool_receipt_read with this receipt_event_seq starting at offset 0 to page the exact call arguments, result, and status. No arbitrary JSON prefix was included because it could split a value or record. Do not repeat the original tool action.",
    },
    fullResultCharacters: serialized.length,
    paged: true,
  };
}

function providerToolError(tool, result) {
  const serialized = JSON.stringify(result ?? null);
  const detail = serialized.length > 2 && serialized.length <= 2_000 ? `: ${serialized}` : "";
  return `${tool} returned an MCP error result${detail}`;
}

export class SlayerRuntime {
  constructor({
    modelTransport, registry, contextBuilder, requestCompiler = null, ledger, config,
    resultFilter = new ResultFilterBoundary(),
    objectReferenceFilter = (groups) => groups,
  }) {
    this.modelTransport = modelTransport;
    this.registry = registry;
    this.contextBuilder = contextBuilder;
    this.requestCompiler = requestCompiler;
    this.ledger = ledger;
    this.config = config;
    this.resultFilter = resultFilter;
    this.objectReferenceFilter = objectReferenceFilter;
    this.systemPrompt = null;
  }

  async loadSystemPrompt() {
    if (this.systemPrompt == null) this.systemPrompt = await fs.readFile(this.config.systemPromptPath, "utf8");
    return this.systemPrompt;
  }

  async #runStructuredStep({
    requestId,
    channel,
    step,
    label,
    stepIndex,
    model,
    effort,
    input,
    developerInstructions,
    requestAttachmentInput = null,
    outputSchema,
    runTimeoutMs = null,
  }) {
    const operationId = `${this.modelTransport.id}:${requestId}:${step}`;
    this.ledger.append({
      type: "agent.step", phase: "start", status: "processing", actorType: "service",
      actorName: "Structured turn workflow", channel, turnId: requestId, operationId,
      name: label, content: `Started ${label.toLowerCase()}`,
      payload: { workflowStep: step, workflowStepLabel: label, stepIndex, reasoningEffort: effort },
    });
    const filteredContext = this.resultFilter.filterContext(developerInstructions, {
      requestId,
      interactionId: operationId,
      source: `${step}.developer_context`,
      maximumCharacters: this.config.maxFilteredContextCharacters ?? 256 * 1024,
    });
    developerInstructions = filteredContext.text;
    this.ledger.append({
      type: "search.filter", status: "complete", actorType: "service",
      actorName: "Search result filter", channel, turnId: requestId, operationId,
      name: `${label} context filter`, content: filteredContext.receipt.status,
      payload: filteredContext.receipt,
    });
    const turnRequest = {
      model,
      effort,
      conversationId: null,
      baseInstructions: step.startsWith("orientation")
        ? commonSenseInstructions
        : auditInstructions,
      developerInstructions,
      input,
      requestAttachmentInput,
      tools: [],
      outputSchema,
      maxToolCalls: 0,
      runTimeoutMs,
    };
    const providerRequest = this.modelTransport.describeRequest(turnRequest);
    this.ledger.append({
      type: "context.sent", status: "complete", actorType: "system", actorName: "Context builder",
      channel, turnId: requestId, name: `${label} context sent`, content: developerInstructions,
      payload: {
        workflowStep: step, workflowStepLabel: label, stepIndex,
        structuredOutputSchema: providerRequest.outputSchema
          ?? providerRequest.structuredOutput
          ?? outputSchema,
        boundedContextCharacters: developerInstructions.length,
      },
    });
    this.ledger.append({
      type: "tools.sent", status: "complete", actorType: "system", actorName: "Tool registry",
      channel, turnId: requestId, name: `No tools callable during ${label.toLowerCase()}`,
      payload: {
        workflowStep: step, workflowStepLabel: label, stepIndex,
        count: 0, availableCount: this.registry.toolDefinitions().length, tools: [],
      },
    });
    this.ledger.append({
      type: "model.request", phase: "start", status: "processing", actorType: "service",
      actorName: `${this.modelTransport.displayName} transport`, channel, turnId: requestId,
      operationId, name: `${label} model request`,
      payload: {
        ...providerRequest,
        workflowStep: step, workflowStepLabel: label, stepIndex, reasoningEffort: effort,
      },
    });
    let responseRecorded = false;
    try {
      const result = await this.modelTransport.runTurn({
        ...turnRequest,
        onEvent: (event) => {
          if (event.type !== "request.started") return;
          this.ledger.append({
            type: "model.call", phase: "start", status: "processing", actorType: "service",
            actorName: model, channel, turnId: requestId, operationId, name: "LLM call",
            payload: { ...event, workflowStep: step, workflowStepLabel: label, stepIndex },
          });
        },
        onToolCall: async ({ tool }) => {
          throw new Error(`${tool} is not callable during ${label.toLowerCase()}`);
        },
      });
      this.ledger.append({
        type: "model.response", phase: "end", status: "complete", actorType: "model",
        actorName: model, channel, turnId: requestId, operationId, name: `${label} model response`,
        content: result.text,
        payload: {
          workflowStep: step, workflowStepLabel: label, stepIndex,
          transport: this.modelTransport.id,
          conversationId: result.conversationId ?? result.threadId ?? null,
          providerTurnId: result.providerTurnId ?? result.turnId ?? null,
          status: result.status,
          messages: result.messages,
          protocolEvents: result.events,
        },
      });
      this.ledger.append({
        type: "model.usage", status: "complete", actorType: "service",
        actorName: `${this.modelTransport.displayName} usage`, channel, turnId: requestId,
        operationId, name: `${label} model usage`,
        payload: {
          ...result.usage,
          workflowStep: step, workflowStepLabel: label, stepIndex, reasoningEffort: effort,
        },
      });
      responseRecorded = true;
      const parsedValue = parseStructuredModelOutput(result.text, outputSchema, label);
      const value = outputSchema === completionAuditSchema
        ? normalizeCompletionAudit(parsedValue)
        : parsedValue;
      this.ledger.append({
        type: "agent.step", phase: "end", status: "complete", actorType: "service",
        actorName: "Structured turn workflow", channel, turnId: requestId, operationId,
        name: label, content: value.summary ?? `Completed ${label.toLowerCase()}`,
        payload: { workflowStep: step, workflowStepLabel: label, stepIndex, reasoningEffort: effort, result: value },
      });
      return { value, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const diagnostics = error?.data && typeof error.data === "object" && !Array.isArray(error.data)
        ? error.data
        : {};
      if (!responseRecorded) {
        this.ledger.append({
          type: "model.response", phase: "error", status: "error", actorType: "external",
          actorName: this.modelTransport.displayName, channel, turnId: requestId,
          operationId, name: `${label} model response failed`, payload: diagnostics, error: message,
        });
        if (diagnostics.usage) {
          this.ledger.append({
            type: "model.usage", status: "complete", actorType: "service",
            actorName: `${this.modelTransport.displayName} usage`, channel, turnId: requestId,
            operationId, name: `${label} model usage before failure`,
            payload: {
              ...diagnostics.usage,
              workflowStep: step, workflowStepLabel: label, stepIndex, reasoningEffort: effort,
              responseFailed: true,
            },
          });
        }
      }
      this.ledger.append({
        type: "agent.step", phase: "error", status: "error", actorType: "service",
        actorName: "Structured turn workflow", channel, turnId: requestId, operationId,
        name: label, content: message, error: message,
        payload: { workflowStep: step, workflowStepLabel: label, stepIndex, reasoningEffort: effort },
      });
      throw error;
    }
  }

  async #runExecutorStep(args, { step, label, stepIndex, effort, initialReceipts = [] }) {
    const operationId = `${this.modelTransport.id}:${args.requestId}:${step}`;
    this.ledger.append({
      type: "agent.step", phase: "start", status: "processing", actorType: "service",
      actorName: "Structured turn workflow", channel: args.channel ?? "web", turnId: args.requestId,
      operationId, name: label, content: `Started ${label.toLowerCase()}`,
      payload: { workflowStep: step, workflowStepLabel: label, stepIndex, reasoningEffort: effort },
    });
    try {
      const execution = await this.#runExecutor({
        ...args,
        effort,
        workflowStep: step,
        workflowStepLabel: label,
        stepIndex,
        isolatedConversation: true,
        conversationStartEventSeq: typeof this.ledger.conversationBoundaryEventSeq === "function"
          ? this.ledger.conversationBoundaryEventSeq()
          : 0,
        initialReceipts,
      });
      this.ledger.append({
        type: "agent.step", phase: "end", status: "complete", actorType: "service",
        actorName: "Structured turn workflow", channel: args.channel ?? "web", turnId: args.requestId,
        operationId, name: label, content: execution.text,
        payload: {
          workflowStep: step, workflowStepLabel: label, stepIndex, reasoningEffort: effort,
          toolCallCount: execution.toolCallCount,
        },
      });
      return execution;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ledger.append({
        type: "agent.step", phase: "error", status: "error", actorType: "service",
        actorName: "Structured turn workflow", channel: args.channel ?? "web", turnId: args.requestId,
        operationId, name: label, content: message, error: message,
        payload: { workflowStep: step, workflowStepLabel: label, stepIndex, reasoningEffort: effort },
      });
      throw error;
    }
  }

  async #runCommonSenseWorkflow(args) {
    const channel = args.channel ?? "web";
    const workflowStartedAt = Date.now();
    let pausedDurationMs = 0;
    const configuredTimeoutMs = args.runLimits?.timeoutMs ?? null;
    const configuredMaxToolCalls = args.runLimits == null
      ? this.config.maxToolCalls
      : args.runLimits.maxToolCalls;
    const remainingTimeoutMs = () => {
      if (configuredTimeoutMs === null) return null;
      const remaining = configuredTimeoutMs - (Date.now() - workflowStartedAt - pausedDurationMs);
      if (remaining <= 0) throw new Error(`Turn workflow timed out after ${configuredTimeoutMs}ms`);
      return remaining;
    };

    const registeredTools = this.registry.toolDefinitions();
    const allowedToolNames = Array.isArray(args.allowedToolNames)
      ? new Set(args.allowedToolNames)
      : null;
    const availableTools = allowedToolNames
      ? registeredTools.filter(({ name }) => allowedToolNames.has(name))
      : registeredTools;
    if (allowedToolNames && availableTools.length !== allowedToolNames.size) {
      const availableNames = new Set(availableTools.map(({ name }) => name));
      const unavailable = [...allowedToolNames].filter((name) => !availableNames.has(name));
      throw new Error(`Authorized request tool is unavailable: ${unavailable.join(", ")}`);
    }

    const boundaryEventSeq = typeof this.ledger.conversationBoundaryEventSeq === "function"
      ? this.ledger.conversationBoundaryEventSeq()
      : 0;
    const recentConversation = typeof this.ledger.recentConversation === "function"
      ? this.ledger.recentConversation({
          beforeRequestId: args.requestId,
          afterEventSeq: boundaryEventSeq,
          limit: 3,
        })
      : [];
    const previousState = typeof this.ledger.latestConversationState === "function"
      ? this.ledger.latestConversationState({ afterEventSeq: boundaryEventSeq })
      : null;
    const catalog = requestCapabilityCatalog(availableTools);
    const routing = await this.requestCompiler.compile({
      tools: availableTools,
      text: args.text,
      attachment: args.attachment,
      recentConversation,
      previousCapabilities: [],
    });
    const directlyRoutedCapabilities = routing.capabilities.filter((capability) => (
      routing.reasons.some((reason) => (
        reason === `${capability}:request`
        || reason === `${capability}:declared-alias`
        || reason.startsWith(`${capability}:explicit-hat:`)
      ))
    ));
    const activeActionReferences = typeof this.ledger.activeDeferredActionReferences === "function"
      ? this.ledger.activeDeferredActionReferences({ afterEventSeq: boundaryEventSeq })
      : [];
    const referencedExchanges = typeof this.ledger.referencedExchangesForRequest === "function"
      ? this.ledger.referencedExchangesForRequest(args.requestId, { limit: 8 })
      : [];
    const includePriorOperationalEvidence = needsPriorOperationalEvidence(
      args.text,
      args.selectedObjectCandidates,
      referencedExchanges,
    );
    // Orientation always receives the bounded recent exchange. It decides how
    // much that conversation matters; a keyword gate cannot reliably classify
    // ordinary continuations such as "You can connect ...". Exact operational
    // evidence remains gated so unrelated old bindings, receipts, and deferred
    // actions do not become current action targets.
    const relevantConversation = recentConversation;
    const relevantActionReferences = includePriorOperationalEvidence ? activeActionReferences : [];
    const recentToolReceipts = recentToolReceiptIndex(this.ledger, [
      ...(includePriorOperationalEvidence ? relevantConversation : []),
      ...referencedExchanges.map(({ requestId }) => ({ requestId })),
    ]);
    const reusableReferencedExchanges = referencedExchanges.filter((exchange) => (
      exchange.objectReferencePolicy == null
        ? exchange.taskOutcome !== "incomplete" && exchange.status !== "error"
        : exchange.objectReferencePolicy !== "fresh_read_required"
    ));
    const reusableReferencedObjectReferences = this.objectReferenceFilter(
      reusableReferencedExchanges.flatMap(({ objectReferences = [] }) => objectReferences),
    );
    const requestEventSeq = typeof this.ledger.eventSequence === "function"
      ? this.ledger.eventSequence(args.requestEventId)
      : null;
    const currentAttachmentReferences = currentRequestAttachmentObjectReferences(
      args.attachment,
      requestEventSeq,
    );
    const recentEvidenceText = [
      args.text,
      ...relevantConversation.map(({ content }) => content),
    ].filter(Boolean).join("\n");
    const inheritedReferenceSets = mergeReferenceSets([
      ...(includePriorOperationalEvidence
        ? relevantConversation.flatMap(({ referenceSets = [] }) => referenceSets)
        : []),
      ...reusableReferencedExchanges.flatMap(({ referenceSets = [] }) => referenceSets),
    ]);
    const inheritedSetObjectRefs = referenceSetObjectRefs(inheritedReferenceSets);
    const relevantRecentObjectReferences = relevantObjectReferenceCatalog(
      this.objectReferenceFilter(includePriorOperationalEvidence
        ? relevantConversation.flatMap(({ objectReferences = [] }) => objectReferences)
        : []),
      {
        evidenceText: recentEvidenceText,
        alwaysRefs: inheritedSetObjectRefs,
        // Orientation is the semantic selection point. Do not truncate a
        // relevant prior batch before the model can select its members or its
        // compact generated set.
        maximumObjects: Math.max(500, inheritedSetObjectRefs.length),
      },
    );
    const availableObjectReferences = explicitReferenceObjectCatalog(
      relevantRecentObjectReferences,
      this.objectReferenceFilter([
        ...reusableReferencedObjectReferences,
        ...currentAttachmentReferences,
      ]),
    );
    const selectedObjectCandidates = args.selectedObjectCandidates ?? [];
    const orientationObjectReferences = mergeObjectReferenceGroups([
      ...availableObjectReferences,
      ...selectedObjectCandidateGroups(selectedObjectCandidates, requestEventSeq),
    ]);
    const availableReferenceSets = mergeReferenceSets([
      ...inheritedReferenceSets,
      ...objectReferenceSets(orientationObjectReferences),
    ]);
    const orientationBaseContext = await this.contextBuilder.build(args.requestId, args.text, {
      attachment: args.attachment,
      nativeConversation: false,
      continuingConversation: false,
      conversationStartEventSeq: boundaryEventSeq,
      capabilities: [],
      conversationCheckpoint: null,
      includeRecentExchanges: false,
      includeReferencedObjectReferences: false,
    });
    const schema = commonSenseCoreSchema({
      capabilities: catalog.map(({ capability }) => capability),
      contextViewIds: catalog.flatMap(({ contextViews = [] }) => contextViews.map(({ id }) => id)),
      actionReferenceIds: relevantActionReferences.map(({ referenceId }) => referenceId),
      objectRefs: availableCoreObjectRefs(orientationObjectReferences, selectedObjectCandidates),
      objectSetRefs: availableReferenceSets
        .filter(({ kind }) => kind === "object_set").map(({ ref }) => ref),
      relationshipSetRefs: availableReferenceSets
        .filter(({ kind }) => kind === "relationship_set").map(({ ref }) => ref),
      objectTypes: flatObjectReferences(orientationObjectReferences).map(({ type }) => type),
      requestId: args.requestId,
    });
    const priorConversationSummary = JSON.stringify({
      priorObjective: previousState?.activeObjective ?? null,
      openQuestions: previousState?.unresolvedQuestions ?? [],
      recent: relevantConversation.map(({ eventSeq, role, content }) => ({ eventSeq, role, content })),
    }, null, 2);
    const orientationDeveloperInstructions = joinedInstructions(
      commonSenseContext({
        requestId: args.requestId,
        requestEventSeq,
        requestText: args.text,
        recentConversation: relevantConversation,
        conversationSummary: priorConversationSummary,
        capabilityCatalog: catalog,
        selectedObjectCandidates,
        availableObjectReferences,
        availableReferenceSets,
        deferredActionReferences: relevantActionReferences,
        explicitHats: routing.explicitHats,
        localCalendar: needsLocalCalendar(args.text)
          ? orientationBaseContext.localCalendar ?? null
          : null,
      }),
      args.supplementalInstructions,
    );
    let orientation = await this.#runStructuredStep({
      requestId: args.requestId,
      channel,
      step: "orientation",
      label: "Understand request",
      stepIndex: 1,
      model: args.model || this.config.model,
      effort: this.config.orientationReasoningEffort ?? "medium",
      input: args.text,
      developerInstructions: orientationDeveloperInstructions,
      requestAttachmentInput: orientationBaseContext.requestAttachmentInput ?? null,
      outputSchema: schema,
      runTimeoutMs: remainingTimeoutMs(),
    });
    const withCoreReadCapabilities = (value) => ({
      ...value,
      capabilities: [...new Set([
        ...value.capabilities,
        ...routing.capabilities.filter((capability) => (
          capability === "database"
          && (
            directlyRoutedCapabilities.includes("database")
            || !directlyRoutedCapabilities.includes("relationships")
          )
        )),
      ])],
    });
    const acceptedCore = (value) => {
      const accepted = withCoreReadCapabilities(value);
      const problem = orientationReferenceSetProblem(accepted, {
        requestId: args.requestId,
        availableSets: availableReferenceSets,
        availableObjectReferences: orientationObjectReferences,
      });
      if (problem) throw new Error(`Common-sense reference selection is invalid: ${problem}`);
      return accepted;
    };
    let orientationSelectedCapabilities = [...orientation.value.capabilities];
    let core = acceptedCore(orientation.value);
    let temporalFindings = temporalConsistencyFindings(core, {
      requestText: args.text,
      requestEventSeq,
    });
    this.ledger.append({
      type: "orientation.validation",
      phase: temporalFindings.length ? "error" : "end",
      status: temporalFindings.length ? "error" : "complete",
      actorType: "service",
      actorName: "Common-sense core validator",
      channel,
      turnId: args.requestId,
      name: temporalFindings.length ? "Orientation validation failed" : "Orientation validation passed",
      content: temporalFindings.length
        ? temporalFindings.map(({ message }) => message).join("; ")
        : "Common-sense core validation passed",
      payload: { findings: temporalFindings, temporalResolutions: core.temporalResolutions },
      ...(temporalFindings.length ? { error: temporalFindings.map(({ message }) => message).join("; ") } : {}),
    });
    if (temporalFindings.length) {
      orientation = await this.#runStructuredStep({
        requestId: args.requestId,
        channel,
        step: "orientation_correction",
        label: "Correct date interpretation",
        stepIndex: 1,
        model: args.model || this.config.model,
        effort: this.config.orientationReasoningEffort ?? "medium",
        input: args.text,
        developerInstructions: joinedInstructions(
          orientationDeveloperInstructions,
          temporalRepairContext(core, temporalFindings),
        ),
        requestAttachmentInput: orientationBaseContext.requestAttachmentInput ?? null,
        outputSchema: schema,
        runTimeoutMs: remainingTimeoutMs(),
      });
      orientationSelectedCapabilities = [...orientation.value.capabilities];
      core = acceptedCore(orientation.value);
      temporalFindings = temporalConsistencyFindings(core, {
        requestText: args.text,
        requestEventSeq,
      });
      if (temporalFindings.length) {
        throw new Error(`Date interpretation remained inconsistent after correction: ${temporalFindings.map(({ message }) => message).join("; ")}`);
      }
    }

    const applicationReadCapabilities = core.capabilities.filter((capability) => (
      !orientationSelectedCapabilities.includes(capability)
    ));
    if (applicationReadCapabilities.length) {
      this.ledger.append({
        type: "capability.selection", status: "complete", actorType: "system",
        actorName: "Capability selector", channel, turnId: args.requestId,
        name: "Required read-only core capabilities added",
        content: applicationReadCapabilities.join(", "),
        payload: {
          selectedByOrientation: orientationSelectedCapabilities,
          addedReadOnlyCoreCapabilities: applicationReadCapabilities,
          acceptedCapabilities: core.capabilities,
        },
      });
    }

    const contextRequests = [...new Set([
      ...core.contextRequests,
      ...(selectedObjectCandidates.length ? ["search.native_object_candidates"] : []),
    ])];
    const contextOperationId = `${this.modelTransport.id}:${args.requestId}:context_preparation`;
    this.ledger.append({
      type: "agent.step", phase: "start", status: "processing", actorType: "service",
      actorName: "Structured turn workflow", channel, turnId: args.requestId,
      operationId: contextOperationId, name: "Prepare execution context",
      content: "Started preparing bounded execution context",
      payload: {
        workflowStep: "context_preparation", workflowStepLabel: "Prepare execution context",
        stepIndex: 2, reasoningEffort: null, requests: contextRequests,
      },
    });
    let preparedCapabilityContext;
    let preparedObjectReferences;
    try {
      preparedCapabilityContext = await this.registry.prepareContext(contextRequests, {
        requestId: args.requestId,
        requestEventId: args.requestEventId,
        requestText: args.text,
        selectedObjectCandidates,
        channel,
      });
      const contextEventId = this.ledger.append({
        type: "context.prepared", status: "complete", actorType: "service",
        actorName: "Capability context", channel, turnId: args.requestId,
        operationId: contextOperationId, name: "Execution context prepared",
        content: preparedCapabilityContext.length
          ? preparedCapabilityContext.map(({ title, view }) => `${title} (${view})`).join(", ")
          : "No capability context requested",
        payload: { requests: contextRequests, sections: preparedCapabilityContext },
      });
      const contextEventSeq = typeof this.ledger.eventSequence === "function"
        ? this.ledger.eventSequence(contextEventId)
        : null;
      preparedObjectReferences = mergeObjectReferenceGroups(preparedCapabilityContext.flatMap(
        (section) => objectReferenceGroupsFromToolResult({
          toolDefinition: {
            name: `context:${section.view}`,
            source: "local",
            capabilityId: section.capability,
          },
          result: section.data ?? section,
          sourceEventSeq: contextEventSeq,
        }),
      ));
      const unresolvedSelections = unresolvedSelectedObjectCandidates(
        selectedObjectCandidates,
        preparedObjectReferences,
      );
      if (unresolvedSelections.length) {
        const missing = unresolvedSelections.map(({ display, type, id, ref }) => ({
          display, type, id, ref,
        }));
        throw new Error(`Every selected object must be verified before execution. Missing or unavailable selections: ${JSON.stringify(missing)}`);
      }
      if (preparedObjectReferences.length) {
        this.ledger.append({
          type: "object.references.observed", status: "complete", actorType: "service",
          actorName: "Object reference binder", channel, turnId: args.requestId,
          operationId: contextOperationId, name: "Verified context object references observed",
          content: `${preparedObjectReferences.reduce((count, group) => count + group.objects.length, 0)} verified object references from prepared context`,
          payload: { sourceContextEventSeq: contextEventSeq, objectReferences: preparedObjectReferences },
        });
      }
      this.ledger.append({
        type: "agent.step", phase: "end", status: "complete", actorType: "service",
        actorName: "Structured turn workflow", channel, turnId: args.requestId,
        operationId: contextOperationId, name: "Prepare execution context",
        content: preparedCapabilityContext.length
          ? `Prepared ${preparedCapabilityContext.length} bounded context view(s)`
          : "No execution context was needed",
        payload: {
          workflowStep: "context_preparation", workflowStepLabel: "Prepare execution context",
          stepIndex: 2, reasoningEffort: null, requests: contextRequests,
          preparedCount: preparedCapabilityContext.length,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ledger.append({
        type: "agent.step", phase: "error", status: "error", actorType: "service",
        actorName: "Structured turn workflow", channel, turnId: args.requestId,
        operationId: contextOperationId, name: "Prepare execution context",
        content: message, error: message,
        payload: {
          workflowStep: "context_preparation", workflowStepLabel: "Prepare execution context",
          stepIndex: 2, reasoningEffort: null, requests: contextRequests,
        },
      });
      throw error;
    }

    const hydratedObjectReferenceCatalog = mergeObjectReferenceGroups([
      ...availableObjectReferences,
      ...preparedObjectReferences,
    ]);
    const acceptedReferenceSets = selectedReferenceSets(core, {
      requestId: args.requestId,
      requestEventSeq,
      availableSets: availableReferenceSets,
      availableObjectReferences: hydratedObjectReferenceCatalog,
    });
    const selectedRefs = [...new Set([
      ...coreTargetRefs(core, acceptedReferenceSets),
      ...selectedObjectCandidates.map(({ ref }) => ref).filter(Boolean),
    ])];
    const selectedObjectReferences = mergeObjectReferenceGroups(objectReferenceGroupsForRefs(
      hydratedObjectReferenceCatalog,
      selectedRefs,
    ));
    const completeObjectReferences = mergeObjectReferenceGroups(objectReferenceGroupsForRefs(
      hydratedObjectReferenceCatalog,
      selectedObjectCandidates.map(({ ref }) => ref).filter(Boolean),
    ));
    const executionObjectReferences = mergeObjectReferenceGroups([
      ...selectedObjectReferences,
      ...preparedObjectReferences,
    ]);
    const confirmedActionReferences = relevantActionReferences
      .filter(({ referenceId }) => core.confirmedActionReferenceIds.includes(referenceId))
      .map((reference) => ({ ...reference, state: "confirmed" }));
    const confirmedReferenceIds = new Set(
      confirmedActionReferences.map(({ referenceId }) => referenceId),
    );
    const pendingTargetTools = new Set(relevantActionReferences
      .filter(({ referenceId }) => !confirmedReferenceIds.has(referenceId))
      .map(({ targetTool }) => targetTool));

    this.ledger.append({
      type: "orientation.core", status: "complete", actorType: "service",
      actorName: "Common-sense orienter", channel, turnId: args.requestId,
      name: "Accepted common-sense core", content: core.conversationSummary,
      payload: {
        core,
        objectReferences: selectedObjectReferences,
        referenceSets: acceptedReferenceSets,
        sourceRequestId: args.requestId,
      },
      subjectType: "orientation_core", subjectId: args.requestId,
    });
    const sourceEventSeqsForState = Number.isSafeInteger(requestEventSeq) ? [requestEventSeq] : [];
    const conversationState = {
      activeObjective: core.objective,
      openCommitments: core.mode === "act"
        ? core.actions.map(({ instruction }) => ({ text: instruction, sourceEventSeqs: sourceEventSeqsForState }))
        : [],
      durableConstraints: core.constraints.map((constraint) => ({
        text: constraint,
        sourceEventSeqs: sourceEventSeqsForState,
      })),
      unresolvedQuestions: core.questions,
      relevantRequestIds: [args.requestId],
    };
    this.ledger.append({
      type: "conversation.state", status: "complete", actorType: "service",
      actorName: "Common-sense orienter", channel, turnId: args.requestId,
      name: "Brief conversation state", content: core.conversationSummary,
      payload: {
        state: conversationState,
        sourceOrientationCore: core,
        sourceRequestId: args.requestId,
      },
      subjectType: "conversation_state", subjectId: "main",
    });

    const explicitHatCapabilities = routing.explicitHats
      .filter(({ available }) => available)
      .map(({ capability }) => capability);
    const selectedObjectCapabilities = selectedObjectCandidates
      .map(selectedObjectCapability)
      .filter(Boolean);
    const confirmedToolCapabilities = confirmedActionReferences
      .map(({ targetTool }) => availableTools.find(({ name }) => name === targetTool))
      .filter(Boolean)
      .map(capabilityForTool);
    const primaryExecutionCapabilities = [...new Set([
      ...core.capabilities,
      ...directlyRoutedCapabilities,
      ...explicitHatCapabilities,
      ...selectedObjectCapabilities,
      ...confirmedToolCapabilities,
    ])];
    const receiptReader = recentToolReceipts.length
      ? availableTools.find(({ name }) => name === "tool_receipt_read")
      : null;
    const supportTools = [receiptReader].filter(Boolean);
    const executionCapabilities = [...new Set([
      ...primaryExecutionCapabilities,
      ...supportTools.map(capabilityForTool),
    ])];
    const primaryExecutionCapabilitySet = new Set(primaryExecutionCapabilities);
    const executionToolNames = [...new Set([
      ...availableTools
        .filter((tool) => primaryExecutionCapabilitySet.has(capabilityForTool(tool)))
        .map(({ name }) => name)
        .filter((name) => !pendingTargetTools.has(name)),
      ...supportTools.map(({ name }) => name),
      ...confirmedActionReferences.map(({ targetTool }) => targetTool),
    ])];
    const executorArgs = {
      ...args,
      capabilityOverride: executionCapabilities,
      toolOverride: executionToolNames,
      runLimits: {
        maxToolCalls: configuredMaxToolCalls,
        timeoutMs: remainingTimeoutMs(),
      },
      supplementalInstructions: joinedInstructions(
        args.supplementalInstructions,
        commonSenseExecutionInstructions(
          core,
          executionObjectReferences,
          confirmedActionReferences,
          acceptedReferenceSets,
          selectedObjectCandidates,
        ),
        priorReceiptInstructions(recentToolReceipts),
      ),
      activeActionReferences: relevantActionReferences,
      confirmedActionReferences,
      preparedCapabilityContext,
      temporalResolutions: core.temporalResolutions,
      objectReferences: selectedObjectReferences,
      completeObjectReferences,
      initialObjectReferences: mergeObjectReferenceGroups([
        ...executionObjectReferences,
        ...reusableReferencedObjectReferences,
      ]),
    };

    if (typeof args.awaitTurnBriefApproval === "function") {
      const capabilityById = new Map(catalog.map((entry) => [entry.capability, entry]));
      const toolByName = new Map(catalog.flatMap(({ tools = [] }) => (
        tools.map((tool) => [tool.name, tool])
      )));
      const contextViewById = new Map(catalog.flatMap(({ capability, contextViews = [] }) => (
        contextViews.map((view) => [view.id, { ...view, capability }])
      )));
      const approvalStartedAt = Date.now();
      try {
        await args.awaitTurnBriefApproval({
          objective: core.objective,
          summary: core.conversationSummary,
          capabilities: executionCapabilities.map((capability) => {
            const entry = capabilityById.get(capability);
            return {
              capability,
              title: entry?.title ?? capability,
              summary: entry?.summary ?? null,
            };
          }),
          tools: executionToolNames.map((name) => {
            const entry = toolByName.get(name);
            return {
              name,
              title: entry?.title ?? null,
              summary: entry?.summary ?? null,
            };
          }),
          contextViews: contextRequests.map((id) => {
            const entry = contextViewById.get(id);
            return {
              id,
              title: entry?.title ?? id,
              description: entry?.description ?? null,
              capability: entry?.capability ?? null,
            };
          }),
        });
      } finally {
        pausedDurationMs += Date.now() - approvalStartedAt;
      }
    }

    const execution = await this.#runExecutorStep(executorArgs, {
      step: "execution", label: "Execute request", stepIndex: 3,
      effort: args.effort || this.config.reasoningEffort,
    });
    const receiptFindings = completionReceiptFindings({
      receipts: execution.receipts,
      confirmedActionReferences,
    });
    const confirmationFindings = pendingConfirmationFindings(
      execution.receipts,
      confirmedActionReferences,
    );
    const terminalFindings = terminalToolFailureFindings(execution.receipts);

    if (terminalFindings.length > 0) {
      const notice = terminalToolFailureNotice(terminalFindings);
      this.ledger.append({
        type: "tool.retry.blocked", phase: "error", status: "error", actorType: "service",
        actorName: "Tool contract guard", channel, turnId: args.requestId,
        name: "Repair retry blocked", content: notice,
        payload: { findings: terminalFindings },
        error: terminalFindings.map(({ toolFailure }) => toolFailure.code).join(", "),
      });
      return terminalFindings.some(({ toolFailure }) => toolFailure.step === "final_confirmation_handoff")
        ? notice
        : joinedInstructions(execution.text, notice);
    }
    if (confirmationFindings.length > 0) {
      const response = pendingConfirmationResponse(execution.text);
      this.ledger.append({
        type: "confirmation.required", phase: "end", status: "complete", actorType: "service",
        actorName: "Confirmation gate", channel, turnId: args.requestId,
        name: "Waiting for user confirmation", content: response,
        payload: { findings: confirmationFindings },
      });
      return response;
    }

    const executionFindings = [...receiptFindings];
    const auditReasons = exceptionalAuditReasons({
      core,
      receipts: execution.receipts,
      registry: this.registry,
      findings: executionFindings,
      requestText: args.text,
    });
    if (auditReasons.length === 0) {
      const operationId = `${this.modelTransport.id}:${args.requestId}:audit`;
      const auditPayload = {
        workflowStep: "audit", workflowStepLabel: "Audit completion", stepIndex: 4,
        reasoningEffort: null, skipped: true,
        reason: "Typed tool receipts were sufficient; no exceptional semantic audit was needed.",
      };
      this.ledger.append({
        type: "agent.step", phase: "start", status: "processing", actorType: "service",
        actorName: "Structured turn workflow", channel, turnId: args.requestId, operationId,
        name: "Audit completion", content: "Evaluating whether an exceptional audit is required", payload: auditPayload,
      });
      this.ledger.append({
        type: "agent.step", phase: "end", status: "complete", actorType: "service",
        actorName: "Structured turn workflow", channel, turnId: args.requestId, operationId,
        name: "Audit skipped", content: auditPayload.reason, payload: auditPayload,
      });
      return execution.text;
    }

    const audit = await this.#runStructuredStep({
      requestId: args.requestId,
      channel,
      step: "audit",
      label: "Audit exceptional outcome",
      stepIndex: 4,
      model: args.model || this.config.model,
      effort: this.config.auditReasoningEffort ?? "low",
      input: `Audit completion of request ${args.requestId}.`,
      developerInstructions: auditContext({
        core,
        receipts: execution.receipts,
        executorResponse: execution.text,
        deterministicFindings: executionFindings,
        reasons: auditReasons,
        callableTools: execution.callableToolCatalog,
        selectedObjectCandidates,
      }),
      outputSchema: completionAuditSchema,
      runTimeoutMs: remainingTimeoutMs(),
    });
    if (audit.value.outcome === "needs_information") return execution.text;
    if (audit.value.outcome === "blocked") return blockedAuditResponse(audit.value);
    if (audit.value.outcome !== "repair_needed" && executionFindings.length === 0) return execution.text;

    const remainingToolCalls = configuredMaxToolCalls === null
      ? null
      : Math.max(0, configuredMaxToolCalls - execution.toolCallCount);
    const repairArgs = {
      ...executorArgs,
      toolOverride: execution.selectedToolNames,
      runLimits: {
        maxToolCalls: remainingToolCalls,
        timeoutMs: remainingTimeoutMs(),
      },
      supplementalInstructions: joinedInstructions(
        executorArgs.supplementalInstructions,
        "# Exceptional audit requires correction",
        JSON.stringify(audit.value, null, 2),
        "# Deterministic receipt findings",
        JSON.stringify(executionFindings, null, 2),
        "Perform only the remaining work. Do not repeat successful actions. Return one coherent response to the original request without narrating internal audit or repair stages.",
      ),
    };
    const repair = await this.#runExecutorStep(repairArgs, {
      step: "repair", label: "Repair completion", stepIndex: 5,
      effort: this.config.repairReasoningEffort ?? args.effort ?? this.config.reasoningEffort,
      initialReceipts: execution.receipts,
    });
    const repairTerminalFindings = terminalToolFailureFindings(repair.receipts);
    if (repairTerminalFindings.length) {
      return joinedInstructions(repair.text, terminalToolFailureNotice(repairTerminalFindings));
    }
    const finalFindings = completionReceiptFindings({
      receipts: repair.receipts,
      confirmedActionReferences,
    });
    if (finalFindings.length) {
      const response = incompleteReceiptResponse(finalFindings);
      this.ledger.append({
        type: "completion.guard", phase: "error", status: "error", actorType: "service",
        actorName: "Receipt contract", channel, turnId: args.requestId,
        name: "Completion claim blocked", content: response,
        payload: { findings: finalFindings },
        error: finalFindings.map(({ code }) => code).join(", "),
      });
      return response;
    }
    const repairAudit = await this.#runStructuredStep({
      requestId: args.requestId,
      channel,
      step: "audit",
      label: "Audit repaired outcome",
      stepIndex: 6,
      model: args.model || this.config.model,
      effort: this.config.auditReasoningEffort ?? "low",
      input: `Verify the repaired completion of request ${args.requestId}.`,
      developerInstructions: auditContext({
        core,
        receipts: repair.receipts,
        executorResponse: repair.text,
        deterministicFindings: [],
        reasons: [{
          code: "post_repair_verification",
          message: "A prior exceptional audit required repair; independently verify the repaired receipts before accepting completion.",
        }],
        callableTools: repair.callableToolCatalog,
        selectedObjectCandidates,
      }),
      outputSchema: completionAuditSchema,
      runTimeoutMs: remainingTimeoutMs(),
    });
    if (repairAudit.value.outcome === "complete"
      || repairAudit.value.outcome === "needs_information") return repair.text;
    return blockedAuditResponse(repairAudit.value);
  }

  async run(args) {
    let rawResponse;
    if (
      this.config.turnWorkflowEnabled !== false
      && this.requestCompiler
      && !Array.isArray(args.capabilityOverride)
    ) {
      rawResponse = await this.#runCommonSenseWorkflow(args);
    } else {
      const execution = await this.#runExecutor(args);
      rawResponse = execution.text;
    }
    const presentedResponse = formatUserFacingDates(rawResponse);
    if (presentedResponse !== rawResponse) {
      this.ledger.append({
        type: "response.presentation", phase: "point", status: "complete",
        actorType: "service", actorName: "Presentation formatter",
        channel: args.channel ?? "web", turnId: args.requestId,
        name: "User-facing dates formatted",
        content: "Formatted explicit prose dates as Mon, 31 Aug 2026",
        payload: { dateStyle: "EEE, d MMM yyyy" },
      });
    }
    return canonicalizeAgentName(presentedResponse);
  }

  async #runExecutor({
    requestId, requestEventId, text, channel = "web", attachment = null, runLimits = null,
    model = null, effort = null, supplementalInstructions = "",
    capabilityOverride = null, workflowStep = null, workflowStepLabel = null, stepIndex = null,
    toolOverride = null,
    allowedToolNames: allowedToolNameList = null,
    isolatedConversation = false, conversationStartEventSeq = 0, initialReceipts = [],
    activeActionReferences = [], confirmedActionReferences = [],
    preparedCapabilityContext = null, temporalResolutions = [], objectReferences = [],
    completeObjectReferences = [], initialObjectReferences = [],
  }) {
    const registeredTools = this.registry.toolDefinitions();
    const allowedToolNames = Array.isArray(allowedToolNameList)
      ? new Set(allowedToolNameList)
      : null;
    const availableTools = allowedToolNames
      ? registeredTools.filter(({ name }) => allowedToolNames.has(name))
      : registeredTools;
    if (allowedToolNames && availableTools.length !== allowedToolNames.size) {
      const availableNames = new Set(availableTools.map(({ name }) => name));
      const unavailable = [...allowedToolNames].filter((name) => !availableNames.has(name));
      throw new Error(`Authorized request tool is unavailable: ${unavailable.join(", ")}`);
    }
    const priorConversation = !isolatedConversation && typeof this.ledger.currentModelConversation === "function"
      ? this.ledger.currentModelConversation()
      : { conversationId: null, markerEventSeq: conversationStartEventSeq, capabilities: [] };
    const recentConversation = this.requestCompiler
      && priorConversation.conversationId
      && typeof this.ledger.recentConversation === "function"
      ? this.ledger.recentConversation({
          beforeRequestId: requestId,
          afterEventSeq: priorConversation.markerEventSeq,
          limit: 10,
        })
      : [];
    let compilation = this.requestCompiler
      ? await this.requestCompiler.compile({
          tools: availableTools,
          text,
          attachment,
          recentConversation,
          previousCapabilities: priorConversation.capabilities,
          capabilityOverride,
          toolOverride,
          allowCapabilityExpansion: true,
          allowToolExpansion: Array.isArray(toolOverride),
        })
      : {
          tools: availableTools,
          capabilities: ["all"],
          reasons: ["compiler:disabled"],
          fallbackAll: true,
          followsPriorTurn: false,
          availableToolCount: availableTools.length,
          instructions: "",
          explicitHats: [],
          instructionCapabilities: [],
          deferredCapabilities: [],
          capabilityCatalog: [],
        };
    const initialToolFingerprint = callableToolsFingerprint(compilation.tools);
    let conversation = !isolatedConversation && typeof this.ledger.activeModelConversation === "function"
      ? this.ledger.activeModelConversation(initialToolFingerprint)
      : {
          conversationId: null,
          markerEventSeq: conversationStartEventSeq,
          reason: isolatedConversation ? "turn_brief" : "new",
        };
    const priorContextUsage = priorConversation.conversationId
      && typeof this.ledger.latestModelContextUsage === "function"
      ? this.ledger.latestModelContextUsage({ afterEventSeq: priorConversation.markerEventSeq })
      : null;
    const contextRolloverPercent = this.config.contextRolloverPercent ?? 65;
    if (
      conversation.conversationId
      && priorContextUsage?.usedPercent != null
      && priorContextUsage.usedPercent >= contextRolloverPercent
    ) {
      conversation = { ...conversation, conversationId: null, reason: "context_rollover" };
    }
    const baseInstructions = await this.loadSystemPrompt();
    const maxToolCalls = runLimits === null ? this.config.maxToolCalls : runLimits.maxToolCalls;
    const configuredRunTimeoutMs = runLimits?.timeoutMs ?? null;
    const executorStartedAt = Date.now();
    const selectedModel = model || this.config.model;
    const selectedEffort = effort || this.config.reasoningEffort;
    let conversationId = conversation.conversationId;
    let totalToolCallCount = 0;
    // Orientation normally supplies the right capability families. Execution
    // may still discover one evidenced owning-domain dependency after a read;
    // permit exactly one bounded expansion instead of converting that ordinary
    // discovery into a terminal dead end.
    const maximumCapabilityExpansionRounds = 1;
    let capabilityExpansionRounds = 0;
    const maximumToolExpansionRounds = Array.isArray(toolOverride)
      ? Math.max(0, this.config.maxToolExpansionRounds ?? 2)
      : 0;
    let toolExpansionRounds = 0;
    const selectedToolNames = new Set(toolOverride ?? []);
    let attempt = 0;
    let result;
    const sameRequestReceipts = [...initialReceipts];
    const successfulMutationAttempts = new Set(initialReceipts.flatMap((receipt) => {
      if (!receipt?.ok) return [];
      const definition = this.registry.get(receipt.tool);
      if (definition?.annotations?.readOnlyHint === true) return [];
      return [toolAttemptKey(receipt.tool, receipt.arguments)];
    }));
    let observedObjectReferences = mergeObjectReferenceGroups([
      ...initialObjectReferences,
      ...initialReceipts.flatMap((receipt) => receipt.objectReferences ?? []),
    ]);
    const generatedActionReferences = [];
    let conversationCheckpoint = null;
    let finalAttemptStartedNewConversation = !conversationId;
    const failedToolAttempts = new Set(initialReceipts.filter((receipt) => (
      !receipt.ok && receipt.preExecutionRejection !== true
    ))
      .map(receiptAttemptKey));
    while (true) {
      attempt += 1;
      const runTimeoutMs = configuredRunTimeoutMs === null
        ? null
        : attempt === 1
          ? configuredRunTimeoutMs
          : configuredRunTimeoutMs - (Date.now() - executorStartedAt);
      if (runTimeoutMs !== null && runTimeoutMs <= 0) {
        throw new Error(`Model execution timed out after ${configuredRunTimeoutMs}ms`);
      }
      finalAttemptStartedNewConversation = !conversationId;
      // Callable schemas remain the exact owning provider contracts. Verified
      // bindings are identity evidence at the call boundary; they never rewrite
      // a provider schema into a historical ID allow-list.
      const tools = compilation.tools;
      const callableToolNames = new Set(tools.map(({ name }) => name));
      const callableToolDefinitions = new Map(tools.map((tool) => [tool.name, tool]));
      if (
        !conversationId
        && priorConversation.conversationId
        && conversationCheckpoint === null
        && typeof this.ledger.conversationCheckpoint === "function"
      ) {
        conversationCheckpoint = this.ledger.conversationCheckpoint({
          afterEventSeq: priorConversation.markerEventSeq,
          beforeRequestId: requestId,
          maximumCharacters: this.config.conversationCheckpointCharacters ?? 48 * 1024,
        });
        this.ledger.append({
          type: "conversation.checkpoint", status: "complete", actorType: "service",
          actorName: "Conversation manager", channel, turnId: requestId,
          name: "Bounded conversation checkpoint", content: conversationCheckpoint.text,
          payload: {
            reason: conversation.reason,
            priorConversationId: priorConversation.conversationId,
            ...Object.fromEntries(
              Object.entries(conversationCheckpoint).filter(([key]) => key !== "text"),
            ),
          },
          subjectType: "model_conversation", subjectId: priorConversation.conversationId,
        });
      }
      const context = await this.contextBuilder.build(requestId, text, {
        attachment,
        nativeConversation: conversationId
          ? true
          : attempt === 1 && conversation.reason === "new" && !conversationCheckpoint,
        continuingConversation: Boolean(conversationId),
        conversationStartEventSeq: conversation.markerEventSeq,
        capabilities: compilation.capabilities,
        ...(preparedCapabilityContext === null ? {} : { preparedCapabilityContext }),
        conversationCheckpoint: conversationId ? null : conversationCheckpoint,
        ...(workflowStep ? { includeRecentExchanges: false } : {}),
      });
      const continuingAfterExpansion = attempt > 1
        ? "Execution context has been refreshed. Continue and finish the original user request using the exact newly callable schemas and earlier receipts. Do not ask the user to repeat it, and do not repeat completed actions."
        : "";
      const developerInstructions = joinedInstructions(
        compilation.instructions,
        context.developerInstructions ?? context.text,
        supplementalInstructions,
        attempt > 1 || initialReceipts.length
          ? sameRequestReceiptInstructions(sameRequestReceipts)
          : "",
        continuingAfterExpansion,
      );
      const contextFilterOperationId = `${this.modelTransport.id}:${requestId}:${workflowStep ?? "model"}:${attempt}:context-filter`;
      const filteredContext = this.resultFilter.filterContext(developerInstructions, {
        requestId,
        interactionId: contextFilterOperationId,
        source: `${workflowStep ?? "model"}.developer_context`,
        maximumCharacters: this.config.maxFilteredContextCharacters ?? 256 * 1024,
      });
      const modelDeveloperInstructions = filteredContext.text;
      this.ledger.append({
        type: "search.filter", status: "complete", actorType: "service",
        actorName: "Search result filter", channel, turnId: requestId,
        operationId: contextFilterOperationId, name: "LLM context filter",
        content: filteredContext.receipt.status, payload: filteredContext.receipt,
      });
      const remainingToolCalls = maxToolCalls === null
        ? null
        : Math.max(0, maxToolCalls - totalToolCallCount);
      const attemptInput = attempt === 1
        ? text
        : `Continue the original user request now that the requested capabilities are callable.\n\nOriginal user request:\n${text}`;
      const turnRequest = {
        model: selectedModel,
        effort: selectedEffort,
        conversationId,
        baseInstructions,
        developerInstructions: modelDeveloperInstructions,
        input: attemptInput,
        requestAttachmentInput: context.requestAttachmentInput ?? null,
        tools,
        maxToolCalls: remainingToolCalls,
        terminalFailureObserved: terminalToolFailureFindings(sameRequestReceipts).length > 0,
        runTimeoutMs,
      };
      const providerRequest = this.modelTransport.describeRequest(turnRequest);
      const providerCallableTools = providerRequest.callableTools
        ?? providerRequest.dynamicTools
        ?? providerRequest.tools
        ?? tools;

      this.ledger.append({
        type: "context.sent", status: "complete", actorType: "system", actorName: "Context builder",
        channel, turnId: requestId, name: "Compiled context sent", content: modelDeveloperInstructions,
        payload: {
          workflowStep, workflowStepLabel, stepIndex, reasoningEffort: selectedEffort,
          attempt,
          profileFacts: context.profileFacts,
          activeTrackers: context.activeTrackers ?? [],
          activeProfileFactCount: context.activeProfileFactCount,
          relevantProfileTypes: context.relevantProfileTypes,
          relevantProfileQuestions: context.relevantProfileQuestions,
          localCalendar: context.localCalendar ?? null,
          referencedExchanges: context.referencedExchanges ?? [],
          conversationCheckpoint: context.conversationCheckpoint ?? null,
          history: context.history,
          contextBudget: context.contextBudget,
          attachment: context.attachment,
          nativeConversation: context.nativeConversation,
          runLimits: { maxToolCalls, timeoutMs: runTimeoutMs },
          remainingToolCalls,
          conversationTransition: {
            reason: conversationId ? "continue" : conversation.reason,
            rolloverThresholdPercent: contextRolloverPercent,
            priorContextUsage,
            checkpointInjected: Boolean(context.conversationCheckpoint),
          },
          capabilitySelection: {
            explicitHats: compilation.explicitHats ?? [],
            capabilities: compilation.capabilities,
            deferredCapabilities: compilation.deferredCapabilities ?? [],
            capabilityCatalog: compilation.capabilityCatalog ?? [],
            instructionCapabilities: compilation.instructionCapabilities,
            dependentTools: compilation.dependentTools ?? [],
            reasons: compilation.reasons,
            fallbackAll: compilation.fallbackAll,
            followsPriorTurn: compilation.followsPriorTurn,
            availableToolCount: compilation.availableToolCount,
            callableToolCount: tools.length,
            baseInstructionCharacters: baseInstructions.length,
            capabilityInstructionCharacters: compilation.instructions.length,
            boundedContextCharacters: (context.developerInstructions ?? context.text ?? "").length,
            totalDeveloperInstructionCharacters: modelDeveloperInstructions.length,
          },
        },
      });
      const schemasSentThisCall = providerRequest.toolDelivery === "sent in every Responses API call";
      const toolDelivery = schemasSentThisCall || !conversationId ? "sent" : "retained";
      this.ledger.append({
        type: "tools.sent", status: "complete", actorType: "system", actorName: "Tool registry",
        channel, turnId: requestId,
        name: toolDelivery === "retained"
          ? `${tools.length} callable tools available on resumed conversation`
          : `${tools.length} callable tools sent with new conversation`,
        payload: {
          workflowStep, workflowStepLabel, stepIndex, reasoningEffort: selectedEffort,
          attempt,
          count: tools.length,
          availableCount: availableTools.length,
          schemaBytes: serializedBytes(providerCallableTools),
          delivery: toolDelivery,
          protocolDelivery: providerRequest.toolDelivery ?? null,
          capabilities: compilation.capabilities,
          explicitHats: compilation.explicitHats ?? [],
          deferredCapabilities: compilation.deferredCapabilities ?? [],
          deferredTools: compilation.deferredTools ?? [],
          capabilityCatalog: compilation.capabilityCatalog ?? [],
          dependentTools: compilation.dependentTools ?? [],
          selectionReasons: compilation.reasons,
          tools: providerCallableTools,
        },
      });
      const operationId = `${this.modelTransport.id}:${requestId}:${workflowStep ?? "model"}:${attempt}`;
      this.ledger.append({
        type: "model.request", phase: "start", status: "processing", actorType: "service",
        actorName: `${this.modelTransport.displayName} transport`, channel, turnId: requestId, operationId,
        name: attempt === 1 ? "Model request" : "Model request after execution refresh",
        payload: {
          ...providerRequest,
          workflowStep, workflowStepLabel, stepIndex, reasoningEffort: selectedEffort,
        },
      });

      const requestedCapabilities = new Set();
      const requestedTools = new Set();
      let expansionRequested = false;
      try {
        result = await this.modelTransport.runTurn({
          ...turnRequest,
          onEvent: (event) => {
            if (event.type === "tools.refreshed") {
              this.ledger.append({
                type: "tools.sent", status: "complete", actorType: "system",
                actorName: "Object binding compiler", channel, turnId: requestId,
                operationId, name: `${event.toolSchemaCount} callable tools refreshed in the same model exchange`,
                content: "Coalesced newly verified object bindings after all sibling tool calls",
                payload: {
                  workflowStep, workflowStepLabel, stepIndex, reasoningEffort: selectedEffort,
                  attempt, reason: event.reason, count: event.toolSchemaCount,
                  delivery: "same_exchange_refresh",
                  tools: event.providerTools ?? event.tools ?? [],
                },
              });
              return;
            }
            if (event.type !== "request.started") return;
            this.ledger.append({
              type: "model.call", phase: "start", status: "processing", actorType: "service",
              actorName: selectedModel, channel, turnId: requestId, operationId, name: "LLM call",
              payload: { ...event, workflowStep, workflowStepLabel, stepIndex },
            });
          },
          onToolCall: async (call) => {
            totalToolCallCount += 1;
            const callId = call.callId;
            const name = call.tool;
            let args;
            try {
              args = argumentsObject(call.arguments);
            } catch (error) {
              const message = `Invalid JSON tool arguments: ${error.message}`;
              this.ledger.append({
                type: "tool.call", phase: "error", status: "error", actorType: "model",
                actorName: selectedModel, channel, turnId: requestId, operationId: callId,
                name, payload: { callId, name, rawArguments: call.arguments }, error: message,
              });
              return { ok: false, error: message };
            }
            this.ledger.append({
              type: "tool.call", phase: "start", status: "processing", actorType: "model",
              actorName: selectedModel, channel, turnId: requestId, operationId: callId,
              name, payload: { callId, name, arguments: args },
            });
            if (maxToolCalls !== null && totalToolCallCount > maxToolCalls) {
              const message = `Tool-call budget exhausted after ${maxToolCalls} calls. Return a final answer now without calling another tool; state clearly which requested actions remain incomplete.`;
              this.ledger.append({
                type: "tool.result", phase: "error", status: "error", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name }, error: message,
              });
              return { ok: false, error: message };
            }
            if (!callableToolNames.has(name)) {
              const message = `${name} is not callable for this request`;
              this.ledger.append({
                type: "tool.result", phase: "error", status: "error", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name }, error: message,
              });
              return { ok: false, error: message };
            }
            // Expansion adds schemas on the next exchange. Tools whose schemas
            // were already sent remain callable for this response's other calls.
            const registeredTool = this.registry.get(name);
            const readOnly = registeredTool?.annotations?.readOnlyHint === true;
            const { toolArguments, filterRequest } = splitReadResultFilter(args, readOnly);
            const attemptKey = toolAttemptKey(name, args);
            if (failedToolAttempts.has(attemptKey)) {
              const message = `An identical ${name} call with the same arguments already failed during this request. Do not repeat it; make a material correction or report the blocker.`;
              sameRequestReceipts.push({
                tool: name, arguments: toolArguments,
                ...(filterRequest ? { resultFilter: filterRequest } : {}),
                ok: false, error: message,
              });
              this.ledger.append({
                type: "tool.result", phase: "error", status: "error", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name, duplicateFailure: true }, error: message,
              });
              return { ok: false, error: message, stopToolLoop: true };
            }
            if (readOnly) {
              const problem = schemaProblem(filterRequest, readResultFilterSchema, "result_filter");
              if (problem) {
                const message = `Read tool ${name} requires a valid result_filter: ${problem}`;
                failedToolAttempts.add(toolAttemptKey(name, args));
                sameRequestReceipts.push({
                  tool: name, arguments: toolArguments, resultFilter: filterRequest,
                  ok: false, error: message,
                });
                this.ledger.append({
                  type: "search.filter", phase: "error", status: "error", actorType: "service",
                  actorName: "Search result filter", channel, turnId: requestId,
                  operationId: callId, name: `${name} result filter rejected`,
                  payload: {
                    protocol: "agent-slayer.search-data", version: 1,
                    requestId, interactionId: callId, source: { tool: name },
                    status: "error", filter: filterRequest ?? null,
                  },
                  error: message,
                });
                this.ledger.append({
                  type: "tool.result", phase: "error", status: "error", actorType: "tool",
                  actorName: name, channel, turnId: requestId, operationId: callId, name,
                  payload: { callId, name }, error: message,
                });
                return { ok: false, error: message };
              }
            }
            if (workflowStep) {
              const referenceProblem = deferredActionArgumentProblem(
                name,
                toolArguments,
                confirmedActionReferences,
                [
                  ...activeActionReferences,
                  ...sameRequestReceipts.flatMap((receipt) => (
                    receipt?.deferredActionReference ? [receipt.deferredActionReference] : []
                  )),
                  ...generatedActionReferences,
                ],
              );
              if (referenceProblem) {
                failedToolAttempts.add(attemptKey);
                sameRequestReceipts.push({ tool: name, arguments: toolArguments, ok: false, error: referenceProblem });
                this.ledger.append({
                  type: "tool.result", phase: "error", status: "error", actorType: "tool",
                  actorName: name, channel, turnId: requestId, operationId: callId, name,
                  payload: { callId, name }, error: referenceProblem,
                });
                return { ok: false, error: referenceProblem };
              }
            }
            if (name === "request_tools") {
              if (toolExpansionRounds >= maximumToolExpansionRounds || expansionRequested) {
                const message = maximumToolExpansionRounds === 0
                  ? "Tool expansion is not available for this execution"
                  : "The bounded tool-expansion rounds are exhausted or one expansion is already pending; finish with the callable tools or report the evidenced blocker";
                this.ledger.append({
                  type: "tool.result", phase: "error", status: "error", actorType: "tool",
                  actorName: name, channel, turnId: requestId, operationId: callId, name,
                  payload: { callId, name }, error: message,
                });
                return { ok: false, error: message };
              }
              const allowed = new Set((compilation.deferredTools ?? []).map(({ name: toolName }) => toolName));
              const requested = Array.isArray(args.tools)
                ? [...new Set(args.tools.filter((toolName) => allowed.has(toolName)))]
                : [];
              if (requested.length === 0) {
                const message = "request_tools requires at least one tool from the visible deferred tool catalog";
                this.ledger.append({
                  type: "tool.result", phase: "error", status: "error", actorType: "tool",
                  actorName: name, channel, turnId: requestId, operationId: callId, name,
                  payload: { callId, name }, error: message,
                });
                return { ok: false, error: message };
              }
              expansionRequested = true;
              for (const toolName of requested) requestedTools.add(toolName);
              const toolResult = {
                requested_tools: requested,
                continuation: "Agent Slayer will continue this same execution with the exact requested tool schemas and earlier receipts. Do not claim the user's task is complete yet.",
              };
              this.ledger.append({
                type: "tools.expansion.requested", status: "complete", actorType: "model",
                actorName: selectedModel, channel, turnId: requestId, operationId: callId,
                name: "Additional exact tools requested", content: requested.join(", "),
                payload: { callId, tools: requested, capabilities: compilation.capabilities },
              });
              this.ledger.append({
                type: "tool.result", phase: "end", status: "complete", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name, result: toolResult },
              });
              return { ok: true, result: toolResult };
            }
            if (name === "request_capabilities") {
              if (capabilityExpansionRounds >= maximumCapabilityExpansionRounds || expansionRequested) {
                const message = maximumCapabilityExpansionRounds === 0
                  ? "Capability expansion is unavailable during structured execution; orientation already selected the accepted common-sense capability families and their declared dependent tools"
                  : "The single capability-expansion round is already used or pending; finish with the callable tools or report the evidenced blocker";
                this.ledger.append({
                  type: "tool.result", phase: "error", status: "error", actorType: "tool",
                  actorName: name, channel, turnId: requestId, operationId: callId, name,
                  payload: { callId, name }, error: message,
                });
                return { ok: false, error: message };
              }
              const allowed = new Set(compilation.deferredCapabilities ?? []);
              const requested = Array.isArray(args.capabilities)
                ? [...new Set(args.capabilities.filter((capability) => allowed.has(capability)))]
                : [];
              if (requested.length === 0) {
                const message = "request_capabilities requires at least one capability from the visible deferred catalog";
                this.ledger.append({
                  type: "tool.result", phase: "error", status: "error", actorType: "tool",
                  actorName: name, channel, turnId: requestId, operationId: callId, name,
                  payload: { callId, name }, error: message,
                });
                return { ok: false, error: message };
              }
              expansionRequested = true;
              for (const capability of requested) requestedCapabilities.add(capability);
              const toolResult = {
                requested_capabilities: requested,
                continuation: "Agent Slayer will continue this same user request with the exact requested tool schemas loaded. Do not claim the user's task is complete yet.",
              };
              this.ledger.append({
                type: "tools.expansion.requested", status: "complete", actorType: "model",
                actorName: selectedModel, channel, turnId: requestId, operationId: callId,
                name: "Additional tools requested", content: requested.join(", "),
                payload: { callId, capabilities: requested },
              });
              this.ledger.append({
                type: "tool.result", phase: "end", status: "complete", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name, result: toolResult },
              });
              return { ok: true, result: toolResult };
            }
            if (!readOnly && successfulMutationAttempts.has(attemptKey)) {
              const message = `An identical successful ${name} mutation with the same arguments already has a receipt in this request. It will not be executed again; use the existing receipt and verify state with a read if needed.`;
              sameRequestReceipts.push({
                tool: name, arguments: toolArguments, ok: false, error: message,
              });
              this.ledger.append({
                type: "tool.result", phase: "error", status: "error", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name, duplicateSuccessfulMutation: true }, error: message,
              });
              return { ok: false, error: message, stopToolLoop: true };
            }
            const objectBindingProblem = objectInputBindingProblem({
              toolDefinition: registeredTool ?? callableToolDefinitions.get(name),
              argumentsObject: toolArguments,
              selectedGroups: objectReferences,
              observedGroups: observedObjectReferences,
              completeGroups: completeObjectReferences,
            });
            if (objectBindingProblem) {
              sameRequestReceipts.push({
                tool: name,
                arguments: toolArguments,
                ok: false,
                error: objectBindingProblem,
                preExecutionRejection: true,
              });
              this.ledger.append({
                type: "object.binding.rejected", phase: "error", status: "error",
                actorType: "service", actorName: "Object binding guard", channel,
                turnId: requestId, operationId: callId, name: `${name} object binding rejected`,
                content: objectBindingProblem,
                payload: {
                  callId,
                  name,
                  arguments: toolArguments,
                  preExecutionRejection: true,
                },
                error: objectBindingProblem,
              });
              this.ledger.append({
                type: "tool.result", phase: "error", status: "error", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name, preExecutionRejection: true }, error: objectBindingProblem,
              });
              return { ok: false, error: objectBindingProblem };
            }
            const blocked = sameRequestReceipts.find((receipt) => (receipt.tool === name || !readOnly)
              && normalizedToolFailure(receipt.toolFailure)?.terminalForCurrentRequest);
            if (blocked) {
              const error = `${name} is blocked after ${blocked.toolFailure.code}. Do not retry it; use a separate read for verification if needed and report the blocker.`;
              this.ledger.append({
                type: "tool.result", phase: "error", status: "error", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name, toolFailure: blocked.toolFailure }, error,
              });
              return { ok: false, error, toolFailure: blocked.toolFailure };
            }
            try {
              const toolResult = await this.registry.execute(name, toolArguments, {
                requestId, requestEventId, callId, channel, attachment, temporalResolutions,
                verifiedObjectReferences: mergeObjectReferenceGroups([
                  ...objectReferences,
                  ...observedObjectReferences,
                ]),
              });
              const toolDefinition = this.registry.get(name);
              const providerResult = mcpResultDetails(toolResult);
              const resolveProviderTool = (targetName) => toolDefinition?.source === "local"
                ? this.registry.get(targetName)
                : this.registry.resolveUpstreamTool(toolDefinition?.source, targetName);
              const deferredActionReference = providerResult?.isError ? null : extractDeferredActionReference({
                tool: name,
                toolDefinition,
                result: toolResult,
                requestId,
                resolveProviderTool,
              });
              const actionContractProblem = providerResult?.isError ? null : deferredActionContractProblem({
                toolDefinition,
                result: toolResult,
                resolveProviderTool,
              });
              if (actionContractProblem) {
                const message = `${name} did not return a usable final confirmation step: ${actionContractProblem}`;
                const toolFailure = finalConfirmationHandoffFailure(name, toolDefinition);
                failedToolAttempts.add(attemptKey);
                const resultEventId = this.ledger.append({
                  type: "tool.result", phase: "error", status: "error", actorType: "tool",
                  actorName: name, channel, turnId: requestId, operationId: callId, name,
                  payload: {
                    callId, name, result: toolResult,
                    ...(providerResult ? { providerResult } : {}),
                    toolFailure,
                  },
                  error: message,
                });
                const receiptEventSeq = typeof this.ledger.eventSequence === "function"
                  ? this.ledger.eventSequence(resultEventId)
                  : null;
                const inline = inlineToolResult(toolResult, {
                  tool: name,
                  receiptEventSeq,
                  maximumCharacters: this.config.maxInlineToolResultCharacters ?? 32 * 1024,
                });
                sameRequestReceipts.push({
                  tool: name,
                  arguments: toolArguments,
                  ok: false,
                  result: inline.deliveredResult,
                  error: message,
                  toolFailure,
                  receiptEventSeq,
                });
                return { ok: false, error: message, result: inline.deliveredResult, toolFailure };
              }
              if (providerResult?.isError) {
                const message = providerToolError(name, toolResult);
                const toolFailure = repeatedToolFailure(
                  sameRequestReceipts, name, message, toolDefinition, toolArguments,
                );
                failedToolAttempts.add(attemptKey);
                const resultEventId = this.ledger.append({
                  type: "tool.result", phase: "error", status: "error", actorType: "tool",
                  actorName: name, channel, turnId: requestId, operationId: callId, name,
                  payload: { callId, name, result: toolResult, providerResult, ...(toolFailure ? { toolFailure } : {}) }, error: message,
                });
                const receiptEventSeq = typeof this.ledger.eventSequence === "function"
                  ? this.ledger.eventSequence(resultEventId)
                  : null;
                const filteredError = readOnly
                  ? this.resultFilter.filterReadResult(toolResult, {
                      requestId,
                      interactionId: callId,
                      tool: name,
                      source: registeredTool?.source ?? callableToolDefinitions.get(name)?.source,
                      filterRequest,
                      receiptEventSeq,
                      protectedFields: protectedReadResultFields(
                        registeredTool ?? callableToolDefinitions.get(name),
                        this.registry.toolDefinitions(),
                      ),
                    })
                  : null;
                if (filteredError) {
                  this.ledger.append({
                    type: "search.filter",
                    phase: filteredError.ok ? "end" : "error",
                    status: filteredError.ok ? "complete" : "error",
                    actorType: "service", actorName: "Search result filter",
                    channel, turnId: requestId, operationId: callId,
                    name: `${name} error result filtered`, content: filteredError.receipt.status,
                    payload: filteredError.receipt,
                    ...(filteredError.ok ? {} : { error: filteredError.error }),
                  });
                }
                const deliveredErrorResult = filteredError?.deliveredResult ?? toolResult;
                sameRequestReceipts.push({
                  tool: name, arguments: toolArguments,
                  ...(filterRequest ? { resultFilter: filterRequest } : {}),
                  ok: false, result: deliveredErrorResult, error: message, receiptEventSeq,
                  ...(toolFailure ? { toolFailure } : {}),
                });
                return { ok: false, error: message, result: deliveredErrorResult, ...(toolFailure ? { toolFailure } : {}) };
              }
              const resultEventId = this.ledger.append({
                type: "tool.result", phase: "end", status: "complete", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: {
                  callId, name, result: toolResult,
                  ...(providerResult ? { providerResult } : {}),
                  ...(deferredActionReference ? { deferredActionReference } : {}),
                },
              });
              const receiptEventSeq = typeof this.ledger.eventSequence === "function"
                ? this.ledger.eventSequence(resultEventId)
                : null;
              const sourcedActionReference = deferredActionReference ? {
                ...deferredActionReference,
                sourceReceiptEventSeq: receiptEventSeq,
              } : null;
              const recordedSets = name === "reference_set_record"
                ? mergeReferenceSets(toolResult?.referenceSets ?? [])
                : name === "object_connection_set"
                  ? connectionReferenceSets(requestId, toolResult, receiptEventSeq)
                  : [];
              if (
                sourcedActionReference
                && !generatedActionReferences.some(({ referenceId }) => (
                  referenceId === sourcedActionReference.referenceId
                ))
              ) {
                generatedActionReferences.push(sourcedActionReference);
              }
              const filtered = readOnly
                ? this.resultFilter.filterReadResult(toolResult, {
                    requestId,
                    interactionId: callId,
                    tool: name,
                    source: registeredTool?.source ?? callableToolDefinitions.get(name)?.source,
                    filterRequest,
                    receiptEventSeq,
                    protectedFields: protectedReadResultFields(
                      registeredTool ?? callableToolDefinitions.get(name),
                      this.registry.toolDefinitions(),
                    ),
                  })
                : null;
              if (filtered) {
                this.ledger.append({
                  type: "search.filter",
                  phase: filtered.ok ? "end" : "error",
                  status: filtered.ok ? "complete" : "error",
                  actorType: "service", actorName: "Search result filter",
                  channel, turnId: requestId, operationId: callId,
                  name: `${name} result filtered`, content: filtered.receipt.status,
                  payload: filtered.receipt,
                  ...(filtered.ok ? {} : { error: filtered.error }),
                });
              }
              if (filtered && !filtered.ok) {
                failedToolAttempts.add(attemptKey);
                sameRequestReceipts.push({
                  tool: name, arguments: toolArguments, resultFilter: filterRequest,
                  ok: false, result: filtered.deliveredResult, error: filtered.error,
                  receiptEventSeq,
                });
                return { ok: false, error: filtered.error, result: filtered.deliveredResult };
              }
              if (recordedSets.length) {
                this.ledger.append({
                  type: "reference.sets.observed", status: "complete", actorType: "service",
                  actorName: "Reference set recorder", channel, turnId: requestId,
                  operationId: callId, name: "Exact reference sets recorded",
                  content: `${recordedSets.length} exact reference set${recordedSets.length === 1 ? "" : "s"} recorded`,
                  payload: {
                    tool: name,
                    sourceReceiptEventSeq: receiptEventSeq,
                    referenceSets: recordedSets,
                  },
                });
              }
              const inline = filtered ?? inlineToolResult(toolResult, {
                tool: name,
                receiptEventSeq,
                maximumCharacters: name === "tool_receipt_read"
                  ? Number.MAX_SAFE_INTEGER
                  : this.config.maxInlineToolResultCharacters ?? 32 * 1024,
              });
              const newObjectReferences = objectReferenceGroupsFromToolResult({
                toolDefinition: registeredTool ?? callableToolDefinitions.get(name),
                toolDefinitions: this.registry.toolDefinitions(),
                result: inline.deliveredResult,
                sourceEventSeq: receiptEventSeq,
              });
              observedObjectReferences = mergeObjectReferenceGroups([
                ...observedObjectReferences, ...newObjectReferences,
              ]);
              if (newObjectReferences.length) {
                const objectCount = newObjectReferences.reduce(
                  (count, group) => count + group.objects.length, 0,
                );
                this.ledger.append({
                  type: "object.references.observed", status: "complete", actorType: "service",
                  actorName: "Object reference binder", channel, turnId: requestId,
                  operationId: callId, name: "Verified object references observed",
                  content: `${objectCount} verified object reference${objectCount === 1 ? "" : "s"} from ${name}`,
                  payload: {
                    tool: name, sourceReceiptEventSeq: receiptEventSeq,
                    objectReferences: newObjectReferences,
                  },
                });
              }
              sameRequestReceipts.push({
                tool: name,
                arguments: toolArguments,
                ...(filterRequest ? { resultFilter: filterRequest } : {}),
                ok: true,
                result: inline.deliveredResult,
                receiptEventSeq,
                ...(newObjectReferences.length ? { objectReferences: newObjectReferences } : {}),
                ...(recordedSets.length ? { referenceSets: recordedSets } : {}),
                ...(sourcedActionReference ? { deferredActionReference: sourcedActionReference } : {}),
              });
              if (!readOnly) successfulMutationAttempts.add(attemptKey);
              if (inline.paged) {
                this.ledger.append({
                  type: "tool.result.paged", status: "complete", actorType: "service",
                  actorName: "Tool result pager", channel, turnId: requestId,
                  operationId: callId, name,
                  payload: {
                    receiptEventSeq,
                    fullResultCharacters: inline.fullResultCharacters
                      ?? filtered?.receipt.summary.inputCharacters,
                    inlineCharacters: filterRequest?.max_characters
                      ?? this.config.maxInlineToolResultCharacters ?? 32 * 1024,
                  },
                });
              }
              return {
                ok: true,
                result: inline.deliveredResult,
                ...(newObjectReferences.length ? { objectReferences: newObjectReferences } : {}),
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const toolFailure = normalizedToolFailure(error?.toolFailure)
                ?? repeatedToolFailure(sameRequestReceipts, name, message, registeredTool, toolArguments);
              failedToolAttempts.add(attemptKey);
              const errorEventId = this.ledger.append({
                type: "tool.result", phase: "error", status: "error", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name, ...(toolFailure ? { toolFailure } : {}) }, error: message,
              });
              sameRequestReceipts.push({
                tool: name, arguments: toolArguments,
                ...(filterRequest ? { resultFilter: filterRequest } : {}),
                ok: false, error: message,
                receiptEventSeq: this.ledger.eventSequence?.(errorEventId) ?? null,
                ...(toolFailure ? { toolFailure } : {}),
              });
              return { ok: false, error: message, ...(toolFailure ? { toolFailure } : {}) };
            }
          },
        });
      } catch (error) {
        const diagnostics = error?.data && typeof error.data === "object" && !Array.isArray(error.data)
          ? error.data
          : {};
        this.ledger.append({
          type: "model.response", phase: "error", status: "error", actorType: "external",
          actorName: this.modelTransport.displayName, channel, turnId: requestId, operationId,
          name: "Model response failed", payload: diagnostics,
          error: error instanceof Error ? error.message : String(error),
        });
        if (diagnostics.usage) {
          this.ledger.append({
            type: "model.usage", status: "complete", actorType: "service",
            actorName: `${this.modelTransport.displayName} usage`, channel, turnId: requestId,
            operationId, name: "Model usage before failure",
            payload: {
              ...diagnostics.usage,
              workflowStep, workflowStepLabel, stepIndex, reasoningEffort: selectedEffort,
              attempt,
              responseFailed: true,
            },
          });
        }
        throw error;
      }

      this.ledger.append({
        type: "model.response", phase: "end", status: "complete", actorType: "model",
        actorName: selectedModel, channel, turnId: requestId, operationId,
        name: requestedCapabilities.size > 0 || requestedTools.size > 0
          ? "Model requested additional tools"
          : "Model response",
        payload: {
          workflowStep, workflowStepLabel, stepIndex,
          attempt,
          transport: this.modelTransport.id,
          conversationId: result.conversationId ?? result.threadId ?? null,
          providerTurnId: result.providerTurnId ?? result.turnId ?? null,
          status: result.status,
          messages: result.messages,
          protocolEvents: result.events,
        },
      });
      this.ledger.append({
        type: "model.usage", status: "complete", actorType: "service",
        actorName: `${this.modelTransport.displayName} usage`, channel, turnId: requestId,
        operationId, name: "Model usage after request",
        payload: {
          ...result.usage,
          workflowStep, workflowStepLabel, stepIndex, reasoningEffort: selectedEffort,
        },
      });

      if (requestedCapabilities.size === 0 && requestedTools.size === 0) break;
      if (!this.requestCompiler) throw new Error("Tool expansion requires the request compiler");
      conversationId = null;
      if (requestedTools.size > 0) {
        toolExpansionRounds += 1;
        for (const toolName of requestedTools) selectedToolNames.add(toolName);
        compilation = await this.requestCompiler.compile({
          tools: availableTools,
          text,
          attachment,
          recentConversation,
          previousCapabilities: priorConversation.capabilities,
          capabilityOverride: compilation.capabilities,
          toolOverride: [...selectedToolNames],
          allowCapabilityExpansion: false,
          allowToolExpansion: toolExpansionRounds < maximumToolExpansionRounds,
        });
      } else {
        capabilityExpansionRounds += 1;
        compilation = await this.requestCompiler.compile({
          tools: availableTools,
          text,
          attachment,
          recentConversation,
          previousCapabilities: priorConversation.capabilities,
          capabilityOverride: [...new Set([...compilation.capabilities, ...requestedCapabilities])],
          allowCapabilityExpansion: capabilityExpansionRounds < maximumCapabilityExpansionRounds,
        });
      }
    }

    const finalConversationId = result.conversationId ?? result.threadId;
    const finalToolFingerprint = callableToolsFingerprint(compilation.tools);
    if (
      !isolatedConversation
      && finalAttemptStartedNewConversation
      && typeof this.ledger.markConversationStarted === "function"
    ) {
      this.ledger.markConversationStarted({
        conversationId: finalConversationId,
        toolFingerprint: finalToolFingerprint,
        capabilities: compilation.capabilities,
        requestId,
        channel,
      });
    }
    return {
      text: responseWithCreatedTodoSequences(result.text, sameRequestReceipts),
      result,
      receipts: sameRequestReceipts,
      actionReferences: generatedActionReferences,
      toolCallCount: totalToolCallCount,
      capabilities: compilation.capabilities,
      selectedToolNames: [...selectedToolNames],
      callableToolCatalog: callableToolCatalog(compilation.tools),
      conversationId: finalConversationId,
    };
  }
}
