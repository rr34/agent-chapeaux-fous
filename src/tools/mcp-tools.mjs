import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FileOAuthClientProvider } from "../mcp-oauth.mjs";

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
    this.connections = new Map();
    this.oauthProviders = new Map();
    this.registeredTools = new Set();
    this.serverTools = new Map();
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
      this.connections.set(serverName, { client, transport });
      this.replaceServerTools(serverName, tools);
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
    for (const tool of tools) this.registerRemoteTool(serverName, tool);
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
      source: `mcp:${serverName}`,
      upstreamName: tool.name,
      execute: async (argumentsObject) => {
        const connection = this.connections.get(serverName);
        if (!connection) throw new Error(`${serverName} is not connected`);
        const result = await connection.client.callTool({ name: tool.name, arguments: argumentsObject });
        return resultContent(result);
      },
    });
    this.registeredTools.add(modelName);
    const serverTools = this.serverTools.get(serverName) ?? new Set();
    serverTools.add(modelName);
    this.serverTools.set(serverName, serverTools);
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
    return this.states;
  }

  async close() {
    await Promise.allSettled([...this.connections.values()].map(({ client }) => client.close()));
    this.connections.clear();
  }
}
