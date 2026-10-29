import assert from "node:assert/strict";
import test from "node:test";
import { MusicNarrationService } from "../src/music-narration.mjs";

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
