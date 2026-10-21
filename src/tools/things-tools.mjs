import { physicalItemConditions, physicalItemStatuses } from "../physical-items.mjs";

const toolDescriptions = Object.freeze({
  physical_item_group_list: { summary: "List active named Things groups and their physical-item counts." },
  physical_item_group_create: { summary: "Create or reactivate one named Things group." },
  physical_item_group_update: { summary: "Rename or archive one exact Things group." },
  physical_item_list: { summary: "Search or list the user's physical possessions by exact group, status, or descriptive text." },
  physical_item_create: { summary: "Create one physical possession in an exact Things group." },
  physical_item_update: { summary: "Update or archive one exact physical possession while preserving optimistic concurrency." },
  physical_item_link_set: { summary: "Atomically connect, change, or disconnect physical items and exact to-dos, content, files, or contacts." },
});

function toolGroup(group) {
  return {
    physical_item_group_id: group.id,
    name: group.name,
    sort_position: group.sortPosition,
    archived_at_utc: group.archivedAtUtc,
    item_count: group.itemCount,
    ref: `agent-slayer://physical-item-groups/${group.id}`,
  };
}

function toolItem(item) {
  return {
    physical_item_id: item.id,
    physical_item_group_id: item.groupId,
    group_name: item.groupName,
    name: item.name,
    description: item.description,
    personal_notes: item.personalNotes,
    quantity: item.quantity,
    location_text: item.location,
    item_condition: item.condition,
    status: item.status,
    manufacturer: item.manufacturer,
    model_number: item.modelNumber,
    serial_number: item.serialNumber,
    acquired_on: item.acquiredOn,
    sort_position: item.sortPosition,
    created_at_utc: item.createdAtUtc,
    updated_at_utc: item.updatedAtUtc,
    version: item.version,
    ref: `agent-slayer://physical-items/${item.id}`,
    linked_todos: item.linkedTodos ?? [],
    linked_content: item.linkedContent ?? [],
    linked_files: item.linkedFiles ?? [],
    linked_contacts: item.linkedContacts ?? [],
  };
}

const groupSchema = {
  type: "object",
  properties: {
    physical_item_group_id: { type: "integer" }, name: { type: "string" },
    sort_position: { type: "integer" }, archived_at_utc: {}, item_count: { type: "integer" },
    ref: { type: "string" },
  },
};

const itemSchema = {
  type: "object",
  properties: {
    physical_item_id: { type: "integer" }, physical_item_group_id: { type: "integer" },
    group_name: { type: "string" }, name: { type: "string" }, description: {}, personal_notes: {},
    quantity: { type: "integer" }, location_text: {}, item_condition: { type: "string" }, status: { type: "string" },
    manufacturer: {}, model_number: {}, serial_number: {}, acquired_on: {}, sort_position: { type: "integer" },
    created_at_utc: {}, updated_at_utc: {}, version: { type: "integer" }, ref: { type: "string" },
    linked_todos: { type: "array", items: { type: "object", properties: {} } },
    linked_content: { type: "array", items: { type: "object", properties: {} } },
    linked_files: { type: "array", items: { type: "object", properties: {} } },
    linked_contacts: { type: "array", items: { type: "object", properties: {} } },
  },
};

const nullableText = { type: ["string", "null"] };
const editableProperties = {
  physical_item_group_id: { type: "integer", minimum: 1 },
  name: { type: "string", minLength: 1, maxLength: 500 },
  description: nullableText,
  personal_notes: nullableText,
  quantity: { type: "integer", minimum: 1 },
  location_text: nullableText,
  item_condition: { type: "string", enum: physicalItemConditions },
  status: { type: "string", enum: physicalItemStatuses },
  manufacturer: nullableText,
  model_number: nullableText,
  serial_number: nullableText,
  acquired_on: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
};

const nativeToolContracts = Object.freeze({
  physical_item_group_list: { objectTypes: ["things.physical_item_group"] },
  physical_item_list: { objectTypes: ["things.physical_item"], allowUnboundInputs: true },
});

export function registerThingsTools(registry, physicalItems) {
  const rootRegistry = registry;
  registry = registry.withCapability?.("things", toolDescriptions, nativeToolContracts) ?? registry;
  rootRegistry.registerContextView?.("things", {
    id: "things.active_groups",
    title: "Active Things groups",
    description: "Exact active Things group names and IDs for creating or moving physical items.",
    maximumItems: 100,
    execute() {
      const groups = physicalItems.listGroups().slice(0, 100);
      return {
        heading: "Active Things groups",
        text: groups.length ? ["Use these exact existing group IDs when they match the request.",
          ...groups.map((group) => `- [group ${group.id}] ${group.name}`)].join("\n") : "No active Things groups exist.",
        data: { groups, totalCount: groups.length, omittedCount: 0 },
      };
    },
  });

  registry.register({
    name: "physical_item_group_list",
    description: "List active named groups that organize physical possessions.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    outputSchema: { type: "object", properties: { groups: { type: "array", items: groupSchema } } },
    async execute() { return { groups: physicalItems.listGroups().map(toolGroup) }; },
  });

  registry.register({
    name: "physical_item_group_create",
    description: "Create one named Things group, or reactivate an archived group with the same name.",
    parameters: { type: "object", additionalProperties: false, properties: { name: { type: "string", minLength: 1, maxLength: 200 } }, required: ["name"] },
    outputSchema: { type: "object", properties: { group: groupSchema } },
    async execute(input, context) { return { group: toolGroup(physicalItems.createGroup(input, { ...context, actorType: "tool", actorName: "physical_item_group_create", channel: context.channel ?? "agent" })) }; },
  });

  registry.register({
    name: "physical_item_group_update",
    description: "Rename or archive one exact Things group. Archiving is rejected while non-archived physical items remain in it.",
    parameters: { type: "object", additionalProperties: false, properties: {
      physical_item_group_id: { type: "integer", minimum: 1 }, name: { type: ["string", "null"], minLength: 1, maxLength: 200 }, archived: { type: ["boolean", "null"] },
    }, required: ["physical_item_group_id"] },
    outputSchema: { type: "object", properties: { group: groupSchema } },
    async execute({ physical_item_group_id: id, ...input }, context) {
      const changes = { ...(input.name != null ? { name: input.name } : {}), ...(input.archived != null ? { archived: input.archived } : {}) };
      return { group: toolGroup(physicalItems.updateGroup(id, changes, { ...context, actorType: "tool", actorName: "physical_item_group_update", channel: context.channel ?? "agent" })) };
    },
  });

  registry.register({
    name: "physical_item_list",
    description: "List or search physical possessions with their exact linked to-dos, content-library items, files, and contacts. Null status returns currently possessed, loaned, or lost items and excludes disposed or archived history.",
    parameters: { type: "object", additionalProperties: false, properties: {
      physical_item_group_id: { type: ["integer", "null"], minimum: 1 },
      status: { type: ["string", "null"], enum: [...physicalItemStatuses, null] },
      text_query: { type: ["string", "null"], maxLength: 500 },
      limit: { type: "integer", minimum: 1, maximum: 5000 },
    }, required: [] },
    outputSchema: { type: "object", properties: { items: { type: "array", items: itemSchema }, count: { type: "integer" } } },
    async execute(input) {
      const items = physicalItems.list({ groupId: input.physical_item_group_id, status: input.status, query: input.text_query, limit: input.limit ?? 200 }).map(toolItem);
      return { count: items.length, items };
    },
  });

  registry.register({
    name: "physical_item_create",
    description: "Create one physical possession in an exact active Things group. Notes describe the item; actionable work remains a linked to-do.",
    parameters: { type: "object", additionalProperties: false, properties: editableProperties, required: ["physical_item_group_id", "name"] },
    outputSchema: { type: "object", properties: { item: itemSchema } },
    async execute(input, context) { return { item: toolItem(physicalItems.create(input, { ...context, actorType: "tool", actorName: "physical_item_create", channel: context.channel ?? "agent" })) }; },
  });

  registry.register({
    name: "physical_item_update",
    description: "Update one exact physical possession. Supply its current version from physical_item_list to prevent overwriting a concurrent edit.",
    parameters: { type: "object", additionalProperties: false, properties: {
      physical_item_id: { type: "integer", minimum: 1 }, version: { type: "integer", minimum: 1 }, ...editableProperties,
    }, required: ["physical_item_id", "version"] },
    outputSchema: { type: "object", properties: { item: itemSchema } },
    async execute({ physical_item_id: id, ...input }, context) { return { item: toolItem(physicalItems.update(id, input, { ...context, actorType: "tool", actorName: "physical_item_update", channel: context.channel ?? "agent" })) }; },
  });

  registry.register({
    name: "physical_item_link_set",
    description: "Atomically connect or disconnect 1 through 500 exact physical items and exact to-dos, content-library items, durable files, or contacts. relationship_kind records the owning meaning; use attachment for an otherwise-unspecified file role and related for other unspecified links.",
    parameters: { type: "object", additionalProperties: false, properties: {
      links: { type: "array", minItems: 1, maxItems: 500, items: { type: "object", additionalProperties: false, properties: {
        physical_item_id: { type: "integer", minimum: 1 }, target_type: { type: "string", enum: ["todo", "content", "file", "contact"] },
        target_id: { type: "integer", minimum: 1 }, relationship_kind: { type: ["string", "null"], maxLength: 100 }, linked: { type: "boolean" },
      }, required: ["physical_item_id", "target_type", "target_id", "linked"] } },
    }, required: ["links"] },
    outputSchema: { type: "object", properties: {
      selected_count: { type: "integer" }, changed_count: { type: "integer" }, unchanged_count: { type: "integer" },
      results: { type: "array", items: { type: "object", properties: {} } },
    } },
    async execute({ links }, context) { return physicalItems.setLinks(links, { ...context, actorType: "tool", actorName: "physical_item_link_set", channel: context.channel ?? "agent" }); },
  });
}
