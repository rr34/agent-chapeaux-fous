import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

export const firstClassObjectBindingSchemaId = "https://agent-slayer.local/schemas/first-class-object-binding.v1.schema.json";
export const firstClassObjectBindingVersion = 1;

export const firstClassObjectBindingSchema = Object.freeze(JSON.parse(fs.readFileSync(
  new URL("../config/protocol-schemas/first-class-object-binding.v1.schema.json", import.meta.url),
  "utf8",
)));

const validateSchema = new Ajv2020({ allErrors: true }).compile(firstClassObjectBindingSchema);

export function firstClassObjectBindingProblem(value) {
  if (validateSchema(value)) return null;
  const problem = validateSchema.errors?.[0];
  return `${problem?.instancePath || "/"} ${problem?.message}`;
}

export function validateFirstClassObjectBinding(value, { label = "object binding" } = {}) {
  const problem = firstClassObjectBindingProblem(value);
  if (problem) throw new Error(`${label} does not conform to ${firstClassObjectBindingSchemaId}: ${problem}`);
  return value;
}
