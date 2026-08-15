import fs from "node:fs/promises";

function stringify(value) {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
}

function responseText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const pieces = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) pieces.push(content.text);
      if (content.type === "refusal" && content.refusal) pieces.push(content.refusal);
    }
  }
  return pieces.join("\n").trim();
}

export class SlayerRuntime {
  constructor({ modelClient, registry, contextBuilder, ledger, config }) {
    this.modelClient = modelClient;
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

  async run({ requestId, requestEventId, text, channel = "web" }) {
    const context = await this.contextBuilder.build(requestId);
    const tools = this.registry.modelTools();
    this.ledger.append({
      type: "context.sent", status: "complete", actorType: "system", actorName: "Context builder",
      channel, turnId: requestId, name: "Context sent", content: context.text,
      payload: { profile: context.profile, history: context.history },
    });
    this.ledger.append({
      type: "tools.sent", status: "complete", actorType: "system", actorName: "Tool registry",
      channel, turnId: requestId, name: `${tools.length} callable tools sent`,
      payload: { count: tools.length, tools },
    });

    const input = [
      { role: "developer", content: [{ type: "input_text", text: context.text }] },
      { role: "user", content: [{ type: "input_text", text }] },
    ];
    const basePayload = {
      model: this.config.model,
      instructions: await this.loadSystemPrompt(),
      tools,
      parallel_tool_calls: false,
      store: false,
    };
    if (this.config.reasoningEffort && !["none", "off"].includes(this.config.reasoningEffort)) {
      basePayload.reasoning = { effort: this.config.reasoningEffort };
    }

    for (let round = 1; round <= this.config.maxToolRounds; round += 1) {
      const operationId = `model:${requestId}:${round}`;
      const payload = { ...basePayload, input };
      this.ledger.append({
        type: "model.request", phase: "start", status: "processing", actorType: "service", actorName: "Responses API client",
        channel, turnId: requestId, operationId, name: `Model request ${round}`, payload,
      });
      let response;
      try {
        response = await this.modelClient.create(payload);
      } catch (error) {
        this.ledger.append({
          type: "model.response", phase: "error", status: "error", actorType: "external", actorName: "Responses API",
          channel, turnId: requestId, operationId, name: `Model response ${round} failed`,
          payload: error.responseBody ?? {}, error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      this.ledger.append({
        type: "model.response", phase: "end", status: "complete", actorType: "model", actorName: this.config.model,
        channel, turnId: requestId, operationId, name: `Model response ${round}`, payload: response,
      });

      input.push(...(response.output ?? []));
      const calls = (response.output ?? []).filter((item) => item.type === "function_call");
      if (calls.length === 0) {
        const finalText = responseText(response);
        if (!finalText) throw new Error("The model returned neither a tool call nor response text");
        return finalText;
      }

      for (const call of calls) {
        let argumentsObject;
        try { argumentsObject = JSON.parse(call.arguments || "{}"); }
        catch (error) {
          argumentsObject = {};
          this.ledger.append({
            type: "tool.call", phase: "error", status: "error", actorType: "model", actorName: this.config.model,
            channel, turnId: requestId, operationId: call.call_id, name: call.name,
            payload: { callId: call.call_id, name: call.name, rawArguments: call.arguments },
            error: `Invalid JSON tool arguments: ${error.message}`,
          });
        }
        this.ledger.append({
          type: "tool.call", phase: "start", status: "processing", actorType: "model", actorName: this.config.model,
          channel, turnId: requestId, operationId: call.call_id, name: call.name,
          payload: { callId: call.call_id, name: call.name, arguments: argumentsObject },
        });
        let output;
        try {
          const result = await this.registry.execute(call.name, argumentsObject, {
            requestId, requestEventId, callId: call.call_id, channel,
          });
          output = stringify({ ok: true, result });
          this.ledger.append({
            type: "tool.result", phase: "end", status: "complete", actorType: "tool", actorName: call.name,
            channel, turnId: requestId, operationId: call.call_id, name: call.name,
            payload: { callId: call.call_id, name: call.name, result },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          output = stringify({ ok: false, error: message });
          this.ledger.append({
            type: "tool.result", phase: "error", status: "error", actorType: "tool", actorName: call.name,
            channel, turnId: requestId, operationId: call.call_id, name: call.name,
            payload: { callId: call.call_id, name: call.name }, error: message,
          });
        }
        input.push({ type: "function_call_output", call_id: call.call_id, output });
      }
    }
    throw new Error(`Model exceeded the ${this.config.maxToolRounds}-round tool limit`);
  }
}
