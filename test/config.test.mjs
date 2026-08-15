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
