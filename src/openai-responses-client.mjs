import { redactText, redactValue } from "./redaction.mjs";

function combinedInstructions(baseInstructions, developerInstructions) {
  return [
    "# Base instructions",
    String(baseInstructions ?? "").trim(),
    "# Request-specific developer context",
    String(developerInstructions ?? "").trim(),
  ].filter(Boolean).join("\n\n");
}

function openAITools(tools) {
  return tools.map(({ name, description, inputSchema }) => ({
    type: "function",
    name,
    description,
    parameters: inputSchema,
  }));
}

function attachmentDescription(attachment, imageDetail) {
  if (!attachment) return null;
  if (attachment.mediaKind === "image") {
    return {
      type: "image",
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      byteSize: attachment.byteSize,
      sha256: attachment.sha256,
      detail: imageDetail,
    };
  }
  return {
    type: "text",
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
    sha256: attachment.sha256,
    encoding: attachment.encoding,
  };
}

function userContent(input, requestAttachmentInput, imageDetail) {
  const content = [{ type: "input_text", text: input }];
  if (!requestAttachmentInput) return content;
  if (typeof requestAttachmentInput === "string") {
    content.push({ type: "input_text", text: requestAttachmentInput });
    return content;
  }
  if (requestAttachmentInput.text) {
    content.push({ type: "input_text", text: requestAttachmentInput.text });
  }
  if (requestAttachmentInput.mediaKind === "image") {
    content.push({
      type: "input_image",
      detail: imageDetail,
      image_url: `data:${requestAttachmentInput.mimeType};base64,${requestAttachmentInput.dataBase64}`,
    });
  }
  return content;
}

function responseText(response) {
  return (response.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function functionCalls(response) {
  return (response.output ?? []).filter((item) => item.type === "function_call");
}

function normalizedMessages(response) {
  return (response.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => (item.content ?? [])
      .filter((content) => content.type === "output_text" && content.text?.trim())
      .map((content) => ({
        id: item.id ?? null,
        role: item.role ?? "assistant",
        phase: "final_answer",
        text: content.text.trim(),
      })));
}

function usageFor(response) {
  const usage = response.usage ?? {};
  const inputTokens = Number(usage.input_tokens ?? 0);
  const cachedInputTokens = Number(usage.input_tokens_details?.cached_tokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? 0);
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteTokens: Number(usage.input_tokens_details?.cache_write_tokens ?? 0),
    outputTokens,
    reasoningOutputTokens: Number(usage.output_tokens_details?.reasoning_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? inputTokens + outputTokens),
  };
}

function addUsage(total, current) {
  for (const key of Object.keys(total)) total[key] += Number(current[key] ?? 0);
}

function estimatedCost(tokenUsage, pricing) {
  const uncachedInput = Math.max(
    0,
    tokenUsage.inputTokens - tokenUsage.cachedInputTokens - tokenUsage.cacheWriteTokens,
  );
  return (
    uncachedInput * pricing.inputPerMillion
    + tokenUsage.cachedInputTokens * pricing.cachedInputPerMillion
    + tokenUsage.cacheWriteTokens * pricing.cacheWritePerMillion
    + tokenUsage.outputTokens * pricing.outputPerMillion
  ) / 1_000_000;
}

function safeErrorMessage(error, apiKey) {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(apiKey ? message.replaceAll(apiKey, "[REDACTED]") : message);
}

export class OpenAIResponsesClient {
  constructor({
    apiKey,
    baseUrl = "https://api.openai.com/v1",
    requestTimeoutMs = 10 * 60 * 1000,
    modelContextWindowTokens = 1_050_000,
    imageDetail = "original",
    pricing = {
      inputPerMillion: 2,
      cachedInputPerMillion: 0.2,
      cacheWritePerMillion: 2.5,
      outputPerMillion: 12,
    },
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.id = "openai-responses";
    this.displayName = "OpenAI Responses";
    this.apiKey = String(apiKey ?? "").trim();
    this.baseUrl = String(baseUrl).replace(/\/$/u, "");
    this.requestTimeoutMs = requestTimeoutMs;
    this.modelContextWindowTokens = modelContextWindowTokens;
    this.imageDetail = imageDetail;
    this.pricing = pricing;
    this.fetchImpl = fetchImpl;
    this.started = false;
  }

  async start() {
    this.started = true;
  }

  async close() {
    this.started = false;
  }

  health() {
    const ready = Boolean(this.apiKey && this.fetchImpl);
    return {
      ready,
      reason: ready ? null : "OPENAI_API_KEY is required for the OpenAI Responses transport",
      endpoint: this.baseUrl,
      imageDetail: this.imageDetail,
      usageMode: "metered",
      pricing: this.pricing,
    };
  }

  describeRequest({
    model,
    effort,
    conversationId,
    baseInstructions,
    developerInstructions,
    input,
    requestAttachmentInput,
    tools,
    outputSchema = null,
    maxToolCalls,
    runTimeoutMs,
  }) {
    const attachment = requestAttachmentInput && typeof requestAttachmentInput === "object"
      ? attachmentDescription(requestAttachmentInput, this.imageDetail)
      : requestAttachmentInput
        ? { type: "text", included: true }
        : null;
    return {
      transport: this.id,
      endpoint: `${this.baseUrl}/responses`,
      model,
      reasoningEffort: effort,
      conversation: {
        mode: conversationId ? "continue with previous_response_id" : "start",
        conversationId: conversationId ?? null,
      },
      baseInstructions,
      developerInstructions,
      input: [{ type: "text", text: input }, ...(attachment ? [attachment] : [])],
      callableTools: openAITools(tools),
      outputSchema,
      toolDelivery: "sent in every Responses API call",
      executionBoundary: {
        persistentResponseChain: true,
        builtInTools: "none",
        maxToolCalls,
        runTimeoutMs,
      },
    };
  }

  async request(body, timeoutMs) {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is required for the OpenAI Responses transport");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.requestTimeoutMs);
    timer.unref?.();
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error("OpenAI Responses request timed out");
      throw new Error(`OpenAI Responses request failed: ${safeErrorMessage(error, this.apiKey)}`);
    } finally {
      clearTimeout(timer);
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`OpenAI Responses returned non-JSON HTTP ${response.status}`);
    }
    if (!response.ok) {
      const detail = safeErrorMessage(data?.error?.message || `HTTP ${response.status}`, this.apiKey);
      const error = new Error(`OpenAI Responses rejected the request: ${detail}`);
      error.statusCode = response.status;
      error.data = redactValue({
        type: data?.error?.type ?? null,
        code: data?.error?.code ?? null,
        param: data?.error?.param ?? null,
      });
      throw error;
    }
    return data;
  }

  async runTurn({
    model,
    effort,
    conversationId = null,
    baseInstructions,
    developerInstructions,
    input,
    requestAttachmentInput = null,
    tools,
    outputSchema = null,
    maxToolCalls = 128,
    runTimeoutMs = null,
    onToolCall,
    onEvent,
  }) {
    await this.start();
    if (!this.health().ready) throw new Error(this.health().reason);
    const instructions = combinedInstructions(baseInstructions, developerInstructions);
    const callableTools = openAITools(tools);
    const totalUsage = {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    };
    const messages = [];
    const events = [];
    let response;
    let previousResponseId = conversationId;
    let nextInput = [{
      role: "user",
      content: userContent(input, requestAttachmentInput, this.imageDetail),
    }];
    let toolCallCount = 0;
    let latestInputTokens = 0;
    const deadlineAt = runTimeoutMs === null ? null : Date.now() + runTimeoutMs;
    while (true) {
      const requestBody = {
        model,
        instructions,
        input: nextInput,
        tools: callableTools,
        ...(callableTools.length ? { tool_choice: "auto", parallel_tool_calls: true } : {}),
        store: true,
        ...(outputSchema ? {
          text: {
            format: {
              type: "json_schema",
              name: "agent_slayer_structured_output",
              strict: true,
              schema: outputSchema,
            },
          },
        } : {}),
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
        ...(effort ? { reasoning: { effort: effort === "off" ? "none" : effort } } : {}),
      };
      const remainingMs = deadlineAt === null ? null : deadlineAt - Date.now();
      if (remainingMs !== null && remainingMs <= 0) {
        const error = new Error(`OpenAI model turn exceeded its ${runTimeoutMs}ms run deadline`);
        error.code = "RUN_DEADLINE_EXCEEDED";
        throw error;
      }
      response = await this.request(requestBody, remainingMs);
      const currentUsage = usageFor(response);
      latestInputTokens = currentUsage.inputTokens;
      addUsage(totalUsage, currentUsage);
      const responseEvent = {
        type: "response.completed",
        responseId: response.id ?? null,
        status: response.status ?? null,
        usage: currentUsage,
        outputTypes: (response.output ?? []).map((item) => item.type),
      };
      events.push(responseEvent);
      await onEvent?.(responseEvent);
      messages.push(...normalizedMessages(response));
      if (response.status !== "completed") {
        throw new Error(response.error?.message || `OpenAI response ended with status ${response.status}`);
      }
      const calls = functionCalls(response);
      if (calls.length === 0) break;
      previousResponseId = response.id;
      nextInput = [];
      for (const call of calls) {
        toolCallCount += 1;
        if (maxToolCalls !== null && toolCallCount > maxToolCalls + 8) {
          throw new Error(`OpenAI continued requesting tools after the ${maxToolCalls}-call budget was exhausted`);
        }
        let result;
        if (maxToolCalls !== null && toolCallCount > maxToolCalls) {
          result = {
            ok: false,
            error: `Tool-call budget exhausted after ${maxToolCalls} calls. Return a final answer without another tool call.`,
          };
        } else {
          result = await onToolCall({
            callId: call.call_id,
            tool: call.name,
            arguments: call.arguments,
          });
        }
        nextInput.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result ?? null),
        });
      }
    }
    const text = responseText(response);
    if (!text) throw new Error("OpenAI completed without a final response");
    return {
      text,
      conversationId: response.id,
      providerTurnId: response.id,
      status: response.status,
      messages,
      tokenUsage: totalUsage,
      usage: {
        provider: "openai",
        tokenUsage: totalUsage,
        contextInputTokens: latestInputTokens,
        contextWindowTokens: this.modelContextWindowTokens,
        estimatedCostUsd: estimatedCost(totalUsage, this.pricing),
        pricing: this.pricing,
      },
      events,
      protocol: {
        endpoint: `${this.baseUrl}/responses`,
        responseId: response.id,
        toolSchemaCount: callableTools.length,
        structuredOutput: Boolean(outputSchema),
        imageDetail: requestAttachmentInput?.mediaKind === "image" ? this.imageDetail : null,
      },
    };
  }
}

export { estimatedCost, openAITools };
