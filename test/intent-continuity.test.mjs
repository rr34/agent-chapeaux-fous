import assert from "node:assert/strict";
import test from "node:test";
import {
  intentOutcomeFindings,
  intentPreflightProblems,
  matchIntentOutcomes,
  matchingIntentOutcomeRefs,
} from "../src/intent-continuity.mjs";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { registerJournalTools } from "../src/tools/journal-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

function semanticCore({ basis = "request", targetRefs = [] } = {}) {
  return {
    actions: [{
      actionId: "create_requested_result",
      outcomes: [{
        outcomeId: "requested_result",
        description: "One requested result containing all six supplied details.",
        targetRefs,
        cardinality: { minimum: 1, maximum: 1, basis },
      }],
    }],
  };
}

function createDefinition(name, objectType, batch = "singleton") {
  return {
    name,
    capability: {
      resources: [{
        id: objectType,
        kind: "object",
        operations: {
          create: { available: true, tool: name, batch },
        },
      }],
    },
  };
}

function references(type, prefix, ...ids) {
  return [{
    type,
    source: `native:${prefix}`,
    objects: ids.map((id) => ({ id, ref: `agent-slayer://${prefix}/${id}`, display: `Object ${id}` })),
  }];
}

const todoDefinition = () => createDefinition("todo_add", "todos.personal_task");
const taskReferences = (...ids) => references("todos.personal_task", "todos", ...ids);

test("semantic one-result intent rejects homogeneous singleton-create fan-out", () => {
  const calls = Array.from({ length: 6 }, (_, index) => ({
    callId: `call-${index + 1}`,
    tool: "todo_add",
    arguments: { text: `Detail ${index + 1}`, todo_group_id: 10 },
  }));
  const problems = intentPreflightProblems({
    core: semanticCore(),
    calls,
    toolDefinitions: new Map([["todo_add", todoDefinition()]]),
  });
  assert.equal(problems.length, 6);
  assert.deepEqual(new Set(problems.map(({ code }) => code)), new Set([
    "INTENT_OUTCOME_CREATE_OVERSHOOT",
  ]));
  assert.match(problems[0].message, /semantic outcomes allow at most 1 created object/i);
  assert.match(problems[0].message, /todos\.personal_task create count/u);
});

test("inferred outcome structure remains advisory and does not reject calls", () => {
  const problems = intentPreflightProblems({
    core: semanticCore({ basis: "inferred" }),
    calls: [{ callId: "call-1", tool: "todo_add", arguments: {} }, {
      callId: "call-2", tool: "todo_add", arguments: {},
    }],
    toolDefinitions: new Map([["todo_add", todoDefinition()]]),
  });
  assert.deepEqual(problems, []);
});

test("mixed execution representations are not rejected from untyped orientation intent", () => {
  const contactDefinition = createDefinition("contact_import", "contacts.contact", "array");
  const problems = intentPreflightProblems({
    core: semanticCore(),
    calls: [
      { callId: "task", tool: "todo_add", arguments: {} },
      { callId: "contact", tool: "contact_import", arguments: {} },
    ],
    toolDefinitions: new Map([
      ["todo_add", todoDefinition()],
      ["contact_import", contactDefinition],
    ]),
  });
  assert.deepEqual(problems, []);
});

test("owning create contract and receipt bind representation after orientation", () => {
  const core = semanticCore();
  const match = matchIntentOutcomes(core, taskReferences(463), todoDefinition());
  assert.deepEqual(match, {
    outcomeRefs: ["create_requested_result.requested_result"],
    bindings: [{
      outcomeRef: "create_requested_result.requested_result",
      objectType: "todos.personal_task",
    }],
  });
  assert.deepEqual(
    matchingIntentOutcomeRefs(core, taskReferences(463), todoDefinition()),
    ["create_requested_result.requested_result"],
  );

  const registry = { get: () => ({ annotations: { readOnlyHint: false } }) };
  const receipt = {
    ok: true,
    tool: "todo_add",
    objectReferences: taskReferences(463),
    intentOutcomeRefs: match.outcomeRefs,
    intentOutcomeBindings: match.bindings,
  };
  assert.deepEqual(intentOutcomeFindings({ core, receipts: [receipt], registry }), []);

  const excessive = intentOutcomeFindings({
    core,
    receipts: [{
      ...receipt,
      objectReferences: taskReferences(463, 464, 465, 466, 467, 468),
    }],
    registry,
  });
  assert.equal(excessive.length, 1);
  assert.equal(excessive[0].observed, 6);
  assert.equal(excessive[0].objectType, "todos.personal_task");
  assert.equal(excessive[0].code, "INTENT_OUTCOME_EVIDENCE_EXCESS");
});

test("exact supplied targets bind by verified reference without an orientation resource type", () => {
  const ref = "agent-slayer://todos/463";
  const core = semanticCore({ targetRefs: [ref] });
  assert.deepEqual(matchIntentOutcomes(core, taskReferences(463), null), {
    outcomeRefs: ["create_requested_result.requested_result"],
    bindings: [{
      outcomeRef: "create_requested_result.requested_result",
      objectType: "todos.personal_task",
    }],
  });
});

test("one homogeneous batch outcome accepts its exact distinct object count", () => {
  const core = {
    actions: [{
      actionId: "record_measurements",
      outcomes: [{
        outcomeId: "entries",
        description: "The separate requested measurements.",
        targetRefs: [],
        cardinality: { minimum: 2, maximum: 2, basis: "request" },
      }],
    }],
  };
  const outcomeRef = "record_measurements.entries";
  const receipts = [236, 237].map((id) => ({
    ok: true,
    tool: "journal_add",
    objectReferences: references("journal.entry", "journal-entries", id),
    intentOutcomeRefs: [outcomeRef],
    intentOutcomeBindings: [{ outcomeRef, objectType: "journal.entry" }],
  }));
  assert.deepEqual(intentOutcomeFindings({
    core,
    receipts,
    registry: { get: () => ({ annotations: { readOnlyHint: false } }) },
  }), []);
});

test("journal_add binds its returned entry rather than its surrounding tracker and group", () => {
  const core = {
    actions: [{
      actionId: "record_measurements",
      outcomes: [{
        outcomeId: "entries",
        description: "The two requested journal entries.",
        targetRefs: [],
        cardinality: { minimum: 2, maximum: 2, basis: "request" },
      }],
    }],
  };
  const registry = registerNativeCapabilities(new ToolRegistry());
  registerJournalTools(
    registry,
    { requireReady() { throw new Error("The binding test must not access the database"); } },
    { append() { throw new Error("The binding test must not write to the ledger"); } },
  );
  const definition = registry.toolDefinitions().find(({ name }) => name === "journal_add");
  assert.ok(definition);
  const outcomeRef = "record_measurements.entries";
  const receipts = [245, 246].map((entryId, index) => {
    const objectReferences = [
      ...references("journal.group", "journal-groups", 3),
      ...references("journal.tracker", "journal-trackers", index === 0 ? 10 : 12),
      ...references("journal.entry", "journal-entries", entryId),
    ];
    const match = matchIntentOutcomes(core, objectReferences, definition);
    assert.deepEqual(match, {
      outcomeRefs: [outcomeRef],
      bindings: [{ outcomeRef, objectType: "journal.entry" }],
    });
    return {
      ok: true,
      tool: "journal_add",
      objectReferences,
      intentOutcomeRefs: match.outcomeRefs,
      intentOutcomeBindings: match.bindings,
    };
  });
  assert.deepEqual(intentOutcomeFindings({
    core,
    receipts,
    registry,
  }), []);
});

test("multiple unbound semantic outcomes defer correspondence to audit", () => {
  const core = {
    actions: ["first", "second"].map((name) => ({
      actionId: `create_${name}`,
      outcomes: [{
        outcomeId: "result",
        description: `The ${name} independently requested result.`,
        targetRefs: [],
        cardinality: { minimum: 1, maximum: 1, basis: "request" },
      }],
    })),
  };
  const objectReferences = taskReferences(463, 464);
  assert.deepEqual(matchIntentOutcomes(core, objectReferences, todoDefinition()), {
    outcomeRefs: [], bindings: [],
  });
  const findings = intentOutcomeFindings({
    core,
    receipts: [{ ok: true, tool: "todo_add", objectReferences }],
    registry: { get: () => ({ annotations: { readOnlyHint: false } }) },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "INTENT_OUTCOME_EVIDENCE_AMBIGUOUS");
});

test("inferred outcomes never compete with request-established execution binding", () => {
  const core = {
    actions: [{
      actionId: "resolve_people",
      outcomes: [{
        outcomeId: "prediction",
        description: "An advisory possible result.",
        targetRefs: [],
        cardinality: { minimum: 1, maximum: 1, basis: "inferred" },
      }, {
        outcomeId: "people",
        description: "The fourteen requested people.",
        targetRefs: [],
        cardinality: { minimum: 14, maximum: 14, basis: "request" },
      }],
    }],
  };
  const definition = createDefinition("contact_import", "contacts.contact", "array");
  const imported = references(
    "contacts.contact",
    "contacts",
    ...Array.from({ length: 14 }, (_, index) => 1600 + index),
  );
  assert.deepEqual(matchIntentOutcomes(core, imported, definition), {
    outcomeRefs: ["resolve_people.people"],
    bindings: [{ outcomeRef: "resolve_people.people", objectType: "contacts.contact" }],
  });
});

test("missing mechanical correlation remains an audit question", () => {
  const core = semanticCore();
  const findings = intentOutcomeFindings({
    core,
    receipts: [{ ok: true, tool: "todo_add", objectReferences: [] }],
    registry: { get: () => ({ annotations: { readOnlyHint: false } }) },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "INTENT_OUTCOME_EVIDENCE_INCOMPLETE");
  assert.equal(findings[0].observed, 0);
  assert.match(findings[0].message, /not proof that the requested work failed/i);
});
