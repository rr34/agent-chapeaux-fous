import { objectDescriptionMetadataKey } from "./object-description.mjs";
import { nativeObjectDescriptionForTool } from "./native-object-types.mjs";

export function applyNativeObjectDescription(tool) {
  const description = nativeObjectDescriptionForTool(tool.name);
  if (!description) return tool;
  return {
    ...tool,
    metadata: {
      ...(tool.metadata ?? {}),
      [objectDescriptionMetadataKey]: description,
    },
  };
}
