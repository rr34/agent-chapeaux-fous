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
  assert.equal(findings[0].code, "INTENT_OUTCOME_EVIDENCE_EXCESS");
  assert.equal(findings[0].auditOnly, true);
  assert.deepEqual(findings[0].outcomeRefs, ["create_watch_job.watch_job"]);
});

test("one homogeneous batch outcome accepts its exact distinct object count without audit", () => {
  const core = {
    actions: [{
      actionId: "record_exercise",
      outcomeObjects: [{
        outcomeId: "exercise_entries",
        description: "The batch of separate entries for the requested tracker values.",
        objectType: "journal.entry",
        targetRefs: [],
        cardinality: { minimum: 2, maximum: 2, basis: "request" },
      }],
    }],
  };
  const entryReferences = (id) => [{
    type: "journal.entry",
    source: "native:journal",
    objects: [{ id, ref: `agent-slayer://journal-entries/${id}`, display: `Entry ${id}` }],
  }];
  const outcomeRef = "record_exercise.exercise_entries";
  const receipts = [236, 237].map((id) => ({
    ok: true,
    tool: "journal_add",
    objectReferences: entryReferences(id),
    intentOutcomeRefs: [outcomeRef],
  }));
  assert.deepEqual(intentOutcomeFindings({
    core,
    receipts,
    registry: { get: () => ({ annotations: { readOnlyHint: false } }) },
  }), []);
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

test("inferred same-type outcomes never compete with request-established receipt correlation", () => {
  const outcomeRef = "tag_contacts.tagged_contacts";
  const core = {
    actions: [{
      actionId: "tag_contacts",
      outcomeObjects: [{
        outcomeId: "predicted_tag",
        description: "A predicted tag representation that is not a first-class object.",
        objectType: "contacts.contact",
        targetRefs: [],
        cardinality: { minimum: 1, maximum: 1, basis: "inferred" },
      }, {
        outcomeId: "tagged_contacts",
        description: "The fourteen contacts named by the supplied email addresses.",
        objectType: "contacts.contact",
        targetRefs: [],
        cardinality: { minimum: 14, maximum: 14, basis: "request" },
      }],
    }],
  };
  const existing = [{
    type: "contacts.contact", source: "native:contacts",
    objects: [{ id: 399, ref: "agent-slayer://contacts/399", display: "Emily Wu" }],
  }];
  const imported = [{
    type: "contacts.contact", source: "native:contacts",
    objects: Array.from({ length: 13 }, (_, index) => ({
      id: 1613 + index,
      ref: `agent-slayer://contacts/${1613 + index}`,
      display: `Service ${index + 1}`,
    })),
  }];
  assert.deepEqual(matchingIntentOutcomeRefs(core, existing), [outcomeRef]);
  assert.deepEqual(matchingIntentOutcomeRefs(core, imported), [outcomeRef]);
  assert.deepEqual(intentOutcomeFindings({
    core,
    receipts: [{
      ok: true, tool: "contact_tag_add_batch", objectReferences: existing,
      intentOutcomeRefs: [outcomeRef],
    }, {
      ok: true, tool: "contact_import", objectReferences: imported,
      intentOutcomeRefs: [outcomeRef],
    }],
    registry: { get: () => ({ annotations: { readOnlyHint: false } }) },
  }), []);
});

test("missing mechanical outcome correlation is an audit question, not proof of failure", () => {
  const core = {
    actions: [{
      actionId: "tag_contacts",
      outcomeObjects: [{
        outcomeId: "tagged_contacts",
        description: "Fourteen tagged contacts.",
        objectType: "contacts.contact",
        targetRefs: [],
        cardinality: { minimum: 14, maximum: 14, basis: "request" },
      }],
    }],
  };
  const imported = [{
    type: "contacts.contact", source: "native:contacts",
    objects: Array.from({ length: 13 }, (_, index) => ({
      id: 1613 + index,
      ref: `agent-slayer://contacts/${1613 + index}`,
      display: `Service ${index + 1}`,
    })),
  }];
  const findings = intentOutcomeFindings({
    core,
    receipts: [{
      ok: true, tool: "contact_tag_add_batch", objectReferences: [],
    }, {
      ok: true, tool: "contact_import", objectReferences: imported,
      intentOutcomeRefs: ["tag_contacts.tagged_contacts"],
    }],
    registry: { get: () => ({ annotations: { readOnlyHint: false } }) },
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "INTENT_OUTCOME_EVIDENCE_INCOMPLETE");
  assert.equal(findings[0].auditOnly, true);
  assert.equal(findings[0].observed, 13);
  assert.match(findings[0].message, /not proof that the requested work failed/i);
});
