import {
  defaultCapabilityPackagesRoot,
  loadCapabilityPackages,
  validateRegisteredCapabilities,
} from "./capability-packages.mjs";

export const nativeCapabilityManifests = loadCapabilityPackages();

export function registerNativeCapabilities(registry, manifests = nativeCapabilityManifests) {
  for (const manifest of manifests) registry.registerCapability(manifest);
  return registry;
}

export function nativeCapabilityManifest(capabilityId) {
  return nativeCapabilityManifests.find(({ id }) => id === capabilityId) ?? null;
}

export function validateNativeCapabilityPackages({
  capabilityRoot = defaultCapabilityPackagesRoot,
} = {}) {
  return loadCapabilityPackages({ capabilityRoot });
}

export function assertNativeCapabilityRegistrations(tools, manifests = nativeCapabilityManifests) {
  return validateRegisteredCapabilities(manifests, tools);
}
