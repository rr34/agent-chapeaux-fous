import { objectDescriptionMetadataKey } from "./object-description.mjs";
import { nativeObjectDescriptionForTypes } from "./native-object-types.mjs";

export function applyNativeObjectDescription(tool) {
  const description = nativeObjectDescriptionForTypes(tool.nativeObjectTypes ?? []);
  if (!description) return tool;
  return {
    ...tool,
    metadata: {
      ...(tool.metadata ?? {}),
      [objectDescriptionMetadataKey]: description,
    },
  };
}
