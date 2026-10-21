import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

export const capabilityManifestProtocol = "agent-slayer.capability";
export const capabilityManifestVersion = 1;
export const defaultCapabilityPackagesRoot = fileURLToPath(
  new URL("../config/capabilities/", import.meta.url),
);

const manifestSchema = JSON.parse(fs.readFileSync(
  new URL("../config/protocol-schemas/capability-manifest.v1.schema.json", import.meta.url),
  "utf8",
));
const validateSchema = new Ajv2020({ allErrors: true }).compile(manifestSchema);
const packageFiles = new Set(["capability.json", "guidance.md"]);
const objectOperations = ["create", "read", "update", "delete"];
const relationshipOperations = ["link", "read", "update", "unlink"];
const operationAction = Object.freeze({
  create: "CREATE", link: "CREATE", read: "READ",
  update: "UPDATE", delete: "DELETE", unlink: "DELETE",
});

function normalizedSingleLine(value, label) {
  if (value !== value.trim() || /[\r\n\u0000-\u001f]/u.test(value)) {
    throw new Error(`${label} must be trimmed single-line text`);
  }
  return value;
}

function schemaError(filename) {
  const problem = validateSchema.errors?.[0];
  return `${filename}${problem?.instancePath || "/"} ${problem?.message || "is invalid"}`;
}

function readPackage(capabilityRoot, directoryName) {
  const packageRoot = path.join(capabilityRoot, directoryName);
  const entries = fs.readdirSync(packageRoot, { withFileTypes: true });
  const unexpected = entries.find((entry) => !entry.isFile() || !packageFiles.has(entry.name));
  if (unexpected) {
    throw new Error(`Capability package ${directoryName} has unexpected entry: ${unexpected.name}`);
  }
  for (const required of packageFiles) {
    if (!entries.some((entry) => entry.name === required)) {
      throw new Error(`Capability package ${directoryName} is missing ${required}`);
    }
  }
  const filename = path.join(packageRoot, "capability.json");
  let document;
  try {
    document = JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse ${filename}: ${error.message}`);
  }
  if (!validateSchema(document)) throw new Error(schemaError(filename));
  if (document.id !== directoryName) {
    throw new Error(`Capability package directory ${directoryName} must match manifest ID ${document.id}`);
  }
  for (const field of [document.title, document.summary, ...document.aliases]) {
    normalizedSingleLine(field, `Capability ${document.id} text`);
  }
  const normalizedAliases = document.aliases.map((alias) => alias.toLocaleLowerCase("en-US"));
  if (new Set(normalizedAliases).size !== normalizedAliases.length) {
    throw new Error(`Capability ${document.id} aliases must be case-insensitively unique`);
  }
  const resourceIds = (document.resources ?? []).map(({ id }) => id);
  if (new Set(resourceIds).size !== resourceIds.length) {
    throw new Error(`Capability ${document.id} resource IDs must be unique`);
  }
  for (const resource of document.resources ?? []) {
    for (const field of [resource.title, resource.summary, resource.reason].filter(Boolean)) {
      normalizedSingleLine(field, `Capability ${document.id} resource ${resource.id} text`);
    }
    const expected = resource.kind === "object" ? objectOperations : relationshipOperations;
    if (resource.management === "user") {
      const unexpected = Object.keys(resource.operations).find((name) => !expected.includes(name));
      if (unexpected) {
        throw new Error(`Capability ${document.id} resource ${resource.id} cannot declare ${unexpected}`);
      }
    }
  }
  const guidance = fs.readFileSync(path.join(packageRoot, document.guidance), "utf8").trim();
  if (!guidance) throw new Error(`Capability ${document.id} guidance is empty`);
  const { $schema: _schema, guidance: guidanceFile, ...manifest } = document;
  return Object.freeze({ ...manifest, guidanceFile, guidance });
}

export function loadCapabilityPackages({ capabilityRoot = defaultCapabilityPackagesRoot } = {}) {
  const root = path.resolve(capabilityRoot);
  const directories = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
  if (!directories.length) throw new Error(`No native capability packages found in ${root}`);
  const manifests = directories.map((directory) => readPackage(root, directory));
  const ids = manifests.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("Native capability package IDs must be unique");
  const resourceOwners = new Map();
  for (const manifest of manifests) {
    for (const resource of manifest.resources ?? []) {
      if (resourceOwners.has(resource.id)) {
        throw new Error(`Native resource ${resource.id} is declared by both ${resourceOwners.get(resource.id)} and ${manifest.id}`);
      }
      resourceOwners.set(resource.id, manifest.id);
    }
  }
  return Object.freeze(manifests);
}

export function resourceOperationsForTool(manifests, toolName) {
  const matches = [];
  for (const manifest of manifests) {
    for (const resource of manifest.resources ?? []) {
      for (const [operation, contract] of Object.entries(resource.operations ?? {})) {
        if (contract.tool !== toolName) continue;
        matches.push({ capabilityId: manifest.id, resource, operation, contract });
      }
    }
  }
  return matches;
}

export function resourceToolDescriptionDefaults(manifests, toolName) {
  const operations = resourceOperationsForTool(manifests, toolName);
  if (!operations.length) return null;
  const actionClasses = [...new Set(operations.map(({ operation }) => operationAction[operation]))]
    .sort((left, right) => ["CREATE", "READ", "UPDATE", "DELETE", "EXECUTE"].indexOf(left)
      - ["CREATE", "READ", "UPDATE", "DELETE", "EXECUTE"].indexOf(right));
  const mutating = actionClasses.some((action) => action !== "READ");
  const destructive = operations.some(({ contract }) => contract.destructive === true);
  const effectClassifications = mutating
    ? ["MUTATING", ...(destructive ? ["DESTRUCTIVE"] : [])]
    : ["READ-ONLY"];
  const resources = [...new Map(operations.map(({ resource }) => [resource.id, resource])).values()];
  const verbs = actionClasses.map((action) => action.toLocaleLowerCase("en-US")).join(", ");
  const labels = resources.map((resource) => resource.title ?? resource.id).join(", ");
  return {
    summary: `${verbs.slice(0, 1).toLocaleUpperCase("en-US")}${verbs.slice(1)} ${labels} through the authoritative resource lifecycle.`,
    actionClasses,
    effectClassifications,
    operations,
  };
}

export function publicResource(resource) {
  return {
    id: resource.id,
    kind: resource.kind,
    ...(resource.title ? { title: resource.title } : {}),
    ...(resource.summary ? { summary: resource.summary } : {}),
    management: resource.management,
    ...(resource.reason ? { reason: resource.reason } : {}),
    ...(resource.endpoints ? { endpoints: resource.endpoints } : {}),
    ...(resource.operations ? {
      operations: Object.fromEntries(Object.entries(resource.operations).map(([name, operation]) => (
        operation.unavailable
          ? [name, { available: false, status: operation.unavailable, reason: operation.reason }]
          : [name, {
              available: true,
              tool: operation.tool,
              batch: operation.batch.mode,
              ...(operation.note ? { note: operation.note } : {}),
            }]
      ))),
    } : {}),
  };
}

export function validateNativeResourceCoverage(manifests, {
  objectTypes = [], relationshipTables = [],
} = {}) {
  const resources = manifests.flatMap((manifest) => (
    (manifest.resources ?? []).map((resource) => ({ ...resource, capabilityId: manifest.id }))
  ));
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const findings = [];
  for (const type of objectTypes) {
    const resource = byId.get(type.id);
    if (!resource) findings.push(`${type.id} has no native resource declaration`);
    else if (resource.kind !== "object") findings.push(`${type.id} is not declared as an object resource`);
    else if (resource.capabilityId !== type.capabilityId) {
      findings.push(`${type.id} is owned by ${resource.capabilityId}, expected ${type.capabilityId}`);
    }
  }
  const objectIds = new Set(objectTypes.map(({ id }) => id));
  for (const resource of resources.filter(({ kind }) => kind === "object")) {
    if (!objectIds.has(resource.id)) findings.push(`${resource.id} has no canonical native object type`);
  }
  const declaredTables = new Map();
  for (const resource of resources.filter(({ kind }) => kind === "relationship")) {
    const table = resource.storage?.table;
    if (!table) continue;
    const previous = declaredTables.get(table);
    if (previous) findings.push(`${table} is classified by both ${previous} and ${resource.id}`);
    else declaredTables.set(table, resource.id);
  }
  for (const table of relationshipTables) {
    if (!declaredTables.has(table)) findings.push(`${table} has no native relationship resource declaration`);
  }
  for (const [table, id] of declaredTables) {
    if (!relationshipTables.includes(table)) findings.push(`${id} names non-relationship storage table ${table}`);
  }
  if (findings.length) throw new Error(`Native resource coverage mismatch: ${findings.join("; ")}`);
  return true;
}

function schemaAtPointer(schema, pointer) {
  let value = schema;
  for (const raw of pointer.slice(1).split("/")) {
    const segment = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    value = value?.properties?.[segment];
    if (!value) return null;
  }
  return value;
}

export function validateRegisteredCapabilities(manifests, tools) {
  const byId = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const findings = [];
  for (const tool of tools.filter(({ source }) => String(source ?? "local") === "local")) {
    if (!tool.capabilityId || !byId.has(tool.capabilityId)) {
      findings.push(`${tool.name} has undeclared native capability ${tool.capabilityId ?? "(none)"}`);
    }
  }
  for (const manifest of manifests) {
    for (const name of manifest.readOnlyTools ?? []) {
      const tool = byName.get(name);
      if (!tool) continue;
      else if (tool.capabilityId !== manifest.id) findings.push(`${manifest.id}.readOnlyTools names tool ${name} owned by ${tool.capabilityId}`);
      else if (tool.annotations?.readOnlyHint !== true) findings.push(`${manifest.id}.readOnlyTools conflicts with ${name} annotations`);
    }
    for (const name of manifest.dependentTools ?? []) {
      const tool = byName.get(name);
      if (tool?.capabilityId === manifest.id) {
        findings.push(`${manifest.id}.dependentTools names same-capability tool ${name}`);
      }
    }
    const capabilityActive = tools.some((tool) => tool.capabilityId === manifest.id);
    if (capabilityActive) {
      for (const resource of manifest.resources ?? []) {
        for (const [operation, contract] of Object.entries(resource.operations ?? {})) {
          if (contract.unavailable) continue;
          const tool = byName.get(contract.tool);
          if (!tool) findings.push(`${manifest.id}.${resource.id}.${operation} names unavailable tool ${contract.tool}`);
          else if (contract.batch.mode === "array") {
            const collection = schemaAtPointer(tool.inputSchema ?? tool.parameters, contract.batch.input);
            if (collection?.type !== "array" || collection.minItems !== 1 || !Number.isSafeInteger(collection.maxItems)) {
              findings.push(`${manifest.id}.${resource.id}.${operation} batch path ${contract.batch.input} is not a bounded nonempty array on ${contract.tool}`);
            }
          }
        }
      }
    }
  }
  for (const tool of tools.filter(({ source }) => String(source ?? "local") === "local")) {
    const defaults = resourceToolDescriptionDefaults(manifests, tool.name);
    if (!defaults) continue;
    const selection = tool.metadata?.["agent-slayer/selection"];
    if (!selection) continue;
    if (defaults.actionClasses.some((action) => !selection.actionClasses.includes(action))) {
      findings.push(`${tool.name} actions do not match its resource operations`);
    }
    if (defaults.effectClassifications.some((effect) => !selection.effectClassifications.includes(effect))) {
      findings.push(`${tool.name} effects do not match its resource operations`);
    }
  }
  if (findings.length) throw new Error(`Native capability registration mismatch: ${findings.join("; ")}`);
  return true;
}
