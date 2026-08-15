import fs from "node:fs/promises";
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

export function remoteToolName(serverName, toolName) {
  // `mcp__` is a runtime-owned namespace in Codex App Server, not an
  // application tool prefix. Source metadata already records that this tool
  // came from MCP, so expose a provider-neutral application name instead.
  return safeName(`remote_${serverName}_${toolName}`);
}

function resultContent(result) {
  if (result?.structuredContent != null) return result.structuredContent;
  if (!Array.isArray(result?.content)) return result;
  return result.content.map((item) => {
    if (item.type === "text") return item.text;
    if (item.type === "resource") return item.resource;
    return { type: item.type, mimeType: item.mimeType, omittedBinaryData: Boolean(item.data) };
  });
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
    this.states = {};
    this.servers = {};
    this.registry = null;
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
    this.servers = config;

    for (const [serverName, server] of Object.entries(config)) {
      if (server.enabled === false) {
        this.states[serverName] = { ready: false, disabled: true, required: false };
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
            };
            continue;
          }
        }
        await this.connectServer(serverName, server, provider);
      } catch (error) {
        this.states[serverName] = {
          ready: false, required, oauth,
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
      await this.connections.get(serverName)?.client.close().catch(() => {});
      this.connections.set(serverName, { client, transport });
      for (const tool of tools) this.registerRemoteTool(serverName, tool);
      this.states[serverName] = {
        ready: true,
        required: server.required === true,
        oauth: Boolean(provider),
        ...(provider ? { authorization: "connected" } : {}),
        url: server.url,
        toolCount: tools.length,
        tools: tools.map((tool) => tool.name),
      };
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
  }

  registerRemoteTool(serverName, tool) {
    const modelName = remoteToolName(serverName, tool.name);
    if (this.registeredTools.has(modelName)) return;
    this.registry.register({
      name: modelName,
      description: `[${serverName}] ${tool.description || tool.name}`,
      parameters: tool.inputSchema || { type: "object", additionalProperties: true },
      strict: false,
      source: `mcp:${serverName}`,
      upstreamName: tool.name,
      execute: async (argumentsObject) => {
        const connection = this.connections.get(serverName);
        if (!connection) throw new Error(`${serverName} is not connected`);
        const result = await connection.client.callTool({ name: tool.name, arguments: argumentsObject });
        if (result.isError) throw new Error(JSON.stringify(resultContent(result)));
        return resultContent(result);
      },
    });
    this.registeredTools.add(modelName);
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
        authorization: "connected", url: server.url,
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
    return this.states[serverName];
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
