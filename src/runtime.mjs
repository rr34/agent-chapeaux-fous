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
  requiredToolCapabilityFindings,
  requiredToolCapabilityRepairContext,
} from "./request-compiler.mjs";
import {
  readResultFilterSchema,
  ResultFilterBoundary,
  splitReadResultFilter,
} from "./search/result-filter.mjs";
import { mcpResultDetails } from "./tools/mcp-tools.mjs";
import { schemaProblem } from "./tools/registry.mjs";
import {
  auditContext,
  auditInstructions,
  completionAuditSchema,
  orientationContext,
  orientationInstructions,
  parseStructuredModelOutput,
  preparedContextOrientationContext,
  turnBriefInstructions,
  turnBriefSchema,
} from "./turn-brief.mjs";
import {
  temporalConsistencyFindings,
  temporalRepairContext,
} from "./temporal-consistency.mjs";

function argumentsObject(value) {
  if (value == null) return {};
  if (typeof value === "string") return JSON.parse(value || "{}");
  if (typeof value === "object" && !Array.isArray(value)) return value;
  throw new Error("Tool arguments must be a JSON object");
}

function callableToolsFingerprint(tools) {
  return createHash("sha256").update(JSON.stringify(tools)).digest("hex");
}

function callableToolCatalog(tools) {
  return tools
    .filter(({ name }) => !["request_capabilities", "request_tools"].includes(name))
    .map(({ name, title, description, source, upstreamName, capabilityId, annotations }) => ({
      name,
      title: title ?? null,
      description,
      source,
      upstreamName: upstreamName ?? null,
      capabilityId: capabilityId ?? null,
      annotations: annotations ?? null,
    }));
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

function toolAttemptKey(name, args) {
  return `${name}\n${JSON.stringify(canonicalToolArguments(args))}`;
}

function hasReceiptGatedActiveBriefing(preparedCapabilityContext) {
  return preparedCapabilityContext.some(({ view, data }) => (
    view === "interaction-guides.active_runs"
    && Array.isArray(data?.runs)
    && data.runs.some(({ currentExchange }) => (
      currentExchange?.contractSummary?.completionMode === "tool_receipt"
      || currentExchange?.contract?.completion?.mode === "tool_receipt"
    ))
  ));
}

function activeBriefingDestinationTools(preparedCapabilityContext) {
  return [...new Set(preparedCapabilityContext.flatMap(({ view, data }) => (
    view === "interaction-guides.active_runs" && Array.isArray(data?.runs)
      ? data.runs.flatMap(({ currentExchange }) => (
          currentExchange?.contractSummary
            ? [
                ...(currentExchange.contractSummary.operationTools ?? []),
                ...(currentExchange.contractSummary.legacyInstructionTools ?? []),
              ]
            : currentExchange?.contract?.operations?.map(({ tool }) => tool).filter(Boolean) ?? []
        ))
      : []
  )))];
}

function recentToolReceiptIndex(ledger, recentConversation, maximumReceipts = 24) {
  if (typeof ledger?.toolReceiptList !== "function") return [];
  const requestIds = [...new Set(
    [...recentConversation].reverse().map(({ requestId }) => requestId).filter(Boolean),
  )];
  const receipts = [];
  for (const requestId of requestIds) {
    const page = ledger.toolReceiptList({ requestId, limit: Math.min(8, maximumReceipts) });
    for (const receipt of page.receipts ?? []) {
      receipts.push({
        receiptEventSeq: receipt.receiptEventSeq,
        requestId: receipt.requestId,
        occurredAtUtc: receipt.occurredAtUtc,
        tool: receipt.tool,
        status: receipt.status,
        ok: receipt.ok,
        resultCharacters: receipt.resultCharacters,
        argumentCharacters: receipt.argumentCharacters,
        error: typeof receipt.error === "string" ? receipt.error.slice(0, 1000) : null,
      });
      if (receipts.length >= maximumReceipts) return receipts;
    }
  }
  return receipts;
}

function receiptReferenceFindings(brief, recentToolReceipts) {
  const indexed = new Map(recentToolReceipts.map((receipt) => [receipt.receiptEventSeq, receipt]));
  const seen = new Set();
  const findings = [];
  for (const [index, reference] of (brief.receiptReferences ?? []).entries()) {
    const receipt = indexed.get(reference.receiptEventSeq);
    if (seen.has(reference.receiptEventSeq)) {
      findings.push({
        code: "duplicate_receipt_reference",
        path: `brief.receiptReferences[${index}].receiptEventSeq`,
        message: `Receipt ${reference.receiptEventSeq} is selected more than once`,
      });
      continue;
    }
    seen.add(reference.receiptEventSeq);
    if (!receipt || receipt.tool !== reference.tool) {
      findings.push({
        code: "receipt_reference_not_indexed",
        path: `brief.receiptReferences[${index}]`,
        message: `Receipt ${reference.receiptEventSeq} for ${reference.tool} is not an exact entry in the supplied receipt index`,
      });
    }
  }
  if ((brief.receiptReferences ?? []).length > 0 && !brief.requiredTools.includes("tool_receipt_read")) {
    findings.push({
      code: "receipt_reader_not_selected",
      path: "brief.requiredTools",
      message: "receiptReferences requires tool_receipt_read in requiredTools",
    });
  }
  return findings;
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

function terminalToolFailureNotice(findings) {
  const failure = findings[0]?.toolFailure;
  if (!failure) return "";
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

function finalConfirmationHandoffFailure(toolName, toolDefinition) {
  const source = String(toolDefinition?.source ?? "mcp:unknown");
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
    code: "MCP_FINAL_CONFIRMATION_INVALID",
    terminalForCurrentRequest: true,
    retry: "after_provider_contract_correction_and_integration_refresh",
    serverName,
    capabilityId: toolDefinition?.capabilityId ?? `integration:${serverName}`,
    transportId: "mcp-control-plane",
    contractFingerprint,
    step: "final_confirmation_handoff",
    method: null,
    path: null,
    httpStatus: null,
    sourceTool: toolName,
  };
}

export function auditEffectsForReceipts(receipts, registry) {
  return receipts.flatMap((receipt) => {
    if (!receipt?.ok || ["request_capabilities", "request_tools"].includes(receipt.tool)) return [];
    const annotations = registry.get(receipt.tool)?.annotations;
    if (annotations?.readOnlyHint === true) return [];
    return [{
      tool: receipt.tool,
      reason: annotations?.readOnlyHint === false
        ? "tool declares possible effects"
        : "tool effects are not declared read-only",
    }];
  });
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

function sameRequestReceiptInstructions(receipts, maximumCharacters = 24_000) {
  if (!receipts.length) return "";
  const header = [
    "# Earlier execution evidence from this same user request",
    "Each source-referenced entry below is the compact canonical continuation projection of one durable tool receipt. Treat successful entries as completed actions, continue from their evidence, and do not repeat them unless the user explicitly asked for repetition.",
  ].join("\n");
  const blocks = [];
  let characters = header.length;
  for (const receipt of receipts) {
    const projected = continuationReceipt(receipt);
    const exact = JSON.stringify(projected);
    const remaining = maximumCharacters - characters - 2;
    if (remaining <= 0) break;
    const block = exact.length <= remaining
      ? exact
      : JSON.stringify({
          receiptEventSeq: receipt.receiptEventSeq ?? null,
          tool: receipt.tool,
          arguments: receipt.arguments,
          status: receipt.ok ? "complete" : "error",
          evidenceStoredInDurableReceipt: true,
          continuation: Number.isSafeInteger(receipt.receiptEventSeq)
            ? "The exact durable receipt remains source evidence. Use tool_receipt_read only when it is callable and this omitted evidence is still necessary; never repeat the original action merely to recover its result."
            : "The exact durable receipt remains in the request trace; never repeat the original action merely to recover its result.",
        });
    if (block.length > remaining) break;
    blocks.push(block);
    characters += block.length + 2;
  }
  const omitted = receipts.length - blocks.length;
  return [header, ...blocks, ...(omitted ? [`[${omitted} additional evidence entr${omitted === 1 ? "y" : "ies"} omitted]`] : [])].join("\n\n");
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
  }) {
    this.modelTransport = modelTransport;
    this.registry = registry;
    this.contextBuilder = contextBuilder;
    this.requestCompiler = requestCompiler;
    this.ledger = ledger;
    this.config = config;
    this.resultFilter = resultFilter;
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
      baseInstructions: ["orientation", "orientation_repair"].includes(step)
        ? orientationInstructions
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
      const value = parseStructuredModelOutput(result.text, outputSchema, label);
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

  async #runWorkflow(args) {
    const channel = args.channel ?? "web";
    const workflowStartedAt = Date.now();
    const configuredTimeoutMs = args.runLimits?.timeoutMs ?? null;
    const configuredMaxToolCalls = args.runLimits == null
      ? this.config.maxToolCalls
      : args.runLimits.maxToolCalls;
    const remainingTimeoutMs = () => {
      if (configuredTimeoutMs === null) return null;
      const remaining = configuredTimeoutMs - (Date.now() - workflowStartedAt);
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
    const catalog = requestCapabilityCatalog(availableTools);
    const routing = await this.requestCompiler.compile({
      tools: availableTools,
      text: args.text,
      attachment: args.attachment,
      recentConversation: [],
      previousCapabilities: [],
    });
    const boundaryEventSeq = typeof this.ledger.conversationBoundaryEventSeq === "function"
      ? this.ledger.conversationBoundaryEventSeq()
      : 0;
    const recentConversation = typeof this.ledger.recentConversation === "function"
      ? this.ledger.recentConversation({
          beforeRequestId: args.requestId,
          afterEventSeq: boundaryEventSeq,
          limit: 6,
        })
      : [];
    const previousState = typeof this.ledger.latestConversationState === "function"
      ? this.ledger.latestConversationState({ afterEventSeq: boundaryEventSeq })
      : null;
    const activeActionReferences = typeof this.ledger.activeDeferredActionReferences === "function"
      ? this.ledger.activeDeferredActionReferences({ afterEventSeq: boundaryEventSeq })
      : [];
    const referencedExchanges = typeof this.ledger.referencedExchangesForRequest === "function"
      ? this.ledger.referencedExchangesForRequest(args.requestId, { limit: 8 })
      : [];
    const recentToolReceipts = recentToolReceiptIndex(this.ledger, [
      ...recentConversation,
      ...referencedExchanges.map(({ requestId }) => ({ requestId })),
    ]);
    const fallbackCheckpoint = !previousState
      && recentConversation.length >= 10
      && typeof this.ledger.conversationCheckpoint === "function"
      ? this.ledger.conversationCheckpoint({
          afterEventSeq: boundaryEventSeq,
          beforeRequestId: args.requestId,
          maximumCharacters: 16_000,
        }).text
      : null;
    const orientationBaseContext = await this.contextBuilder.build(args.requestId, args.text, {
      attachment: args.attachment,
      nativeConversation: false,
      continuingConversation: false,
      conversationStartEventSeq: boundaryEventSeq,
      capabilities: [],
      conversationCheckpoint: null,
      includeRecentExchanges: false,
    });
    const requestEventSeq = typeof this.ledger.eventSequence === "function"
      ? this.ledger.eventSequence(args.requestEventId)
      : null;
    const schema = turnBriefSchema(
      catalog.map(({ capability }) => capability),
      activeActionReferences.map(({ referenceId }) => referenceId),
      catalog.flatMap(({ contextViews = [] }) => contextViews.map(({ id }) => id)),
      catalog.flatMap(({ tools = [] }) => tools.map(({ name }) => name)),
      recentToolReceipts,
    );
    const orientationDeveloperInstructions = joinedInstructions(
      orientationBaseContext.developerInstructions ?? orientationBaseContext.text,
      orientationContext({
        requestId: args.requestId,
        requestEventSeq,
        recentConversation,
        previousState,
        fallbackCheckpoint,
        capabilityCatalog: catalog,
        deferredActionReferences: activeActionReferences,
        recentToolReceipts,
        explicitHats: routing.explicitHats,
      }),
      args.supplementalInstructions,
    );
    let orientation = await this.#runStructuredStep({
      requestId: args.requestId,
      channel,
      step: "orientation",
      label: "Orient request",
      stepIndex: 1,
      model: args.model || this.config.model,
      effort: this.config.orientationReasoningEffort ?? "medium",
      input: args.text,
      developerInstructions: orientationDeveloperInstructions,
      requestAttachmentInput: orientationBaseContext.requestAttachmentInput ?? null,
      outputSchema: schema,
      runTimeoutMs: remainingTimeoutMs(),
    });
    const confirmedTargetTools = (candidate) => activeActionReferences
      .filter(({ referenceId }) => candidate.confirmedActionReferenceIds.includes(referenceId))
      .map(({ targetTool }) => targetTool);
    const validateBrief = (candidate, requiredContractTools = []) => {
      const temporalFindings = temporalConsistencyFindings(candidate, {
        requestText: args.text,
        requestEventSeq,
      });
      const capabilityFindings = requiredToolCapabilityFindings(
        availableTools,
        candidate.requiredCapabilities,
        [...candidate.requiredTools, ...confirmedTargetTools(candidate), ...requiredContractTools],
      );
      const selectedToolNames = new Set(candidate.requiredTools);
      const contractToolFindings = requiredContractTools
        .filter((tool) => !selectedToolNames.has(tool))
        .map((tool) => ({
          code: "contract_tool_not_selected",
          path: "brief.requiredTools",
          message: `${tool} is a declared destination operation for the active exchange but is absent from requiredTools`,
          tool,
        }));
      const receiptFindings = receiptReferenceFindings(candidate, recentToolReceipts);
      return {
        temporalFindings,
        capabilityFindings: [...capabilityFindings, ...contractToolFindings],
        receiptFindings,
        findings: [
          ...temporalFindings, ...capabilityFindings, ...contractToolFindings, ...receiptFindings,
        ],
      };
    };
    let brief = orientation.value;
    let validation = validateBrief(brief);
    const recordBriefValidation = (findings, candidate, repaired = false) => {
      const valid = findings.length === 0;
      const content = valid
        ? `TurnBrief validation passed${repaired ? " after repair" : ""}`
        : findings.map(({ message }) => message).join("; ");
      this.ledger.append({
        type: "turn.brief.validation",
        phase: valid ? "end" : "error",
        status: valid ? "complete" : "error",
        actorType: "service",
        actorName: "TurnBrief validation guard",
        channel,
        turnId: args.requestId,
        name: valid ? "TurnBrief validation passed" : "TurnBrief validation failed",
        content,
        payload: {
          repaired,
          findings,
          temporalResolutions: candidate.temporalResolutions,
          requiredCapabilities: candidate.requiredCapabilities,
          requiredTools: candidate.requiredTools,
          receiptReferences: candidate.receiptReferences,
        },
        ...(valid ? {} : { error: content }),
      });
    };
    recordBriefValidation(validation.findings, brief);
    if (validation.findings.length) {
      orientation = await this.#runStructuredStep({
        requestId: args.requestId,
        channel,
        step: "orientation_repair",
        label: "Repair orientation",
        stepIndex: 1,
        model: args.model || this.config.model,
        effort: this.config.orientationReasoningEffort ?? "medium",
        input: args.text,
        developerInstructions: joinedInstructions(
          orientationDeveloperInstructions,
          validation.temporalFindings.length
            ? temporalRepairContext(brief, validation.temporalFindings)
            : null,
          validation.capabilityFindings.length
            ? requiredToolCapabilityRepairContext(brief, validation.capabilityFindings)
            : null,
          validation.receiptFindings.length
            ? [
                "# Receipt-reference validation requires repair",
                JSON.stringify(validation.receiptFindings, null, 2),
                "Select only exact receiptEventSeq and tool pairs from the supplied recent receipt index. Include tool_receipt_read whenever receiptReferences is nonempty.",
              ].join("\n")
            : null,
        ),
        requestAttachmentInput: orientationBaseContext.requestAttachmentInput ?? null,
        outputSchema: schema,
        runTimeoutMs: remainingTimeoutMs(),
      });
      brief = orientation.value;
      validation = validateBrief(brief);
      recordBriefValidation(validation.findings, brief, true);
      if (validation.findings.length) {
        throw new Error(`TurnBrief validation failed after repair: ${validation.findings.map(({ message }) => message).join("; ")}`);
      }
    }
    const contextOperationId = `${this.modelTransport.id}:${args.requestId}:context_preparation`;
    this.ledger.append({
      type: "agent.step", phase: "start", status: "processing", actorType: "service",
      actorName: "Structured turn workflow", channel, turnId: args.requestId,
      operationId: contextOperationId, name: "Prepare execution context",
      content: "Preparing orientation-requested context",
      payload: {
        workflowStep: "context_preparation", workflowStepLabel: "Prepare execution context",
        stepIndex: 2, reasoningEffort: null, requests: brief.contextRequests,
      },
    });
    let preparedCapabilityContext;
    try {
      preparedCapabilityContext = await this.registry.prepareContext(brief.contextRequests, {
        requestId: args.requestId,
        requestEventId: args.requestEventId,
        requestText: args.text,
        channel,
      });
      this.ledger.append({
        type: "context.prepared", status: "complete", actorType: "service",
        actorName: "Capability context", channel, turnId: args.requestId,
        operationId: contextOperationId, name: "Execution context prepared",
        content: preparedCapabilityContext.length
          ? preparedCapabilityContext.map(({ title, view }) => `${title} (${view})`).join(", ")
          : "No capability context requested",
        payload: { requests: brief.contextRequests, sections: preparedCapabilityContext },
      });
      this.ledger.append({
        type: "agent.step", phase: "end", status: "complete", actorType: "service",
        actorName: "Structured turn workflow", channel, turnId: args.requestId,
        operationId: contextOperationId, name: "Prepare execution context",
        content: preparedCapabilityContext.length
          ? `Prepared ${preparedCapabilityContext.length} requested context view(s)`
          : "No execution context was requested",
        payload: {
          workflowStep: "context_preparation", workflowStepLabel: "Prepare execution context",
          stepIndex: 2, reasoningEffort: null, requests: brief.contextRequests,
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
          stepIndex: 2, reasoningEffort: null, requests: brief.contextRequests,
        },
      });
      throw error;
    }
    if (hasReceiptGatedActiveBriefing(preparedCapabilityContext)) {
      const requiredContractTools = activeBriefingDestinationTools(preparedCapabilityContext);
      const refinementSchema = turnBriefSchema(
        catalog.map(({ capability }) => capability),
        activeActionReferences.map(({ referenceId }) => referenceId),
        brief.contextRequests,
        catalog.flatMap(({ tools = [] }) => tools.map(({ name }) => name)),
        recentToolReceipts,
      );
      refinementSchema.properties.contextRequests.minItems = brief.contextRequests.length;
      const refinementDeveloperInstructions = joinedInstructions(
        orientationBaseContext.developerInstructions ?? orientationBaseContext.text,
        preparedContextOrientationContext({
          brief,
          preparedCapabilityContext,
          capabilityCatalog: catalog,
        }),
        args.supplementalInstructions,
      );
      orientation = await this.#runStructuredStep({
        requestId: args.requestId,
        channel,
        step: "orientation_context",
        label: "Finalize orientation from prepared context",
        stepIndex: 2,
        model: args.model || this.config.model,
        effort: this.config.orientationReasoningEffort ?? "medium",
        input: args.text,
        developerInstructions: refinementDeveloperInstructions,
        requestAttachmentInput: orientationBaseContext.requestAttachmentInput ?? null,
        outputSchema: refinementSchema,
        runTimeoutMs: remainingTimeoutMs(),
      });
      brief = orientation.value;
      validation = validateBrief(brief, requiredContractTools);
      recordBriefValidation(validation.findings, brief);
      if (validation.findings.length) {
        orientation = await this.#runStructuredStep({
          requestId: args.requestId,
          channel,
          step: "orientation_context_repair",
          label: "Repair context-informed orientation",
          stepIndex: 2,
          model: args.model || this.config.model,
          effort: this.config.orientationReasoningEffort ?? "medium",
          input: args.text,
          developerInstructions: joinedInstructions(
            refinementDeveloperInstructions,
            validation.temporalFindings.length
              ? temporalRepairContext(brief, validation.temporalFindings)
              : null,
            validation.capabilityFindings.length
              ? requiredToolCapabilityRepairContext(brief, validation.capabilityFindings)
              : null,
            validation.receiptFindings.length
              ? [
                  "# Receipt-reference validation requires repair",
                  JSON.stringify(validation.receiptFindings, null, 2),
                  "Select only exact receiptEventSeq and tool pairs from the supplied recent receipt index. Include tool_receipt_read whenever receiptReferences is nonempty.",
                ].join("\n")
              : null,
          ),
          requestAttachmentInput: orientationBaseContext.requestAttachmentInput ?? null,
          outputSchema: refinementSchema,
          runTimeoutMs: remainingTimeoutMs(),
        });
        brief = orientation.value;
        validation = validateBrief(brief, requiredContractTools);
        recordBriefValidation(validation.findings, brief, true);
        if (validation.findings.length) {
          throw new Error(`Context-informed TurnBrief validation failed after repair: ${validation.findings.map(({ message }) => message).join("; ")}`);
        }
      }
    }
    const confirmedActionReferences = activeActionReferences
      .filter(({ referenceId }) => brief.confirmedActionReferenceIds.includes(referenceId))
      .map((reference) => ({ ...reference, state: "confirmed" }));
    const confirmedReferenceIds = new Set(
      confirmedActionReferences.map(({ referenceId }) => referenceId),
    );
    const pendingTargetTools = new Set(activeActionReferences
      .filter(({ referenceId }) => !confirmedReferenceIds.has(referenceId))
      .map(({ targetTool }) => targetTool));
    this.ledger.append({
      type: "turn.brief", status: "complete", actorType: "service",
      actorName: "Turn orienter", channel, turnId: args.requestId,
      name: "Accepted TurnBrief", content: brief.summary,
      payload: { brief, sourceRequestId: args.requestId },
      subjectType: "turn_brief", subjectId: args.requestId,
    });
    this.ledger.append({
      type: "conversation.state", status: "complete", actorType: "service",
      actorName: "Turn orienter", channel, turnId: args.requestId,
      name: "Rolling conversation state", content: brief.summary,
      payload: {
        state: brief.conversationState,
        sourceTurnBrief: brief,
        sourceRequestId: args.requestId,
      },
      subjectType: "conversation_state", subjectId: "main",
    });
    const contextCapabilities = brief.contextRequests.map((viewId) => (
      this.registry.contextView(viewId)?.capabilityId
    )).filter(Boolean);
    const explicitHatCapabilities = routing.explicitHats
      .filter(({ available }) => available)
      .map(({ capability }) => capability);
    const executionCapabilities = [...new Set([
      ...explicitHatCapabilities,
      ...brief.requiredCapabilities,
      ...contextCapabilities,
    ])];
    const executorArgs = {
      ...args,
      capabilityOverride: executionCapabilities,
      toolOverride: [...new Set([
        ...brief.requiredTools.filter((toolName) => !pendingTargetTools.has(toolName)),
        ...confirmedActionReferences.map(({ targetTool }) => targetTool),
      ])],
      runLimits: {
        maxToolCalls: configuredMaxToolCalls,
        timeoutMs: remainingTimeoutMs(),
      },
      supplementalInstructions: joinedInstructions(
        args.supplementalInstructions,
        turnBriefInstructions(brief, confirmedActionReferences),
      ),
      activeActionReferences,
      confirmedActionReferences,
      preparedCapabilityContext,
      temporalResolutions: brief.temporalResolutions,
    };
    const execution = await this.#runExecutorStep(executorArgs, {
      step: "execution", label: "Execute request", stepIndex: 3,
      effort: args.effort || this.config.reasoningEffort,
    });
    const receiptFindings = completionReceiptFindings({
      brief,
      receipts: execution.receipts,
      confirmedActionReferences,
    });
    const confirmationFindings = pendingConfirmationFindings(
      execution.receipts,
      confirmedActionReferences,
    );
    const terminalFindings = terminalToolFailureFindings(execution.receipts);
    const executionFindings = [...receiptFindings, ...confirmationFindings, ...terminalFindings];
    const auditEffects = auditEffectsForReceipts(execution.receipts, this.registry);
    const declaredActionNeedsAudit = brief.responseMode === "act" && brief.requestedActions.length > 0;
    if (
      !brief.audit.required
      && !declaredActionNeedsAudit
      && auditEffects.length === 0
      && executionFindings.length === 0
    ) {
      const operationId = `${this.modelTransport.id}:${args.requestId}:audit`;
      const auditPayload = {
        workflowStep: "audit", workflowStepLabel: "Audit completion", stepIndex: 4,
        reasoningEffort: null, skipped: true,
        reason: "TurnBrief did not require an audit and all successful calls declared read-only effects.",
      };
      this.ledger.append({
        type: "agent.step", phase: "start", status: "processing", actorType: "service",
        actorName: "Structured turn workflow", channel, turnId: args.requestId, operationId,
        name: "Audit completion", content: "Evaluating whether an audit is required", payload: auditPayload,
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
      label: "Audit completion",
      stepIndex: 4,
      model: args.model || this.config.model,
      effort: this.config.auditReasoningEffort ?? "low",
      input: `Audit completion of request ${args.requestId}.`,
      developerInstructions: auditContext({
        brief,
        receipts: execution.receipts,
        executorResponse: execution.text,
        deterministicFindings: executionFindings,
        auditEffects,
        callableTools: execution.callableToolCatalog,
      }),
      outputSchema: completionAuditSchema,
      runTimeoutMs: remainingTimeoutMs(),
    });
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
        "# Completion audit requires repair",
        JSON.stringify(audit.value, null, 2),
        "# Application-enforced receipt findings",
        JSON.stringify(executionFindings, null, 2),
        "Perform only the remaining requested work. Earlier successful receipts are completed actions and must not be repeated. Use only the completion audit's satisfiedCriteria and successful receipts to carry earlier completed work into the final answer. Return one coherent final response to the original user request. Include earlier completed work only when it remains a user-relevant part of the final outcome. Describe included actions as work completed during this same user request, not as state that merely existed beforehand. Report the resulting state without narrating internal execution, audit, failure, retry, or repair history unless an unresolved problem still affects the user.",
      ),
    };
    const repair = await this.#runExecutorStep(repairArgs, {
      step: "repair", label: "Repair completion", stepIndex: 5,
      effort: this.config.repairReasoningEffort ?? args.effort ?? this.config.reasoningEffort,
      initialReceipts: execution.receipts,
    });
    const finalFindings = completionReceiptFindings({
      brief,
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
    return repair.text;
  }

  async run(args) {
    let rawResponse;
    if (
      this.config.turnWorkflowEnabled !== false
      && this.requestCompiler
      && !Array.isArray(args.capabilityOverride)
    ) {
      rawResponse = await this.#runWorkflow(args);
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
        payload: { dateStyle: "EEE, dd MMM yyyy" },
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
    preparedCapabilityContext = null, temporalResolutions = [],
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
          allowCapabilityExpansion: !workflowStep,
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
    // Orientation owns capability-family selection for structured execution.
    // Legacy/direct execution may make one bounded late expansion, but an
    // expansion can never turn into open-ended capability fishing.
    const maximumCapabilityExpansionRounds = workflowStep ? 0 : 1;
    let capabilityExpansionRounds = 0;
    const maximumToolExpansionRounds = Array.isArray(toolOverride)
      ? Math.max(0, this.config.maxToolExpansionRounds ?? 2)
      : 0;
    let toolExpansionRounds = 0;
    const selectedToolNames = new Set(toolOverride ?? []);
    let attempt = 0;
    let result;
    const sameRequestReceipts = [...initialReceipts];
    const generatedActionReferences = [];
    let conversationCheckpoint = null;
    let finalAttemptStartedNewConversation = !conversationId;
    const failedToolAttempts = new Set();
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
        ? "Capability expansion is complete. Continue and finish the original user request using the newly callable tools. Do not ask the user to repeat it, and do not repeat actions already confirmed by earlier tool results."
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
        name: attempt === 1 ? "Model request" : "Model request after tool expansion",
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
            if (expansionRequested && !["request_capabilities", "request_tools"].includes(name)) {
              const message = "Tool expansion is pending; no other tool is callable in this model turn";
              this.ledger.append({
                type: "tool.result", phase: "error", status: "error", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name }, error: message,
              });
              return { ok: false, error: message };
            }
            const registeredTool = this.registry.get(name);
            const readOnly = registeredTool?.annotations?.readOnlyHint === true;
            const { toolArguments, filterRequest } = splitReadResultFilter(args, readOnly);
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
                  ? "Capability expansion is unavailable during structured execution; orientation already selected the accepted TurnBrief capabilities and their declared dependent tools"
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
                payload: { callId, name }, error: message,
              });
              return { ok: false, error: message };
            }
            try {
              const toolResult = await this.registry.execute(name, toolArguments, {
                requestId, requestEventId, callId, channel, attachment, temporalResolutions,
              });
              const toolDefinition = this.registry.get(name);
              const providerResult = mcpResultDetails(toolResult);
              const resolveProviderTool = (upstreamName) => this.registry.resolveUpstreamTool(
                toolDefinition?.source,
                upstreamName,
              );
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
                failedToolAttempts.add(attemptKey);
                const resultEventId = this.ledger.append({
                  type: "tool.result", phase: "error", status: "error", actorType: "tool",
                  actorName: name, channel, turnId: requestId, operationId: callId, name,
                  payload: { callId, name, result: toolResult, providerResult }, error: message,
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
                });
                return { ok: false, error: message, result: deliveredErrorResult };
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
              const inline = filtered ?? inlineToolResult(toolResult, {
                tool: name,
                receiptEventSeq,
                maximumCharacters: name === "tool_receipt_read"
                  ? Number.MAX_SAFE_INTEGER
                  : this.config.maxInlineToolResultCharacters ?? 32 * 1024,
              });
              sameRequestReceipts.push({
                tool: name,
                arguments: toolArguments,
                ...(filterRequest ? { resultFilter: filterRequest } : {}),
                ok: true,
                result: inline.deliveredResult,
                receiptEventSeq,
                ...(sourcedActionReference ? { deferredActionReference: sourcedActionReference } : {}),
              });
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
              return { ok: true, result: inline.deliveredResult };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              const toolFailure = normalizedToolFailure(error?.toolFailure);
              failedToolAttempts.add(attemptKey);
              sameRequestReceipts.push({
                tool: name, arguments: toolArguments,
                ...(filterRequest ? { resultFilter: filterRequest } : {}),
                ok: false, error: message,
                ...(toolFailure ? { toolFailure } : {}),
              });
              this.ledger.append({
                type: "tool.result", phase: "error", status: "error", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name, ...(toolFailure ? { toolFailure } : {}) }, error: message,
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
      text: result.text,
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
