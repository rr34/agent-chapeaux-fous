import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { FileOAuthClientProvider } from "../src/mcp-oauth.mjs";
import { McpToolManager, remoteToolName } from "../src/tools/mcp-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

test("remote application tools use provider-neutral names", () => {
  const name = remoteToolName("weather", "openmeteo_search_locations");
  assert.equal(name, "remote_weather_openmeteo_search_locations");
  assert.equal(name.startsWith("mcp__"), false);
  assert.match(name, /^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
});

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-oauth-test-"));
  return { directory, cleanup: () => fs.rmSync(directory, { recursive: true, force: true }) };
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
