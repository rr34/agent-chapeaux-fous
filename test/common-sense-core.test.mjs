import assert from "node:assert/strict";
import test from "node:test";
import {
  auditContext,
  auditInstructions,
  commonSenseContext,
  commonSenseCoreSchema,
  commonSenseExecutionInstructions,
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
      targetSetRefs: [],
      relationshipSetRefs: [],
      unresolvedTargets: [],
    }],
    objectSets: [],
    relationshipSets: [],
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
  assert.match(schema.properties.mode.description, /act only when.*mutation/i);
});

test("read-only work is answer mode and current receipts can correct factual premises", () => {
  assert.match(commonSenseInstructions, /answer for read-only retrieval/i);
  assert.match(commonSenseInstructions, /rejects an object the agent just created by mistake/i);
  assert.match(commonSenseExecutionInstructions(validCore(), []), /Tool results are authoritative for current facts/);
  assert.match(commonSenseExecutionInstructions(validCore(), []), /successful owning-domain read is sufficient evidence/);
  assert.match(commonSenseExecutionInstructions(validCore(), []), /nested dot paths/);
  assert.match(commonSenseExecutionInstructions(validCore(), []), /never fabricate missing records/i);
  const audit = auditContext({
    core: validCore(), receipts: [], executorResponse: "There are 63 current records.",
  });
  assert.match(audit, /receipts are authoritative for current facts/i);
  assert.match(auditInstructions, /factual premises about current data/i);
  assert.match(auditInstructions, /preserve exact bound sets/i);
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
    availableObjectReferences: [{
      mention: "Earlier to-do results",
      role: "subject",
      type: "todos.personal_task",
      source: "native:todos",
      objects: [{ id: 8, ref: "agent-slayer://todos/8", display: "Task 8" }],
      sourceEventSeqs: [8],
    }],
  });
  assert.match(context, /Exact current request/);
  assert.match(context, /agent-slayer:\/\/todos\/7/);
  assert.match(context, /todos \(To-dos\)/);
  assert.match(context, /available identity evidence, not a target list/i);
  assert.match(context, /never copy the whole group/i);
  assert.doesNotMatch(context, /todo_complete_batch/);
  assert.match(commonSenseInstructions, /common-sense orientation/i);
  assert.match(commonSenseInstructions, /not proof that every member is a current target/i);
});

test("orientation and execution preserve exact selected recurring occurrences", () => {
  const selectedObjectCandidates = ["2026-10-21T20:15:00.000Z", "2026-10-28T20:15:00.000Z"]
    .map((occurrenceStartsAtUtc) => ({
      mention: "@Vince Art Class", type: "calendar.event", source: "native:calendar",
      id: 2948, ref: "agent-slayer://calendar-events/2948", display: "Vince Art Class",
      occurrenceStartsAtUtc,
    }));
  const orientation = commonSenseContext({
    requestId: "request-occurrences",
    requestEventSeq: 9,
    requestText: "Move these to Thursday.",
    recentConversation: [],
    capabilityCatalog: [{
      capability: "calendar", title: "Calendar", summary: "Manage calendar events.",
      tools: [], contextViews: [],
    }],
    selectedObjectCandidates,
  });
  assert.match(orientation, /2026-10-21T20:15:00\.000Z/u);
  assert.match(orientation, /2026-10-28T20:15:00\.000Z/u);
  assert.match(orientation, /one-occurrence rather than whole-series scope/u);

  const execution = commonSenseExecutionInstructions(
    validCore(), [], [], [], selectedObjectCandidates,
  );
  assert.match(execution, /Exact selected calendar occurrences/u);
  assert.match(execution, /several entries share one recurring-master ref/u);
  assert.match(execution, /2026-10-28T20:15:00\.000Z/u);

  const audit = auditContext({
    core: validCore(), receipts: [], executorResponse: "Done.",
    selectedObjectCandidates,
  });
  assert.match(audit, /Exact selected calendar occurrences/u);
  assert.match(audit, /2026-10-21T20:15:00\.000Z/u);
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

test("the core can define and select exact relationship sets from supplied objects", () => {
  const requestId = "request-links";
  const relationshipRef = `agent-slayer://requests/${requestId}/relationship-sets/task-contacts`;
  const schema = commonSenseCoreSchema({
    requestId,
    capabilities: ["todos", "contacts"],
    objectRefs: ["agent-slayer://todos/7", "agent-slayer://contacts/70"],
  });
  const value = {
    ...validCore(),
    objective: "Link the task to its matching contact.",
    capabilities: ["todos", "contacts"],
    actions: [{
      instruction: "Apply the exact task-to-contact pairing.",
      targetRefs: [],
      targetSetRefs: [],
      relationshipSetRefs: [relationshipRef],
      unresolvedTargets: [],
    }],
    relationshipSets: [{
      ref: relationshipRef,
      display: "Task and matching contact",
      relationshipType: "todos.related_contact",
      fromType: "todos.personal_task",
      toType: "contacts.contact",
      edges: [{
        fromRef: "agent-slayer://todos/7",
        toRef: "agent-slayer://contacts/70",
      }],
    }],
  };
  assert.deepEqual(parseStructuredModelOutput(JSON.stringify(value), schema, "Orientation"), value);
});
