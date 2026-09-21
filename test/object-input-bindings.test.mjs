import assert from "node:assert/strict";
import test from "node:test";
import {
  constrainToolObjectInputs,
  objectInputBindingProblem,
  objectInputBindingsMetadataKey,
  validateObjectInputBindings,
} from "../src/object-input-bindings.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { normalizeObjectReferenceGroups } from "../src/object-references.mjs";

const contract = {
  protocol: "agent-slayer.object-input-bindings",
  version: 1,
  bindings: [{ path: "/account_id", objectType: "accounting.account", value: "id" }],
};
const tool = {
  name: "remote_accounting_search_transactions",
  source: "mcp:accounting",
  inputSchema: {
    type: "object", additionalProperties: false,
    properties: { account_id: { type: "integer", minimum: 1 } },
  },
  metadata: { [objectInputBindingsMetadataKey]: contract },
};
const selected = [{
  mention: "that account", type: "accounting.account", source: "mcp:accounting",
  objects: [{ id: 178, ref: "accounting://accounts/178", display: "Operating Checking" }],
  sourceEventSeqs: [30_801],
}];

test("provider-declared object inputs narrow the callable schema to accepted exact IDs", () => {
  assert.deepEqual(validateObjectInputBindings(contract), contract);
  const constrained = constrainToolObjectInputs(tool, selected);
  assert.deepEqual(constrained.inputSchema.properties.account_id.enum, [178]);
  assert.equal(tool.inputSchema.properties.account_id.enum, undefined, "the registered provider schema stays immutable");
});

test("the call boundary rejects a substituted ID and accepts the exact bound ID", () => {
  assert.match(objectInputBindingProblem({
    toolDefinition: tool, argumentsObject: { account_id: 1 }, selectedGroups: selected,
  }), /must use the exact id.*178/);
  assert.equal(objectInputBindingProblem({
    toolDefinition: tool, argumentsObject: { account_id: 178 }, selectedGroups: selected,
  }), null);
});

test("a declared object input cannot receive an ID before its object is identified", () => {
  assert.match(objectInputBindingProblem({
    toolDefinition: tool, argumentsObject: { account_id: 1 },
  }), /1 is not identified/);
});

test("native tool registration declares first-class IDs, including IDs inside batches", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "todo_update_batch", description: "Update selected to-dos.", capabilityId: "todos",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        updates: {
          type: "array", items: {
            type: "object", properties: { personal_task_id: { type: "integer" } },
          },
        },
      },
    },
    async execute() { return {}; },
  });
  const [definition] = registry.toolDefinitions();
  assert.deepEqual(definition.metadata[objectInputBindingsMetadataKey].bindings, [{
    path: "/updates/*/personal_task_id", objectType: "todos.personal_task", value: "id",
  }]);
  const selectedTodo = [{
    mention: "those tasks", type: "todos.personal_task", source: "native:todos",
    objects: [{ id: 8, ref: "agent-slayer://todos/8", display: "Buy coffee" }],
    sourceEventSeqs: [42],
  }];
  assert.match(objectInputBindingProblem({
    toolDefinition: definition,
    argumentsObject: { updates: [{ personal_task_id: 1 }] },
    selectedGroups: selectedTodo,
  }), /must use the exact id.*8/);
});

test("database string IDs canonicalize before a native calendar-contact action", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "calendar_event_contact_link_set",
    description: "Link a contact to an event.",
    capabilityId: "calendar",
    parameters: {
      type: "object", additionalProperties: false,
      required: ["calendar_event_id", "contact_id"],
      properties: {
        calendar_event_id: { type: "integer", minimum: 1 },
        contact_id: { type: "integer", minimum: 1 },
      },
    },
    async execute(argumentsObject) { return argumentsObject; },
  });
  const [definition] = registry.toolDefinitions();
  const observed = normalizeObjectReferenceGroups([
    {
      mention: "that event", type: "calendar.event", source: "native:calendar",
      objects: [{ id: "3113", ref: "agent-slayer://calendar-events/3113", display: "Call Lucas" }],
      sourceEventSeqs: [30_801],
    },
    {
      mention: "Lucas", type: "contacts.contact", source: "native:contacts",
      objects: [{ id: "578", ref: "agent-slayer://contacts/578", display: "Lucas Ruffing" }],
      sourceEventSeqs: [30_771],
    },
  ]);
  assert.deepEqual(observed.map(({ objects }) => objects[0].id), [3113, 578]);
  assert.equal(objectInputBindingProblem({
    toolDefinition: definition,
    argumentsObject: { calendar_event_id: 3113, contact_id: 578 },
    selectedGroups: observed,
  }), null);
  assert.deepEqual(
    constrainToolObjectInputs(definition, observed).inputSchema.properties.calendar_event_id.enum,
    [3113],
  );
});

test("local tool results expose native database identities as integers", async () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "calendar_event_search",
    description: "Return an event and its linked contact.",
    capabilityId: "calendar",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() {
      return {
        events: [{
          calendar_event_id: "3113",
          linked_contacts: [{ contact_id: "578" }],
        }],
      };
    },
  });
  assert.deepEqual(await registry.execute("calendar_event_search", {}), {
    events: [{ calendar_event_id: 3113, linked_contacts: [{ contact_id: 578 }] }],
  });
});

test("the application-owned MCP upload bridge consumes an exact native file binding", () => {
  const uploadTool = {
    name: "remote_accounting_upload_statement_file",
    source: "mcp:accounting",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: { file_id: { type: "integer", minimum: 1 } },
    },
    metadata: {
      "agent-slayer/artifactUpload": { transportId: "statement" },
      [objectInputBindingsMetadataKey]: {
        protocol: "agent-slayer.object-input-bindings",
        version: 1,
        bindings: [{ path: "/file_id", objectType: "files.file", value: "id" }],
      },
    },
  };
  const files = [{
    mention: "that CSV", type: "files.file", source: "native:files",
    objects: [{ id: 293, ref: "agent-slayer://files/293", display: "x5999.csv" }],
    sourceEventSeqs: [30_801],
  }];
  assert.equal(objectInputBindingProblem({
    toolDefinition: uploadTool, argumentsObject: { file_id: 293 }, selectedGroups: files,
  }), null);
  assert.match(objectInputBindingProblem({
    toolDefinition: uploadTool, argumentsObject: { file_id: 1 }, selectedGroups: files,
  }), /must use the exact id.*293/);
});
