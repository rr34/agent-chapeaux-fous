import assert from "node:assert/strict";
import test from "node:test";
import { MusicNarrationService } from "../src/music-narration.mjs";
import { runWithPerson } from "../src/person-context.mjs";

function pcmWav(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24);
  bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, 44 + index * 2));
  return bytes;
}

test("music narration generates temporary disclosed speech audio", async () => {
  const calls = [];
  const service = new MusicNarrationService({
    speech: {
      async synthesize(text, options) {
        calls.push({ text, options });
        return {
          bytes: Buffer.from("audio"), mimeType: "audio/wav", durationMs: 1250,
          model: "speech-test", voice: "cedar", aiGenerated: true,
        };
      },
    },
    now: () => 1_000,
    createId: () => "00000000-0000-4000-8000-000000000001",
  });

  const result = await service.create({ text: "  Next:   Allegro assai.  " });

  assert.equal(calls[0].text, "Next: Allegro assai.");
  assert.match(calls[0].options.instructions, /concert companion/u);
  assert.equal(calls[0].options.voice, "cedar");
  assert.deepEqual(result, {
    narrationId: "00000000-0000-4000-8000-000000000001",
    durationMs: 1250,
    model: "speech-test",
    voice: "cedar",
    aiGenerated: true,
    streamUrl: "/api/music/narrations/00000000-0000-4000-8000-000000000001/stream",
  });
  assert.equal(service.get(result.narrationId).bytes.toString(), "audio");
});

test("music narration rejects missing or oversized text before speech generation", async () => {
  let calls = 0;
  const service = new MusicNarrationService({
    speech: { async synthesize() { calls += 1; } },
  });

  await assert.rejects(() => service.create({ text: " " }), /required/u);
  await assert.rejects(() => service.create({ text: "x".repeat(2_001) }), /2000/u);
  assert.equal(calls, 0);
});

test("prepared narration reuses generated speech and locks gain into PCM samples", async () => {
  let calls = 0;
  let id = 0;
  const service = new MusicNarrationService({
    speech: {
      async synthesize() {
        calls += 1;
        return { bytes: pcmWav([1_000, -1_000]), mimeType: "audio/wav", durationMs: 50, model: "test", voice: "cedar" };
      },
    },
    createId: () => `narration-${++id}`,
  });
  const original = await service.create({ text: "Allegro." });
  const prepared = await service.createPrepared({ text: "Allegro.", volume: 0.5, sourceNarrationId: original.narrationId });

  assert.equal(calls, 1);
  assert.equal(prepared.preparedVolume, 0.5);
  assert.equal(service.get(prepared.narrationId).bytes.readInt16LE(44), 500);
  assert.equal(service.get(prepared.narrationId).bytes.readInt16LE(46), -500);
  assert.equal(service.get(original.narrationId).bytes.readInt16LE(44), 1_000);
  await assert.rejects(() => service.createPrepared({ text: "Allegro.", volume: 1.1, sourceNarrationId: original.narrationId }), /between 0 and 1/u);
  await assert.rejects(() => service.createPrepared({ text: "Different text.", volume: 0.5, sourceNarrationId: original.narrationId, sourceOnly: true }), /does not match/u);
  assert.equal(calls, 1);
});

test("music narration expires temporary audio and bounds the cache", async () => {
  let now = 0;
  let id = 0;
  const service = new MusicNarrationService({
    speech: {
      async synthesize() {
        return { bytes: Buffer.from("1234"), mimeType: "audio/wav", durationMs: 1, model: "test", voice: "cedar" };
      },
    },
    maximumEntries: 2,
    maximumBytes: 8,
    ttlMs: 10,
    now: () => now,
    createId: () => `narration-${++id}`,
  });

  await service.create({ text: "one" });
  await service.create({ text: "two" });
  await service.create({ text: "three" });
  assert.equal(service.get("narration-1"), null);
  assert.ok(service.get("narration-2"));
  now = 11;
  assert.equal(service.get("narration-2"), null);
  assert.equal(service.get("narration-3"), null);
});

test("temporary narration is private to the person that generated it", async () => {
  const service = new MusicNarrationService({
    speech: { async synthesize() {
      return { bytes: Buffer.from("private"), mimeType: "audio/wav", durationMs: 1, model: "test", voice: "cedar" };
    } },
    createId: () => "private-narration",
  });
  const narration = await runWithPerson(41, () => service.create({ text: "Private introduction" }));
  assert.ok(runWithPerson(41, () => service.get(narration.narrationId)));
  assert.equal(runWithPerson(42, () => service.get(narration.narrationId)), null);
  assert.equal(runWithPerson(42, () => service.remove(narration.narrationId)), false);
});
