import fs from "node:fs";
import {
  loadCapabilityPackages, validateNativeResourceCoverage,
} from "../src/capability-packages.mjs";
import { nativeFirstClassObjectTypes } from "../src/native-object-types.mjs";
import { nativeGlobalSearchObjectTypes } from "../src/search/native-search.mjs";
import { baselineFilename } from "./agent-schema.mjs";

const packages = loadCapabilityPackages();
const toolHints = packages.reduce((count, capability) => count + (capability.readOnlyTools?.length ?? 0), 0);
const schema = fs.readFileSync(baselineFilename, "utf8");
const relationshipTables = [...schema.matchAll(/^CREATE TABLE ([a-z][a-z0-9_]*_join) \(/gmu)]
  .map(([, table]) => table);
validateNativeResourceCoverage(packages, {
  objectTypes: nativeFirstClassObjectTypes,
  relationshipTables,
});
const resources = packages.flatMap(({ resources = [] }) => resources);
const localFirstClassObjectTypes = nativeFirstClassObjectTypes
  .filter(({ table }) => table)
  .map(({ id }) => id)
  .sort();
if (JSON.stringify([...nativeGlobalSearchObjectTypes].sort()) !== JSON.stringify(localFirstClassObjectTypes)) {
  throw new Error("Global search provider ownership does not match the local first-class object catalog.");
}
const unimplemented = resources.flatMap((resource) => Object.entries(resource.operations ?? {})
  .filter(([, operation]) => operation.unavailable === "unimplemented")
  .map(([operation]) => `${resource.id}.${operation}`));

console.log(`Verified ${packages.length} native capability packages, ${resources.length} resource declarations, ${nativeFirstClassObjectTypes.length} first-class object lifecycles, ${relationshipTables.length} relationship tables, ${nativeGlobalSearchObjectTypes.length} global-search object owners, ${unimplemented.length} explicit implementation gaps, and ${toolHints} read-only tool declarations.`);
if (unimplemented.length) console.log(`Known lifecycle gaps: ${unimplemented.join(", ")}`);
