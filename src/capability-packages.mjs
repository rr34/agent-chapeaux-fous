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
  return Object.freeze(manifests);
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
  }
  if (findings.length) throw new Error(`Native capability registration mismatch: ${findings.join("; ")}`);
  return true;
}
