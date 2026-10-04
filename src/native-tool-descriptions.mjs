import { toolDescriptionMetadataKey } from "./tool-description.mjs";

export function assertNativeToolDescriptions(tools) {
  const missing = tools
    .filter((tool) => String(tool.source ?? "local") === "local")
    .filter((tool) => !tool.metadata?.[toolDescriptionMetadataKey])
    .map(({ name }) => name)
    .sort();
  if (missing.length) {
    throw new Error(`Native tools missing implementation-owned Tool Description metadata: ${missing.join(", ")}`);
  }
}
