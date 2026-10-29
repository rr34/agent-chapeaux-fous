import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

export const musicMetadataSchema = Object.freeze(JSON.parse(fs.readFileSync(
  new URL("../config/music-metadata.v1.schema.json", import.meta.url),
  "utf8",
)));

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(musicMetadataSchema);

function validationMessage() {
  return (validate.errors ?? []).slice(0, 8).map((error) => (
    `${error.instancePath || "/"} ${error.message}`
  )).join("; ");
}

export function validateMusicMetadata(value) {
  const valid = validate(value);
  return valid ? { valid: true, errors: [] } : {
    valid: false,
    errors: (validate.errors ?? []).map((error) => ({
      path: error.instancePath || "/",
      message: error.message,
    })),
  };
}

export function serializeMusicMetadata(value) {
  if (!validate(value)) {
    throw Object.assign(new Error(`Music metadata is invalid: ${validationMessage()}`), { statusCode: 400 });
  }
  return JSON.stringify(value, null, 2);
}

export function parseMusicMetadataDescription(description) {
  if (typeof description !== "string" || !description.trim()) {
    return { metadata: null, error: "File description does not contain music metadata" };
  }
  let metadata;
  try { metadata = JSON.parse(description); }
  catch { return { metadata: null, error: "File description is not JSON" }; }
  const result = validateMusicMetadata(metadata);
  return result.valid
    ? { metadata, error: null }
    : { metadata: null, error: `Music metadata is invalid: ${result.errors[0]?.path} ${result.errors[0]?.message}` };
}

export function emptyMusicMetadata() {
  return {
    schemaVersion: 1,
    work: { type: null, title: null, version: null, creators: null, catalogue: null },
    sequence1: null,
    sequence2: null,
    performers: null,
    genres: null,
    languages: null,
    compositionDate: null,
    performanceDate: null,
    notes: null,
  };
}

const {
  $schema: _schema,
  $id: _id,
  title: _title,
  description: _description,
  ...musicMetadataToolInput
} = musicMetadataSchema;

export const musicMetadataInputSchema = Object.freeze(musicMetadataToolInput);
