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

  async run({ requestId, requestEventId, text, channel = "web", attachment = null, runLimits = null }) {
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
    const compilation = this.requestCompiler
      ? await this.requestCompiler.compile({
          tools: availableTools,
          text,
          attachment,
          recentConversation,
          previousCapabilities: priorConversation.capabilities,
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
        };
    const tools = compilation.tools;
    const callableToolNames = new Set(tools.map(({ name }) => name));
    const toolFingerprint = callableToolsFingerprint(tools);
    const conversation = typeof this.ledger.activeModelConversation === "function"
      ? this.ledger.activeModelConversation(toolFingerprint)
      : { conversationId: null, markerEventSeq: 0, reason: "new" };
    const context = await this.contextBuilder.build(requestId, text, {
      attachment,
      nativeConversation: conversation.reason !== "tools_changed",
      continuingConversation: Boolean(conversation.conversationId),
      conversationStartEventSeq: conversation.markerEventSeq,
    });
    const baseInstructions = await this.loadSystemPrompt();
    const developerInstructions = joinedInstructions(
      compilation.instructions,
      context.developerInstructions ?? context.text,
    );
    const maxToolCalls = runLimits === null ? this.config.maxToolCalls : runLimits.maxToolCalls;
    const runTimeoutMs = runLimits?.timeoutMs ?? null;
    const turnRequest = {
      model: this.config.model,
      effort: this.config.reasoningEffort,
      conversationId: conversation.conversationId,
      baseInstructions,
      developerInstructions,
      input: text,
      requestAttachmentInput: context.requestAttachmentInput ?? null,
      tools,
      maxToolCalls,
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
        profileFacts: context.profileFacts,
        activeProfileFactCount: context.activeProfileFactCount,
        relevantProfileTypes: context.relevantProfileTypes,
        relevantProfileQuestions: context.relevantProfileQuestions,
        history: context.history,
        contextBudget: context.contextBudget,
        attachment: context.attachment,
        nativeConversation: context.nativeConversation,
        runLimits: { maxToolCalls, timeoutMs: runTimeoutMs },
        capabilitySelection: {
          capabilities: compilation.capabilities,
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
    const toolDelivery = conversation.conversationId ? "retained" : "sent";
    this.ledger.append({
      type: "tools.sent", status: "complete", actorType: "system", actorName: "Tool registry",
      channel, turnId: requestId,
      name: toolDelivery === "retained"
        ? `${tools.length} callable tools available on resumed conversation`
        : `${tools.length} callable tools sent with new conversation`,
      payload: {
        count: tools.length,
        availableCount: availableTools.length,
        schemaBytes: serializedBytes(providerCallableTools),
        delivery: toolDelivery,
        capabilities: compilation.capabilities,
        dependentTools: compilation.dependentTools ?? [],
        selectionReasons: compilation.reasons,
        tools,
      },
    });
    const operationId = `${this.modelTransport.id}:${requestId}`;
    this.ledger.append({
      type: "model.request", phase: "start", status: "processing", actorType: "service",
      actorName: `${this.modelTransport.displayName} transport`, channel, turnId: requestId, operationId,
      name: "Model request", payload: providerRequest,
    });

    let toolCallCount = 0;
    let result;
    try {
      result = await this.modelTransport.runTurn({
        ...turnRequest,
        onToolCall: async (call) => {
          toolCallCount += 1;
          const callId = call.callId;
          const name = call.tool;
          let args;
          try {
            args = argumentsObject(call.arguments);
          } catch (error) {
            const message = `Invalid JSON tool arguments: ${error.message}`;
            this.ledger.append({
              type: "tool.call", phase: "error", status: "error", actorType: "model",
              actorName: this.config.model, channel, turnId: requestId, operationId: callId,
              name, payload: { callId, name, rawArguments: call.arguments }, error: message,
            });
            return { ok: false, error: message };
          }
          this.ledger.append({
            type: "tool.call", phase: "start", status: "processing", actorType: "model",
            actorName: this.config.model, channel, turnId: requestId, operationId: callId,
            name, payload: { callId, name, arguments: args },
          });
          if (maxToolCalls !== null && toolCallCount > maxToolCalls) {
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
          try {
            const toolResult = await this.registry.execute(name, args, {
              requestId, requestEventId, callId, channel, attachment,
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

    if (!conversation.conversationId && typeof this.ledger.markConversationStarted === "function") {
      this.ledger.markConversationStarted({
        conversationId: result.conversationId ?? result.threadId,
        toolFingerprint,
        capabilities: compilation.capabilities,
        requestId,
        channel,
      });
    }

    this.ledger.append({
      type: "model.response", phase: "end", status: "complete", actorType: "model",
      actorName: this.config.model, channel, turnId: requestId, operationId,
      name: "Model response",
      payload: {
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
      payload: result.usage,
    });
    return result.text;
  }
}
