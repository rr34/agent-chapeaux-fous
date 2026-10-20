import assert from "node:assert/strict";
import test from "node:test";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { registerObjectNetworkTools } from "../src/tools/object-network-tools.mjs";
import { schemaProblem, ToolRegistry } from "../src/tools/registry.mjs";

test("the object connection tool publishes exact binding-shaped endpoints and a mutation receipt", async () => {
  let received;
  const registry = registerNativeCapabilities(new ToolRegistry());
  registerObjectNetworkTools(registry, {
    identity(type, id) {
      if (type === "video.content_item") return from;
      if (type === "todos.personal_task") return to;
      throw new Error(`Unexpected identity ${type}:${id}`);
    },
    setConnections(connections, context) {
      received = { connections, context };
      return {
        selected_count: 1,
        changed_count: 1,
        unchanged_count: 0,
        results: [{ ...connections[0], changed: true }],
      };
    },
  });
  const definition = registry.toolDefinitions()
    .find(({ name }) => name === "object_connection_set");
  assert.equal(definition.capabilityId, "relationships");
  assert.equal(definition.annotations.readOnlyHint, false);
  assert.equal(definition.inputSchema.properties.connections.maxItems, 50);
  assert.deepEqual(
    definition.metadata["agent-slayer/object-input-bindings"].bindings
      .map(({ path, objectType, allowUnbound }) => ({ path, objectType, allowUnbound })),
    [
      { path: "/connections/*/personal_task_id", objectType: "todos.personal_task", allowUnbound: undefined },
      { path: "/connections/*/contact_id", objectType: "contacts.contact", allowUnbound: undefined },
      { path: "/connections/*/calendar_event_id", objectType: "calendar.event", allowUnbound: undefined },
      { path: "/connections/*/content_id", objectType: "video.content_item", allowUnbound: undefined },
      { path: "/connections/*/physical_item_id", objectType: "things.physical_item", allowUnbound: undefined },
      { path: "/connections/*/file_id", objectType: "files.file", allowUnbound: undefined },
    ],
  );

  const from = {
    type: "video.content_item", source: "native:video", id: 165,
    ref: "agent-slayer://content-items/165", display: "Job 6 - Sidelined",
  };
  const to = {
    type: "todos.personal_task", source: "native:todos", id: 126,
    ref: "agent-slayer://todos/126", display: "Job 6 - Sidelined",
  };
  const result = await registry.execute("object_connection_set", {
    connections: [{
      relationship_type: "todo_content",
      personal_task_id: 126,
      content_id: 165,
      linked: true,
    }],
  }, { requestId: "request-connect", callId: "call-connect", channel: "web" });
  assert.equal(schemaProblem(result, definition.outputSchema, "result"), null);
  assert.deepEqual(received.connections, [{ from: to, to: from, linked: true }]);
  assert.equal(received.context.actorName, "object_connection_set");
  assert.equal(result.changed_count, 1);
});
