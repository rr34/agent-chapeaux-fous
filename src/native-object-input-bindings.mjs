import {
  objectInputBindingsMetadataKey,
  objectInputBindingsProtocol,
  objectInputBindingsVersion,
  validateObjectInputBindings,
} from "./object-input-bindings.mjs";

// This is an application-owned declaration, not a naming heuristic. Adding a
// native first-class ID input requires review here just as a remote provider
// must publish the equivalent metadata on its tool.
const nativeFields = Object.freeze({
  contact_id: { objectType: "contacts.contact", value: "id" },
  contact_ids: { objectType: "contacts.contact", value: "id", members: true },
  related_contact_id: { objectType: "contacts.contact", value: "id" },
  keep_contact_id: { objectType: "contacts.contact", value: "id" },
  personal_task_id: { objectType: "todos.personal_task", value: "id" },
  todo_group_id: { objectType: "todos.todo_group", value: "id" },
  calendar_event_id: { objectType: "calendar.event", value: "id" },
  series_calendar_event_id: { objectType: "calendar.event", value: "id" },
  journal_entry_id: { objectType: "journal.entry", value: "id" },
  tracker_id: { objectType: "journal.tracker", value: "id" },
  journal_group_id: { objectType: "journal.group", value: "id" },
  file_id: { objectType: "files.file", value: "id" },
});

const identifyingReads = new Set([
  "file_get", "file_read", "file_structure_inspect", "file_text_search",
  "file_table_inspect", "file_table_read_rows",
]);

function escaped(name) {
  return name.replaceAll("~", "~0").replaceAll("/", "~1");
}

function declaredBindings(schema, path = "", output = [], visited = new Set()) {
  if (!schema || typeof schema !== "object" || visited.has(schema)) return output;
  visited.add(schema);
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const childPath = `${path}/${escaped(name)}`;
    const declared = nativeFields[name];
    if (declared) {
      output.push({
        path: `${childPath}${declared.members ? "/*" : ""}`,
        objectType: declared.objectType,
        value: declared.value,
      });
    }
    declaredBindings(child, childPath, output, visited);
  }
  if (schema.items) declaredBindings(schema.items, `${path}/*`, output, visited);
  for (const branch of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    declaredBindings(branch, path, output, visited);
  }
  return output;
}

export function applyNativeObjectInputBindings(tool) {
  const bindings = declaredBindings(tool.parameters).map((binding) => (
    identifyingReads.has(tool.name) ? { ...binding, allowUnbound: true } : binding
  ));
  if (!bindings.length) return tool;
  const existing = tool.metadata?.[objectInputBindingsMetadataKey]?.bindings ?? [];
  const byPath = new Map([...existing, ...bindings].map((binding) => [binding.path, binding]));
  const contract = validateObjectInputBindings({
    protocol: objectInputBindingsProtocol,
    version: objectInputBindingsVersion,
    bindings: [...byPath.values()],
  }, { label: tool.name });
  return {
    ...tool,
    metadata: {
      ...(tool.metadata ?? {}),
      [objectInputBindingsMetadataKey]: contract,
    },
  };
}
