import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { FileOAuthClientProvider } from "../src/mcp-oauth.mjs";
import { SlayerRuntime } from "../src/runtime.mjs";
import {
  artifactUploadMetadataKey, McpToolManager, mcpResultDetails, remoteToolName,
} from "../src/tools/mcp-tools.mjs";
import { toolDescriptionMetadataKey } from "../src/tool-description.mjs";
import { schemaProblem, ToolRegistry } from "../src/tools/registry.mjs";

test("remote application tools use provider-neutral names", () => {
  const name = remoteToolName("weather", "openmeteo_search_locations");
  assert.equal(name, "remote_weather_openmeteo_search_locations");
  assert.equal(name.startsWith("mcp__"), false);
  assert.match(name, /^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
});

test("remote Tool Description metadata is validated without becoming a base-MCP requirement", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "remote_example_valid",
    description: "A complete provider execution description.",
    source: "mcp:example",
    annotations: { readOnlyHint: true },
    metadata: {
      [toolDescriptionMetadataKey]: {
        protocol: "agent-slayer.tool-description",
        version: 1,
        summary: "Read the current example record.",
        actionClasses: ["READ"],
        effectClassifications: ["READ-ONLY"],
      },
    },
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() { return {}; },
  });
  assert.equal(registry.toolDefinitions().length, 1);

  assert.throws(() => registry.register({
    name: "remote_example_invalid",
    description: "A complete provider execution description.",
    source: "mcp:example",
    annotations: { readOnlyHint: true },
    metadata: {
      [toolDescriptionMetadataKey]: {
        protocol: "agent-slayer.tool-description",
        version: 1,
        summary: "Mutate the example record.",
        actionClasses: ["UPDATE"],
        effectClassifications: ["MUTATING"],
      },
    },
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() { return {}; },
  }), /effects conflict with readOnlyHint/);

  assert.throws(() => registry.register({
    name: "remote_example_malformed",
    description: "A provider extension with a field outside the versioned contract.",
    source: "mcp:example",
    annotations: { readOnlyHint: true },
    metadata: {
      [toolDescriptionMetadataKey]: {
        protocol: "agent-slayer.tool-description",
        version: 1,
        summary: "Read the current example record.",
        actionClasses: ["READ"],
        effectClassifications: ["READ-ONLY"],
        undocumentedField: true,
      },
    },
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() { return {}; },
  }), /undocumentedField is not allowed/);

  registry.register({
    name: "remote_example_legacy",
    description: "A legacy MCP tool with no Agent Slayer extension.",
    source: "mcp:example",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() { return {}; },
  });
  assert.equal(registry.toolDefinitions().length, 2);
});

test("an advertised HTTP artifact receiver becomes one resumable file-upload application tool", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.directory, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    accounting: {
      enabled: true,
      url: "https://accounting.example.test/mcp",
      headers: { Authorization: "Bearer accounting-token" },
    },
  }));
  const data = Buffer.from('{"id":1}\n{"id":2}\n', "utf8");
  const digest = createHash("sha256").update(data).digest("hex");
  let received = Buffer.from(data.subarray(0, 4));
  let closeCount = 0;
  let completed = false;
  const requests = [];
  const events = [];
  const inputSchema = (fields) => ({
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(fields.map((field) => [field, { type: "string" }])),
    required: fields,
  });
  const tools = [
    {
      name: "stage_transaction_import_artifact", description: "Stage an uploaded transaction artifact.",
      inputSchema: inputSchema(["import_job_id", "artifact_id"]),
      _meta: {
        [toolDescriptionMetadataKey]: {
          protocol: "agent-slayer.tool-description",
          version: 1,
          summary: "Stage one previously uploaded transaction artifact for provider validation.",
          actionClasses: ["EXECUTE"],
          effectClassifications: ["MUTATING"],
        },
        [artifactUploadMetadataKey]: {
          contractVersion: 1,
          transportId: "transaction_import",
          endpointPath: "/mcp/artifacts",
          acceptedMediaTypes: ["application/x-ndjson"],
          maximumChunkBytes: 8,
          maximumBytes: 1000,
        },
      },
    },
  ];
  const fakeClient = {
    async connect() {},
    async listTools() { return { tools }; },
    async callTool() { throw new Error("The upload wrapper must not call the consumer MCP tool"); },
    async close() {},
  };
  const fetchFn = async (input, options = {}) => {
    const url = new URL(input);
    requests.push({
      method: options.method, path: url.pathname,
      authorization: options.headers?.Authorization,
      contentType: options.headers?.["Content-Type"],
      uploadOffset: options.headers?.["Upload-Offset"],
      chunkDigest: options.headers?.["X-Content-SHA256"],
    });
    assert.equal(options.headers.Authorization, "Bearer accounting-token");
    if (options.method === "POST" && url.pathname === "/mcp/artifacts") {
      const body = JSON.parse(options.body);
      assert.deepEqual(body, {
        client_request_id: `agent-slayer:${digest}`,
        file_name: "records.jsonl",
        media_type: "application/x-ndjson",
        byte_size: data.length,
        sha256: digest,
      });
      return new Response(JSON.stringify({ artifact_id: "artifact-1", unexpected_echo: data.toString("utf8") }), {
        status: 201, headers: { "Content-Type": "application/json" },
      });
    }
    if (options.method === "GET" && url.pathname === "/mcp/artifacts/artifact-1") {
      return Response.json(completed ? {
        artifact_id: "artifact-1", status: "complete", next_offset: data.length,
        file_name: "records.jsonl", media_type: "application/x-ndjson",
        byte_size: data.length, sha256: digest,
      } : { artifact_id: "artifact-1", status: "receiving", next_offset: received.length });
    }
    if (options.method === "PATCH" && url.pathname === "/mcp/artifacts/artifact-1") {
      assert.equal(Number(options.headers["Upload-Offset"]), received.length);
      const chunk = Buffer.from(options.body);
      assert.equal(options.headers["Content-Type"], "application/octet-stream");
      assert.equal(options.headers["X-Content-SHA256"], createHash("sha256").update(chunk).digest("hex"));
      assert.deepEqual(chunk, data.subarray(received.length, received.length + chunk.length));
      received = Buffer.concat([received, chunk]);
      return new Response(null, { status: 204, headers: { "Upload-Offset": String(received.length) } });
    }
    if (options.method === "POST" && url.pathname === "/mcp/artifacts/artifact-1/complete") {
      assert.deepEqual(received, data);
      completed = true;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected artifact request ${options.method} ${url.pathname}`);
  };
  const manager = new McpToolManager({
    configPath,
    clientFactory: () => fakeClient,
    transportFactory: () => ({ async close() {} }),
    fetchFn,
    artifactSource: {
      async open(fileId) {
        assert.equal(fileId, 218);
        return {
          descriptor: {
            file: { file_id: 218 },
            fileId: 218,
            filename: "records.jsonl",
            mimeType: "application/x-ndjson",
            byteSize: data.length,
            sha256: digest,
            jsonLineRecordCount: 2,
          },
          async read(offset, maximumBytes) { return data.subarray(offset, offset + maximumBytes); },
          async close() { closeCount += 1; },
        };
      },
    },
    ledger: { append(event) { events.push(event); } },
  });
  const registry = new ToolRegistry();
  await manager.initialize(registry);
  const wrapperName = "remote_accounting_upload_transaction_import_file";
  assert.deepEqual(registry.list().map(({ name }) => name).sort(), [
    "remote_accounting_stage_transaction_import_artifact", wrapperName,
  ]);
  const definition = registry.toolDefinitions().find(({ name }) => name === wrapperName);
  const consumerDefinition = registry.toolDefinitions().find(({ name }) => (
    name === "remote_accounting_stage_transaction_import_artifact"
  ));
  assert.equal(
    consumerDefinition.metadata[toolDescriptionMetadataKey].protocol,
    "agent-slayer.tool-description",
  );
  assert.deepEqual(definition.inputSchema.required, ["file_id"]);
  assert.equal(definition.annotations.idempotentHint, true);
  assert.equal(definition.annotations.openWorldHint, true);
  assert.deepEqual(manager.health().accounting.artifactUploads, [
    { transportId: "transaction_import", tool: wrapperName },
  ]);
  assert.deepEqual(manager.health().accounting.artifactUploadProblems, []);

  const first = await registry.execute(wrapperName, { file_id: 218 }, {
    requestId: "request-1", callId: "call-1", channel: "web",
  });
  assert.equal(first.artifact.artifact_id, "artifact-1");
  assert.equal(first.transfer.resumed_from_offset, 4);
  assert.equal(first.transfer.chunks_sent, 2);
  assert.equal(first.transfer.bytes_sent_this_call, data.length - 4);
  assert.equal(schemaProblem(first, definition.outputSchema, "result"), null);
  assert.equal(closeCount, 1);
  assert.equal(new Set(requests.map(({ authorization }) => authorization)).size, 1);
  assert.equal(JSON.stringify(events).includes("accounting-token"), false);
  assert.equal(JSON.stringify(events).includes(data.toString("utf8")), false);
  assert.deepEqual(events.map(({ type, status }) => [type, status]), [
    ["mcp.artifact.begin", "complete"],
    ["mcp.artifact.resume", "complete"],
    ["mcp.artifact.chunk", "complete"],
    ["mcp.artifact.chunk", "complete"],
    ["mcp.artifact.complete", "complete"],
    ["mcp.artifact.verify", "complete"],
  ]);

  const replay = await registry.execute(wrapperName, { file_id: 218 });
  assert.equal(replay.transfer.resumed_from_offset, data.length);
  assert.equal(replay.transfer.chunks_sent, 0);
  assert.equal(replay.transfer.bytes_sent_this_call, 0);
  assert.equal(closeCount, 2);
  assert.equal(requests.filter(({ method, path: requestPath }) => (
    method === "POST" && requestPath.endsWith("/complete")
  )).length, 1);
  await manager.close();
});

test("an advertised artifact route returning 405 is terminal until a successful integration refresh", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.directory, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    accounting: {
      enabled: true,
      url: "https://accounting.example.test/mcp",
      headers: { Authorization: "Bearer accounting-token" },
    },
  }));
  const tools = [{
    name: "stage_transaction_import_artifact",
    description: "Stage an uploaded transaction artifact.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { artifact_id: { type: "string" } }, required: ["artifact_id"],
    },
    _meta: { [artifactUploadMetadataKey]: {
      contractVersion: 1,
      transportId: "transaction_import",
      endpointPath: "/mcp/artifacts",
      acceptedMediaTypes: ["application/x-ndjson"],
      maximumChunkBytes: 1024,
    } },
  }];
  let fetchCount = 0;
  let openCount = 0;
  const manager = new McpToolManager({
    configPath,
    clientFactory: () => ({
      async connect() {},
      async listTools() { return { tools }; },
      async close() {},
    }),
    transportFactory: () => ({ async close() {} }),
    fetchFn: async () => {
      fetchCount += 1;
      return new Response("Method Not Allowed", { status: 405 });
    },
    artifactSource: {
      async open() {
        openCount += 1;
        return {
          descriptor: {
            file: { file_id: 218 }, fileId: 218, filename: "records.jsonl",
            mimeType: "application/x-ndjson", byteSize: 3,
            sha256: createHash("sha256").update("{}\n").digest("hex"),
          },
          async read() { return Buffer.from("{}\n"); },
          async close() {},
        };
      },
    },
  });
  const registry = new ToolRegistry();
  await manager.initialize(registry);
  const wrapperName = "remote_accounting_upload_transaction_import_file";

  const firstFailure = await rejectedError(
    registry.execute(wrapperName, { file_id: 218 }),
  );
  assert.equal(firstFailure.toolFailure.kind, "contract_mismatch");
  assert.equal(firstFailure.toolFailure.code, "MCP_ARTIFACT_REQUIRED_METHOD_NOT_SUPPORTED");
  assert.equal(firstFailure.toolFailure.terminalForCurrentRequest, true);
  assert.equal(firstFailure.toolFailure.method, "POST");
  assert.equal(firstFailure.toolFailure.path, "/mcp/artifacts");
  assert.equal(firstFailure.toolFailure.httpStatus, 405);
  assert.match(firstFailure.toolFailure.contractFingerprint, /^[0-9a-f]{64}$/);

  const blockedFailure = await rejectedError(
    registry.execute(wrapperName, { file_id: 218 }),
  );
  assert.equal(blockedFailure.toolFailure.code, "MCP_ARTIFACT_CONTRACT_BLOCKED_UNTIL_REFRESH");
  assert.equal(fetchCount, 1);
  assert.equal(openCount, 1);
  assert.equal(manager.health().accounting.artifactContractFailures.length, 1);

  assert.equal((await manager.refreshTools()).accounting.refreshed, true);
  assert.deepEqual(manager.health().accounting.artifactContractFailures, []);
  const afterRefreshFailure = await rejectedError(
    registry.execute(wrapperName, { file_id: 218 }),
  );
  assert.equal(afterRefreshFailure.toolFailure.code, "MCP_ARTIFACT_REQUIRED_METHOD_NOT_SUPPORTED");
  assert.equal(fetchCount, 2);
  assert.equal(openCount, 2);
  await manager.close();
});

test("artifact authentication and transient HTTP failures remain distinguishable and retryable", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.directory, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    storage: {
      enabled: true,
      url: "https://storage.example.test/mcp",
      headers: { Authorization: "Bearer storage-token" },
    },
  }));
  const tools = [{
    name: "consume_file",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { artifact_id: { type: "string" } }, required: ["artifact_id"],
    },
    _meta: { [artifactUploadMetadataKey]: {
      contractVersion: 1, transportId: "files", endpointPath: "/mcp/artifacts",
      acceptedMediaTypes: ["application/x-ndjson"], maximumChunkBytes: 1024,
    } },
  }];
  const statuses = [401, 503];
  const manager = new McpToolManager({
    configPath,
    clientFactory: () => ({
      async connect() {}, async listTools() { return { tools }; }, async close() {},
    }),
    transportFactory: () => ({ async close() {} }),
    fetchFn: async () => new Response(null, { status: statuses.shift() }),
    artifactSource: {
      async open() {
        return {
          descriptor: {
            file: { file_id: 9 }, fileId: 9, filename: "records.jsonl",
            mimeType: "application/x-ndjson", byteSize: 3,
            sha256: createHash("sha256").update("{}\n").digest("hex"),
          },
          async read() { return Buffer.from("{}\n"); }, async close() {},
        };
      },
    },
  });
  const registry = new ToolRegistry();
  await manager.initialize(registry);
  const wrapperName = "remote_storage_upload_files_file";
  const authentication = await rejectedError(registry.execute(wrapperName, { file_id: 9 }));
  assert.equal(authentication.toolFailure.kind, "authentication_failure");
  assert.equal(authentication.toolFailure.terminalForCurrentRequest, false);
  const transient = await rejectedError(registry.execute(wrapperName, { file_id: 9 }));
  assert.equal(transient.toolFailure.kind, "transient_provider_failure");
  assert.equal(transient.toolFailure.terminalForCurrentRequest, false);
  assert.deepEqual(manager.health().storage.artifactContractFailures, []);
  await manager.close();
});

test("invalid advertised artifact upload metadata does not create an application upload tool", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.directory, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    storage: { enabled: true, url: "https://storage.example.test/mcp" },
  }));
  const manager = new McpToolManager({
    configPath,
    artifactSource: { async open() { throw new Error("not called"); } },
    clientFactory: () => ({
      async connect() {},
      async listTools() {
        return { tools: [{
          name: "consume_file",
          inputSchema: { type: "object", properties: { artifact_id: { type: "string" } }, required: [] },
          _meta: { [artifactUploadMetadataKey]: {
            contractVersion: 1, transportId: "files", endpointPath: "/mcp/artifacts",
            acceptedMediaTypes: ["*/*"], maximumChunkBytes: 2 * 1024 * 1024,
          } },
        }] };
      },
      async close() {},
    }),
    transportFactory: () => ({ async close() {} }),
  });
  const registry = new ToolRegistry();
  await manager.initialize(registry);
  assert.deepEqual(registry.list().map(({ name }) => name), ["remote_storage_consume_file"]);
  assert.match(manager.health().storage.artifactUploadProblems.join(" "), /artifact_id/);
  assert.match(manager.health().storage.artifactUploadProblems.join(" "), /maximumChunkBytes/);
  await manager.close();
});

test("MCP identity, contracts, metadata, and supplemental resources survive adaptation", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.directory, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    accounting: { enabled: true, url: "https://accounting.example.test/mcp", aliases: ["books"] },
  }));
  const structuredContent = Object.freeze({ status: "ready", planId: "provider-plan" });
  let callToolCount = 0;
  const fakeClient = {
    async connect() {},
    getServerVersion() { return { name: "accounting-server", title: "Accounting" }; },
    getInstructions() { return "Use exact provider plans. Commit only after confirmation."; },
    async listTools() {
      return { tools: [
        {
          name: "plan_import", title: "Plan import", description: "Build an import plan.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          outputSchema: { type: "object", properties: { status: { type: "string" } } },
          annotations: { readOnlyHint: true, idempotentHint: true },
          _meta: { providerTool: "accounting-plan" },
        },
        {
          name: "failing_operation", description: "Return a structured provider error.",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
        },
      ] };
    },
    async callTool({ name }) {
      callToolCount += 1;
      if (name === "failing_operation") {
        return {
          isError: true,
          content: [{ type: "text", text: "The provider rejected this operation." }],
          _meta: { providerCode: "REJECTED" },
        };
      }
      return {
        structuredContent,
        content: [
          { type: "text", text: JSON.stringify(structuredContent) },
          { type: "resource_link", uri: "accounting://plans/provider-plan", name: "Import plan" },
        ],
        _meta: { receipt: "provider-receipt" },
      };
    },
    async close() {},
  };
  const manager = new McpToolManager({
    configPath,
    clientFactory: () => fakeClient,
    transportFactory: () => ({ async close() {} }),
  });
  const registry = new ToolRegistry();
  await manager.initialize(registry);

  const definition = registry.toolDefinitions().find(({ name }) => name === "remote_accounting_plan_import");
  assert.equal(definition.title, "Plan import");
  assert.deepEqual(definition.outputSchema, {
    type: "object", properties: { status: { type: "string" } },
  });
  assert.deepEqual(definition.annotations, { readOnlyHint: true, idempotentHint: true });
  assert.deepEqual(definition.metadata, { providerTool: "accounting-plan" });
  assert.equal(definition.capabilityId, "integration:accounting");
  assert.equal(definition.capability.title, "Accounting");
  assert.deepEqual(definition.capability.aliases, ["accounting", "accounting-server", "Accounting", "books"]);
  assert.equal(manager.health().accounting.instructionsAvailable, true);

  await assert.rejects(
    registry.execute("remote_accounting_failing_operation", {
      result_filter: { max_characters: 10000 },
    }),
    /arguments\.result_filter is not allowed/,
  );
  assert.equal(callToolCount, 0);

  const result = await registry.execute("remote_accounting_plan_import", {});
  assert.equal(result.status, "ready");
  assert.deepEqual(result.mcpSupplementalContent, [{
    type: "resource_link", uri: "accounting://plans/provider-plan", name: "Import plan",
  }]);
  assert.deepEqual(mcpResultDetails(result), {
    meta: { receipt: "provider-receipt" }, isError: false,
    contentTypes: ["text", "resource_link"],
  });
  assert.equal(callToolCount, 1);

  const providerError = await registry.execute("remote_accounting_failing_operation", {});
  assert.deepEqual(providerError, ["The provider rejected this operation."]);
  assert.deepEqual(mcpResultDetails(providerError), {
    meta: { providerCode: "REJECTED" }, isError: true, contentTypes: ["text"],
  });
  assert.equal(callToolCount, 2);

  const events = [];
  let errorResponse;
  const runtime = new SlayerRuntime({
    modelTransport: {
      id: "mcp-error-test", displayName: "MCP error test",
      describeRequest(payload) { return { tools: payload.tools, input: payload.input }; },
      async runTurn(payload) {
        errorResponse = await payload.onToolCall({
          callId: "provider-error", tool: "remote_accounting_failing_operation", arguments: {},
        });
        return {
          text: "The provider rejected the operation.", threadId: null, turnId: "provider-turn",
          status: "completed", messages: [], events: [],
          usage: { tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
        };
      },
    },
    registry,
    contextBuilder: {
      async build() {
        return {
          text: "context", profileFacts: [], activeProfileFactCount: 0,
          relevantProfileTypes: [], relevantProfileQuestions: [], history: [],
          contextBudget: { truncated: false }, attachment: null,
        };
      },
    },
    ledger: { append(event) { events.push(event); } },
    config: {
      model: "test-model", reasoningEffort: "low", turnWorkflowEnabled: false,
      maxToolCalls: 2, systemPromptPath: "unused",
    },
  });
  runtime.systemPrompt = "SYSTEM";
  await runtime.run({ requestId: "provider-error-request", requestEventId: "event-1", text: "Try it." });
  assert.equal(errorResponse.ok, false);
  assert.match(errorResponse.error, /returned an MCP error result/);
  const errorEvent = events.find(({ type, status }) => type === "tool.result" && status === "error");
  assert.deepEqual(errorEvent.payload.providerResult, {
    meta: { providerCode: "REJECTED" }, isError: true, contentTypes: ["text"],
  });
  await manager.close();
});

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-oauth-test-"));
  return { directory, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

async function rejectedError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

test("OAuth credentials persist privately and preserve rotated refresh tokens", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const provider = new FileOAuthClientProvider({
    serverName: "tlom",
    storageRoot: temporary.directory,
    redirectUrl: "https://slayer.example.test/api/integrations/tlom/oauth/callback",
    scopes: ["tlom:read", "tlom:write"],
  });
  await provider.load();
  await provider.saveClientInformation({
    client_id: "client-1",
    redirect_uris: [provider.redirectUrl.toString()],
  });
  await provider.saveTokens({ access_token: "access-1", refresh_token: "refresh-1", token_type: "Bearer" });
  await provider.saveTokens({ access_token: "access-2", token_type: "Bearer" });
  assert.equal((await provider.tokens()).refresh_token, "refresh-1");
  await provider.beginAuthorization();
  const state = await provider.state();
  await provider.assertState(state);
  await assert.rejects(provider.assertState("wrong-state"), /state did not match/);

  assert.equal(await provider.tokens(), undefined);
  assert.equal(provider.clientMetadata.scope, "tlom:read tlom:write");
  assert.equal(fs.statSync(provider.filename).mode & 0o777, 0o600);
  assert.equal(fs.statSync(temporary.directory).mode & 0o777, 0o700);
});

test("changing the public callback invalidates an old OAuth client registration", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const original = new FileOAuthClientProvider({
    serverName: "tlom", storageRoot: temporary.directory,
    redirectUrl: "https://old.example.test/api/integrations/tlom/oauth/callback",
  });
  await original.saveClientInformation({ client_id: "old-client", redirect_uris: [original.redirectUrl.toString()] });
  await original.saveTokens({ access_token: "old-token", token_type: "Bearer" });

  const changed = new FileOAuthClientProvider({
    serverName: "tlom", storageRoot: temporary.directory,
    redirectUrl: "https://new.example.test/api/integrations/tlom/oauth/callback",
  });
  await changed.load();
  assert.equal(await changed.clientInformation(), undefined);
  assert.equal(await changed.tokens(), undefined);
});

test("the SDK OAuth flow discovers metadata, dynamically registers, and exchanges a PKCE code", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const provider = new FileOAuthClientProvider({
    serverName: "tlom",
    storageRoot: temporary.directory,
    redirectUrl: "https://slayer.example.test/api/integrations/tlom/oauth/callback",
    scopes: ["tlom:read", "tlom:write"],
  });
  await provider.beginAuthorization();
  const requests = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
  const fetchFn = async (input, init = {}) => {
    const url = new URL(input);
    requests.push({ url: url.toString(), method: init.method ?? "GET", body: init.body });
    if (url.pathname === "/.well-known/oauth-protected-resource/api/mcp") {
      return json({
        resource: "https://mytlom.example.test/api/mcp",
        authorization_servers: ["https://mytlom.example.test"],
        scopes_supported: ["tlom:read", "tlom:write", "tlom:delete"],
      });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json({
        issuer: "https://mytlom.example.test",
        authorization_endpoint: "https://mytlom.example.test/oauth/authorize",
        token_endpoint: "https://mytlom.example.test/oauth/token",
        registration_endpoint: "https://mytlom.example.test/oauth/register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/oauth/register") {
      const registration = JSON.parse(init.body);
      assert.equal(registration.scope, "tlom:read tlom:write");
      return json({ ...registration, client_id: "dynamic-client" }, 201);
    }
    if (url.pathname === "/oauth/token") {
      const tokenRequest = new URLSearchParams(init.body);
      assert.equal(tokenRequest.get("grant_type"), "authorization_code");
      assert.equal(tokenRequest.get("code"), "authorization-code");
      assert.equal(tokenRequest.get("client_id"), "dynamic-client");
      assert.equal(tokenRequest.get("redirect_uri"), provider.redirectUrl.toString());
      assert.ok(tokenRequest.get("code_verifier"));
      assert.equal(tokenRequest.get("resource"), "https://mytlom.example.test/api/mcp");
      return json({ access_token: "access-token", refresh_token: "refresh-token", token_type: "Bearer" });
    }
    throw new Error(`Unexpected OAuth request: ${url}`);
  };

  assert.equal(await auth(provider, {
    serverUrl: "https://mytlom.example.test/api/mcp",
    scope: "tlom:read tlom:write",
    fetchFn,
  }), "REDIRECT");
  const authorizationUrl = new URL(await provider.authorizationUrl());
  assert.equal(authorizationUrl.pathname, "/oauth/authorize");
  assert.equal(authorizationUrl.searchParams.get("scope"), "tlom:read tlom:write");
  assert.equal(authorizationUrl.searchParams.get("resource"), "https://mytlom.example.test/api/mcp");
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));

  assert.equal(await auth(provider, {
    serverUrl: "https://mytlom.example.test/api/mcp",
    authorizationCode: "authorization-code",
    scope: "tlom:read tlom:write",
    fetchFn,
  }), "AUTHORIZED");
  assert.equal((await provider.tokens()).refresh_token, "refresh-token");
  assert.ok(requests.some((request) => request.url.endsWith("/oauth/register")));
  assert.ok(requests.some((request) => request.url.endsWith("/oauth/token")));
});

test("an OAuth MCP is unavailable until the callback completes, then its tools are callable", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.directory, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    tlom: {
      enabled: true,
      required: true,
      url: "https://mytlom.example.test/api/mcp",
      oauth: { enabled: true, scopes: ["tlom:read", "tlom:write"] },
    },
  }));

  const calls = [];
  const fakeClient = {
    async connect() {},
    async listTools() {
      return { tools: [{ name: "clock_update", description: "Update a clock row", inputSchema: { type: "object" } }] };
    },
    async callTool(call) { calls.push(call); return { structuredContent: { updated: true } }; },
    async close() {},
  };
  const manager = new McpToolManager({
    configPath,
    oauthRoot: path.join(temporary.directory, "oauth"),
    publicUrl: "https://slayer.example.test",
    clientFactory: () => fakeClient,
    transportFactory: () => ({ async close() {} }),
    authFn: async (provider, options) => {
      if (options.authorizationCode) {
        assert.equal(options.authorizationCode, "authorization-code");
        await provider.saveTokens({ access_token: "access-token", refresh_token: "refresh-token", token_type: "Bearer" });
        return "AUTHORIZED";
      }
      const state = await provider.state();
      await provider.saveClientInformation({ client_id: "client-1", redirect_uris: [provider.redirectUrl.toString()] });
      await provider.saveCodeVerifier("verifier");
      await provider.redirectToAuthorization(new URL(`https://mytlom.example.test/oauth/authorize?state=${state}`));
      return "REDIRECT";
    },
  });
  const registry = new ToolRegistry();
  await manager.initialize(registry);
  assert.match(manager.requiredProblem(), /OAuth authorization is required/);
  assert.equal(registry.list().length, 0);

  const started = await manager.beginOAuth("tlom");
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  await manager.finishOAuth("tlom", { code: "authorization-code", state });
  assert.equal(manager.requiredProblem(), null);
  assert.equal(manager.health().tlom.authorization, "connected");
  assert.deepEqual(await registry.execute("remote_tlom_clock_update", { id: 42 }), { updated: true });
  assert.deepEqual(calls, [{ name: "clock_update", arguments: { id: 42 } }]);
  const disconnected = await manager.disconnectOAuth("tlom");
  assert.equal(disconnected.authorization, "required");
  assert.match(manager.requiredProblem(), /OAuth authorization is required/);
  assert.equal(registry.list().length, 0);
  assert.equal(await manager.oauthProviders.get("tlom").tokens(), undefined);
  await assert.rejects(
    registry.execute("remote_tlom_clock_update", { id: 42 }),
    /Unknown tool/,
  );
  const restarted = await manager.beginOAuth("tlom");
  await manager.finishOAuth("tlom", {
    code: "authorization-code",
    state: new URL(restarted.authorizationUrl).searchParams.get("state"),
  });
  assert.deepEqual(await registry.execute("remote_tlom_clock_update", { id: 43 }), { updated: true });
  await manager.close();
});

test("multiple OAuth MCP integrations authorize and connect independently", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.directory, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    alpha: {
      enabled: true,
      url: "https://alpha.example.test/mcp",
      oauth: { enabled: true, scopes: [] },
    },
    beta: {
      enabled: true,
      url: "https://beta.example.test/mcp",
      oauth: { enabled: true, scopes: [] },
    },
  }));

  const manager = new McpToolManager({
    configPath,
    oauthRoot: path.join(temporary.directory, "oauth"),
    publicUrl: "https://slayer.example.test",
    clientFactory: () => ({
      async connect() {},
      async listTools() {
        return { tools: [{ name: "ping", description: "Ping this service", inputSchema: { type: "object" } }] };
      },
      async callTool() { return { structuredContent: { ok: true } }; },
      async close() {},
    }),
    transportFactory: () => ({ async close() {} }),
    authFn: async (provider, options) => {
      if (options.authorizationCode) {
        await provider.saveTokens({ access_token: `${provider.serverName}-token`, token_type: "Bearer" });
        return "AUTHORIZED";
      }
      const state = await provider.state();
      await provider.saveClientInformation({
        client_id: `${provider.serverName}-client`,
        redirect_uris: [provider.redirectUrl.toString()],
      });
      await provider.saveCodeVerifier(`${provider.serverName}-verifier`);
      await provider.redirectToAuthorization(new URL(`https://${provider.serverName}.example.test/authorize?state=${state}`));
      return "REDIRECT";
    },
  });
  const registry = new ToolRegistry();
  await manager.initialize(registry);
  assert.equal(manager.health().alpha.authorization, "required");
  assert.equal(manager.health().beta.authorization, "required");

  const alphaStart = await manager.beginOAuth("alpha");
  await manager.finishOAuth("alpha", {
    code: "alpha-code",
    state: new URL(alphaStart.authorizationUrl).searchParams.get("state"),
  });
  assert.equal(manager.health().alpha.ready, true);
  assert.equal(manager.health().beta.ready, false);

  const betaStart = await manager.beginOAuth("beta");
  await manager.finishOAuth("beta", {
    code: "beta-code",
    state: new URL(betaStart.authorizationUrl).searchParams.get("state"),
  });
  assert.equal(manager.health().alpha.ready, true);
  assert.equal(manager.health().beta.ready, true);
  assert.deepEqual(registry.list().map(({ name }) => name).sort(), ["remote_alpha_ping", "remote_beta_ping"]);
  await manager.close();
});

test("refresh replaces MCP tool names and schemas while preserving the last good list on failure", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.directory, "mcp.json");
  fs.writeFileSync(configPath, JSON.stringify({
    inventory: { enabled: true, url: "https://inventory.example.test/mcp" },
  }));

  let generation = 0;
  const closed = [];
  const clients = [
    [
      { name: "item_read", description: "Read an item", inputSchema: { type: "object", required: ["oldId"] } },
      { name: "item_retired", description: "Retired tool", inputSchema: { type: "object" } },
    ],
    [
      { name: "item_read", description: "Read current inventory", inputSchema: { type: "object", required: ["sku"] } },
      { name: "item_create", description: "Create an item", inputSchema: { type: "object" } },
    ],
  ];
  const manager = new McpToolManager({
    configPath,
    clientFactory: () => {
      const clientGeneration = generation++;
      return {
        async connect() {},
        async listTools() {
          if (!clients[clientGeneration]) throw new Error("inventory refresh unavailable");
          return { tools: clients[clientGeneration] };
        },
        async callTool({ name }) { return { structuredContent: { name, clientGeneration } }; },
        async close() { closed.push(clientGeneration); },
      };
    },
    transportFactory: () => ({ async close() {} }),
  });
  const registry = new ToolRegistry();
  await manager.initialize(registry);
  assert.deepEqual(
    registry.list().map(({ name }) => name).sort(),
    ["remote_inventory_item_read", "remote_inventory_item_retired"],
  );

  const refreshed = await manager.refreshTools();
  assert.deepEqual(refreshed.inventory, {
    refreshed: true,
    toolCount: 2,
    tools: ["item_read", "item_create"],
  });
  assert.deepEqual(
    registry.list().map(({ name }) => name).sort(),
    ["remote_inventory_item_create", "remote_inventory_item_read"],
  );
  const readDefinition = registry.list().find(({ name }) => name === "remote_inventory_item_read");
  assert.equal(readDefinition.description, "[inventory] Read current inventory");
  assert.deepEqual(readDefinition.parameters.required, ["sku"]);
  assert.deepEqual(await registry.execute("remote_inventory_item_create", {}), {
    name: "item_create", clientGeneration: 1,
  });
  assert.deepEqual(closed, [0]);

  const failed = await manager.refreshTools();
  assert.deepEqual(failed.inventory, { refreshed: false, error: "inventory refresh unavailable" });
  assert.equal(manager.health().inventory.ready, true);
  assert.equal(manager.health().inventory.refreshError, "inventory refresh unavailable");
  assert.deepEqual(
    registry.list().map(({ name }) => name).sort(),
    ["remote_inventory_item_create", "remote_inventory_item_read"],
  );
  await manager.close();
});

test("UI-managed bearer MCP integrations persist privately, reload, and can be removed", async (context) => {
  const temporary = temporaryDirectory();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.directory, "mcp.json");
  const userConfigPath = path.join(temporary.directory, "private", "mcp-connections.json");
  fs.writeFileSync(configPath, "{}");
  const transports = [];
  const managerOptions = {
    configPath,
    userConfigPath,
    clientFactory: () => ({
      async connect() {},
      async listTools() {
        return { tools: [{ name: "ledger_verify", description: "Verify the ledger", inputSchema: { type: "object" } }] };
      },
      async callTool() { return { structuredContent: { verified: true } }; },
      async close() {},
    }),
    transportFactory: (url, options) => {
      transports.push({ url: url.toString(), options });
      return { async close() {} };
    },
  };

  const first = new McpToolManager(managerOptions);
  const firstRegistry = new ToolRegistry();
  await first.initialize(firstRegistry);
  const connected = await first.addBearerIntegration({
    name: "Accounting MCP",
    url: "https://accounting.example.test/mcp",
    token: "cfacct_private-token",
  });
  assert.equal(connected.ready, true);
  assert.equal(connected.userManaged, true);
  assert.equal(transports[0].options.requestInit.headers.Authorization, "Bearer cfacct_private-token");
  assert.deepEqual(await firstRegistry.execute("remote_accounting-mcp_ledger_verify", {}), { verified: true });
  assert.equal(fs.statSync(userConfigPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(userConfigPath)).mode & 0o777, 0o700);
  assert.match(fs.readFileSync(userConfigPath, "utf8"), /cfacct_private-token/);
  await first.close();

  const restarted = new McpToolManager(managerOptions);
  const restartedRegistry = new ToolRegistry();
  await restarted.initialize(restartedRegistry);
  assert.equal(restarted.health()["accounting-mcp"].ready, true);
  assert.equal(restarted.health()["accounting-mcp"].userManaged, true);
  assert.equal(restartedRegistry.list().length, 1);
  const removed = await restarted.removeUserIntegration("accounting-mcp");
  assert.equal(removed.removed, true);
  assert.equal(restarted.health()["accounting-mcp"], undefined);
  assert.equal(restartedRegistry.list().length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(userConfigPath, "utf8")), {});
  await restarted.close();
});
