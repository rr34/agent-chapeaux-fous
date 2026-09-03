import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfig, repositoryRoot } from "../src/config.mjs";

const databaseEnvironment = {
  MARIADB_ENGINE: "mariadb",
  MARIADB_HOST: "localhost",
  MARIADB_NAME: "chapeauxfous",
  MARIADB_USER: "cfr_user",
  MARIADB_PASSWORD: "temporary",
};

function loadTestConfig(environment = {}) {
  return loadConfig({ ...databaseEnvironment, ...environment });
}

test("OpenAI Responses configuration has stable defaults", () => {
  const config = loadTestConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    XDG_STATE_HOME: "/tmp/agent-slayer-state-test",
  });
  assert.equal(config.openAIBaseUrl, "https://api.openai.com/v1");
  assert.equal(config.openAIImageDetail, "original");
  assert.equal(config.reasoningEffort, "high");
  assert.equal(config.orientationReasoningEffort, "medium");
  assert.equal(config.auditReasoningEffort, "low");
  assert.equal(config.repairReasoningEffort, "high");
  assert.equal(config.turnWorkflowEnabled, true);
  assert.deepEqual(config.aiPricing, {
    inputPerMillion: 2,
    cachedInputPerMillion: 0.2,
    cacheWritePerMillion: 2.5,
    outputPerMillion: 12,
  });
  assert.equal(config.hatCatalogPath, path.join(repositoryRoot, "config", "hats.json"));
  assert.deepEqual(config.databaseTarget, {
    engine: "mariadb",
    connection: {
      host: "localhost",
      port: 3306,
      socketPath: undefined,
      user: "cfr_user",
      password: "temporary",
      database: "chapeauxfous",
    },
  });
});

test("MariaDB runtime configuration is explicit and bounded", () => {
  const config = loadTestConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    MARIADB_HOST: "db.internal",
    MARIADB_PORT: "3307",
    MARIADB_NAME: "chapeauxfous",
    MARIADB_USER: "cfr_user",
    MARIADB_PASSWORD: "temporary",
  });
  assert.deepEqual(config.databaseTarget, {
    engine: "mariadb",
    connection: {
      host: "db.internal",
      port: 3307,
      socketPath: undefined,
      user: "cfr_user",
      password: "temporary",
      database: "chapeauxfous",
    },
  });
  assert.throws(() => loadTestConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    MARIADB_NAME: "bad-name",
    MARIADB_USER: "cfr_user",
    MARIADB_PASSWORD: "temporary",
  }), /valid MariaDB database name/);
});

test("legacy SLAYER_DATABASE variables are not accepted", () => {
  assert.throws(() => loadConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    SLAYER_DATABASE_NAME: "chapeauxfous",
    SLAYER_DATABASE_USER: "cfr_user",
    SLAYER_DATABASE_PASSWORD: "temporary",
  }), /MARIADB_ENGINE must be mariadb/);
});

test("turn workflow reasoning effort is independently configurable by phase", () => {
  const config = loadTestConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    SLAYER_REASONING_EFFORT: "xhigh",
    SLAYER_ORIENTATION_REASONING_EFFORT: "low",
    SLAYER_AUDIT_REASONING_EFFORT: "medium",
    SLAYER_REPAIR_REASONING_EFFORT: "high",
    SLAYER_TURN_WORKFLOW_ENABLED: "false",
  });
  assert.equal(config.reasoningEffort, "xhigh");
  assert.equal(config.orientationReasoningEffort, "low");
  assert.equal(config.auditReasoningEffort, "medium");
  assert.equal(config.repairReasoningEffort, "high");
  assert.equal(config.turnWorkflowEnabled, false);
});

test("the public URL controls browser OAuth callbacks", () => {
  const config = loadTestConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    SLAYER_PUBLIC_URL: "https://slayer.example.test",
    XDG_STATE_HOME: "/tmp/agent-slayer-state-test",
  });
  assert.equal(config.publicUrl, "https://slayer.example.test/");
  assert.equal(config.mcpOAuthRoot, "/tmp/agent-slayer-state-test/agent-slayer/mcp-oauth");
  assert.equal(config.mcpUserConfigPath, "/tmp/agent-slayer-state-test/agent-slayer/mcp-connections.json");
});

test("the public URL rejects credentials and non-HTTP schemes", () => {
  assert.throws(
    () => loadTestConfig({ SLAYER_ALLOW_UNAUTHENTICATED: "true", SLAYER_PUBLIC_URL: "file:///tmp/slayer" }),
    /must be an HTTPS origin/,
  );
  assert.throws(
    () => loadTestConfig({ SLAYER_ALLOW_UNAUTHENTICATED: "true", SLAYER_PUBLIC_URL: "https://user:secret@example.test" }),
    /must be an HTTPS origin/,
  );
  assert.throws(
    () => loadTestConfig({ SLAYER_ALLOW_UNAUTHENTICATED: "true", SLAYER_PUBLIC_URL: "http://slayer.example.test" }),
    /must be an HTTPS origin/,
  );
});

test("native JMAP email configuration is independent of MCP", () => {
  const config = loadTestConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    SLAYER_JMAP_SESSION_URL: "https://mail.example.test/jmap/session",
    SLAYER_JMAP_ACCESS_TOKEN: "jmap-secret",
    SLAYER_JMAP_ACCOUNT_ID: "account1",
    SLAYER_JMAP_REQUIRED: "true",
    SLAYER_JMAP_TIMEOUT_MS: "9000",
  });
  assert.equal(config.jmapSessionUrl, "https://mail.example.test/jmap/session");
  assert.equal(config.jmapAccessToken, "jmap-secret");
  assert.equal(config.jmapAccountId, "account1");
  assert.equal(config.jmapRequired, true);
  assert.equal(config.jmapTimeoutMs, 9000);

  const integrations = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config", "mcp-servers.json"), "utf8"));
  assert.equal(integrations.fastmail, undefined);
});

test("text request attachments have a separate bounded upload limit", () => {
  const defaults = loadTestConfig({ SLAYER_ALLOW_UNAUTHENTICATED: "true" });
  assert.equal(defaults.maxToolCalls, 128);
  assert.equal(defaults.contextRolloverPercent, 65);
  assert.equal(defaults.conversationCheckpointCharacters, 48 * 1024);
  assert.equal(defaults.maxInlineToolResultCharacters, 32 * 1024);
  assert.equal(defaults.maxTextAttachmentBytes, 10 * 1024 * 1024);
  assert.equal(defaults.maxRequestAttachmentBytes, 50 * 1024 * 1024);
  assert.equal(defaults.maxAttachmentContextCharacters, 64 * 1024);
  const configured = loadTestConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    SLAYER_MAX_TEXT_ATTACHMENT_BYTES: "8192",
    SLAYER_MAX_REQUEST_ATTACHMENT_BYTES: "67108864",
    SLAYER_MAX_ATTACHMENT_CONTEXT_CHARACTERS: "4096",
  });
  assert.equal(configured.maxTextAttachmentBytes, 8192);
  assert.equal(configured.maxRequestAttachmentBytes, 67108864);
  assert.equal(configured.maxAttachmentContextCharacters, 4096);
});

test("context rollover and inline result limits are configurable", () => {
  const configured = loadTestConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    SLAYER_CONTEXT_ROLLOVER_PERCENT: "72.5",
    SLAYER_CONVERSATION_CHECKPOINT_CHARACTERS: "24000",
    SLAYER_MAX_INLINE_TOOL_RESULT_CHARACTERS: "12000",
  });
  assert.equal(configured.contextRolloverPercent, 72.5);
  assert.equal(configured.conversationCheckpointCharacters, 24000);
  assert.equal(configured.maxInlineToolResultCharacters, 12000);
});

test("explicit page reads have bounded network limits", () => {
  const defaults = loadTestConfig({ SLAYER_ALLOW_UNAUTHENTICATED: "true" });
  assert.equal(defaults.webPageTimeoutMs, 15_000);
  assert.equal(defaults.webPageMaximumBytes, 2 * 1024 * 1024);
  const configured = loadTestConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    SLAYER_WEB_PAGE_TIMEOUT_MS: "9000",
    SLAYER_WEB_PAGE_MAX_BYTES: "524288",
  });
  assert.equal(configured.webPageTimeoutMs, 9000);
  assert.equal(configured.webPageMaximumBytes, 524288);
});
