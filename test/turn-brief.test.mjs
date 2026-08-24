import assert from "node:assert/strict";
import test from "node:test";
import { parseStructuredModelOutput, turnBriefSchema } from "../src/turn-brief.mjs";

function validBrief() {
  const sourced = { text: "Create the offered reminder.", sourceEventSeqs: [4, 9] };
  return {
    contractVersion: 1,
    requestType: "authorization",
    responseMode: "act",
    objective: "Create the offered reminder.",
    summary: "The current request accepts the prior offer.",
    requiredCapabilities: ["todos"],
    authorizedActions: [sourced],
    prohibitedActions: [],
    deferredActions: [],
    constraints: [],
    unresolvedQuestions: [],
    completionCriteria: ["A successful creation receipt exists."],
    evidence: [sourced],
    audit: { required: true, reasons: ["The request authorizes a write."] },
    conversationState: {
      activeObjective: "Create the offered reminder.",
      openCommitments: [sourced],
      durableConstraints: [],
      unresolvedQuestions: [],
      relevantRequestIds: ["request-current"],
    },
  };
}

test("TurnBrief parsing enforces source references and unique capability selection", () => {
  const schema = turnBriefSchema(["todos", "calendar"]);
  const value = validBrief();
  assert.deepEqual(parseStructuredModelOutput(JSON.stringify(value), schema, "Orientation"), value);

  const unsourced = validBrief();
  unsourced.authorizedActions[0].sourceEventSeqs = [];
  assert.throws(
    () => parseStructuredModelOutput(JSON.stringify(unsourced), schema, "Orientation"),
    /sourceEventSeqs has too few items/,
  );

  const duplicateCapabilities = validBrief();
  duplicateCapabilities.requiredCapabilities = ["todos", "todos"];
  assert.throws(
    () => parseStructuredModelOutput(JSON.stringify(duplicateCapabilities), schema, "Orientation"),
    /requiredCapabilities must contain unique items/,
  );
});
