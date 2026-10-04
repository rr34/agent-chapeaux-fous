import {
  objectInputBindingsMetadataKey,
  objectInputBindingsProtocol,
  objectInputBindingsVersion,
  validateObjectInputBindings,
} from "./object-input-bindings.mjs";
import { nativeObjectInputFields } from "./native-object-types.mjs";

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
  const roles = tool.nativeObjectInputRoles ?? {};
  const bindings = declaredBindings(tool.parameters).map((binding) => {
    const withRole = {
      ...binding,
      role: roles[binding.path] ?? "subject",
    };
    return tool.allowUnboundObjectInputs === true
      ? { ...withRole, allowUnbound: true }
      : withRole;
  });
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
