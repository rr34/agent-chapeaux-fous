import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

export const objectDescriptionMetadataKey = "agent-slayer/objects";
export const objectDescriptionProtocol = "agent-slayer.object-description";
export const objectDescriptionVersion = 1;

const schema = JSON.parse(fs.readFileSync(
  new URL("../config/protocol-schemas/object-description.v1.schema.json", import.meta.url), "utf8",
));
const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);

export function validateObjectDescription(value, { annotations, selection, label = "tool" } = {}) {
  if (!validateSchema(value)) {
    const problem = validateSchema.errors?.[0];
    throw new Error(`${label} has an invalid _meta["${objectDescriptionMetadataKey}"]: ${problem?.instancePath || "/"} ${problem?.message}`);
  }
  if (annotations?.readOnlyHint !== true || selection?.effectClassifications?.length !== 1
    || selection.effectClassifications[0] !== "READ-ONLY") {
    throw new Error(`${label} Object Description requires a read-only tool with a valid read-only Tool Description`);
  }
  const prose = value.types.flatMap((type) => [
    type.title, type.summary, ...(type.aliases ?? []),
    type.identity.field, type.identity.summary,
    type.reference.field, type.reference.summary, type.display.field, type.display.summary,
    ...type.qualifiers.flatMap(({ field, summary }) => [field, summary]),
    ...(type.relationships ?? []).flatMap(({ name, summary }) => [name, summary]),
  ]);
  if (prose.some((part) => part !== part.trim() || /[\r\n\u0000-\u001f]/u.test(part))) {
    throw new Error(`${label} Object Description text must be trimmed and single-line`);
  }
  const ids = value.types.map((type) => type.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} Object Description type IDs must be unique`);
  }
  for (const type of value.types) {
    const relationships = (type.relationships ?? []).map(({ name }) => name);
    if (new Set(relationships).size !== relationships.length) {
      throw new Error(`${label} Object Description ${type.id} relationship names must be unique`);
    }
  }
  return value;
}
