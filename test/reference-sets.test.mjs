import assert from "node:assert/strict";
import test from "node:test";
import {
  objectReferenceSets,
  orientationReferenceSetProblem,
  referenceSetObjectRefs,
  selectedReferenceSets,
  validateReferenceSet,
} from "../src/reference-sets.mjs";

const references = [{
  mention: "Watch Jobs",
  role: "subject",
  type: "todos.personal_task",
  source: "native:todos",
  objects: [
    { id: 7, ref: "agent-slayer://todos/7", display: "Call Alice" },
    { id: 8, ref: "agent-slayer://todos/8", display: "Call Bob" },
  ],
  sourceEventSeqs: [41],
}, {
  mention: "matched contacts",
  role: "relationship_target",
  type: "contacts.contact",
  source: "native:contacts",
  objects: [
    { id: 70, ref: "agent-slayer://contacts/70", display: "Alice" },
    { id: 80, ref: "agent-slayer://contacts/80", display: "Bob" },
  ],
  sourceEventSeqs: [42],
}];

test("binding groups are exposed as compact selectable object sets", () => {
  const sets = objectReferenceSets(references);
  assert.equal(sets.length, 2);
  assert.deepEqual(sets[0].memberRefs, ["agent-slayer://todos/7", "agent-slayer://todos/8"]);
  assert.match(sets[0].ref, /^agent-slayer:\/\/reference-sets\/objects\//u);
  assert.deepEqual(validateReferenceSet(sets[0]), sets[0]);
});

test("orientation can select an exact directed relationship set without losing pairings", () => {
  const requestId = "request-links";
  const relationshipRef = `agent-slayer://requests/${requestId}/relationship-sets/watch-job-contacts`;
  const core = {
    actions: [{
      targetRefs: [], targetSetRefs: [], relationshipSetRefs: [relationshipRef],
      unresolvedTargets: [],
    }],
    objectSets: [],
    relationshipSets: [{
      ref: relationshipRef,
      display: "Each Watch Job and its matching contact",
      relationshipType: "todos.related_contact",
      edges: [
        { fromRef: "agent-slayer://todos/7", toRef: "agent-slayer://contacts/70" },
        { fromRef: "agent-slayer://todos/8", toRef: "agent-slayer://contacts/80" },
      ],
    }],
  };
  assert.equal(orientationReferenceSetProblem(core, {
    requestId, availableObjectReferences: references,
  }), null);
  const selected = selectedReferenceSets(core, {
    requestId, requestEventSeq: 43, availableObjectReferences: references,
  });
  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].edges, core.relationshipSets[0].edges);
  assert.deepEqual(referenceSetObjectRefs(selected), [
    "agent-slayer://contacts/70",
    "agent-slayer://contacts/80",
    "agent-slayer://todos/7",
    "agent-slayer://todos/8",
  ]);
  assert.deepEqual(selected[0].sourceEventSeqs, [41, 42, 43]);
});

test("relationship sets reject unavailable endpoints and duplicate directed edges", () => {
  const requestId = "request-links";
  const ref = `agent-slayer://requests/${requestId}/relationship-sets/bad`;
  const relationship = {
    ref,
    display: "Bad edges",
    relationshipType: "todos.related_contact",
    edges: [{ fromRef: "agent-slayer://todos/7", toRef: "agent-slayer://contacts/999" }],
  };
  const core = {
    actions: [{ targetSetRefs: [], relationshipSetRefs: [ref] }],
    objectSets: [], relationshipSets: [relationship],
  };
  assert.match(orientationReferenceSetProblem(core, {
    requestId, availableObjectReferences: references,
  }), /unavailable object reference.*contacts\/999/u);

  relationship.edges = [
    { fromRef: "agent-slayer://todos/7", toRef: "agent-slayer://contacts/70" },
    { fromRef: "agent-slayer://todos/7", toRef: "agent-slayer://contacts/70" },
  ];
  assert.match(orientationReferenceSetProblem(core, {
    requestId, availableObjectReferences: references,
  }), /duplicate directed relationship/u);
});
