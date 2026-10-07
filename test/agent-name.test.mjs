import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_NAME, canonicalizeAgentName } from "../src/agent-name.mjs";

test("input-only aliases are canonicalized at the final response boundary", () => {
  assert.equal(AGENT_NAME, "Time V3 Agent");
  assert.equal(
    canonicalizeAgentName("Chapofu, SHAPOFU, Chapo fu, and Chapeau Faux are me."),
    "Time V3 Agent, Time V3 Agent, Time V3 Agent, and Time V3 Agent are me.",
  );
  assert.equal(canonicalizeAgentName("Chapeaux Fous was the old name."), "Time V3 Agent was the old name.");
  assert.equal(canonicalizeAgentName("Time V3 Agent is my name."), "Time V3 Agent is my name.");
});
