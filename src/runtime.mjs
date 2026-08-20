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
          limit: 2,
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
          instructionCapabilities: [],
          deferredCapabilities: [],
          capabilityCatalog: [],
        };
    const initialToolFingerprint = callableToolsFingerprint(compilation.tools);
    const conversation = typeof this.ledger.activeModelConversation === "function"
      ? this.ledger.activeModelConversation(initialToolFingerprint)
      : { conversationId: null, markerEventSeq: 0, reason: "new" };
    const baseInstructions = await this.loadSystemPrompt();
    const maxToolCalls = runLimits === null ? this.config.maxToolCalls : runLimits.maxToolCalls;
    const runTimeoutMs = runLimits?.timeoutMs ?? null;
    const selectedModel = model || this.config.model;
    const selectedEffort = effort || this.config.reasoningEffort;
    let conversationId = conversation.conversationId;
    let totalToolCallCount = 0;
    let attempt = 0;
    let result;
    let finalAttemptStartedNewConversation = !conversationId;
    while (true) {
      attempt += 1;
      finalAttemptStartedNewConversation = !conversationId;
      const tools = compilation.tools;
      const callableToolNames = new Set(tools.map(({ name }) => name));
      const context = await this.contextBuilder.build(requestId, text, {
        attachment,
        nativeConversation: conversationId
          ? true
          : attempt === 1 && conversation.reason !== "tools_changed",
        continuingConversation: Boolean(conversationId),
        conversationStartEventSeq: conversation.markerEventSeq,
        capabilities: compilation.capabilities,
      });
      const continuingAfterExpansion = attempt > 1
        ? "Capability expansion is complete. Continue and finish the original user request using the newly callable tools. Do not ask the user to repeat it, and do not repeat actions already confirmed by earlier tool results."
        : "";
      const developerInstructions = joinedInstructions(
        compilation.instructions,
        context.developerInstructions ?? context.text,
        supplementalInstructions,
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
          history: context.history,
          contextBudget: context.contextBudget,
          attachment: context.attachment,
          nativeConversation: context.nativeConversation,
          runLimits: { maxToolCalls, timeoutMs: runTimeoutMs },
          remainingToolCalls,
          capabilitySelection: {
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
      const toolDelivery = conversationId ? "retained" : "sent";
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
          capabilities: compilation.capabilities,
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
      let domainToolHandled = false;
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
              if (domainToolHandled) {
                const message = "request_capabilities must be called before any domain tool in its model turn";
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
            domainToolHandled = true;
            try {
              const toolResult = await this.registry.execute(name, args, {
                requestId, requestEventId, callId, channel, attachment, videoSource,
              });
              this.ledger.append({
                type: "tool.result", phase: "end", status: "complete", actorType: "tool",
                actorName: name, channel, turnId: requestId, operationId: callId, name,
                payload: { callId, name, result: toolResult },
              });
              return { ok: true, result: toolResult };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
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
