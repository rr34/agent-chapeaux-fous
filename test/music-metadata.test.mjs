import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyMusicMetadata,
  parseMusicMetadataDescription,
  serializeMusicMetadata,
  validateMusicMetadata,
} from "../src/music-metadata.mjs";

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

  const multiDiscAlbum = emptyMusicMetadata();
  multiDiscAlbum.work = { type: "album", title: "Example Album", version: null, creators: null, catalogue: null };
  multiDiscAlbum.sequence1 = { type: "disc", number: 2, count: 2, title: null };
  multiDiscAlbum.sequence2 = { type: "track", number: 3, count: 8, title: "Finale" };
  assert.equal(validateMusicMetadata(multiDiscAlbum).valid, true);
});
