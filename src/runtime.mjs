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

export class SlayerRuntime {
  constructor({ modelTransport, registry, contextBuilder, ledger, config }) {
    this.modelTransport = modelTransport;
    this.registry = registry;
    this.contextBuilder = contextBuilder;
    this.ledger = ledger;
    this.config = config;
    this.systemPrompt = null;
  }

  async loadSystemPrompt() {
    if (this.systemPrompt == null) this.systemPrompt = await fs.readFile(this.config.systemPromptPath, "utf8");
    return this.systemPrompt;
  }

  async run({ requestId, requestEventId, text, channel = "web", attachment = null, runLimits = null }) {
    const tools = this.registry.toolDefinitions();
    const toolFingerprint = callableToolsFingerprint(tools);
    const conversation = typeof this.ledger.activeModelConversation === "function"
      ? this.ledger.activeModelConversation(toolFingerprint)
      : { conversationId: null, markerEventSeq: 0, reason: "new" };
    const context = await this.contextBuilder.build(requestId, text, {
      attachment,
      nativeConversation: true,
      continuingConversation: Boolean(conversation.conversationId),
      conversationStartEventSeq: conversation.markerEventSeq,
    });
    const baseInstructions = await this.loadSystemPrompt();
    const maxToolCalls = runLimits === null ? this.config.maxToolCalls : runLimits.maxToolCalls;
    const runTimeoutMs = runLimits?.timeoutMs ?? null;
    const turnRequest = {
      model: this.config.model,
      effort: this.config.reasoningEffort,
      conversationId: conversation.conversationId,
      baseInstructions,
      developerInstructions: context.text,
      input: text,
      tools,
      maxToolCalls,
      runTimeoutMs,
    };
    const providerRequest = this.modelTransport.describeRequest(turnRequest);

    this.ledger.append({
      type: "context.sent", status: "complete", actorType: "system", actorName: "Context builder",
      channel, turnId: requestId, name: "Context sent", content: context.text,
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
      },
    });
    this.ledger.append({
      type: "tools.sent", status: "complete", actorType: "system", actorName: "Tool registry",
      channel, turnId: requestId, name: `${tools.length} callable tools sent`,
      payload: { count: tools.length, tools },
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
