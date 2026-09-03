import assert from "node:assert/strict";
import test from "node:test";
import {
  orientationInstructions,
  parseStructuredModelOutput,
  turnBriefSchema,
} from "../src/turn-brief.mjs";

function validBrief() {
  const sourced = { text: "Create the offered reminder.", sourceEventSeqs: [4, 9] };
  return {
    contractVersion: 1,
    requestType: "confirmation",
    responseMode: "act",
    objective: "Create the offered reminder.",
    summary: "The current request accepts the prior offer.",
    requiredCapabilities: ["todos"],
    requiredTools: ["todo_create"],
    confirmedActionReferenceIds: [],
    contextRequests: [],
    receiptReferences: [],
    temporalResolutions: [],
    requestedActions: [sourced],
    prohibitedActions: [],
    deferredActions: [],
    constraints: [],
    unresolvedQuestions: [],
    completionCriteria: ["A successful creation receipt exists."],
    evidence: [sourced],
    audit: { required: true, reasons: ["The request confirms a write."] },
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
  unsourced.requestedActions[0].sourceEventSeqs = [];
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

  const unconfirmedReference = validBrief();
  unconfirmedReference.confirmedActionReferenceIds = ["prepared-change:not-visible"];
  assert.throws(
    () => parseStructuredModelOutput(JSON.stringify(unconfirmedReference), schema, "Orientation"),
    /confirmedActionReferenceIds has too many items/,
  );

  const referenceSchema = turnBriefSchema(["todos"], ["prepared-change:visible"], [], ["todo_create"]);
  const confirmedReference = validBrief();
  confirmedReference.confirmedActionReferenceIds = ["prepared-change:visible"];
  assert.deepEqual(
    parseStructuredModelOutput(JSON.stringify(confirmedReference), referenceSchema, "Orientation"),
    confirmedReference,
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

  const receiptSchema = turnBriefSchema(
    ["todos", "database"],
    [],
    [],
    ["todo_create", "tool_receipt_read"],
    [{ receiptEventSeq: 42, tool: "todo_create" }],
  );
  const withReceipt = validBrief();
  withReceipt.requiredCapabilities = ["todos", "database"];
  withReceipt.requiredTools = ["tool_receipt_read"];
  withReceipt.receiptReferences = [{
    receiptEventSeq: 42,
    tool: "todo_create",
    reason: "Recover the exact prior creation result.",
  }];
  assert.deepEqual(
    parseStructuredModelOutput(JSON.stringify(withReceipt), receiptSchema, "Orientation"),
    withReceipt,
  );
  withReceipt.receiptReferences[0].receiptEventSeq = 43;
  assert.throws(
    () => parseStructuredModelOutput(JSON.stringify(withReceipt), receiptSchema, "Orientation"),
    /receiptEventSeq must be one of 42/,
  );
});

test("orientation treats conversation and focused knowledge as evidence for an actual answer", () => {
  assert.match(orientationInstructions, /exact recent conversation entries as evidence/);
  assert.match(orientationInstructions, /leave requiredTools empty/);
  assert.match(orientationInstructions, /focused knowledge tool supplies evidence, not final wording/);
  assert.match(orientationInstructions, /answering the user's actual question/);
  assert.match(orientationInstructions, /immediately preceding assistant question or active exchange/);
  assert.match(orientationInstructions, /never invent omitted units/);
});
