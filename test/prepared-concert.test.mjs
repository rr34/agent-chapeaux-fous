import assert from "node:assert/strict";
import test from "node:test";
import { PreparedConcertService } from "../src/prepared-concert.mjs";

test("prepared concerts preserve separate item order and use opaque playback URLs", async () => {
  const removed = [];
  const narration = {
    get(id) { return id === "raw-1" ? { narrationId: id } : null; },
    async createPrepared({ sourceNarrationId, volume }) {
      assert.equal(sourceNarrationId, "raw-1");
      assert.equal(volume, 0.4);
      return { narrationId: "prepared-1" };
    },
    remove(id) { removed.push(id); },
  };
  const service = new PreparedConcertService({
    narration,
    createId: () => "00000000-0000-4000-8000-000000000001",
    createToken: () => "private-playback-token",
    now: () => 100,
  });
  const concert = await service.create({
    voiceVolume: 0.4,
    items: [
      { kind: "narration", queueIndex: 0, text: "Introduction", sourceNarrationId: "raw-1" },
      { kind: "music", queueIndex: 1, fileId: 42 },
    ],
  });

  assert.deepEqual(concert.items.map(({ kind, queueIndex }) => ({ kind, queueIndex })), [
    { kind: "narration", queueIndex: 0 },
    { kind: "music", queueIndex: 1 },
  ]);
  assert.match(concert.items[0].streamUrl, /token=private-playback-token/u);
  assert.equal(service.playbackItem(concert.concertId, 0, "wrong-token"), null);
  assert.equal(service.playbackItem(concert.concertId, 1, "private-playback-token").fileId, 42);
  assert.equal(service.discard(concert.concertId), true);
  assert.deepEqual(removed, ["prepared-1"]);
});

test("prepared concerts skip unavailable introductions without dropping music", async () => {
  const service = new PreparedConcertService({
    narration: { get() { return null; }, remove() {} },
    createId: () => "concert-id",
    createToken: () => "token",
  });
  const concert = await service.create({
    voiceVolume: 0.5,
    items: [
      { kind: "narration", queueIndex: 0, text: "Unavailable", sourceNarrationId: "missing" },
      { kind: "music", queueIndex: 1, fileId: 1 },
    ],
  });
  assert.equal(concert.failedNarrationCount, 1);
  assert.deepEqual(concert.items.map((item) => item.kind), ["music"]);
});
