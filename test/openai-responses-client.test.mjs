import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenAIResponsesClient,
  estimatedCost,
  openAICompatibleSchema,
  openAITools,
} from "../src/openai-responses-client.mjs";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

const tools = [{
  name: "todo_create",
  description: "Create one todo",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
}];

test("OpenAI Responses sends the exact request, image, and tool schemas through a complete function loop", async () => {
  const requests = [];
  const responses = [
    {
      id: "resp_1",
      status: "completed",
      output: [{
        type: "function_call", id: "fc_1", call_id: "call_1",
        name: "todo_create", arguments: "{\"text\":\"File receipt\"}",
      }],
      usage: {
        input_tokens: 1200, output_tokens: 100, total_tokens: 1300,
        input_tokens_details: { cached_tokens: 200, cache_write_tokens: 100 },
        output_tokens_details: { reasoning_tokens: 60 },
      },
    },
    {
      id: "resp_2",
      status: "completed",
      output: [{
        type: "message", id: "msg_1", role: "assistant",
        content: [{ type: "output_text", text: "I filed the receipt." }],
      }],
      usage: {
        input_tokens: 1400, output_tokens: 80, total_tokens: 1480,
        input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 400 },
        output_tokens_details: { reasoning_tokens: 30 },
      },
    },
  ];
  const client = new OpenAIResponsesClient({
    apiKey: "sk_test_secret_value_123456",
    pricing: {
      inputPerMillion: 2, cachedInputPerMillion: 0.2, cacheWritePerMillion: 2.5, outputPerMillion: 12,
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return jsonResponse(responses.shift());
    },
  });
  const calls = [];
  const result = await client.runTurn({
    model: "gpt-5.6-terra",
    effort: "high",
    conversationId: null,
    baseInstructions: "BASE",
    developerInstructions: "BOUNDED CONTEXT",
    input: "File this receipt and tell me the total.",
    requestAttachmentInput: {
      mediaKind: "image", filename: "receipt.jpg", mimeType: "image/jpeg",
      byteSize: 3, sha256: "receipt-sha", text: "ATTACHED IMAGE METADATA", dataBase64: "/9j/",
    },
    tools,
    maxToolCalls: 10,
    onToolCall: async (call) => {
      calls.push(call);
      return { ok: true, result: { id: 44 } };
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
  assert.equal(requests[0].options.headers.Authorization, "Bearer sk_test_secret_value_123456");
  assert.match(requests[0].body.instructions, /BASE[\s\S]+BOUNDED CONTEXT/);
  assert.equal(requests[0].body.input[0].content[0].text, "File this receipt and tell me the total.");
  assert.equal(requests[0].body.input[0].content[2].image_url, "data:image/jpeg;base64,/9j/");
  assert.equal(requests[0].body.input[0].content[2].detail, "original");
  assert.deepEqual(requests[0].body.tools, openAITools(tools));
  assert.equal(requests[1].body.previous_response_id, "resp_1");
  assert.deepEqual(requests[1].body.tools, openAITools(tools));
  assert.deepEqual(requests[1].body.input, [{
    type: "function_call_output", call_id: "call_1",
    output: JSON.stringify({ ok: true, result: { id: 44 } }),
  }]);
  assert.equal(calls[0].tool, "todo_create");
  assert.equal(result.text, "I filed the receipt.");
  assert.equal(result.conversationId, "resp_2");
  assert.deepEqual(result.usage.tokenUsage, {
    inputTokens: 2600,
    cachedInputTokens: 1200,
    cacheWriteTokens: 500,
    outputTokens: 180,
    reasoningOutputTokens: 90,
    totalTokens: 2780,
  });
  assert.equal(result.usage.contextInputTokens, 1400);
  assert.equal(result.usage.estimatedCostUsd, estimatedCost(result.usage.tokenUsage, client.pricing));
});

test("OpenAI request descriptions expose schemas and image metadata without bytes or credentials", () => {
  const client = new OpenAIResponsesClient({ apiKey: "sk_test_secret_value_123456" });
  const description = client.describeRequest({
    model: "gpt-5.6-terra", effort: "high", conversationId: "resp_previous",
    baseInstructions: "BASE", developerInstructions: "CONTEXT", input: "Read it", tools,
    requestAttachmentInput: {
      mediaKind: "image", filename: "receipt.png", mimeType: "image/png",
      byteSize: 100, sha256: "sha", dataBase64: "sensitive-binary",
    },
    maxToolCalls: 128, runTimeoutMs: null,
  });
  assert.equal(description.toolDelivery, "sent in every Responses API call");
  assert.deepEqual(description.callableTools, openAITools(tools));
  assert.equal(description.input[1].sha256, "sha");
  assert.doesNotMatch(JSON.stringify(description), /sensitive-binary|sk_test/);
  assert.doesNotMatch(JSON.stringify(client.health()), /sk_test/);
});

test("OpenAI schemas omit provider-unsupported uniqueness constraints without mutating local schemas", () => {
  const localSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      values: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        uniqueItems: true,
        items: { type: "string" },
      },
    },
    required: ["values"],
  };

  const compatible = openAICompatibleSchema(localSchema);
  assert.equal(localSchema.properties.values.uniqueItems, true);
  assert.equal(Object.hasOwn(compatible.properties.values, "uniqueItems"), false);
  assert.equal(compatible.properties.values.minItems, 1);
  assert.equal(compatible.properties.values.maxItems, 4);
  assert.equal(
    Object.hasOwn(openAITools([{ name: "collect", description: "Collect", inputSchema: localSchema }])[0]
      .parameters.properties.values, "uniqueItems"),
    false,
  );
  const description = new OpenAIResponsesClient({ apiKey: "sk_test_secret_value_123456" })
    .describeRequest({
      model: "gpt-5.6-terra", effort: "medium", conversationId: null,
      baseInstructions: "BASE", developerInstructions: "CONTEXT", input: "Collect",
      tools: [], outputSchema: localSchema, maxToolCalls: 0, runTimeoutMs: null,
    });
  assert.deepEqual(description.outputSchema, compatible);
});

test("OpenAI Responses sends strict JSON Schema output contracts", async () => {
  const requests = [];
  const outputSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      objective: { type: "string" },
      capabilities: {
        type: "array", uniqueItems: true, items: { type: "string" },
      },
    },
    required: ["objective", "capabilities"],
  };
  const client = new OpenAIResponsesClient({
    apiKey: "sk_test_secret_value_123456",
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return jsonResponse({
        id: "resp_structured", status: "completed",
        output: [{
          type: "message", role: "assistant",
          content: [{
            type: "output_text",
            text: '{"objective":"Orient request","capabilities":[]}',
          }],
        }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      });
    },
  });

  const result = await client.runTurn({
    model: "gpt-5.6-terra", effort: "medium", conversationId: null,
    baseInstructions: "ORIENT", developerInstructions: "SOURCES", input: "Continue.",
    tools: [], outputSchema, maxToolCalls: 0, onToolCall: async () => null,
  });

  const providerSchema = openAICompatibleSchema(outputSchema);
  assert.deepEqual(requests[0].text, {
    format: {
      type: "json_schema", name: "agent_slayer_structured_output", strict: true,
      schema: providerSchema,
    },
  });
  assert.equal(outputSchema.properties.capabilities.uniqueItems, true);
  assert.equal(Object.hasOwn(requests[0], "tool_choice"), false);
  assert.equal(Object.hasOwn(requests[0], "parallel_tool_calls"), false);
  assert.equal(result.text, '{"objective":"Orient request","capabilities":[]}');
  assert.equal(result.protocol.structuredOutput, true);
});

test("OpenAI API errors redact the configured key", async () => {
  const apiKey = "sk_test_secret_value_123456";
  const client = new OpenAIResponsesClient({
    apiKey,
    fetchImpl: async () => jsonResponse({
      error: { message: `Credential ${apiKey} is invalid`, type: "authentication_error", code: "bad_key" },
    }, { ok: false, status: 401 }),
  });
  await assert.rejects(
    client.runTurn({
      model: "gpt-5.6-terra", effort: "high", baseInstructions: "BASE",
      developerInstructions: "CONTEXT", input: "hello", tools: [], onToolCall: async () => null,
    }),
    (error) => !error.message.includes(apiKey) && /REDACTED/.test(error.message),
  );
});
