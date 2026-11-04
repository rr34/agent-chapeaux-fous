import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { objectReferenceGroupsFromToolResult } from "./object-references.mjs";

export const outcomeEvidenceBindingsMetadataKey = "agent-slayer/outcome-evidence-bindings";
export const outcomeEvidenceBindingsProtocol = "agent-slayer.outcome-evidence-bindings";
export const outcomeEvidenceBindingsVersion = 1;

const schema = JSON.parse(fs.readFileSync(
  new URL("../config/protocol-schemas/outcome-evidence-bindings.v1.schema.json", import.meta.url),
  "utf8",
));
const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);

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

function schemaAtPointer(root, segments) {
  let current = root;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return null;
    current = segment === "*" ? current.items : current.properties?.[segment];
  }
  return current ?? null;
}

export function defineOutcomeEvidenceBindings(bindings) {
  return {
    protocol: outcomeEvidenceBindingsProtocol,
    version: outcomeEvidenceBindingsVersion,
    bindings,
  };
}

export function validateOutcomeEvidenceBindings(value, { label = "tool" } = {}) {
  if (!validateSchema(value)) {
    const problem = validateSchema.errors?.[0];
    throw new Error(`${label} has invalid _meta["${outcomeEvidenceBindingsMetadataKey}"]: ${problem?.instancePath || "/"} ${problem?.message}`);
  }
  const paths = value.bindings.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    throw new Error(`${label} outcome-evidence binding paths must be unique`);
  }
  if (value.bindings.some((binding) => (
    binding.effect === "supporting" && binding.countsTowardOutcome
  ))) {
    throw new Error(`${label} supporting outcome evidence cannot count toward an outcome`);
  }
  return value;
}

export function outcomeEvidenceBindingSchemaProblem(tool, declaredObjectTypes = null) {
  const contract = tool?._meta?.[outcomeEvidenceBindingsMetadataKey]
    ?? tool?.metadata?.[outcomeEvidenceBindingsMetadataKey];
  if (!contract) return null;
  if (!tool.outputSchema) {
    return `${tool.name} publishes outcome-evidence bindings without an output schema`;
  }
  for (const binding of contract.bindings) {
    if (declaredObjectTypes && !declaredObjectTypes.has(binding.objectType)) {
      return `${tool.name} binds outcome evidence to undeclared object type ${binding.objectType}`;
    }
    if (!schemaAtPointer(tool.outputSchema, pointerSegments(binding.path))) {
      return `${tool.name} binds missing output schema path ${binding.path}`;
    }
  }
  return null;
}

export function outcomeEvidenceReferences({
  toolDefinition, toolDefinitions = [], result, sourceEventSeq = null,
}) {
  const contract = toolDefinition?.metadata?.[outcomeEvidenceBindingsMetadataKey];
  if (!contract) return null;
  const groups = [];
  const evidence = [];
  for (const binding of contract.bindings) {
    const references = valuesAt(result, pointerSegments(binding.path)).flatMap((value) => (
      objectReferenceGroupsFromToolResult({
        toolDefinition, toolDefinitions, result: value, sourceEventSeq, exactRecords: true,
      }).filter(({ type }) => type === binding.objectType)
        .map((group) => ({ ...group, role: binding.role ?? group.role }))
    ));
    const objectRefs = [...new Set(references.flatMap(({ objects = [] }) => (
      objects.map(({ ref }) => ref).filter(Boolean)
    )))];
    evidence.push({ ...binding, objectRefs });
    if (binding.countsTowardOutcome) groups.push(...references);
  }
  return { groups, evidence };
}
