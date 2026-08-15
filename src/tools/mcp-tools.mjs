import fs from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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
  constructor({ configPath, environment = process.env }) {
    this.configPath = configPath;
    this.environment = environment;
    this.connections = new Map();
    this.states = {};
  }

  async initialize(registry) {
    let config;
    try {
      config = JSON.parse(await fs.readFile(this.configPath, "utf8"));
    } catch (error) {
      this.states.configuration = { ready: false, error: error instanceof Error ? error.message : String(error) };
      return;
    }

    for (const [serverName, server] of Object.entries(config)) {
      if (server.enabled === false) {
        this.states[serverName] = { ready: false, disabled: true };
        continue;
      }
      try {
        const headers = Object.fromEntries(
          Object.entries(server.headers ?? {}).map(([name, value]) => [name, expandEnvironment(value, this.environment)]),
        );
        const transport = new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers },
        });
        const client = new Client({ name: "agent-slayer", version: "0.1.0" });
        await connectWithTimeout(client, transport, Number(server.connectTimeoutMs) || 8000);
        const response = await client.listTools();
        const allowed = server.includeTools ? new Set(server.includeTools) : null;
        const tools = response.tools.filter((tool) => !allowed || allowed.has(tool.name));
        for (const tool of tools) {
          const modelName = safeName(`mcp__${serverName}__${tool.name}`);
          registry.register({
            name: modelName,
            description: `[${serverName}] ${tool.description || tool.name}`,
            parameters: tool.inputSchema || { type: "object", additionalProperties: true },
            strict: false,
            source: `mcp:${serverName}`,
            async execute(argumentsObject) {
              const result = await client.callTool({ name: tool.name, arguments: argumentsObject });
              if (result.isError) throw new Error(JSON.stringify(resultContent(result)));
              return resultContent(result);
            },
          });
        }
        this.connections.set(serverName, { client, transport });
        this.states[serverName] = { ready: true, url: server.url, toolCount: tools.length, tools: tools.map((tool) => tool.name) };
      } catch (error) {
        this.states[serverName] = {
          ready: false,
          url: server.url,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  health() {
    return this.states;
  }

  async close() {
    await Promise.allSettled([...this.connections.values()].map(({ client }) => client.close()));
    this.connections.clear();
  }
}
