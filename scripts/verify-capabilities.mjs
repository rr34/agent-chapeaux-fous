import { loadCapabilityPackages } from "../src/capability-packages.mjs";

const packages = loadCapabilityPackages();
const toolHints = packages.reduce((count, capability) => count + (capability.readOnlyTools?.length ?? 0), 0);

console.log(`Verified ${packages.length} native capability packages and ${toolHints} read-only tool declarations.`);
