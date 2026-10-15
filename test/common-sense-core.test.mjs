import assert from "node:assert/strict";
import test from "node:test";
import {
  commonSenseContext,
  commonSenseCoreSchema,
  commonSenseInstructions,
  coreTargetRefs,
  parseStructuredModelOutput,
} from "../src/common-sense-core.mjs";

function validCore() {
  return {
    version: 1,
    mode: "act",
    objective: "Complete the three selected to-dos.",
    conversationSummary: "The user selected three to-dos and wants all of them completed.",
    actions: [{
      instruction: "Complete all three selected to-dos.",
      targetRefs: [
        "agent-slayer://todos/7",
        "agent-slayer://todos/8",
        "agent-slayer://todos/9",
      ],
    }],
    constraints: [],
    questions: [],
    capabilities: ["todos"],
    contextRequests: [],
    confirmedActionReferenceIds: [],
    temporalResolutions: [],
  };
}

test("the common-sense core is compact, batch-shaped, and contains no tool planning", () => {
  const schema = commonSenseCoreSchema({
    capabilities: ["todos", "calendar"],
    objectRefs: [
      "agent-slayer://todos/7",
      "agent-slayer://todos/8",
      "agent-slayer://todos/9",
    ],
  });
  const value = validCore();
  assert.deepEqual(parseStructuredModelOutput(JSON.stringify(value), schema, "Orientation"), value);
  assert.deepEqual(coreTargetRefs(value), value.actions[0].targetRefs);
  assert.equal(Object.hasOwn(schema.properties, "requiredTools"), false);
  assert.equal(Object.hasOwn(schema.properties, "audit"), false);
  assert.equal(Object.hasOwn(schema.properties, "conversationState"), false);
  assert.equal(Object.hasOwn(schema.properties, "completionCriteria"), false);
});

test("the core rejects unavailable capability families, context views, and object references", () => {
  const schema = commonSenseCoreSchema({
    capabilities: ["todos"],
    contextViewIds: ["todos.active_groups"],
    objectRefs: [
      "agent-slayer://todos/7",
      "agent-slayer://todos/8",
      "agent-slayer://todos/9",
    ],
  });
  const wrongCapability = validCore();
  wrongCapability.capabilities = ["calendar"];
  assert.throws(
    () => parseStructuredModelOutput(JSON.stringify(wrongCapability), schema, "Orientation"),
    /capabilities\[0\] must be one of/,
  );

  const wrongContext = validCore();
  wrongContext.contextRequests = ["contacts.active_tags"];
  assert.throws(
    () => parseStructuredModelOutput(JSON.stringify(wrongContext), schema, "Orientation"),
    /contextRequests\[0\] must be one of/,
  );

  const wrongObject = validCore();
  wrongObject.actions[0].targetRefs = ["agent-slayer://todos/10"];
  assert.throws(
    () => parseStructuredModelOutput(JSON.stringify(wrongObject), schema, "Orientation"),
    /targetRefs\[0\] must be one of/,
  );
});

test("orientation contains families and selections but no exact tool catalog", () => {
  const context = commonSenseContext({
    requestId: "request-1",
    requestEventSeq: 9,
    requestText: "Complete these.",
    recentConversation: [],
    capabilityCatalog: [{
      capability: "todos",
      title: "To-dos",
      summary: "Read and manage personal to-dos.",
      tools: [{ name: "todo_complete_batch", summary: "Complete many to-dos." }],
      contextViews: [],
    }],
    selectedObjectCandidates: [{
      mention: "@Task 7 — To-do #7",
      type: "todos.personal_task",
      source: "native:todos",
      id: 7,
      ref: "agent-slayer://todos/7",
      display: "Task 7",
    }],
  });
  assert.match(context, /Exact current request/);
  assert.match(context, /agent-slayer:\/\/todos\/7/);
  assert.match(context, /todos \(To-dos\)/);
  assert.doesNotMatch(context, /todo_complete_batch/);
  assert.match(commonSenseInstructions, /common-sense orientation/i);
});

test("orientation omits empty sections and serializes calendar evidence", () => {
  const context = commonSenseContext({
    requestId: "request-2",
    requestEventSeq: 10,
    requestText: "Move it tomorrow.",
    recentConversation: [],
    capabilityCatalog: [{
      capability: "calendar", title: "Calendar", summary: "Manage calendar events.",
      tools: [], contextViews: [],
    }],
    localCalendar: { today: "2026-10-14", tomorrow: "2026-10-15" },
  });
  assert.doesNotMatch(context, /Explicit composer selections/);
  assert.doesNotMatch(context, /Exact previously verified object references/);
  assert.doesNotMatch(context, /Explicitly invoked roles/);
  assert.doesNotMatch(context, /\[object Object\]/);
  assert.match(context, /"tomorrow": "2026-10-15"/);
});
