import assert from "node:assert/strict";
import test from "node:test";
import { objectDescriptionMetadataKey } from "../src/object-description.mjs";
import { validateFirstClassObjectBinding } from "../src/first-class-object-binding.mjs";
import {
  normalizeObjectReferenceGroups,
  objectReferenceGroupsFromToolResult,
  objectReferenceSelectionFindings,
} from "../src/object-references.mjs";

const accountRead = {
  name: "remote_accounting_list_accounts",
  source: "mcp:accounting",
  metadata: {
    [objectDescriptionMetadataKey]: {
      protocol: "agent-slayer.object-description",
      version: 1,
      types: [{
        id: "accounting.account",
        title: "Accounting account",
        summary: "A provider-owned ledger account.",
        identity: { field: "id", summary: "Provider-native account ID." },
        reference: { field: "ref", summary: "Stable account reference." },
        display: { field: "name", summary: "Account name shown to the user." },
        qualifiers: [],
      }],
    },
  },
};

test("remote object bindings preserve bulk IDs, stable references, displays, and evidence together", () => {
  const groups = objectReferenceGroupsFromToolResult({
    toolDefinition: accountRead,
    toolDefinitions: [accountRead],
    result: { accounts: [
      { id: 178, ref: "accounting://accounts/178", name: "Operating Checking" },
      { id: 179, ref: "accounting://accounts/179", name: "Payroll Checking" },
    ] },
    sourceEventSeq: 30_801,
  });

  assert.deepEqual(groups, [{
    mention: "Accounting account returned by remote_accounting_list_accounts",
    type: "accounting.account",
    source: "mcp:accounting",
    objects: [
      { id: 178, ref: "accounting://accounts/178", display: "Operating Checking" },
      { id: 179, ref: "accounting://accounts/179", display: "Payroll Checking" },
    ],
    sourceEventSeqs: [30_801],
  }]);
});

test("a provider record is not identified when its declared primary ID is absent", () => {
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: accountRead,
    toolDefinitions: [accountRead],
    result: { accounts: [{ ref: "accounting://accounts/178", name: "Operating Checking" }] },
    sourceEventSeq: 30_801,
  }), []);
});

test("a non-owner tool result needs the provider objectType discriminator", () => {
  const transactionRead = structuredClone(accountRead);
  transactionRead.name = "remote_accounting_list_transactions";
  transactionRead.metadata[objectDescriptionMetadataKey].types[0].id = "accounting.transaction";
  transactionRead.metadata[objectDescriptionMetadataKey].types[0].title = "Accounting transaction";
  const action = { name: "remote_accounting_update", source: "mcp:accounting", metadata: {} };
  const result = { id: 178, ref: "accounting://accounts/178", name: "Operating Checking" };
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: action, toolDefinitions: [accountRead, transactionRead, action], result,
  }), []);
  const [group] = objectReferenceGroupsFromToolResult({
    toolDefinition: action, toolDefinitions: [accountRead, transactionRead, action],
    result: { ...result, objectType: "accounting.account" }, sourceEventSeq: 12,
  });
  assert.equal(group.type, "accounting.account");
});

test("the canonical runtime schema requires complete machine, human, and evidence identity", () => {
  const binding = {
    mention: "that account",
    type: "accounting.account",
    source: "mcp:accounting",
    objects: [{ id: 178, ref: "accounting://accounts/178", display: "Operating Checking" }],
    sourceEventSeqs: [30_801],
  };
  assert.equal(validateFirstClassObjectBinding(binding), binding);
  assert.throws(
    () => validateFirstClassObjectBinding({ ...binding, sourceEventSeqs: [] }),
    /sourceEventSeqs.*must NOT have fewer than 1 items/,
  );
  assert.throws(
    () => validateFirstClassObjectBinding({
      ...binding, objects: [{ id: 178, ref: "accounting:\/\/accounts\/178" }],
    }),
    /required property 'display'/,
  );
  assert.deepEqual(normalizeObjectReferenceGroups([{
    ...binding, objects: [{ id: true, ref: "accounting://accounts/true", display: "Invalid" }],
  }]), []);
});

test("object selection rejects an altered ID or display for a known stable reference", () => {
  const available = [{
    mention: "that account", type: "accounting.account", source: "mcp:accounting",
    objects: [{ id: 178, ref: "accounting://accounts/178", display: "Operating Checking" }],
    sourceEventSeqs: [30_801],
  }];
  const selected = structuredClone(available);
  selected[0].objects[0].id = 1;

  assert.deepEqual(objectReferenceSelectionFindings(selected, available), [{
    code: "object_reference_mismatch",
    path: "brief.objectReferences[0].objects[0]",
    message: "accounting://accounts/178 must retain its exact type, source, ID, and display name",
  }]);

  const alteredEvidence = structuredClone(available);
  alteredEvidence[0].sourceEventSeqs = [1];
  assert.equal(
    objectReferenceSelectionFindings(alteredEvidence, available)[0].code,
    "object_reference_evidence_mismatch",
  );
});

test("native prepared context produces compact human and machine identity bindings", () => {
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: { name: "context:todos.active_groups", source: "local", capabilityId: "todos" },
    result: { groups: [{ todoGroupId: 7, name: "Wedding" }] },
    sourceEventSeq: 55,
  }), [{
    mention: "To-do group returned by context:todos.active_groups",
    type: "todos.todo_group",
    source: "native:todos",
    objects: [{ id: 7, ref: "agent-slayer://todo-groups/7", display: "Wedding" }],
    sourceEventSeqs: [55],
  }]);
});
