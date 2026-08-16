import fs from "node:fs/promises";

function argumentsObject(value) {
  if (value == null) return {};
  if (typeof value === "string") return JSON.parse(value || "{}");
  if (typeof value === "object" && !Array.isArray(value)) return value;
  throw new Error("Tool arguments must be a JSON object");
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

  async run({ requestId, requestEventId, text, channel = "web", attachment = null }) {
    const context = await this.contextBuilder.build(requestId, text, { attachment });
    const tools = this.registry.toolDefinitions();
    const baseInstructions = await this.loadSystemPrompt();
    const turnRequest = {
      model: this.config.model,
      effort: this.config.reasoningEffort,
      baseInstructions,
      developerInstructions: context.text,
      input: text,
      tools,
      maxToolCalls: this.config.maxToolCalls,
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
          if (toolCallCount > this.config.maxToolCalls) {
            const message = `Tool-call budget exhausted after ${this.config.maxToolCalls} calls. Return a final answer now without calling another tool; state clearly which requested actions remain incomplete.`;
            this.ledger.append({
              type: "tool.result", phase: "error", status: "error", actorType: "tool",
              actorName: name, channel, turnId: requestId, operationId: callId, name,
              payload: { callId, name }, error: message,
            });
            return { ok: false, error: message };
          }
          try {
            const toolResult = await this.registry.execute(name, args, {
              requestId, requestEventId, callId, channel,
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
