import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_NAME, canonicalizeAgentName } from "../src/agent-name.mjs";

test("input-only aliases are canonicalized at the final response boundary", () => {
  assert.equal(AGENT_NAME, "Chapeaux Fous");
  assert.equal(
    canonicalizeAgentName("Chapofu, SHAPOFU, Chapo fu, and Chapeau Faux are me."),
    "Chapeaux Fous, Chapeaux Fous, Chapeaux Fous, and Chapeaux Fous are me.",
  );
  assert.equal(canonicalizeAgentName("Chapeaux Fous is my name."), "Chapeaux Fous is my name.");
});
