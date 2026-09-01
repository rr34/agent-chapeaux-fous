import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FileOAuthClientProvider } from "../mcp-oauth.mjs";
import {
  defineToolDescription, toolDescriptionMetadataKey,
} from "../tool-description.mjs";

function expandEnvironment(value, environment) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name) => {
    const replacement = environment[name]?.trim();
    if (!replacement || /^replace-with-/.test(replacement)) throw new Error(`missing environment variable ${name}`);
    return replacement;
  });
}

function safeName(value) {
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, "_");
  return normalized.length <= 64 ? normalized : `${normalized.slice(0, 55)}_${normalized.slice(-8)}`;
}

function requestError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function userIntegrationName(value) {
  const name = String(value ?? "").trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
    throw requestError("Connection name must begin with a letter and contain no more than 64 letters, numbers, hyphens, or underscores");
  }
  return name;
}

function userIntegrationUrl(value) {
  let url;
  try { url = new URL(String(value ?? "").trim()); }
  catch { throw requestError("MCP URL must be a valid HTTP or HTTPS URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
    throw requestError("MCP URL must be an HTTP or HTTPS URL without credentials or a fragment");
  }
  if (url.toString().length > 2048) throw requestError("MCP URL is too long");
  return url.toString();
}

export function remoteToolName(serverName, toolName) {
  // Source metadata records that this tool came from MCP, so keep its callable
  // application name independent from protocol-specific namespace conventions.
  return safeName(`remote_${serverName}_${toolName}`);
}

export const artifactUploadMetadataKey = "agent-slayer/artifactUpload";
const artifactUploadContractVersion = 1;
const artifactFailureContractVersion = 1;
const maximumArtifactChunkBytes = 1024 * 1024;
const maximumArtifactResponseBytes = 1024 * 1024;

function artifactFailureKey(serverName, upload) {
  return `${serverName}\n${upload.transportId}\n${upload.contractFingerprint}`;
}

function artifactFailureDetails({
  kind, code, terminalForCurrentRequest, retry, serverName, upload, step,
  method = null, path: requestPath = null, httpStatus = null,
}) {
  return {
    contractVersion: artifactFailureContractVersion,
    kind,
    code,
    terminalForCurrentRequest,
    retry,
    serverName,
    capabilityId: `integration:${serverName}`,
    transportId: upload.transportId,
    contractFingerprint: upload.contractFingerprint,
    step,
    method,
    path: requestPath,
    httpStatus,
  };
}

function artifactTransferError(message, toolFailure) {
  const error = new Error(message);
  Object.defineProperty(error, "toolFailure", {
    value: Object.freeze(structuredClone(toolFailure)),
    enumerable: true,
  });
  return error;
}

function artifactHttpFailure(serverName, upload, step, request, httpStatus) {
  let kind = "provider_rejection";
  let code = "MCP_ARTIFACT_PROVIDER_REJECTED_REQUEST";
  let retry = "after_corrected_request_or_provider_guidance";
  let terminalForCurrentRequest = false;
  if ([404, 405, 415, 501].includes(httpStatus)) {
    kind = "contract_mismatch";
    terminalForCurrentRequest = true;
    retry = "after_provider_or_connection_change";
    code = ({
      404: "MCP_ARTIFACT_REQUIRED_ENDPOINT_NOT_FOUND",
      405: "MCP_ARTIFACT_REQUIRED_METHOD_NOT_SUPPORTED",
      415: "MCP_ARTIFACT_ADVERTISED_MEDIA_TYPE_REJECTED",
      501: "MCP_ARTIFACT_REQUIRED_OPERATION_NOT_IMPLEMENTED",
    })[httpStatus];
  } else if ([401, 403].includes(httpStatus)) {
    kind = "authentication_failure";
    code = "MCP_ARTIFACT_AUTHENTICATION_FAILED";
    retry = "after_reauthentication";
  } else if ([408, 425, 429].includes(httpStatus) || httpStatus >= 500) {
    kind = "transient_provider_failure";
    code = "MCP_ARTIFACT_PROVIDER_TEMPORARILY_UNAVAILABLE";
    retry = "resume_with_same_artifact_after_provider_recovery";
  } else if (httpStatus === 409) {
    kind = "provider_state_conflict";
    code = "MCP_ARTIFACT_PROVIDER_STATE_CONFLICT";
    retry = "follow_provider_guidance_or_refresh_state";
  }
  return artifactFailureDetails({
    kind, code, terminalForCurrentRequest, retry, serverName, upload, step,
    method: request.method, path: request.path, httpStatus,
  });
}

function artifactContractFailure(serverName, upload, step, code, message, request = {}) {
  return artifactTransferError(message, artifactFailureDetails({
    kind: "contract_mismatch",
    code,
    terminalForCurrentRequest: true,
    retry: "after_provider_or_connection_change",
    serverName,
    upload,
    step,
    method: request.method ?? null,
    path: request.path ?? null,
  }));
}

const artifactUploadOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    contractVersion: { type: "integer", const: 1 },
    status: { type: "string", const: "success" },
    destination: {
      type: "object", additionalProperties: false,
      properties: {
        server_name: { type: "string", minLength: 1 },
        capability_id: { type: "string", minLength: 1 },
        transport_id: { type: "string", minLength: 1 },
      },
      required: ["server_name", "capability_id", "transport_id"],
    },
    file: {
      type: "object", additionalProperties: false,
      properties: { file_id: { type: "integer", minimum: 1 } },
      required: ["file_id"],
    },
    artifact: {
      type: "object", additionalProperties: false,
      properties: {
        artifact_id: { type: "string", minLength: 1, maxLength: 1024 },
        filename: { type: ["string", "null"] },
        mime_type: { type: "string", minLength: 1 },
        byte_size: { type: "integer", minimum: 0 },
        sha256: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      },
      required: ["artifact_id", "filename", "mime_type", "byte_size", "sha256"],
    },
    transfer: {
      type: "object", additionalProperties: false,
      properties: {
        client_request_id: { type: "string", minLength: 1, maxLength: 1024 },
        artifact_id: { type: "string", minLength: 1, maxLength: 1024 },
        resumed_from_offset: { type: "integer", minimum: 0 },
        chunks_sent: { type: "integer", minimum: 0 },
        bytes_sent_this_call: { type: "integer", minimum: 0 },
        total_bytes: { type: "integer", minimum: 0 },
      },
      required: [
        "client_request_id", "artifact_id", "resumed_from_offset", "chunks_sent",
        "bytes_sent_this_call", "total_bytes",
      ],
    },
  },
  required: ["contractVersion", "status", "destination", "file", "artifact", "transfer"],
};

function artifactUploadMetadata(tool) {
  const metadata = tool?._meta?.[artifactUploadMetadataKey];
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : null;
}

function schemaRequires(tool, fields) {
  const required = new Set(tool?.inputSchema?.required ?? []);
  const properties = tool?.inputSchema?.properties ?? {};
  return fields.every((field) => required.has(field) && Object.hasOwn(properties, field));
}

function schemaPropertyAcceptsString(tool, field) {
  const type = tool?.inputSchema?.properties?.[field]?.type;
  return type === "string" || (Array.isArray(type) && type.includes("string"));
}

function discoverArtifactUploads(tools) {
  const available = [];
  const problems = [];
  for (const tool of tools) {
    const metadata = artifactUploadMetadata(tool);
    if (!metadata) continue;
    const {
      contractVersion, transportId, endpointPath, acceptedMediaTypes,
      maximumChunkBytes, maximumBytes = null,
    } = metadata;
    const toolProblems = [];
    if (contractVersion !== artifactUploadContractVersion
      || typeof transportId !== "string" || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(transportId)
      || typeof endpointPath !== "string" || !/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,1000}$/.test(endpointPath)) {
      toolProblems.push(`invalid ${artifactUploadMetadataKey} identity or endpoint`);
    }
    if (!schemaRequires(tool, ["artifact_id"]) || !schemaPropertyAcceptsString(tool, "artifact_id")) {
      toolProblems.push("consumer tool must require artifact_id as a string");
    }
    if (!Array.isArray(acceptedMediaTypes) || acceptedMediaTypes.length === 0
      || acceptedMediaTypes.length > 32
      || acceptedMediaTypes.some((value) => (
        typeof value !== "string"
        || !/^(?:\*\/\*|[a-z0-9!#$&^_.+-]+\/(?:\*|[a-z0-9!#$&^_.+-]+))$/i.test(value.trim())
      ))) {
      toolProblems.push("metadata needs 1 to 32 valid acceptedMediaTypes");
    }
    if (!Number.isSafeInteger(maximumChunkBytes) || maximumChunkBytes < 1
      || maximumChunkBytes > maximumArtifactChunkBytes) {
      toolProblems.push(`maximumChunkBytes must be between 1 and ${maximumArtifactChunkBytes}`);
    }
    if (maximumBytes != null && (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)) {
      toolProblems.push("maximumBytes must be null or a positive integer");
    }
    if (toolProblems.length) {
      problems.push(`${tool.name}: ${toolProblems.join(", ")}`);
    } else {
      const normalizedMediaTypes = acceptedMediaTypes.map((value) => value.trim().toLowerCase());
      const contractFingerprint = createHash("sha256").update(JSON.stringify({
        contractVersion,
        consumerTool: tool.name,
        transportId,
        endpointPath,
        acceptedMediaTypes: normalizedMediaTypes,
        maximumChunkBytes,
        maximumBytes,
      })).digest("hex");
      available.push({
        consumerTool: tool,
        transportId,
        endpointPath,
        acceptedMediaTypes: normalizedMediaTypes,
        maximumChunkBytes,
        maximumBytes,
        contractFingerprint,
      });
    }
  }
  const transportCounts = new Map();
  for (const upload of available) {
    transportCounts.set(upload.transportId, (transportCounts.get(upload.transportId) ?? 0) + 1);
  }
  const duplicateTransports = new Set(
    [...transportCounts].filter(([, count]) => count > 1).map(([transportId]) => transportId),
  );
  for (const transportId of duplicateTransports) {
    problems.push(`duplicate artifact transportId: ${transportId}`);
  }
  return {
    available: available.filter(({ transportId }) => !duplicateTransports.has(transportId)),
    problems,
  };
}

function mimeTypeAccepted(mimeType, accepted) {
  const [family] = mimeType.split("/", 1);
  return accepted.includes("*/*") || accepted.includes(mimeType) || accepted.includes(`${family}/*`);
}

function normalizedSha256(value, label) {
  const digest = String(value ?? "").toLowerCase().replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error(`${label} did not return a valid SHA-256 digest`);
  return digest;
}

function requiredString(value, label, maximumLength = 1024) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is missing`);
  if (value.length > maximumLength) throw new Error(`${label} is too long`);
  return value;
}

async function boundedResponseText(response, label) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumArtifactResponseBytes) {
    throw new Error(`${label} returned an unexpectedly large response`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteCount = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > maximumArtifactResponseBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`${label} returned an unexpectedly large response`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`${label} returned a response that is not valid UTF-8`);
    throw error;
  }
}

async function jsonResponse(response, label, { optional = false } = {}) {
  const text = await boundedResponseText(response, label);
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  if (!text.trim()) {
    if (optional) return {};
    throw new Error(`${label} returned no JSON body`);
  }
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error(`${label} returned invalid JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned a non-object JSON body`);
  }
  return value;
}

function artifactStateTrace(value) {
  const selected = {};
  for (const field of [
    "artifact_id", "status", "next_offset", "file_name", "filename",
    "media_type", "mime_type", "byte_size", "sha256",
  ]) {
    if (!Object.hasOwn(value, field)) continue;
    const fieldValue = value[field];
    selected[field] = typeof fieldValue === "string" ? fieldValue.slice(0, 1024) : fieldValue;
  }
  return selected;
}

function artifactStatusComplete(value) {
  return ["complete", "completed", "success"].includes(String(value ?? "").toLowerCase());
}

const mcpResultMetadata = Symbol("mcpResultMetadata");

function normalizedContentItem(item) {
  if (!item || typeof item !== "object") return item;
  if (item.type === "text") return { type: "text", text: item.text };
  if (item.type === "resource" || item.type === "resource_link") return structuredClone(item);
  return {
    type: item.type,
    ...(item.name ? { name: item.name } : {}),
    ...(item.title ? { title: item.title } : {}),
    ...(item.uri ? { uri: item.uri } : {}),
    ...(item.mimeType ? { mimeType: item.mimeType } : {}),
    omittedBinaryData: Boolean(item.data),
  };
}

function resultContent(result) {
  const content = Array.isArray(result?.content) ? result.content.map(normalizedContentItem) : [];
  let value;
  if (result?.structuredContent != null) {
    const duplicateText = JSON.stringify(result.structuredContent);
    const supplemental = content.filter((item) => item.type !== "text" || item.text !== duplicateText);
    value = result.structuredContent && typeof result.structuredContent === "object"
      ? structuredClone(result.structuredContent)
      : result.structuredContent;
    if (supplemental.length) {
      value = value && typeof value === "object" && !Array.isArray(value)
        ? { ...value, mcpSupplementalContent: supplemental }
        : { structuredContent: value, mcpSupplementalContent: supplemental };
    }
  } else if (content.length) {
    value = content.map((item) => item.type === "text" ? item.text : item);
  } else {
    value = result;
  }
  if (value && typeof value === "object") {
    Object.defineProperty(value, mcpResultMetadata, {
      value: {
        meta: result?._meta ?? null,
        isError: result?.isError === true,
        contentTypes: content.map(({ type }) => type),
      },
      enumerable: false,
    });
  }
  return value;
}

export function mcpResultDetails(value) {
  return value && typeof value === "object" ? value[mcpResultMetadata] ?? null : null;
}

function boundedSummary(value, fallback, maximum = 600) {
  const text = String(value ?? "").replaceAll(/\s+/g, " ").trim();
  if (!text) return fallback;
  const sentence = text.match(/^.*?[.!?](?:\s|$)/u)?.[0]?.trim() ?? text;
  return sentence.length <= maximum ? sentence : `${sentence.slice(0, maximum - 1)}…`;
}

async function connectWithTimeout(client, transport, timeoutMs = 8000) {
  let timer;
  const connection = client.connect(transport);
  connection.catch(() => {});
  try {
    await Promise.race([
      connection,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`MCP connection exceeded ${timeoutMs} ms`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    await transport.close().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class McpToolManager {
  constructor({
    configPath,
    userConfigPath,
    environment = process.env,
    oauthRoot,
    publicUrl = "http://127.0.0.1:8787",
    authFn = auth,
    clientFactory = () => new Client({ name: "agent-slayer", version: "0.2.0" }),
    transportFactory = (url, options) => new StreamableHTTPClientTransport(url, options),
    oauthProviderFactory = (options) => new FileOAuthClientProvider(options),
    fetchFn,
    artifactSource = null,
    ledger = null,
  }) {
    this.configPath = configPath;
    this.userConfigPath = userConfigPath;
    this.environment = environment;
    this.oauthRoot = oauthRoot;
    this.publicUrl = publicUrl;
    this.authFn = authFn;
    this.clientFactory = clientFactory;
    this.transportFactory = transportFactory;
    this.oauthProviderFactory = oauthProviderFactory;
    this.fetchFn = fetchFn;
    this.artifactSource = artifactSource;
    this.ledger = ledger;
    this.connections = new Map();
    this.oauthProviders = new Map();
    this.registeredTools = new Set();
    this.serverTools = new Map();
    this.artifactContractFailures = new Map();
    this.states = {};
    this.servers = {};
    this.userServers = {};
    this.userServerNames = new Set();
    this.registry = null;
    this.refreshPromise = null;
  }

  async initialize(registry) {
    this.registry = registry;
    let config;
    try {
      config = JSON.parse(await fs.readFile(this.configPath, "utf8"));
    } catch (error) {
      this.states.configuration = {
        ready: false, required: true, error: error instanceof Error ? error.message : String(error),
      };
      return;
    }
    let userConfig = {};
    if (this.userConfigPath) {
      try {
        userConfig = JSON.parse(await fs.readFile(this.userConfigPath, "utf8"));
        if (!userConfig || typeof userConfig !== "object" || Array.isArray(userConfig)) {
          throw new Error("private MCP connection file must contain an object");
        }
        await fs.chmod(this.userConfigPath, 0o600);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          this.states.user_configuration = {
            ready: false, required: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        userConfig = {};
      }
    }
    this.userServers = Object.fromEntries(
      Object.entries(userConfig).filter(([serverName]) => !Object.hasOwn(config, serverName)),
    );
    this.userServerNames = new Set(Object.keys(this.userServers));
    this.servers = { ...config, ...this.userServers };

    for (const [serverName, server] of Object.entries(this.servers)) {
      if (server.enabled === false) {
        this.states[serverName] = {
          ready: false,
          disabled: true,
          required: false,
          oauth: server.oauth?.enabled !== false && Boolean(server.oauth),
          userManaged: this.userServerNames.has(serverName),
          url: server.url,
        };
        continue;
      }
      const required = server.required === true;
      const oauth = server.oauth?.enabled !== false && Boolean(server.oauth);
      try {
        let provider;
        if (oauth) {
          if (!this.oauthRoot) throw new Error("OAuth storage root is not configured");
          const redirectUrl = new URL(`/api/integrations/${encodeURIComponent(serverName)}/oauth/callback`, this.publicUrl);
          provider = this.oauthProviderFactory({
            serverName,
            storageRoot: this.oauthRoot,
            redirectUrl,
            scopes: server.oauth.scopes ?? [],
          });
          this.oauthProviders.set(serverName, provider);
          await provider.load?.();
          if (!await provider.tokens()) {
            this.states[serverName] = {
              ready: false, required, oauth: true, authorization: "required", url: server.url,
              userManaged: this.userServerNames.has(serverName),
            };
            continue;
          }
        }
        await this.connectServer(serverName, server, provider);
      } catch (error) {
        this.states[serverName] = {
          ready: false, required, oauth,
          userManaged: this.userServerNames.has(serverName),
          ...(error instanceof UnauthorizedError ? { authorization: "required" } : {}),
          url: server.url,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  async connectServer(serverName, server, provider) {
    const headers = Object.fromEntries(
      Object.entries(server.headers ?? {}).map(([name, value]) => [name, expandEnvironment(value, this.environment)]),
    );
    const options = {
      ...(Object.keys(headers).length ? { requestInit: { headers } } : {}),
      ...(provider ? { authProvider: provider } : {}),
      ...(this.fetchFn ? { fetch: this.fetchFn } : {}),
    };
    const transport = this.transportFactory(new URL(server.url), options);
    const client = this.clientFactory();
    try {
      await connectWithTimeout(client, transport, Number(server.connectTimeoutMs) || 8000);
      const response = await client.listTools();
      const allowed = server.includeTools ? new Set(server.includeTools) : null;
      const tools = response.tools.filter((tool) => !allowed || allowed.has(tool.name));
      const serverInfo = client.getServerVersion?.() ?? null;
      const serverInstructions = client.getInstructions?.() ?? null;
      this.registry.registerCapability({
        id: `integration:${serverName}`,
        title: serverInfo?.title || serverInfo?.name || serverName,
        summary: server.summary || boundedSummary(
          serverInstructions,
          `${serverInfo?.title || serverInfo?.name || serverName} connected MCP integration.`,
        ),
        aliases: [...new Set([
          serverName,
          serverInfo?.name,
          serverInfo?.title,
          ...(server.aliases ?? []),
        ].filter(Boolean))],
        guidance: serverInstructions || null,
        source: `mcp:${serverName}`,
      });
      const previousConnection = this.connections.get(serverName);
      if (previousConnection) {
        await Promise.allSettled([
          previousConnection.client.close(),
          previousConnection.transport?.close?.(),
        ]);
      }
      this.connections.set(serverName, {
        client, transport, headers, provider, serverUrl: new URL(server.url),
      });
      const artifactUploads = this.replaceServerTools(serverName, tools);
      for (const key of this.artifactContractFailures.keys()) {
        if (key.startsWith(`${serverName}\n`)) this.artifactContractFailures.delete(key);
      }
      this.states[serverName] = {
        ready: true,
        required: server.required === true,
        oauth: Boolean(provider),
        userManaged: this.userServerNames.has(serverName),
        ...(provider ? { authorization: "connected" } : {}),
        url: server.url,
        toolCount: tools.length,
        tools: tools.map((tool) => tool.name),
        server: serverInfo,
        instructionsAvailable: Boolean(serverInstructions),
        artifactUploads: artifactUploads.available,
        artifactUploadProblems: artifactUploads.problems,
      };
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
  }

  replaceServerTools(serverName, tools) {
    for (const modelName of this.serverTools.get(serverName) ?? []) {
      this.registry.unregister(modelName);
      this.registeredTools.delete(modelName);
    }
    this.serverTools.delete(serverName);
    const discovered = discoverArtifactUploads(tools);
    for (const tool of tools) this.registerRemoteTool(serverName, tool);
    const available = [];
    if (this.artifactSource) {
      for (const upload of discovered.available) {
        available.push(this.registerArtifactUpload(serverName, upload));
      }
    } else if (discovered.available.length) {
      discovered.problems.push("Agent file storage is unavailable for artifact transfer");
    }
    return { available, problems: discovered.problems };
  }

  rememberRegisteredTool(serverName, modelName) {
    this.registeredTools.add(modelName);
    const serverTools = this.serverTools.get(serverName) ?? new Set();
    serverTools.add(modelName);
    this.serverTools.set(serverName, serverTools);
  }

  registerRemoteTool(serverName, tool) {
    const modelName = remoteToolName(serverName, tool.name);
    if (this.registeredTools.has(modelName)) return;
    this.registry.register({
      name: modelName,
      title: tool.title ?? null,
      description: `[${serverName}] ${tool.description || tool.name}`,
      parameters: tool.inputSchema || { type: "object", additionalProperties: true },
      outputSchema: tool.outputSchema ?? null,
      annotations: tool.annotations ?? null,
      metadata: tool._meta ?? null,
      capabilityId: `integration:${serverName}`,
      strict: false,
      validateArguments: true,
      source: `mcp:${serverName}`,
      upstreamName: tool.name,
      execute: async (argumentsObject) => {
        const connection = this.connections.get(serverName);
        if (!connection) throw new Error(`${serverName} is not connected`);
        const result = await connection.client.callTool({ name: tool.name, arguments: argumentsObject });
        return resultContent(result);
      },
    });
    this.rememberRegisteredTool(serverName, modelName);
  }

  registerArtifactUpload(serverName, upload) {
    const modelName = remoteToolName(serverName, `upload_${upload.transportId}_file`);
    if (this.registeredTools.has(modelName)) return { transportId: upload.transportId, tool: modelName };
    const maximumDescription = upload.maximumBytes == null ? "provider-enforced" : upload.maximumBytes;
    this.registry.register({
      name: modelName,
      title: `Upload file to ${serverName}`,
      description: `[${serverName}] Upload one complete, verified, persisted file through the MCP's advertised resumable HTTP artifact receiver. Use this for data that originated as a file instead of reading or reproducing its records through the model. The application uses the integration's bearer token, resumes from the MCP-confirmed byte offset, and returns an opaque artifact ID. This does not run ${upload.consumerTool.name}; after upload, call that MCP tool with its other required arguments and the returned artifact_id. Accepted media types: ${upload.acceptedMediaTypes.join(", ")}. Maximum bytes: ${maximumDescription}.`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { file_id: { type: "integer", minimum: 1 } },
        required: ["file_id"],
      },
      outputSchema: artifactUploadOutputSchema,
      annotations: {
        readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true,
      },
      metadata: {
        [toolDescriptionMetadataKey]: defineToolDescription({
          summary: `Upload one complete verified durable file to ${serverName}'s advertised artifact receiver. This transfers bytes but does not invoke the provider's consuming tool.`,
          actionClasses: ["EXECUTE"],
          effectClassifications: ["MUTATING", "EXTERNAL"],
        }),
        [artifactUploadMetadataKey]: {
          contractVersion: artifactUploadContractVersion,
          transportId: upload.transportId,
          endpointPath: upload.endpointPath,
          acceptedMediaTypes: upload.acceptedMediaTypes,
          maximumChunkBytes: upload.maximumChunkBytes,
          maximumBytes: upload.maximumBytes,
          consumerTool: upload.consumerTool.name,
        },
      },
      capabilityId: `integration:${serverName}`,
      strict: true,
      validateArguments: true,
      source: `mcp:${serverName}`,
      execute: (argumentsObject, context) => this.uploadArtifact(
        serverName, upload, argumentsObject.file_id, context,
      ),
    });
    this.rememberRegisteredTool(serverName, modelName);
    return { transportId: upload.transportId, tool: modelName };
  }

  appendArtifactEvent(serverName, role, toolName, status, context, fileId, payload, error = null) {
    this.ledger?.append?.({
      type: `mcp.artifact.${role}`,
      phase: "point",
      status,
      actorType: "service",
      actorName: toolName,
      source: `mcp:${serverName}`,
      channel: context?.channel,
      turnId: context?.requestId,
      operationId: context?.callId,
      name: `${role} persisted file transfer through ${serverName}`,
      primaryFileId: fileId,
      subjectType: "file",
      subjectId: String(fileId),
      payload,
      error,
    });
  }

  async artifactAuthorization(serverName, upload) {
    const connection = this.connections.get(serverName);
    if (!connection) throw new Error(`${serverName} is not connected`);
    const configured = Object.entries(connection.headers ?? {})
      .find(([name]) => name.toLowerCase() === "authorization")?.[1];
    if (configured) {
      if (!/^Bearer\s+\S+/i.test(configured)) {
        throw artifactTransferError(
          `${serverName} artifact upload requires bearer authorization`,
          artifactFailureDetails({
            kind: "authentication_failure",
            code: "MCP_ARTIFACT_BEARER_TOKEN_REQUIRED",
            terminalForCurrentRequest: false,
            retry: "after_reauthentication",
            serverName,
            upload,
            step: "authorization",
          }),
        );
      }
      return configured;
    }
    const tokens = await connection.provider?.tokens?.();
    if (tokens?.access_token) return `Bearer ${tokens.access_token}`;
    throw artifactTransferError(
      `${serverName} artifact upload requires the integration's bearer token`,
      artifactFailureDetails({
        kind: "authentication_failure",
        code: "MCP_ARTIFACT_BEARER_TOKEN_REQUIRED",
        terminalForCurrentRequest: false,
        retry: "after_reauthentication",
        serverName,
        upload,
        step: "authorization",
      }),
    );
  }

  async artifactHttp(serverName, upload, role, url, options, context, fileId, traceRequest, { optionalJson = false } = {}) {
    const fetchFn = this.fetchFn ?? globalThis.fetch;
    let response;
    try {
      response = await fetchFn(url, { redirect: "error", ...options });
    } catch (error) {
      const toolFailure = artifactFailureDetails({
        kind: "transport_failure",
        code: "MCP_ARTIFACT_TRANSPORT_UNAVAILABLE",
        terminalForCurrentRequest: false,
        retry: "resume_with_same_artifact_after_connection_recovery",
        serverName,
        upload,
        step: role,
        method: traceRequest.method,
        path: traceRequest.path,
      });
      this.appendArtifactEvent(serverName, role, "MCP artifact HTTP", "error", context, fileId, {
        request: traceRequest,
        toolFailure,
      }, `${serverName} artifact ${role} transport failed`);
      throw artifactTransferError(`${serverName} artifact ${role} transport failed`, toolFailure);
    }
    if (!response.ok) {
      await boundedResponseText(response, `${serverName} artifact ${role}`).catch(() => "");
      const toolFailure = artifactHttpFailure(serverName, upload, role, traceRequest, response.status);
      const message = `${serverName} artifact ${role} returned HTTP ${response.status}`;
      this.appendArtifactEvent(serverName, role, "MCP artifact HTTP", "error", context, fileId, {
        request: traceRequest,
        response: { status: response.status, uploadOffset: response.headers.get("upload-offset") },
        toolFailure,
      }, message);
      throw artifactTransferError(message, toolFailure);
    }
    let result;
    try {
      result = await jsonResponse(response, `${serverName} artifact ${role}`, { optional: optionalJson });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const toolFailure = artifactFailureDetails({
        kind: "contract_mismatch",
        code: "MCP_ARTIFACT_INVALID_RESPONSE",
        terminalForCurrentRequest: true,
        retry: "after_provider_or_connection_change",
        serverName,
        upload,
        step: role,
        method: traceRequest.method,
        path: traceRequest.path,
        httpStatus: response.status,
      });
      this.appendArtifactEvent(serverName, role, "MCP artifact HTTP", "error", context, fileId, {
        request: traceRequest,
        response: { status: response.status, uploadOffset: response.headers.get("upload-offset") },
        toolFailure,
      }, message);
      throw artifactTransferError(message, toolFailure);
    }
    this.appendArtifactEvent(serverName, role, "MCP artifact HTTP", "complete", context, fileId, {
      request: traceRequest,
      response: {
        status: response.status,
        uploadOffset: response.headers.get("upload-offset"),
        body: artifactStateTrace(result),
      },
    });
    return { response, result };
  }

  async uploadArtifact(serverName, upload, fileId, context = {}) {
    const failureKey = artifactFailureKey(serverName, upload);
    const rememberedFailure = this.artifactContractFailures.get(failureKey);
    if (rememberedFailure) {
      const toolFailure = {
        ...rememberedFailure,
        code: "MCP_ARTIFACT_CONTRACT_BLOCKED_UNTIL_REFRESH",
      };
      throw artifactTransferError(
        `${serverName} artifact transfer remains blocked until the integration is refreshed after a provider change`,
        toolFailure,
      );
    }
    const opened = await this.artifactSource.open(fileId);
    try {
      const { descriptor } = opened;
      if (!mimeTypeAccepted(descriptor.mimeType, upload.acceptedMediaTypes)) {
        throw requestError(`${serverName} does not accept ${descriptor.mimeType} artifacts`, 415);
      }
      if (upload.maximumBytes != null && descriptor.byteSize > upload.maximumBytes) {
        throw requestError(`${serverName} accepts artifacts no larger than ${upload.maximumBytes} bytes`, 413);
      }
      const connection = this.connections.get(serverName);
      if (!connection) throw new Error(`${serverName} is not connected`);
      const authorization = await this.artifactAuthorization(serverName, upload);
      const endpoint = new URL(upload.endpointPath, connection.serverUrl.origin);
      if (endpoint.origin !== connection.serverUrl.origin) {
        throw new Error(`${serverName} artifact endpoint must use the MCP server origin`);
      }
      const clientRequestId = `agent-slayer:${descriptor.sha256}`;
      const beginBody = {
        client_request_id: clientRequestId,
        file_name: descriptor.filename,
        media_type: descriptor.mimeType,
        byte_size: descriptor.byteSize,
        sha256: descriptor.sha256,
      };
      const beginRequest = { method: "POST", path: endpoint.pathname, body: beginBody };
      const begin = await this.artifactHttp(serverName, upload, "begin", endpoint, {
        method: "POST",
        headers: { Authorization: authorization, "Content-Type": "application/json" },
        body: JSON.stringify(beginBody),
      }, context, fileId, beginRequest);
      let artifactId;
      try {
        artifactId = requiredString(begin.result.artifact_id, "artifact begin artifact_id");
      } catch (error) {
        throw artifactContractFailure(
          serverName, upload, "begin", "MCP_ARTIFACT_INVALID_ARTIFACT_ID",
          error instanceof Error ? error.message : String(error), beginRequest,
        );
      }
      const artifactUrl = new URL(`${upload.endpointPath.replace(/\/$/, "")}/${encodeURIComponent(artifactId)}`, connection.serverUrl.origin);
      const resumeRequest = { method: "GET", path: artifactUrl.pathname };
      const resume = await this.artifactHttp(serverName, upload, "resume", artifactUrl, {
        method: "GET",
        headers: { Authorization: authorization },
      }, context, fileId, resumeRequest);
      if (resume.result.artifact_id !== artifactId) {
        throw artifactContractFailure(
          serverName, upload, "resume", "MCP_ARTIFACT_IDENTITY_MISMATCH",
          `${serverName} artifact resume did not report the expected artifact_id`, resumeRequest,
        );
      }
      const nextOffset = Number(resume.result.next_offset);
      if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 || nextOffset > descriptor.byteSize) {
        throw artifactContractFailure(
          serverName, upload, "resume", "MCP_ARTIFACT_INVALID_OFFSET",
          `${serverName} artifact resume returned an invalid next_offset`, resumeRequest,
        );
      }
      const chunkSize = Math.min(upload.maximumChunkBytes, maximumArtifactChunkBytes);
      const resumedFromOffset = nextOffset;
      let offset = nextOffset;
      let chunksSent = 0;
      let bytesSentThisCall = 0;
      while (offset < descriptor.byteSize) {
        const bytes = await opened.read(offset, chunkSize);
        if (bytes.length === 0) throw new Error(`File ${fileId} ended before transfer completed`);
        const chunkDigest = createHash("sha256").update(bytes).digest("hex");
        const chunkRequest = {
          method: "PATCH",
          path: artifactUrl.pathname,
          offset,
          byte_size: bytes.length,
          chunk_sha256: chunkDigest,
        };
        const chunk = await this.artifactHttp(serverName, upload, "chunk", artifactUrl, {
          method: "PATCH",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/octet-stream",
            "Upload-Offset": String(offset),
            "X-Content-SHA256": chunkDigest,
          },
          body: bytes,
        }, context, fileId, chunkRequest, { optionalJson: true });
        const confirmedOffset = Number(chunk.response.headers.get("upload-offset") ?? chunk.result.next_offset);
        const expectedOffset = offset + bytes.length;
        if (!Number.isSafeInteger(confirmedOffset) || confirmedOffset !== expectedOffset) {
          throw artifactContractFailure(
            serverName, upload, "chunk", "MCP_ARTIFACT_OFFSET_CONFIRMATION_MISMATCH",
            `${serverName} artifact upload did not confirm the exact byte range`, chunkRequest,
          );
        }
        offset = confirmedOffset;
        chunksSent += 1;
        bytesSentThisCall += bytes.length;
      }
      const alreadyComplete = offset === descriptor.byteSize && artifactStatusComplete(resume.result.status);
      if (!alreadyComplete) {
        const completeUrl = new URL(`${artifactUrl.pathname}/complete`, connection.serverUrl.origin);
        await this.artifactHttp(serverName, upload, "complete", completeUrl, {
          method: "POST",
          headers: { Authorization: authorization },
        }, context, fileId, { method: "POST", path: completeUrl.pathname }, { optionalJson: true });
      }
      const verifyRequest = { method: "GET", path: artifactUrl.pathname };
      const finalState = await this.artifactHttp(serverName, upload, "verify", artifactUrl, {
        method: "GET",
        headers: { Authorization: authorization },
      }, context, fileId, verifyRequest);
      const finish = finalState.result;
      if (finish.artifact_id !== artifactId) {
        throw artifactContractFailure(
          serverName, upload, "verify", "MCP_ARTIFACT_IDENTITY_MISMATCH",
          `${serverName} artifact completion did not report the expected artifact_id`, verifyRequest,
        );
      }
      if (!artifactStatusComplete(finish.status)) {
        throw artifactContractFailure(
          serverName, upload, "verify", "MCP_ARTIFACT_INCOMPLETE_FINAL_STATUS",
          `${serverName} artifact completion did not report a terminal complete status`, verifyRequest,
        );
      }
      if (Number(finish.next_offset) !== descriptor.byteSize) {
        throw artifactContractFailure(
          serverName, upload, "verify", "MCP_ARTIFACT_FINAL_OFFSET_MISMATCH",
          `${serverName} artifact completion did not confirm the complete byte range`, verifyRequest,
        );
      }
      let providerDigest;
      try {
        providerDigest = normalizedSha256(finish.sha256, `${serverName} artifact completion sha256`);
      } catch (error) {
        throw artifactContractFailure(
          serverName, upload, "verify", "MCP_ARTIFACT_INVALID_FINAL_DIGEST",
          error instanceof Error ? error.message : String(error), verifyRequest,
        );
      }
      if (providerDigest !== descriptor.sha256) {
        throw artifactContractFailure(
          serverName, upload, "verify", "MCP_ARTIFACT_FINAL_DIGEST_MISMATCH",
          `${serverName} artifact completion returned a checksum that does not match file ${fileId}`, verifyRequest,
        );
      }
      if (Number(finish.byte_size) !== descriptor.byteSize) {
        throw artifactContractFailure(
          serverName, upload, "verify", "MCP_ARTIFACT_FINAL_SIZE_MISMATCH",
          `${serverName} artifact completion returned a byte size that does not match file ${fileId}`, verifyRequest,
        );
      }
      if (String(finish.media_type ?? finish.mime_type ?? "").toLowerCase() !== descriptor.mimeType) {
        throw artifactContractFailure(
          serverName, upload, "verify", "MCP_ARTIFACT_FINAL_MEDIA_TYPE_MISMATCH",
          `${serverName} artifact completion returned a media type that does not match file ${fileId}`, verifyRequest,
        );
      }
      return {
        contractVersion: artifactUploadContractVersion,
        status: "success",
        destination: {
          server_name: serverName,
          capability_id: `integration:${serverName}`,
          transport_id: upload.transportId,
        },
        file: descriptor.file,
        artifact: {
          artifact_id: artifactId,
          filename: descriptor.filename,
          mime_type: descriptor.mimeType,
          byte_size: descriptor.byteSize,
          sha256: `sha256:${descriptor.sha256}`,
        },
        transfer: {
          client_request_id: clientRequestId,
          artifact_id: artifactId,
          resumed_from_offset: resumedFromOffset,
          chunks_sent: chunksSent,
          bytes_sent_this_call: bytesSentThisCall,
          total_bytes: descriptor.byteSize,
        },
      };
    } catch (error) {
      if (error?.toolFailure?.kind === "contract_mismatch") {
        this.artifactContractFailures.set(failureKey, structuredClone(error.toolFailure));
      }
      throw error;
    } finally {
      await opened.close().catch(() => {});
    }
  }

  async beginOAuth(serverName) {
    const server = this.servers[serverName];
    const provider = this.oauthProviders.get(serverName);
    if (!server || server.enabled === false) throw new Error(`Unknown enabled integration: ${serverName}`);
    if (!provider) throw new Error(`${serverName} is not configured for OAuth`);
    await provider.beginAuthorization();
    const result = await this.authFn(provider, {
      serverUrl: server.url,
      scope: (server.oauth.scopes ?? []).join(" ") || undefined,
      ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}),
    });
    if (result !== "REDIRECT") throw new Error(`${serverName} did not start an interactive OAuth authorization`);
    const authorizationUrl = await provider.authorizationUrl();
    if (!authorizationUrl) throw new Error(`${serverName} did not provide an OAuth authorization URL`);
    this.states[serverName] = {
      ready: false, required: server.required === true, oauth: true,
      userManaged: false,
      authorization: "pending", url: server.url,
    };
    return { serverName, authorizationUrl };
  }

  async finishOAuth(serverName, { code, state }) {
    const server = this.servers[serverName];
    const provider = this.oauthProviders.get(serverName);
    if (!server || !provider) throw new Error(`Unknown OAuth integration: ${serverName}`);
    if (!code) throw new Error("OAuth callback did not include an authorization code");
    await provider.assertState(state);
    const result = await this.authFn(provider, {
      serverUrl: server.url,
      authorizationCode: code,
      scope: (server.oauth.scopes ?? []).join(" ") || undefined,
      ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}),
    });
    if (result !== "AUTHORIZED") throw new Error(`${serverName} OAuth token exchange did not complete`);
    await provider.completeAuthorization();
    try {
      await this.connectServer(serverName, server, provider);
    } catch (error) {
      this.states[serverName] = {
        ready: false, required: server.required === true, oauth: true,
        userManaged: false,
        authorization: "connected", url: server.url,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
    return this.states[serverName];
  }

  async disconnectOAuth(serverName) {
    const server = this.servers[serverName];
    const provider = this.oauthProviders.get(serverName);
    if (!server || !provider) throw new Error(`Unknown OAuth integration: ${serverName}`);

    await this.disconnectServer(serverName);
    await provider.invalidateCredentials("all");
    this.states[serverName] = {
      ready: false,
      required: server.required === true,
      oauth: true,
      authorization: "required",
      url: server.url,
      userManaged: false,
    };
    return this.states[serverName];
  }

  async disconnectServer(serverName) {
    const connection = this.connections.get(serverName);
    this.connections.delete(serverName);
    if (connection) {
      await Promise.allSettled([connection.client.close(), connection.transport?.close?.()]);
    }
    for (const modelName of this.serverTools.get(serverName) ?? []) {
      this.registry.unregister(modelName);
      this.registeredTools.delete(modelName);
    }
    this.serverTools.delete(serverName);
  }

  async refreshTools() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.refreshToolsFromServers();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async refreshToolsFromServers() {
    const entries = await Promise.all(Object.entries(this.servers).map(async ([serverName, server]) => {
      if (server.enabled === false) return [serverName, { refreshed: false, skipped: "disabled" }];
      let provider;
      try {
        provider = this.oauthProviders.get(serverName);
        if (server.oauth?.enabled !== false && server.oauth && (!provider || !await provider.tokens())) {
          return [serverName, { refreshed: false, skipped: "authorization required" }];
        }
        await this.connectServer(serverName, server, provider);
        return [serverName, {
          refreshed: true,
          toolCount: this.states[serverName].toolCount,
          tools: this.states[serverName].tools,
        }];
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const previous = this.states[serverName] ?? {
          ready: false,
          required: server.required === true,
          oauth: Boolean(provider),
          userManaged: this.userServerNames.has(serverName),
          url: server.url,
        };
        this.states[serverName] = this.connections.has(serverName)
          ? { ...previous, refreshError: message }
          : { ...previous, ready: false, error: message, refreshError: message };
        return [serverName, { refreshed: false, error: message }];
      }
    }));
    return Object.fromEntries(entries);
  }

  async saveUserServers() {
    if (!this.userConfigPath) throw new Error("Private MCP connection storage is not configured");
    const directory = path.dirname(this.userConfigPath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const temporary = `${this.userConfigPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(this.userServers, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, this.userConfigPath);
      await fs.chmod(this.userConfigPath, 0o600);
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async addBearerIntegration(input = {}) {
    const serverName = userIntegrationName(input.name);
    if (serverName === "email") throw requestError("The connection name email is reserved", 409);
    if (Object.hasOwn(this.servers, serverName)) throw requestError(`An integration named ${serverName} already exists`, 409);
    const url = userIntegrationUrl(input.url);
    const token = String(input.token ?? "").trim();
    if (!token) throw requestError("API token is required");
    if (token.length > 16 * 1024) throw requestError("API token is too long");
    const server = {
      enabled: true,
      required: false,
      url,
      headers: { Authorization: `Bearer ${token}` },
    };
    this.servers[serverName] = server;
    this.userServers[serverName] = server;
    this.userServerNames.add(serverName);
    try {
      await this.connectServer(serverName, server);
      await this.saveUserServers();
      return this.states[serverName];
    } catch (error) {
      await this.disconnectServer(serverName);
      delete this.servers[serverName];
      delete this.userServers[serverName];
      this.userServerNames.delete(serverName);
      delete this.states[serverName];
      throw error;
    }
  }

  async removeUserIntegration(serverName) {
    if (!this.userServerNames.has(serverName)) throw requestError(`Unknown UI-managed integration: ${serverName}`, 404);
    await this.disconnectServer(serverName);
    delete this.servers[serverName];
    delete this.userServers[serverName];
    this.userServerNames.delete(serverName);
    delete this.states[serverName];
    await this.saveUserServers();
    return { ready: false, removed: true, userManaged: true };
  }

  requiredProblem() {
    const [name, state] = Object.entries(this.states).find(([, candidate]) => candidate.required && !candidate.ready) ?? [];
    if (!name) return null;
    if (state.authorization === "required" || state.authorization === "pending") {
      return `${name} OAuth authorization is ${state.authorization}`;
    }
    return `${name} integration is unavailable${state.error ? `: ${state.error}` : ""}`;
  }

  ready() {
    return this.requiredProblem() == null;
  }

  health() {
    const failuresByServer = new Map();
    for (const failure of this.artifactContractFailures.values()) {
      const failures = failuresByServer.get(failure.serverName) ?? [];
      failures.push(failure);
      failuresByServer.set(failure.serverName, failures);
    }
    return Object.fromEntries(Object.entries(this.states).map(([serverName, state]) => [
      serverName,
      {
        ...state,
        artifactContractFailures: failuresByServer.get(serverName) ?? [],
      },
    ]));
  }

  async close() {
    await Promise.allSettled([...this.connections.values()].map(({ client }) => client.close()));
    this.connections.clear();
  }
}
