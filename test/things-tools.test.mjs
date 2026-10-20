import assert from "node:assert/strict";
import test from "node:test";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { objectDescriptionMetadataKey } from "../src/object-description.mjs";
import { registerThingsTools } from "../src/tools/things-tools.mjs";
import { schemaProblem, ToolRegistry } from "../src/tools/registry.mjs";

const group = {
  id: 4, name: "Workshop", sortPosition: 10, archivedAtUtc: null, itemCount: 1,
};
const item = {
  id: 9, groupId: 4, groupName: "Workshop", name: "Cordless drill",
  description: "18V drill", personalNotes: "Battery bought in 2025", quantity: 1,
  location: "Garage shelf 2", condition: "good", status: "active",
  manufacturer: "Example", modelNumber: "D18", serialNumber: "SER-9",
  acquiredOn: "2025-04-03", sortPosition: 10,
  createdAtUtc: "2026-10-20T12:00:00.000Z", updatedAtUtc: null, version: 1,
};

test("Things tools publish first-class groups and physical items and preserve exact link requests", async () => {
  const calls = [];
  const service = {
    listGroups: () => [group],
    list: (input) => { calls.push(["list", input]); return [item]; },
    createGroup: (input, context) => { calls.push(["createGroup", input, context]); return group; },
    updateGroup: () => group,
    create: (input, context) => { calls.push(["create", input, context]); return item; },
    update: () => item,
    setLinks: (links, context) => {
      calls.push(["links", links, context]);
      return { selected_count: 1, changed_count: 1, unchanged_count: 0, results: [{ ...links[0], changed: true }] };
    },
  };
  const registry = registerNativeCapabilities(new ToolRegistry());
  registerThingsTools(registry, service);
  const definitions = new Map(registry.toolDefinitions().map((definition) => [definition.name, definition]));
  assert.deepEqual(
    definitions.get("physical_item_group_list").metadata[objectDescriptionMetadataKey].types.map(({ id }) => id),
    ["things.physical_item_group"],
  );
  assert.deepEqual(
    definitions.get("physical_item_list").metadata[objectDescriptionMetadataKey].types.map(({ id }) => id),
    ["things.physical_item"],
  );

  const listed = await registry.execute("physical_item_list", { physical_item_group_id: 4, text_query: "drill", limit: 20 });
  assert.equal(listed.items[0].ref, "agent-slayer://physical-items/9");
  assert.equal(listed.items[0].location_text, "Garage shelf 2");
  assert.equal(schemaProblem(listed, definitions.get("physical_item_list").outputSchema, "result"), null);

  const linked = await registry.execute("physical_item_link_set", { links: [{
    physical_item_id: 9, target_type: "file", target_id: 22,
    relationship_kind: "warranty", linked: true,
  }] }, { requestId: "request-things", callId: "call-things" });
  assert.equal(linked.changed_count, 1);
  assert.deepEqual(calls.find(([name]) => name === "links")[1], [{
    physical_item_id: 9, target_type: "file", target_id: 22,
    relationship_kind: "warranty", linked: true,
  }]);
  assert.equal(calls.find(([name]) => name === "links")[2].actorName, "physical_item_link_set");
});
