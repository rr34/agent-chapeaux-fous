import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import {
  completionReceiptFindings,
  deferredActionArgumentProblem,
  extractDeferredActionReference,
  incompleteReceiptResponse,
} from "./deferred-actions.mjs";
import { requestCapabilityCatalog } from "./request-compiler.mjs";
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
  turnBriefInstructions,
  turnBriefSchema,
} from "./turn-brief.mjs";

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
      repairInstruction: "Do not retry this operation or substitute another transport. Preserve earlier receipts and report the provider or connection change required before retrying.",
      terminalForCurrentRequest: true,
      toolFailure,
    }];
  });
}

function terminalToolFailureNotice(findings) {
  const failure = findings[0]?.toolFailure;
  if (!failure) return "";
  const operation = [failure.method, failure.path].filter(Boolean).join(" ");
  const status = failure.httpStatus == null ? failure.code : `HTTP ${failure.httpStatus}`;
  return [
    `Transfer status: ${failure.serverName} did not honor its advertised artifact-transfer contract`,
    operation ? ` for ${operation}` : "",
    ` (${status}). The unchanged transfer will not be retried until the integration is refreshed after the provider changes. Earlier successful steps remain recorded.`,
  ].join("");
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

function sameRequestReceiptInstructions(receipts, maximumCharacters = 24_000) {
  if (!receipts.length) return "";
  const header = [
    "# Earlier tool receipts from this same user request",
    "These calls already happened earlier in this request. Treat successful receipts as completed actions, continue from their exact results, and do not repeat them unless the user explicitly asked for repetition.",
  ].join("\n");
  const blocks = [];
  let characters = header.length;
  for (const receipt of receipts) {
    const exact = JSON.stringify(receipt);
    const remaining = maximumCharacters - characters - 2;
    if (remaining <= 0) break;
    const block = exact.length <= remaining
      ? exact
      : JSON.stringify({
          tool: receipt.tool,
          arguments: receipt.arguments,
          ok: receipt.ok,
          resultOmittedBecauseReceiptBudgetWasExceeded: true,
        });
    if (block.length > remaining) break;
    blocks.push(block);
    characters += block.length + 2;
  }
  const omitted = receipts.length - blocks.length;
  return [header, ...blocks, ...(omitted ? [`[${omitted} additional receipt(s) omitted]`] : [])].join("\n\n");
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
      baseInstructions: step === "orientation" ? orientationInstructions : auditInstructions,
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
      if (!responseRecorded) {
        this.ledger.append({
          type: "model.response", phase: "error", status: "error", actorType: "external",
          actorName: this.modelTransport.displayName, channel, turnId: requestId,
          operationId, name: `${label} model response failed`, error: message,
        });
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
    const availableTools = this.registry.toolDefinitions();
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
    );
    const orientation = await this.#runStructuredStep({
      requestId: args.requestId,
      channel,
      step: "orientation",
      label: "Orient request",
      stepIndex: 1,
      model: args.model || this.config.model,
      effort: this.config.orientationReasoningEffort ?? "medium",
      input: args.text,
      developerInstructions: joinedInstructions(
        orientationBaseContext.developerInstructions ?? orientationBaseContext.text,
        orientationContext({
          requestId: args.requestId,
          requestEventSeq,
          recentConversation,
          previousState,
          fallbackCheckpoint,
          capabilityCatalog: catalog,
          deferredActionReferences: activeActionReferences,
          explicitHats: routing.explicitHats,
        }),
        args.supplementalInstructions,
      ),
      requestAttachmentInput: orientationBaseContext.requestAttachmentInput ?? null,
      outputSchema: schema,
      runTimeoutMs: remainingTimeoutMs(),
    });
    const brief = orientation.value;
    const authorizedActionReferences = activeActionReferences.filter(({ referenceId }) => (
      brief.authorizedActionReferenceIds.includes(referenceId)
    ));
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
        ...brief.requiredTools,
        ...authorizedActionReferences.map(({ targetTool }) => targetTool),
      ])],
      runLimits: {
        maxToolCalls: configuredMaxToolCalls,
        timeoutMs: remainingTimeoutMs(),
      },
      supplementalInstructions: joinedInstructions(
        args.supplementalInstructions,
        turnBriefInstructions(brief, authorizedActionReferences),
      ),
      activeActionReferences,
      authorizedActionReferences,
      preparedCapabilityContext,
    };
    const execution = await this.#runExecutorStep(executorArgs, {
      step: "execution", label: "Execute request", stepIndex: 3,
      effort: args.effort || this.config.reasoningEffort,
    });
    const receiptFindings = completionReceiptFindings({
      brief,
      receipts: execution.receipts,
      authorizedActionReferences,
    });
    const terminalFindings = terminalToolFailureFindings(execution.receipts);
    const executionFindings = [...receiptFindings, ...terminalFindings];
    const auditEffects = auditEffectsForReceipts(execution.receipts, this.registry);
    if (!brief.audit.required && auditEffects.length === 0 && executionFindings.length === 0) {
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
      return joinedInstructions(execution.text, notice);
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
        "Perform only the remaining authorized work. Earlier successful receipts are completed actions and must not be repeated. Return the final user-facing response after repair.",
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
      authorizedActionReferences,
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
    if (
      this.config.turnWorkflowEnabled !== false
      && this.requestCompiler
      && !Array.isArray(args.capabilityOverride)
    ) {
      return this.#runWorkflow(args);
    }
    const execution = await this.#runExecutor(args);
    return execution.text;
  }

  async #runExecutor({
    requestId, requestEventId, text, channel = "web", attachment = null, runLimits = null,
    model = null, effort = null, supplementalInstructions = "",
    capabilityOverride = null, workflowStep = null, workflowStepLabel = null, stepIndex = null,
    toolOverride = null,
    isolatedConversation = false, conversationStartEventSeq = 0, initialReceipts = [],
    activeActionReferences = [], authorizedActionReferences = [],
    preparedCapabilityContext = null,
  }) {
    const availableTools = this.registry.toolDefinitions();
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
                authorizedActionReferences,
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
                  ? "Capability expansion is not authorized during structured execution; orientation already selected the accepted TurnBrief capabilities and their declared dependent tools"
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
                requestId, requestEventId, callId, channel, attachment,
              });
              const toolDefinition = this.registry.get(name);
              const providerResult = mcpResultDetails(toolResult);
              const deferredActionReference = providerResult?.isError ? null : extractDeferredActionReference({
                tool: name,
                toolDefinition,
                result: toolResult,
                requestId,
                resolveProviderTool: (upstreamName) => this.registry.resolveUpstreamTool(
                  toolDefinition?.source,
                  upstreamName,
                ),
              });
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
        this.ledger.append({
          type: "model.response", phase: "error", status: "error", actorType: "external",
          actorName: this.modelTransport.displayName, channel, turnId: requestId, operationId,
          name: "Model response failed", payload: error.data ?? {},
          error: error instanceof Error ? error.message : String(error),
        });
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
