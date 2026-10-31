import assert from "node:assert/strict";
import test from "node:test";
import {
  intentOutcomeFindings,
  intentPreflightProblems,
  matchingIntentOutcomeRefs,
} from "../src/intent-continuity.mjs";

function watchJobCore({ basis = "request" } = {}) {
  return {
    actions: [{
      actionId: "create_watch_job",
      outcomeObjects: [{
        outcomeId: "watch_job",
        description: "One watch job containing all six listed watches and their service notes.",
        objectType: "todos.personal_task",
        targetRefs: [],
        cardinality: { minimum: 1, maximum: 1, basis },
      }],
    }],
  };
}

function todoAddDefinition() {
  return {
    name: "todo_add",
    capability: {
      resources: [{
        id: "todos.personal_task",
        kind: "object",
        operations: {
          create: { available: true, tool: "todo_add", batch: "singleton" },
        },
      }],
    },
  };
}

function taskReferences(...ids) {
  return [{
    type: "todos.personal_task",
    source: "native:todos",
    objects: ids.map((id) => ({ id, ref: `agent-slayer://todos/${id}`, display: `Task ${id}` })),
  }];
}

test("explicit one-object outcomes reject sibling singleton fan-out before execution", () => {
  const calls = Array.from({ length: 6 }, (_, index) => ({
    callId: `call-${index + 1}`,
    tool: "todo_add",
    arguments: { text: `Watch ${index + 1}`, todo_group_id: 10 },
  }));
  const problems = intentPreflightProblems({
    core: watchJobCore(),
    calls,
    toolDefinitions: new Map([["todo_add", todoAddDefinition()]]),
  });
  assert.equal(problems.length, 6);
  assert.deepEqual(new Set(problems.map(({ code }) => code)), new Set([
    "INTENT_OUTCOME_CREATE_OVERSHOOT",
  ]));
  assert.match(problems[0].message, /allows at most 1 todos\.personal_task/u);
});

test("inferred outcome structure remains advisory and does not reject calls", () => {
  const problems = intentPreflightProblems({
    core: watchJobCore({ basis: "inferred" }),
    calls: [{ callId: "call-1", tool: "todo_add", arguments: {} }, {
      callId: "call-2", tool: "todo_add", arguments: {},
    }],
    toolDefinitions: new Map([["todo_add", todoAddDefinition()]]),
  });
  assert.deepEqual(problems, []);
});

test("mutation evidence stays connected to outcome identities and exact final cardinality", () => {
  const core = watchJobCore();
  assert.deepEqual(
    matchingIntentOutcomeRefs(core, taskReferences(463)),
    ["create_watch_job.watch_job"],
  );
  const registry = {
    get: () => ({ annotations: { readOnlyHint: false } }),
  };
  assert.deepEqual(intentOutcomeFindings({
    core,
    receipts: [{
      ok: true, tool: "todo_add", objectReferences: taskReferences(463),
      intentOutcomeRefs: ["create_watch_job.watch_job"],
    }],
    registry,
  }), []);
  const findings = intentOutcomeFindings({
    core,
    receipts: [{
      ok: true, tool: "todo_add",
      objectReferences: taskReferences(463, 464, 465, 466, 467, 468),
      intentOutcomeRefs: ["create_watch_job.watch_job"],
    }],
    registry,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].observed, 6);
  assert.deepEqual(findings[0].outcomeRefs, ["create_watch_job.watch_job"]);
});

test("multiple unbound outcomes of one type defer correspondence to semantic audit", () => {
  const core = {
    actions: ["first", "second"].map((name) => ({
      actionId: `create_${name}`,
      outcomeObjects: [{
        outcomeId: "task",
        description: `The ${name} independently requested task.`,
        objectType: "todos.personal_task",
        targetRefs: [],
        cardinality: { minimum: 1, maximum: 1, basis: "request" },
      }],
    })),
  };
  const objectReferences = taskReferences(463, 464);
  assert.deepEqual(matchingIntentOutcomeRefs(core, objectReferences), []);
  const findings = intentOutcomeFindings({
    core,
    receipts: [{ ok: true, tool: "todo_add", objectReferences }],
    registry: { get: () => ({ annotations: { readOnlyHint: false } }) },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].auditOnly, true);
  assert.equal(findings[0].code, "INTENT_OUTCOME_EVIDENCE_AMBIGUOUS");
});
