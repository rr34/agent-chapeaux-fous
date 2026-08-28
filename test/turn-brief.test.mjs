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
    requiredTools: ["todo_create"],
    authorizedActionReferenceIds: [],
    contextRequests: [],
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
  const schema = turnBriefSchema(["todos", "calendar"], [], [], ["todo_create"]);
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

  const unavailableTool = validBrief();
  unavailableTool.requiredTools = ["calendar_event_create"];
  assert.throws(
    () => parseStructuredModelOutput(JSON.stringify(unavailableTool), schema, "Orientation"),
    /requiredTools\[0\] must be one of/,
  );

  const unauthorizedReference = validBrief();
  unauthorizedReference.authorizedActionReferenceIds = ["mcp-action:not-visible"];
  assert.throws(
    () => parseStructuredModelOutput(JSON.stringify(unauthorizedReference), schema, "Orientation"),
    /authorizedActionReferenceIds has too many items/,
  );

  const referenceSchema = turnBriefSchema(["todos"], ["mcp-action:visible"], [], ["todo_create"]);
  const authorizedReference = validBrief();
  authorizedReference.authorizedActionReferenceIds = ["mcp-action:visible"];
  assert.deepEqual(
    parseStructuredModelOutput(JSON.stringify(authorizedReference), referenceSchema, "Orientation"),
    authorizedReference,
  );

  const contextSchema = turnBriefSchema(
    ["todos", "contacts"],
    [],
    ["todos.active_groups", "contacts.active_tags"],
    ["todo_create"],
  );
  const contextual = validBrief();
  contextual.contextRequests = ["todos.active_groups"];
  assert.deepEqual(
    parseStructuredModelOutput(JSON.stringify(contextual), contextSchema, "Orientation"),
    contextual,
  );
  contextual.contextRequests = ["contacts.unknown_view"];
  assert.throws(
    () => parseStructuredModelOutput(JSON.stringify(contextual), contextSchema, "Orientation"),
    /contextRequests\[0\] must be one of/,
  );
});
