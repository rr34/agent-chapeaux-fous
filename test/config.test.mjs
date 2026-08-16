import assert from "node:assert/strict";
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

test("inspection credentials are separate from full-access credentials", () => {
  const config = loadConfig({
    SLAYER_ACCESS_TOKEN: "full-secret",
    SLAYER_INSPECT_TOKEN: "inspect-secret",
    XDG_STATE_HOME: "/tmp/agent-slayer-state-test",
  });
  assert.equal(config.accessToken, "full-secret");
  assert.equal(config.inspectToken, "inspect-secret");
  assert.throws(
    () => loadConfig({ SLAYER_ACCESS_TOKEN: "same-secret", SLAYER_INSPECT_TOKEN: "same-secret" }),
    /must be different/,
  );
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
