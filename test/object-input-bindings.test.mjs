import assert from "node:assert/strict";
import test from "node:test";
import {
  constrainToolObjectInputs,
  objectInputBindingProblem,
  objectInputBindingsMetadataKey,
  validateObjectInputBindings,
} from "../src/object-input-bindings.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

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
