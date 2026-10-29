import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

function readSchema(filename) {
  return Object.freeze(JSON.parse(fs.readFileSync(new URL(`../config/${filename}`, import.meta.url), "utf8")));
}

export const musicMetadataSchemaBundle = readSchema("music-metadata.schema.json");
export const legacyMusicMetadataSchema = Object.freeze(musicMetadataSchemaBundle.$defs.v1);
export const musicMetadataSchema = Object.freeze(musicMetadataSchemaBundle.$defs.v2);

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validators = new Map([
  [1, ajv.compile(legacyMusicMetadataSchema)],
  [2, ajv.compile(musicMetadataSchema)],
]);

function validationMessage(validate) {
  return (validate?.errors ?? []).slice(0, 8).map((error) => (
    `${error.instancePath || "/"} ${error.message}`
  )).join("; ");
}

export function validateMusicMetadata(value) {
  const validate = validators.get(value?.schemaVersion);
  if (!validate) return { valid: false, errors: [{ path: "/schemaVersion", message: "must be 1 or 2" }] };
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
  const validate = validators.get(value?.schemaVersion);
  if (!validate || !validate(value)) {
    throw Object.assign(new Error(`Music metadata is invalid: ${validationMessage(validate) || "/schemaVersion must be 1 or 2"}`), { statusCode: 400 });
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

export function musicLibraryEntry(file) {
  const parsed = parseMusicMetadataDescription(file?.description);
  if (!parsed.metadata) return null;
  return { ...file, metadata: normalizeMusicMetadata(parsed.metadata), metadataError: null };
}

function releasePosition() {
  return {
    type: "album",
    title: null,
    version: null,
    discNumber: null,
    discCount: null,
    side: null,
    trackNumber: null,
    trackCount: null,
  };
}

export function normalizeMusicMetadata(metadata) {
  if (metadata?.schemaVersion === 2) return metadata;
  if (metadata?.schemaVersion !== 1) return null;
  const legacyAlbum = metadata.work?.type === "album";
  const releaseTrack = metadata.sequence1?.type === "track"
    ? metadata.sequence1
    : metadata.sequence2?.type === "track" ? metadata.sequence2 : null;
  const release = legacyAlbum ? {
    ...releasePosition(),
    title: metadata.work.title,
    version: metadata.work.version,
    discNumber: metadata.sequence1?.type === "disc" ? metadata.sequence1.number : null,
    discCount: metadata.sequence1?.type === "disc" ? metadata.sequence1.count : null,
    side: metadata.sequence1?.type === "side" ? String(metadata.sequence1.number ?? metadata.sequence1.title ?? "") || null : null,
    trackNumber: releaseTrack?.number ?? null,
    trackCount: releaseTrack?.count ?? null,
  } : null;
  const allowedSequence1 = new Set(["movement", "act", "part", "section", "item"]);
  const allowedSequence2 = new Set(["scene", "number", "section", "segment", "sequence"]);
  return {
    schemaVersion: 2,
    release,
    work: {
      type: legacyAlbum ? null : metadata.work.type,
      title: legacyAlbum ? null : metadata.work.title,
      version: legacyAlbum ? null : metadata.work.version,
      creators: metadata.work.creators,
      catalogue: metadata.work.catalogue,
    },
    sequence1: allowedSequence1.has(metadata.sequence1?.type) ? metadata.sequence1 : null,
    sequence2: allowedSequence2.has(metadata.sequence2?.type) ? metadata.sequence2 : null,
    performers: metadata.performers,
    genres: metadata.genres,
    languages: metadata.languages,
    compositionDate: metadata.compositionDate,
    performanceDate: metadata.performanceDate,
    notes: metadata.notes,
  };
}

export function emptyMusicMetadata() {
  return {
    schemaVersion: 2,
    release: null,
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
