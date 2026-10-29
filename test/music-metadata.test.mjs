import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyMusicMetadata,
  legacyMusicMetadataSchema,
  musicLibraryEntry,
  musicMetadataSchema,
  musicMetadataSchemaBundle,
  normalizeMusicMetadata,
  parseMusicMetadataDescription,
  serializeMusicMetadata,
  validateMusicMetadata,
} from "../src/music-metadata.mjs";

test("music metadata versions share one schema registry", () => {
  assert.equal(musicMetadataSchemaBundle["x-current-version"], 2);
  assert.equal(musicMetadataSchemaBundle.$defs.v1, legacyMusicMetadataSchema);
  assert.equal(musicMetadataSchemaBundle.$defs.v2, musicMetadataSchema);
  assert.deepEqual(Object.keys(musicMetadataSchemaBundle.$defs), ["v1", "v2"]);
  for (const schema of [legacyMusicMetadataSchema, musicMetadataSchema]) {
    const catalogue = schema.$defs.work.properties.catalogue;
    assert.match(catalogue.description, /catalogue siglum and entry number together/u);
    assert.deepEqual(catalogue.examples[0], ["K. 319"]);
  }
});

function concertoMovement({ work = "Violin Concerto in E major, Spring", movement = 1 } = {}) {
  const metadata = emptyMusicMetadata();
  metadata.work = {
    type: "concerto",
    title: work,
    version: null,
    creators: ["Antonio Vivaldi — composer"],
    catalogue: ["RV 269"],
  };
  metadata.sequence1 = { type: "movement", number: movement, count: 3, title: "Allegro" };
  metadata.performers = ["Example Orchestra"];
  return metadata;
}

test("music metadata validates work, sequence, alias, and nullable-field structure", () => {
  const metadata = concertoMovement();
  assert.equal(validateMusicMetadata(metadata).valid, true);
  assert.deepEqual(parseMusicMetadataDescription(serializeMusicMetadata(metadata)).metadata, metadata);

  const invalid = structuredClone(metadata);
  invalid.sequence1.type = "act";
  assert.equal(validateMusicMetadata(invalid).valid, false);

  const opera = emptyMusicMetadata();
  opera.work = { type: "opera", title: "Example Opera", version: null, creators: null, catalogue: null };
  opera.sequence1 = { type: "act", number: 1, count: 2, title: "Act I" };
  opera.sequence2 = { type: "scene", number: 2, count: null, title: "The garden" };
  assert.equal(validateMusicMetadata(opera).valid, true);

  const albumSymphony = emptyMusicMetadata();
  albumSymphony.release = {
    type: "album", title: "Two Salzburg Symphonies", version: null,
    discNumber: 1, discCount: 2, side: null, trackNumber: 3, trackCount: 7,
  };
  albumSymphony.work = {
    type: "symphony", title: "Symphony No. 33 in B-flat major", version: null,
    creators: ["Wolfgang Amadeus Mozart — composer"], catalogue: ["K. 319"],
  };
  albumSymphony.sequence1 = { type: "movement", number: 3, count: 4, title: "Menuett" };
  assert.equal(validateMusicMetadata(albumSymphony).valid, true);
});

test("the music library excludes ordinary audio recordings without music metadata", () => {
  const metadata = concertoMovement();
  const music = musicLibraryEntry({ fileId: 7, description: serializeMusicMetadata(metadata) });
  assert.equal(music.fileId, 7);
  assert.deepEqual(music.metadata, metadata);
  assert.equal(music.metadataError, null);

  assert.equal(musicLibraryEntry({ fileId: 8, description: null }), null);
  assert.equal(musicLibraryEntry({ fileId: 9, description: "Voice request recording" }), null);
  assert.equal(musicLibraryEntry({ fileId: 10, description: JSON.stringify({ schemaVersion: 1 }) }), null);
});

test("legacy album metadata remains playable through a normalized v2 projection", () => {
  const legacy = {
    schemaVersion: 1,
    work: { type: "album", title: "Legacy Album", version: null, creators: ["Composer — composer"], catalogue: null },
    sequence1: { type: "track", number: 2, count: 9, title: "Old Track" },
    sequence2: null,
    performers: ["Example Ensemble"], genres: null, languages: null,
    compositionDate: null, performanceDate: null, notes: null,
  };
  assert.equal(validateMusicMetadata(legacy).valid, true);
  assert.deepEqual(normalizeMusicMetadata(legacy), {
    schemaVersion: 2,
    release: {
      type: "album", title: "Legacy Album", version: null,
      discNumber: null, discCount: null, side: null, trackNumber: 2, trackCount: 9,
    },
    work: { type: null, title: null, version: null, creators: ["Composer — composer"], catalogue: null },
    sequence1: null,
    sequence2: null,
    performers: ["Example Ensemble"], genres: null, languages: null,
    compositionDate: null, performanceDate: null, notes: null,
  });
});
