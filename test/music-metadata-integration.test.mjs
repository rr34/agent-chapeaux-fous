import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { emptyMusicMetadata, parseMusicMetadataDescription } from "../src/music-metadata.mjs";
import { registerFileTools } from "../src/tools/file-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { temporaryDatabase } from "./helpers.mjs";

function concertoMovement(movement = 1) {
  const metadata = emptyMusicMetadata();
  metadata.work = {
    type: "concerto",
    title: "Violin Concerto in E major, Spring",
    version: null,
    creators: ["Antonio Vivaldi — composer"],
    catalogue: ["RV 269"],
  };
  metadata.sequence1 = { type: "movement", number: movement, count: 3, title: "Allegro" };
  metadata.performers = ["Example Orchestra"];
  return metadata;
}

test("file_update atomically stores validated music metadata for a bounded file batch", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const files = [1, 2].map((number) => ledger.registerFile({
    storagePath: `media/vivaldi-${number}.mp3`,
    originalFilename: `Vivaldi Spring ${number}.mp3`,
    mediaKind: "audio",
    mimeType: "audio/mpeg",
    sha256: createHash("sha256").update(`audio-${number}`).digest("hex"),
    byteSize: 100 + number,
  }));
  const registry = new ToolRegistry();
  registerFileTools(registry, {
    ledger, searchCoordinator: {}, mediaRoot: "/tmp", maximumTextBytes: 4096,
  });

  const result = await registry.execute("file_update", {
    updates: files.map((file, index) => ({
      file_id: file.fileId,
      title: `Spring — ${index + 1}. Allegro`,
      music_metadata: concertoMovement(index + 1),
    })),
  }, { requestId: "music-request", callId: "music-update" });

  assert.equal(result.updatedCount, 2);
  assert.deepEqual(result.files.map(({ titleSource }) => titleSource), ["ai", "ai"]);
  for (const file of files) {
    assert.equal(parseMusicMetadataDescription(ledger.file(file.fileId).description).metadata.work.type, "concerto");
  }
});

test("grouped request files are linked atomically and retain their upload order", (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const files = [1, 2, 3].map((number) => ledger.registerFile({
    storagePath: `media/group-${number}.mp3`, originalFilename: `group-${number}.mp3`,
    mediaKind: "audio", mimeType: "audio/mpeg",
    sha256: createHash("sha256").update(`group-${number}`).digest("hex"), byteSize: number,
  }));
  const created = ledger.createRequest({
    text: "These are the three movements of one concerto.",
    primaryFileId: files[0].fileId,
    attachmentFileIds: files.map(({ fileId }) => fileId),
    metadata: { attachmentFileIds: files.map(({ fileId }) => fileId) },
  });
  const rows = store.requireReady().prepare(`
    SELECT file_id, ordinal FROM activity_event_files_join
    WHERE event_id = ? ORDER BY ordinal
  `).all(created.eventId);
  assert.deepEqual(rows.map((row) => Number(row.file_id)), files.map(({ fileId }) => fileId));
  assert.deepEqual(rows.map((row) => Number(row.ordinal)), [0, 1, 2]);
});
