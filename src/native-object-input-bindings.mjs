import {
  objectInputBindingsMetadataKey,
  objectInputBindingsProtocol,
  objectInputBindingsVersion,
  validateObjectInputBindings,
} from "./object-input-bindings.mjs";
import { nativeObjectInputFields } from "./native-object-types.mjs";

// This is an application-owned declaration, not a naming heuristic. Adding a
// native first-class ID input requires review here just as a remote provider
// must publish the equivalent metadata on its tool.
const identifyingReads = new Set([
  "file_get", "file_read", "file_structure_inspect", "file_text_search",
  "file_table_inspect", "file_table_read_rows",
  "todo_list", "interaction_guide_get", "catch_up_list",
  "email_mailbox_list", "email_identity_list", "email_search", "email_get",
  "email_thread_get", "email_changes", "email_submission_get", "email_attachment_get",
  "video_script_get", "video_content_list",
]);

function escaped(name) {
  return name.replaceAll("~", "~0").replaceAll("/", "~1");
}

function declaredBindings(schema, path = "", output = [], visited = new Set()) {
  if (!schema || typeof schema !== "object" || visited.has(schema)) return output;
  visited.add(schema);
  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    const childPath = `${path}/${escaped(name)}`;
    const declared = nativeObjectInputFields[name];
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
