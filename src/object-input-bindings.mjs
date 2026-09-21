import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { flatObjectReferences } from "./object-references.mjs";

export const objectInputBindingsMetadataKey = "agent-slayer/object-input-bindings";
export const objectInputBindingsProtocol = "agent-slayer.object-input-bindings";
export const objectInputBindingsVersion = 1;

const schema = JSON.parse(fs.readFileSync(
  new URL("../config/protocol-schemas/object-input-bindings.v1.schema.json", import.meta.url), "utf8",
));
const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);

export function validateObjectInputBindings(value, { label = "tool" } = {}) {
  if (!validateSchema(value)) {
    const problem = validateSchema.errors?.[0];
    throw new Error(`${label} has invalid _meta["${objectInputBindingsMetadataKey}"]: ${problem?.instancePath || "/"} ${problem?.message}`);
  }
  const paths = value.bindings.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    throw new Error(`${label} object-input binding paths must be unique`);
  }
  return value;
}

function pointerSegments(path) {
  return path.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function valuesAt(value, segments, index = 0) {
  if (index === segments.length) return [value];
  if (value == null) return [];
  const segment = segments[index];
  if (segment === "*") {
    const children = Array.isArray(value) ? value : Object.values(value);
    return children.flatMap((child) => valuesAt(child, segments, index + 1));
  }
  return valuesAt(value[segment], segments, index + 1);
}

function referencesFor(toolDefinition, objectType, selectedGroups, observedGroups) {
  const source = toolDefinition?.source;
  const artifactBridge = toolDefinition?.metadata?.["agent-slayer/artifactUpload"];
  const sourceMatches = (object) => object.source === source
    || (source === "local" && object.source.startsWith("native:"))
    || (artifactBridge && objectType === "files.file" && object.source === "native:files");
  const selected = flatObjectReferences(selectedGroups)
    .filter((object) => object.type === objectType && sourceMatches(object));
  return selected.length ? selected : flatObjectReferences(observedGroups)
    .filter((object) => object.type === objectType && sourceMatches(object));
}

function schemaAtPointer(root, segments) {
  let current = root;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return null;
    if (segment === "*") current = current.items;
    else current = current.properties?.[segment];
  }
  return current ?? null;
}

export function constrainToolObjectInputs(toolDefinition, selectedGroups = [], observedGroups = []) {
  const contract = toolDefinition?.metadata?.[objectInputBindingsMetadataKey];
  if (!contract) return toolDefinition;
  const inputSchema = structuredClone(toolDefinition.inputSchema);
  let changed = false;
  for (const binding of contract.bindings) {
    const references = referencesFor(
      toolDefinition, binding.objectType, selectedGroups, observedGroups,
    );
    if (!references.length) continue;
    const allowed = [...new Set(references.map((object) => object[binding.value]))];
    const target = schemaAtPointer(inputSchema, pointerSegments(binding.path));
    if (!target) continue;
    target.enum = allowed;
    changed = true;
  }
  return changed ? { ...toolDefinition, inputSchema } : toolDefinition;
}

export function objectInputBindingProblem({
  toolDefinition, argumentsObject, selectedGroups = [], observedGroups = [],
}) {
  const contract = toolDefinition?.metadata?.[objectInputBindingsMetadataKey];
  if (!contract) return null;
  for (const binding of contract.bindings) {
    const supplied = valuesAt(argumentsObject, pointerSegments(binding.path))
      .filter((value) => value !== undefined && value !== null);
    if (!supplied.length) continue;
    const references = referencesFor(
      toolDefinition, binding.objectType, selectedGroups, observedGroups,
    );
    const allowed = new Set(references.map((object) => object[binding.value]));
    const invalid = supplied.find((value) => !allowed.has(value));
    if (invalid === undefined) continue;
    if (!references.length && binding.allowUnbound === true) continue;
    if (!references.length) {
      return `${toolDefinition.name}${binding.path} requires a verified ${binding.objectType} binding from its owning read tool; ${JSON.stringify(invalid)} is not identified`;
    }
    const exact = references.map(({ id, ref, display }) => ({ id, ref, display }));
    return `${toolDefinition.name}${binding.path} must use the exact ${binding.value} from the accepted ${binding.objectType} binding: ${JSON.stringify(exact)}`;
  }
  return null;
}

export function objectInputBindingSchemaProblem(tool, declaredObjectTypes) {
  const contract = tool?._meta?.[objectInputBindingsMetadataKey];
  if (!contract) return null;
  for (const binding of contract.bindings) {
    if (!declaredObjectTypes.has(binding.objectType)) {
      return `${tool.name} binds ${binding.path} to undeclared object type ${binding.objectType}`;
    }
    if (!schemaAtPointer(tool.inputSchema, pointerSegments(binding.path))) {
      return `${tool.name} binds missing input schema path ${binding.path}`;
    }
  }
  return null;
}
