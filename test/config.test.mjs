import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfig, repositoryRoot } from "../src/config.mjs";

test("the default Codex workspace cannot inherit repository instructions", () => {
  const config = loadConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    XDG_STATE_HOME: "/tmp/agent-slayer-state-test",
  });
  assert.equal(config.codexWorkDirectory, "/tmp/agent-slayer-state-test/agent-slayer/codex-workspace");
  assert.equal(config.codexWorkDirectory.startsWith(`${repositoryRoot}${path.sep}`), false);
});

test("an explicitly configured Codex workspace inside the repository is rejected", () => {
  assert.throws(
    () => loadConfig({
      SLAYER_ALLOW_UNAUTHENTICATED: "true",
      SLAYER_CODEX_WORKDIR: "data/codex-workspace",
    }),
    /must be outside the Agent Slayer repository/,
  );
});

test("the public URL controls browser OAuth callbacks", () => {
  const config = loadConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    SLAYER_PUBLIC_URL: "https://slayer.example.test",
    XDG_STATE_HOME: "/tmp/agent-slayer-state-test",
  });
  assert.equal(config.publicUrl, "https://slayer.example.test/");
  assert.equal(config.mcpOAuthRoot, "/tmp/agent-slayer-state-test/agent-slayer/mcp-oauth");
});

test("the public URL rejects credentials and non-HTTP schemes", () => {
  assert.throws(
    () => loadConfig({ SLAYER_ALLOW_UNAUTHENTICATED: "true", SLAYER_PUBLIC_URL: "file:///tmp/slayer" }),
    /must be an HTTPS origin/,
  );
  assert.throws(
    () => loadConfig({ SLAYER_ALLOW_UNAUTHENTICATED: "true", SLAYER_PUBLIC_URL: "https://user:secret@example.test" }),
    /must be an HTTPS origin/,
  );
  assert.throws(
    () => loadConfig({ SLAYER_ALLOW_UNAUTHENTICATED: "true", SLAYER_PUBLIC_URL: "http://slayer.example.test" }),
    /must be an HTTPS origin/,
  );
});

test("Nutrition selects generic MCP OAuth without a static access token", () => {
  const integrations = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "config", "mcp-servers.json"), "utf8"));
  assert.deepEqual(integrations.nutrition.oauth, { enabled: true, scopes: [] });
  assert.equal(integrations.nutrition.headers, undefined);

  const environmentExample = fs.readFileSync(path.join(repositoryRoot, ".env.example"), "utf8");
  assert.doesNotMatch(environmentExample, /NUTRITION_ACCESS_TOKEN/);
});

test("native JMAP email configuration is independent of MCP", () => {
  const config = loadConfig({
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
  const defaults = loadConfig({ SLAYER_ALLOW_UNAUTHENTICATED: "true" });
  assert.equal(defaults.maxTextAttachmentBytes, 10 * 1024 * 1024);
  assert.equal(defaults.maxAttachmentContextCharacters, 64 * 1024);
  const configured = loadConfig({
    SLAYER_ALLOW_UNAUTHENTICATED: "true",
    SLAYER_MAX_TEXT_ATTACHMENT_BYTES: "8192",
    SLAYER_MAX_ATTACHMENT_CONTEXT_CHARACTERS: "4096",
  });
  assert.equal(configured.maxTextAttachmentBytes, 8192);
  assert.equal(configured.maxAttachmentContextCharacters, 4096);
});
