import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MusicDurationResolver } from "../src/music-duration.mjs";

function mpeg1Layer3Frame() {
  const frame = Buffer.alloc(417);
  Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(frame);
  return frame;
}

test("music duration resolver measures missing durations once and persists the SHA-bound derivative", async (context) => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-music-duration-"));
  context.after(() => fs.rmSync(mediaRoot, { force: true, recursive: true }));
  const filename = path.join(mediaRoot, "track.mp3");
  fs.writeFileSync(filename, Buffer.concat(Array.from({ length: 100 }, mpeg1Layer3Frame)));
  let storedDuration = null;
  let reads = 0;
  const sha256 = "a".repeat(64);
  const ledger = {
    file(fileId) {
      assert.equal(fileId, 7);
      reads += 1;
      return { file_id: 7, storage_path: "media/track.mp3", media_kind: "audio", mime_type: "audio/mpeg", sha256 };
    },
    cacheAudioDuration(fileId, digest, durationMs) {
      assert.equal(fileId, 7);
      assert.equal(digest, sha256);
      storedDuration = durationMs;
    },
  };
  const resolver = new MusicDurationResolver({ ledger, mediaRoot });
  const [file] = await resolver.enrich([{ fileId: 7, sha256, durationMs: null }]);
  assert.equal(file.durationMs, 2_612);
  assert.equal(storedDuration, 2_612);
  assert.equal(reads, 1);

  fs.unlinkSync(filename);
  const restartedResolver = new MusicDurationResolver({ ledger, mediaRoot });
  assert.equal(await restartedResolver.resolve({ fileId: 7, sha256, durationMs: storedDuration }), 2_612);
  assert.equal(reads, 1);
});
