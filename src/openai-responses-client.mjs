import { createHash, randomUUID } from "node:crypto";
import { redactText, redactValue } from "./redaction.mjs";

function combinedInstructions(baseInstructions, developerInstructions) {
  return [
    "# Base instructions",
    String(baseInstructions ?? "").trim(),
    "# Request-specific developer context",
    String(developerInstructions ?? "").trim(),
  ].filter(Boolean).join("\n\n");
}

function openAICompatibleSchema(schema) {
  if (schema == null) return schema;
  // Retain application-only validation keywords in local schemas, but omit
  // constraints the Responses API Structured Outputs subset rejects.
  return JSON.parse(JSON.stringify(schema, (key, value) => (
    key === "uniqueItems" ? undefined : value
  )));
}

function openAITools(tools) {
  return tools.map(({ name, description, inputSchema, metadata }) => {
    const hosted = metadata?.openaiHostedTool;
    if (hosted?.type === "web_search") {
      return {
        type: "web_search",
        search_context_size: hosted.search_context_size ?? "medium",
        external_web_access: hosted.external_web_access !== false,
      };
    }
    return {
      type: "function",
      name,
      description,
      parameters: openAICompatibleSchema(inputSchema),
    };
  });
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

function publicCitationUrl(value) {
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function outputCitations(content) {
  return (content.annotations ?? []).flatMap((annotation) => {
    if (annotation?.type !== "url_citation") return [];
    const url = publicCitationUrl(annotation.url);
    if (!url) return [];
    return [{
      title: String(annotation.title ?? "").trim() || url,
      url,
      startIndex: Number.isSafeInteger(annotation.start_index) ? annotation.start_index : null,
      endIndex: Number.isSafeInteger(annotation.end_index) ? annotation.end_index : null,
    }];
  });
}

function renderedOutputText(content) {
  const original = String(content?.text ?? "");
  const citations = outputCitations(content)
    .filter(({ startIndex, endIndex }) => (
      startIndex !== null && endIndex !== null
      && startIndex >= 0 && endIndex > startIndex && endIndex <= original.length
    ))
    .sort((left, right) => right.startIndex - left.startIndex);
  let rendered = original;
  let boundary = original.length;
  for (const citation of citations) {
    if (citation.endIndex > boundary) continue;
    const label = original.slice(citation.startIndex, citation.endIndex)
      .replaceAll("[", "\\[").replaceAll("]", "\\]");
    rendered = `${rendered.slice(0, citation.startIndex)}[${label}](<${citation.url}>)${rendered.slice(citation.endIndex)}`;
    boundary = citation.startIndex;
  }
  return rendered;
}

function responseText(response) {
  return (response.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map(renderedOutputText)
    .join("\n")
    .trim();
}

function functionCalls(response) {
  return (response.output ?? []).filter((item) => item.type === "function_call");
}

function hostedWebSearchCalls(response) {
  return (response.output ?? []).filter((item) => item.type === "web_search_call");
}

function hostedWebSearchEventPair(call) {
  const action = call?.action && typeof call.action === "object" ? call.action : null;
  const callId = call?.id ?? `web-search-${randomUUID()}`;
  return [{
    type: "hosted_tool.call",
    callId,
    name: "web_search",
    arguments: action ? { action } : {},
  }, {
    type: "hosted_tool.result",
    callId,
    name: "web_search",
    status: call?.status ?? null,
    result: action ? { action } : {},
  }];
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
        text: renderedOutputText(content).trim(),
        citations: outputCitations(content),
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

function addTierUsage(totals, serviceTier, current) {
  if (!serviceTier) return;
  if (!totals.has(serviceTier)) {
    totals.set(serviceTier, {
      modelCallCount: 0,
      tokenUsage: Object.fromEntries(Object.keys(current).map((key) => [key, 0])),
    });
  }
  const total = totals.get(serviceTier);
  total.modelCallCount += 1;
  addUsage(total.tokenUsage, current);
}

function safeErrorMessage(error, apiKey) {
  const message = error instanceof Error ? error.message : String(error);
  return redactText(apiKey ? message.replaceAll(apiKey, "[REDACTED]") : message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function traceableProviderValue(value, key = "") {
  if (
    key === "image_url"
    && typeof value === "string"
    && /^data:[^;,]+;base64,/u.test(value)
  ) {
    const separator = value.indexOf(",");
    const prefix = value.slice(0, separator + 1);
    const encoded = value.slice(separator + 1);
    return `${prefix}[REDACTED base64Characters=${encoded.length} sha256=${sha256(encoded)}]`;
  }
  if (Array.isArray(value)) return value.map((item) => traceableProviderValue(item));
  if (value == null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => (
    [childKey, traceableProviderValue(child, childKey)]
  )));
}

export class OpenAIResponsesClient {
  constructor({
    apiKey,
    baseUrl = "https://api.openai.com/v1",
    requestTimeoutMs = 10 * 60 * 1000,
    modelContextWindowTokens = 1_050_000,
    imageDetail = "original",
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.id = "openai-responses";
    this.displayName = "OpenAI Responses";
    this.apiKey = String(apiKey ?? "").trim();
    this.baseUrl = String(baseUrl).replace(/\/$/u, "");
    this.requestTimeoutMs = requestTimeoutMs;
    this.modelContextWindowTokens = modelContextWindowTokens;
    this.imageDetail = imageDetail;
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
    const providerOutputSchema = openAICompatibleSchema(outputSchema);
    const callableTools = openAITools(tools);
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
      callableTools,
      outputSchema: providerOutputSchema,
      toolDelivery: "sent in every Responses API call",
      executionBoundary: {
        persistentResponseChain: true,
        builtInTools: callableTools.filter(({ type }) => type !== "function").map(({ type }) => type),
        maxToolCalls,
        runTimeoutMs,
      },
    };
  }

  async request(body, timeoutMs, serializedBody = JSON.stringify(body)) {
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
        body: serializedBody,
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
    terminalFailureObserved = false,
    runTimeoutMs = null,
    onToolCall,
    onEvent,
  }) {
    await this.start();
    if (!this.health().ready) throw new Error(this.health().reason);
    const instructions = combinedInstructions(baseInstructions, developerInstructions);
    let callableTools = openAITools(tools);
    const providerOutputSchema = openAICompatibleSchema(outputSchema);
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
    const usageByServiceTier = new Map();
    const controlTransfers = [];
    let objectBindingRefreshCount = 0;
    let terminalVerificationRounds = terminalFailureObserved ? 1 : null;
    let response;
    let previousResponseId = conversationId;
    let nextInput = [{
      role: "user",
      content: userContent(input, requestAttachmentInput, this.imageDetail),
    }];
    let toolCallCount = 0;
    let modelCallCount = 0;
    let latestInputTokens = 0;
    const deadlineAt = runTimeoutMs === null ? null : Date.now() + runTimeoutMs;
    const observedUsage = () => ({
      provider: "openai",
      modelCallCount,
      tokenUsage: { ...totalUsage },
      ...(usageByServiceTier.size ? {
        usageByServiceTier: [...usageByServiceTier].map(([serviceTier, usage]) => ({
          serviceTier,
          modelCallCount: usage.modelCallCount,
          tokenUsage: { ...usage.tokenUsage },
        })),
      } : {}),
      contextInputTokens: latestInputTokens,
      contextWindowTokens: this.modelContextWindowTokens,
    });
    try {
      while (true) {
        const hasHostedTools = callableTools.some(({ type }) => type !== "function");
        const requestBody = {
          model,
          instructions,
          input: nextInput,
          tools: callableTools,
          ...(callableTools.length ? {
            // Deliver the expansion receipt in this exchange, then hand control
            // back to the runtime to send the additional exact tool schemas.
            tool_choice: controlTransfers.length || terminalVerificationRounds === 0 ? "none" : "auto",
            parallel_tool_calls: true,
          } : {}),
          ...(hasHostedTools ? {
            include: ["web_search_call.action.sources"],
            ...(maxToolCalls === null ? {} : { max_tool_calls: maxToolCalls }),
          } : {}),
          store: true,
          ...(providerOutputSchema ? {
            text: {
              format: {
                type: "json_schema",
                name: "agent_slayer_structured_output",
                strict: true,
                schema: providerOutputSchema,
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
        response = null;
        modelCallCount += 1;
        const serializedRequestBody = JSON.stringify(requestBody);
        const exactProviderBody = JSON.parse(serializedRequestBody);
        await onEvent?.({
          type: "request.started",
          modelCallIndex: modelCallCount,
          providerRequest: {
            method: "POST",
            endpoint: `${this.baseUrl}/responses`,
            headers: {
              Authorization: "[REDACTED]",
              "Content-Type": "application/json",
            },
            body: redactValue(traceableProviderValue(exactProviderBody)),
            bodyBytes: Buffer.byteLength(serializedRequestBody),
            bodySha256: sha256(serializedRequestBody),
            redactions: requestAttachmentInput?.mediaKind === "image"
              ? ["Authorization header value redacted", "Input image data URL bytes replaced by length and SHA-256"]
              : ["Authorization header value redacted"],
          },
        });
        response = await this.request(requestBody, remainingMs, serializedRequestBody);
        const currentUsage = usageFor(response);
        const serviceTier = typeof response.service_tier === "string" && response.service_tier.trim()
          ? response.service_tier.trim()
          : null;
        latestInputTokens = currentUsage.inputTokens;
        addUsage(totalUsage, currentUsage);
        addTierUsage(usageByServiceTier, serviceTier, currentUsage);
        const hostedCalls = hostedWebSearchCalls(response);
        for (const call of hostedCalls) {
          toolCallCount += 1;
          if (maxToolCalls !== null && toolCallCount > maxToolCalls) {
            throw new Error(`OpenAI exceeded the ${maxToolCalls}-call tool budget with hosted web search`);
          }
          const pair = hostedWebSearchEventPair(call);
          events.push(...pair);
          for (const event of pair) await onEvent?.(event);
        }
        const responseEvent = {
          type: "response.completed",
          responseId: response.id ?? null,
          model: response.model ?? model,
          serviceTier,
          status: response.status ?? null,
          incompleteDetails: response.incomplete_details ?? null,
          providerError: response.error ?? null,
          usage: currentUsage,
          outputTypes: (response.output ?? []).map((item) => item.type),
        };
        events.push(responseEvent);
        await onEvent?.(responseEvent);
        messages.push(...normalizedMessages(response));
        if (response.status !== "completed") {
          const incompleteReason = response.incomplete_details?.reason;
          throw new Error(response.error?.message || (
            `OpenAI response ended with status ${response.status}`
            + (incompleteReason ? ` (${incompleteReason})` : "")
          ));
        }
        const calls = functionCalls(response);
        if (calls.length === 0) break;
        // A terminal failure gets one final round for observed-state checks.
        // Then deliver those receipts and require an answer in this exchange.
        if (terminalVerificationRounds !== null) terminalVerificationRounds = 0;
        previousResponseId = response.id;
        nextInput = [];
        let immediateControlTransfer = false;
        let refreshedToolDefinitions = null;
        let stopCurrentToolLoop = false;
        for (const call of calls) {
          toolCallCount += 1;
          if (maxToolCalls !== null && toolCallCount > maxToolCalls + 8) {
            throw new Error(`OpenAI continued requesting tools after the ${maxToolCalls}-call budget was exhausted`);
          }
          let result;
          if (stopCurrentToolLoop) {
            result = {
              ok: false,
              error: "The current tool loop was stopped after an identical failed call. No remaining calls from this model response were executed.",
              stopToolLoop: true,
            };
          } else if (maxToolCalls !== null && toolCallCount > maxToolCalls) {
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
          if (
            result?.ok === true
            && ["request_tools", "request_capabilities"].includes(call.name)
          ) {
            controlTransfers.push({ tool: call.name, callId: call.call_id });
          }
          if (result?.ok === true && result?.controlTransfer?.type === "object_binding_refresh") {
            if (Array.isArray(result.controlTransfer.tools)) {
              // Keep executing sibling calls from this response. Each callback
              // sees the runtime's cumulatively observed bindings, so the last
              // returned tool set is the union needed by the continuation.
              refreshedToolDefinitions = result.controlTransfer.tools;
            } else {
              // Compatibility fallback for transports/callers that cannot
              // provide refreshed exact schemas inline.
              controlTransfers.push({
                tool: call.name,
                callId: call.call_id,
                type: "object_binding_refresh",
              });
              immediateControlTransfer = true;
            }
          }
          if (result?.toolFailure?.terminalForCurrentRequest === true && terminalVerificationRounds === null) {
            terminalVerificationRounds = 1;
          }
          if (result?.stopToolLoop === true) {
            terminalVerificationRounds = 0;
            stopCurrentToolLoop = true;
          }
          nextInput.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result ?? null),
          });
          if (immediateControlTransfer) break;
        }
        if (!immediateControlTransfer && refreshedToolDefinitions) {
          callableTools = openAITools(refreshedToolDefinitions);
          objectBindingRefreshCount += 1;
          await onEvent?.({
            type: "tools.refreshed",
            modelCallIndex: modelCallCount,
            reason: "object_binding_refresh",
            toolSchemaCount: refreshedToolDefinitions.length,
            tools: refreshedToolDefinitions,
            providerTools: callableTools,
          });
        }
        if (immediateControlTransfer) break;
      }
      const text = responseText(response);
      if (!text && controlTransfers.length === 0) {
        throw new Error("OpenAI completed without a final response");
      }
      return {
        text,
        conversationId: response.id,
        providerTurnId: response.id,
        status: response.status,
        messages,
        tokenUsage: totalUsage,
        usage: observedUsage(),
        events,
        controlTransfers,
        protocol: {
          endpoint: `${this.baseUrl}/responses`,
          responseId: response.id,
          toolSchemaCount: callableTools.length,
          structuredOutput: Boolean(providerOutputSchema),
          imageDetail: requestAttachmentInput?.mediaKind === "image" ? this.imageDetail : null,
          controlTransfer: controlTransfers.length > 0,
          objectBindingRefreshCount,
        },
      };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      const existingData = failure.data && typeof failure.data === "object" && !Array.isArray(failure.data)
        ? failure.data
        : {};
      failure.data = redactValue({
        ...existingData,
        transport: this.id,
        conversationId: response?.id ?? previousResponseId ?? null,
        providerTurnId: response?.id ?? null,
        status: response?.status ?? null,
        incompleteDetails: response?.incomplete_details ?? null,
        providerError: response?.error ?? null,
        messages,
        protocolEvents: events,
        controlTransfers,
        usage: observedUsage(),
      });
      throw failure;
    }
  }
}

export { openAICompatibleSchema, openAITools };
