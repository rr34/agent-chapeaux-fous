import assert from "node:assert/strict";
import test from "node:test";
import { objectDescriptionMetadataKey } from "../src/object-description.mjs";
import { validateFirstClassObjectBinding } from "../src/first-class-object-binding.mjs";
import {
  canonicalizeObjectReferenceSelection,
  currentRequestAttachmentObjectReferences,
  explicitReferenceObjectCatalog,
  mergeObjectReferenceGroups,
  normalizeObjectReferenceGroups,
  objectReferenceGroupsFromToolResult,
  objectReferenceSelectionFindings,
  unresolvedSelectedObjectCandidates,
} from "../src/object-references.mjs";

test("a verified current request attachment becomes a canonical file binding", () => {
  assert.deepEqual(currentRequestAttachmentObjectReferences({
    fileId: 304,
    title: "Lowes receipt 88.05.pdf",
    originalFilename: "receipt.pdf",
  }, 41_002), [{
    mention: "File attached to the current request",
    role: "subject",
    type: "files.file",
    source: "native:files",
    objects: [{
      id: 304,
      ref: "agent-slayer://files/304",
      display: "Lowes receipt 88.05.pdf",
    }],
    sourceEventSeqs: [41_002],
  }]);
  assert.deepEqual(currentRequestAttachmentObjectReferences({ fileId: 304 }, null), []);
});

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
    role: "subject",
    type: "accounting.account",
    source: "mcp:accounting",
    objects: [
      { id: 178, ref: "accounting://accounts/178", display: "Operating Checking" },
      { id: 179, ref: "accounting://accounts/179", display: "Payroll Checking" },
    ],
    sourceEventSeqs: [30_801],
  }]);
});

test("merging bindings keeps source evidence attached to the exact observed objects", () => {
  const merged = mergeObjectReferenceGroups([
    {
      mention: "Calendar event returned by an older search",
      role: "subject",
      type: "calendar.event",
      source: "native:calendar",
      objects: [
        { id: 3129, ref: "agent-slayer://calendar-events/3129", display: "Morning Exercise" },
        { id: 3136, ref: "agent-slayer://calendar-events/3136", display: "Meditate" },
      ],
      sourceEventSeqs: [34253],
    },
    {
      mention: "Calendar event returned by the referenced exchange",
      role: "subject",
      type: "calendar.event",
      source: "native:calendar",
      objects: [
        { id: 3128, ref: "agent-slayer://calendar-events/3128", display: "Morning Exercise" },
        { id: 3135, ref: "agent-slayer://calendar-events/3135", display: "Meditate" },
      ],
      sourceEventSeqs: [34319, 34331],
    },
  ]);

  assert.deepEqual(merged, [
    {
      mention: "Calendar event returned by an older search",
      role: "subject",
      type: "calendar.event",
      source: "native:calendar",
      objects: [
        { id: 3129, ref: "agent-slayer://calendar-events/3129", display: "Morning Exercise" },
        { id: 3136, ref: "agent-slayer://calendar-events/3136", display: "Meditate" },
      ],
      sourceEventSeqs: [34253],
    },
    {
      mention: "Calendar event returned by the referenced exchange",
      role: "subject",
      type: "calendar.event",
      source: "native:calendar",
      objects: [
        { id: 3128, ref: "agent-slayer://calendar-events/3128", display: "Morning Exercise" },
        { id: 3135, ref: "agent-slayer://calendar-events/3135", display: "Meditate" },
      ],
      sourceEventSeqs: [34319, 34331],
    },
  ]);
});

test("repeated observations merge evidence only for the repeated stable object", () => {
  const merged = mergeObjectReferenceGroups([
    {
      mention: "First account read",
      role: "subject",
      type: "accounting.account",
      source: "mcp:accounting",
      objects: [
        { id: 178, ref: "accounting://accounts/178", display: "Operating Checking" },
        { id: 179, ref: "accounting://accounts/179", display: "Payroll Checking" },
      ],
      sourceEventSeqs: [10],
    },
    {
      mention: "Fresh account read",
      role: "subject",
      type: "accounting.account",
      source: "mcp:accounting",
      objects: [
        { id: 178, ref: "accounting://accounts/178", display: "Operating Checking" },
      ],
      sourceEventSeqs: [20],
    },
  ]);

  const operating = merged.find(({ objects }) => objects[0].id === 178);
  const payroll = merged.find(({ objects }) => objects[0].id === 179);
  assert.deepEqual(operating.sourceEventSeqs, [10, 20]);
  assert.equal(operating.mention, "Fresh account read");
  assert.deepEqual(payroll.sourceEventSeqs, [10]);
  assert.equal(payroll.mention, "First account read");
});

test("an explicit exchange binding removes stale same-named competitors without hiding unrelated objects", () => {
  const catalog = explicitReferenceObjectCatalog([
    {
      mention: "Events from unrelated recent conversation",
      role: "subject",
      type: "calendar.event",
      source: "native:calendar",
      objects: [
        { id: 3129, ref: "agent-slayer://calendar-events/3129", display: "Morning Exercise" },
        { id: 3136, ref: "agent-slayer://calendar-events/3136", display: "Meditate" },
        { id: 3148, ref: "agent-slayer://calendar-events/3148", display: "Luzia’s dentist appointment" },
      ],
      sourceEventSeqs: [34253],
    },
  ], [
    {
      mention: "Events from the explicitly referenced exchange",
      role: "subject",
      type: "calendar.event",
      source: "native:calendar",
      objects: [
        { id: 3128, ref: "agent-slayer://calendar-events/3128", display: "Morning Exercise" },
        { id: 3135, ref: "agent-slayer://calendar-events/3135", display: "Meditate" },
      ],
      sourceEventSeqs: [34319, 34331],
    },
  ]);

  const objects = catalog.flatMap(({ objects: groupObjects }) => groupObjects);
  assert.deepEqual(objects.map(({ id }) => id).sort((left, right) => left - right), [3128, 3135, 3148]);
  assert.equal(objects.some(({ id }) => id === 3129 || id === 3136), false);
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

test("provider-declared object roles keep same-type returned objects in separate bindings", () => {
  const action = { name: "remote_accounting_start_import", source: "mcp:accounting", metadata: {} };
  const groups = objectReferenceGroupsFromToolResult({
    toolDefinition: action,
    toolDefinitions: [accountRead, action],
    sourceEventSeq: 44,
    result: {
      account: {
        objectType: "accounting.account", objectRole: "subject",
        id: 178, ref: "accounting://accounts/178", name: "Fifth Third x5999",
      },
      suspenseAccount: {
        objectType: "accounting.account", objectRole: "designated_suspense_account",
        id: 279, ref: "accounting://accounts/279", name: "Ask Accountant Dollars",
      },
    },
  });
  assert.deepEqual(groups.map(({ role, objects }) => ({ role, ids: objects.map(({ id }) => id) })), [
    { role: "subject", ids: [178] },
    { role: "designated_suspense_account", ids: [279] },
  ]);
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: action,
    toolDefinitions: [accountRead, action],
    result: {
      objectType: "accounting.account", objectRole: "not a valid role",
      id: 279, ref: "accounting://accounts/279", name: "Ask Accountant Dollars",
    },
  }), []);
});

test("a related native object never inherits the primary object's stable reference", () => {
  const groups = objectReferenceGroupsFromToolResult({
    toolDefinition: { name: "todo_list", source: "local", capabilityId: "todos" },
    result: {
      tasks: [{
        personal_task_id: 364,
        todo_group_id: 6,
        text: "Take down the sign\nAddress: 217 E Oakland",
        group_name: "Construction",
        ref: "agent-slayer://todos/364",
      }],
    },
    sourceEventSeq: 35531,
  });

  const task = groups.find(({ type }) => type === "todos.personal_task");
  const group = groups.find(({ type }) => type === "todos.todo_group");
  assert.deepEqual(task.objects, [{
    id: 364,
    ref: "agent-slayer://todos/364",
    display: "Take down the sign\nAddress: 217 E Oakland",
  }]);
  assert.deepEqual(group.objects, [{
    id: 6,
    ref: "agent-slayer://todo-groups/6",
    display: "Construction",
  }]);
  assert.deepEqual(normalizeObjectReferenceGroups([{
    mention: "Historically misbound group",
    role: "subject",
    type: "todos.todo_group",
    source: "native:todos",
    objects: [{ id: 6, ref: "agent-slayer://todos/364", display: "Construction" }],
    sourceEventSeqs: [35464],
  }]), []);
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

test("object selection restores whitespace-equivalent displays and exact evidence without changing the selected set", () => {
  const available = [{
    mention: "Fresh task read", role: "subject", type: "todos.personal_task",
    source: "native:todos",
    objects: [{
      id: 364,
      ref: "agent-slayer://todos/364",
      display: "Take down the sign\nAddress: 217 E Oakland",
    }],
    sourceEventSeqs: [35300, 35531],
  }];
  const selected = [{
    mention: "Invoice task", role: "invoice_line_source", type: "todos.personal_task",
    source: "native:todos",
    objects: [{
      id: 364,
      ref: "agent-slayer://todos/364",
      display: "Take down the sign Address: 217 E Oakland",
    }],
    sourceEventSeqs: [35300],
  }];

  const canonical = canonicalizeObjectReferenceSelection(selected, available);

  assert.deepEqual(canonical.objectReferences, [{
    ...selected[0],
    objects: [{ ...selected[0].objects[0], display: available[0].objects[0].display }],
    sourceEventSeqs: [35300, 35531],
  }]);
  assert.equal(canonical.corrections.length, 2);
  assert.equal(objectReferenceSelectionFindings(canonical.objectReferences, available).length, 0);
  assert.equal(selected[0].objects[0].display.includes("\n"), false, "the model candidate stays literal");
});

test("object selection does not canonicalize a meaningfully different display or machine identity", () => {
  const available = [{
    mention: "Task read", role: "subject", type: "todos.personal_task",
    source: "native:todos",
    objects: [{ id: 364, ref: "agent-slayer://todos/364", display: "Take down the sign" }],
    sourceEventSeqs: [35531],
  }];
  const renamed = structuredClone(available);
  renamed[0].objects[0].display = "Install the sign";
  renamed[0].sourceEventSeqs = [1];
  const wrongId = structuredClone(available);
  wrongId[0].objects[0].id = 1;
  wrongId[0].sourceEventSeqs = [1];

  assert.deepEqual(canonicalizeObjectReferenceSelection(renamed, available), {
    objectReferences: renamed,
    corrections: [],
  });
  assert.deepEqual(canonicalizeObjectReferenceSelection(wrongId, available), {
    objectReferences: wrongId,
    corrections: [],
  });
});

test("every explicit selected candidate must have an exact prepared binding", () => {
  const candidates = [{
    type: "todos.personal_task", source: "native:todos", id: 8,
    ref: "agent-slayer://todos/8", display: "Send invoice",
  }, {
    type: "todos.personal_task", source: "native:todos", id: 9,
    ref: "agent-slayer://todos/9", display: "Archive receipt",
  }];
  const prepared = [{
    mention: "selected tasks", type: "todos.personal_task", source: "native:todos",
    objects: [{ id: 8, ref: "agent-slayer://todos/8", display: "Send invoice" }],
    sourceEventSeqs: [55],
  }];
  assert.deepEqual(unresolvedSelectedObjectCandidates(candidates, prepared), [candidates[1]]);
  prepared[0].objects.push({ id: 9, ref: "agent-slayer://todos/9", display: "Renamed receipt task" });
  assert.deepEqual(unresolvedSelectedObjectCandidates(candidates, prepared), []);
});

test("native prepared context produces compact human and machine identity bindings", () => {
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: { name: "context:todos.active_groups", source: "local", capabilityId: "todos" },
    result: { groups: [{ todoGroupId: 7, name: "Wedding" }] },
    sourceEventSeq: 55,
  }), [{
    mention: "To-do group returned by context:todos.active_groups",
    role: "subject",
    type: "todos.todo_group",
    source: "native:todos",
    objects: [{ id: 7, ref: "agent-slayer://todo-groups/7", display: "Wedding" }],
    sourceEventSeqs: [55],
  }]);
});
