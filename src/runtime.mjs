import { createHash } from "node:crypto";
import fs from "node:fs/promises";

function argumentsObject(value) {
  if (value == null) return {};
  if (typeof value === "string") return JSON.parse(value || "{}");
  if (typeof value === "object" && !Array.isArray(value)) return value;
  throw new Error("Tool arguments must be a JSON object");
}

function callableToolsFingerprint(tools) {
  return createHash("sha256").update(JSON.stringify(tools)).digest("hex");
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function joinedInstructions(...sections) {
  return sections.map((section) => String(section ?? "").trim()).filter(Boolean).join("\n\n");
}

function sameRequestReceiptInstructions(receipts, maximumCharacters = 24_000) {
  if (!receipts.length) return "";
  const header = [
    "# Earlier tool receipts from this same user request",
    "These calls already happened before capability expansion. Treat successful receipts as completed actions, continue from their exact results, and do not repeat them unless the user explicitly asked for repetition.",
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
      leading_result_json: serialized.slice(0, maximumCharacters),
      leading_result_characters: maximumCharacters,
      continuation: "Call tool_receipt_read with this receipt_event_seq starting at offset 0 to page the exact call arguments, result, and status. Do not repeat the original tool action.",
    },
    fullResultCharacters: serialized.length,
    paged: true,
  };
}

export class SlayerRuntime {
  constructor({ modelTransport, registry, contextBuilder, requestCompiler = null, ledger, config }) {
    this.modelTransport = modelTransport;
    this.registry = registry;
    this.contextBuilder = contextBuilder;
    this.requestCompiler = requestCompiler;
    this.ledger = ledger;
    this.config = config;
    this.systemPrompt = null;
  }

  async loadSystemPrompt() {
    if (this.systemPrompt == null) this.systemPrompt = await fs.readFile(this.config.systemPromptPath, "utf8");
    return this.systemPrompt;
  }

  async run({
    requestId, requestEventId, text, channel = "web", attachment = null, runLimits = null,
    model = null, effort = null, supplementalInstructions = "", videoSource = null,
    capabilityOverride = null,
  }) {
    const availableTools = this.registry.toolDefinitions();
    const priorConversation = typeof this.ledger.currentModelConversation === "function"
      ? this.ledger.currentModelConversation()
      : { markerEventSeq: 0, capabilities: [] };
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
    let conversation = typeof this.ledger.activeModelConversation === "function"
      ? this.ledger.activeModelConversation(initialToolFingerprint)
      : { conversationId: null, markerEventSeq: 0, reason: "new" };
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
    const runTimeoutMs = runLimits?.timeoutMs ?? null;
    const selectedModel = model || this.config.model;
    const selectedEffort = effort || this.config.reasoningEffort;
    let conversationId = conversation.conversationId;
    let totalToolCallCount = 0;
    let attempt = 0;
    let result;
    const sameRequestReceipts = [];
    let conversationCheckpoint = null;
    let finalAttemptStartedNewConversation = !conversationId;
    while (true) {
      attempt += 1;
      finalAttemptStartedNewConversation = !conversationId;
      const tools = compilation.tools;
      const callableToolNames = new Set(tools.map(({ name }) => name));
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
        conversationCheckpoint: conversationId ? null : conversationCheckpoint,
      });
      const continuingAfterExpansion = attempt > 1
        ? "Capability expansion is complete. Continue and finish the original user request using the newly callable tools. Do not ask the user to repeat it, and do not repeat actions already confirmed by earlier tool results."
        : "";
      const developerInstructions = joinedInstructions(
        compilation.instructions,
        context.developerInstructions ?? context.text,
        supplementalInstructions,
        attempt > 1 ? sameRequestReceiptInstructions(sameRequestReceipts) : "",
        continuingAfterExpansion,
      );
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
        developerInstructions,
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
        channel, turnId: requestId, name: "Compiled context sent", content: developerInstructions,
        payload: {
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
            totalDeveloperInstructionCharacters: developerInstructions.length,
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
          attempt,
          count: tools.length,
          availableCount: availableTools.length,
          schemaBytes: serializedBytes(providerCallableTools),
          delivery: toolDelivery,
          protocolDelivery: providerRequest.toolDelivery ?? null,
          capabilities: compilation.capabilities,
          explicitHats: compilation.explicitHats ?? [],
          deferredCapabilities: compilation.deferredCapabilities ?? [],
          capabilityCatalog: compilation.capabilityCatalog ?? [],
          dependentTools: compilation.dependentTools ?? [],
          selectionReasons: compilation.reasons,
          tools,
        },
      });
      const operationId = `${this.modelTransport.id}:${requestId}:${attempt}`;
      this.ledger.append({
        type: "model.request", phase: "start", status: "processing", actorType: "service",
        actorName: `${this.modelTransport.displayName} transport`, channel, turnId: requestId, operationId,
        name: attempt === 1 ? "Model request" : "Model request after tool expansion", payload: providerRequest,
      });

      const requestedCapabilities = new Set();
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
            if (expansionRequested && name !== "request_capabilities") {
              const message = "Capability expansion is pending; no other tool is callable in this model turn";
              this.ledger.append({
                type: "tool.result", phase: "error", status: "error", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name }, error: message,
              });
              return { ok: false, error: message };
            }
            if (name === "request_capabilities") {
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
            try {
              const toolResult = await this.registry.execute(name, args, {
                requestId, requestEventId, callId, channel, attachment, videoSource,
              });
              const resultEventId = this.ledger.append({
                type: "tool.result", phase: "end", status: "complete", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name, result: toolResult },
              });
              const receiptEventSeq = typeof this.ledger.eventSequence === "function"
                ? this.ledger.eventSequence(resultEventId)
                : null;
              const inline = inlineToolResult(toolResult, {
                tool: name,
                receiptEventSeq,
                maximumCharacters: name === "tool_receipt_read"
                  ? Number.MAX_SAFE_INTEGER
                  : this.config.maxInlineToolResultCharacters ?? 32 * 1024,
              });
              sameRequestReceipts.push({
                tool: name,
                arguments: args,
                ok: true,
                result: inline.deliveredResult,
                receiptEventSeq,
              });
              if (inline.paged) {
                this.ledger.append({
                  type: "tool.result.paged", status: "complete", actorType: "service",
                  actorName: "Tool result pager", channel, turnId: requestId,
                  operationId: callId, name,
                  payload: {
                    receiptEventSeq,
                    fullResultCharacters: inline.fullResultCharacters,
                    inlineCharacters: this.config.maxInlineToolResultCharacters ?? 32 * 1024,
                  },
                });
              }
              return { ok: true, result: inline.deliveredResult };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              sameRequestReceipts.push({ tool: name, arguments: args, ok: false, error: message });
              this.ledger.append({
                type: "tool.result", phase: "error", status: "error", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name }, error: message,
              });
              return { ok: false, error: message };
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
        name: requestedCapabilities.size > 0 ? "Model requested additional tools" : "Model response",
        payload: {
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
        operationId, name: "Model usage after request", payload: result.usage,
      });

      if (requestedCapabilities.size === 0) break;
      if (!this.requestCompiler) throw new Error("Capability expansion requires the request compiler");
      conversationId = null;
      compilation = await this.requestCompiler.compile({
        tools: availableTools,
        text,
        attachment,
        recentConversation,
        previousCapabilities: priorConversation.capabilities,
        capabilityOverride: [...new Set([...compilation.capabilities, ...requestedCapabilities])],
      });
    }

    const finalConversationId = result.conversationId ?? result.threadId;
    const finalToolFingerprint = callableToolsFingerprint(compilation.tools);
    if (finalAttemptStartedNewConversation && typeof this.ledger.markConversationStarted === "function") {
      this.ledger.markConversationStarted({
        conversationId: finalConversationId,
        toolFingerprint: finalToolFingerprint,
        capabilities: compilation.capabilities,
        requestId,
        channel,
      });
    }
    return result.text;
  }
}
