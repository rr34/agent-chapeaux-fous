import assert from "node:assert/strict";
import test from "node:test";
import {
  createIntentState,
  observeIntentState,
  reconcileIntentState,
} from "../src/intent-state.mjs";

function core() {
  return {
    objective: "Convert every source member into a separate destination member.",
    mode: "act",
    constraints: ["Preserve member boundaries."],
    actions: [{
      actionId: "convert_members",
      instruction: "Convert all source members.",
      semanticRoles: [{
        role: "source_members", multiplicity: "many", containerRole: "source_group",
      }, {
        role: "destination_members", multiplicity: "many", containerRole: "destination_group",
        sameCountAs: "source_members",
      }],
      mappings: [{
        fromRole: "source_members", toRole: "destination_members", shape: "one_to_one",
        coverage: "all", preserveMemberBoundaries: true,
      }],
    }],
  };
}

test("intent state always separates requested, observed, current, remaining, and cause", () => {
  const state = createIntentState({ requestId: "request-1", core: core() });

  assert.deepEqual(Object.keys(state).filter((key) => [
    "requested", "observed", "current", "remaining", "cause",
  ].includes(key)), ["requested", "observed", "current", "remaining", "cause"]);
  assert.equal(state.requested.actions[0].semanticRoles[1].sameCountAs, "source_members");
  assert.equal(state.requested.actions[0].mappings[0].shape, "one_to_one");
  assert.equal(state.remaining.status, "pending_execution");
  assert.deepEqual(state.cause, []);
});

test("observations cannot overwrite requested intent and audit reconciliation clears only remaining", () => {
  const initial = createIntentState({ requestId: "request-1", core: core() });
  const observed = observeIntentState(initial, {
    stage: "execution",
    receipts: [{
      receiptEventSeq: 12,
      tool: "physical_item_create",
      ok: true,
      objectReferences: [{
        type: "things.physical_item",
        objects: [{ ref: "agent-slayer://physical-items/9", display: "Passport" }],
      }],
    }, {
      receiptEventSeq: 13,
      tool: "physical_item_create",
      ok: false,
      error: "call budget exhausted",
    }],
    findings: [{ code: "MAPPING_INCOMPLETE", message: "Fourteen members remain." }],
  });

  assert.deepEqual(observed.requested, initial.requested);
  assert.equal(observed.current.status, "evidenced_pending_reconciliation");
  assert.equal(observed.current.asOfReceiptEventSeq, 13);
  assert.equal(observed.current.objectReferences[0].ref, "agent-slayer://physical-items/9");
  assert.deepEqual(observed.cause.map(({ code }) => code), [
    "TOOL_CALL_FAILED", "MAPPING_INCOMPLETE",
  ]);

  const complete = reconcileIntentState(observed, {
    stage: "repair_audit",
    outcome: "complete",
  });
  assert.deepEqual(complete.requested, initial.requested);
  assert.equal(complete.current.status, "evidenced_complete");
  assert.deepEqual(complete.remaining, { status: "complete", items: [] });
  assert.equal(complete.cause.length, 2);
  assert.deepEqual(new Set(complete.cause.map(({ status }) => status)), new Set(["resolved"]));
});
