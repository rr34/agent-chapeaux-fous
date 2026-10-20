const toolDescriptions = Object.freeze({
  object_connection_set: {
    protocol: "agent-slayer.tool-description",
    version: 1,
    summary: "Connect or disconnect a bounded batch of exact first-class-object pairs through their owning domain operations.",
    actionClasses: ["UPDATE"],
    effectClassifications: ["MUTATING"],
  },
});

const compactIdentitySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string" },
    source: { type: "string" },
    id: { type: "integer" },
    ref: { type: "string" },
    display: { type: "string" },
  },
  required: ["type", "source", "id", "ref", "display"],
};

export function registerObjectNetworkTools(registry, objectNetwork) {
  const capabilityRegistry = registry.withCapability?.(
    "relationships",
    toolDescriptions,
  ) ?? registry;
  capabilityRegistry.register({
    name: "object_connection_set",
    title: "Set direct object connections",
    description: "Connect or disconnect 1 through 50 exact first-class-object pairs. Supported simple relationship types are todo_contact, calendar_todo_context, calendar_contact_other, and todo_content. Each edge is delegated to the mutation owned by its domain; specialized calendar meanings are not overwritten. Supply only the endpoint IDs required by each declared relationship type, using IDs from explicit selections or authoritative owning reads. Agent Slayer verifies those IDs against retained first-class-object bindings and hydrates stable references and display names deterministically. Duplicate pairs are rejected. The result reports changed versus already-satisfied edges and their complete exact endpoints.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        connections: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              relationship_type: {
                type: "string",
                enum: ["todo_contact", "calendar_todo_context", "calendar_contact_other", "todo_content"],
              },
              personal_task_id: { type: "integer", minimum: 1 },
              contact_id: { type: "integer", minimum: 1 },
              calendar_event_id: { type: "integer", minimum: 1 },
              content_id: { type: "integer", minimum: 1 },
              linked: { type: "boolean" },
            },
            required: ["relationship_type", "linked"],
          },
        },
      },
      required: ["connections"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        selected_count: { type: "integer", minimum: 1 },
        changed_count: { type: "integer", minimum: 0 },
        unchanged_count: { type: "integer", minimum: 0 },
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              from: compactIdentitySchema,
              to: compactIdentitySchema,
              linked: { type: "boolean" },
              changed: { type: "boolean" },
            },
            required: ["from", "to", "linked", "changed"],
          },
        },
      },
      required: ["selected_count", "changed_count", "unchanged_count", "results"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute({ connections }, context) {
      const hydrated = connections.map((connection, index) => {
        const specifications = {
          todo_contact: [
            ["todos.personal_task", "personal_task_id"],
            ["contacts.contact", "contact_id"],
          ],
          calendar_todo_context: [
            ["calendar.event", "calendar_event_id"],
            ["todos.personal_task", "personal_task_id"],
          ],
          calendar_contact_other: [
            ["calendar.event", "calendar_event_id"],
            ["contacts.contact", "contact_id"],
          ],
          todo_content: [
            ["todos.personal_task", "personal_task_id"],
            ["video.content_item", "content_id"],
          ],
        };
        const specification = specifications[connection.relationship_type];
        const requiredFields = new Set(specification.map(([, field]) => field));
        const suppliedFields = [
          "personal_task_id", "contact_id", "calendar_event_id", "content_id",
        ].filter((field) => Object.hasOwn(connection, field));
        const missing = [...requiredFields].filter((field) => !suppliedFields.includes(field));
        const unrelated = suppliedFields.filter((field) => !requiredFields.has(field));
        if (missing.length || unrelated.length) {
          throw new Error(`connections[${index}] endpoint IDs do not match ${connection.relationship_type}`);
        }
        return {
          from: objectNetwork.identity(specification[0][0], connection[specification[0][1]]),
          to: objectNetwork.identity(specification[1][0], connection[specification[1][1]]),
          linked: connection.linked,
        };
      });
      return objectNetwork.setConnections(hydrated, {
        ...context,
        actorType: "tool",
        actorName: "object_connection_set",
        source: "agent-slayer",
        channel: context.channel ?? "agent",
      });
    },
  });
}
