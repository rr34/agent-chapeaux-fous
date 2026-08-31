import assert from "node:assert/strict";
import test from "node:test";
import { OpenAISpeechService } from "../src/openai-speech.mjs";

test("server speech requests PCM and wraps it as playable WAV audio", async () => {
  let received;
  const speech = new OpenAISpeechService({
    apiKey: "test-key",
    baseUrl: "https://speech.example/v1/",
    model: "gpt-4o-mini-tts",
    voice: "cedar",
    fetchImpl: async (url, options) => {
      received = { url, options, body: JSON.parse(options.body) };
      return new Response(Buffer.alloc(480), {
        status: 200,
        headers: { "content-type": "audio/pcm" },
      });
    },
  });

  const result = await speech.synthesize("Narrate the exact interaction.", {
    instructions: "Speak naturally. Do not add words.",
    voice: "coral",
  });
  assert.equal(received.url, "https://speech.example/v1/audio/speech");
  assert.equal(received.options.headers.Authorization, "Bearer test-key");
  assert.deepEqual(received.body, {
    model: "gpt-4o-mini-tts",
    voice: "coral",
    input: "Narrate the exact interaction.",
    instructions: "Speak naturally. Do not add words.",
    response_format: "pcm",
  });
  assert.equal(result.bytes.subarray(0, 4).toString(), "RIFF");
  assert.equal(result.bytes.subarray(8, 12).toString(), "WAVE");
  assert.equal(result.bytes.length, 524);
  assert.equal(result.mimeType, "audio/wav");
  assert.equal(result.voice, "coral");
  assert.equal(result.chunkCount, 1);
  assert.equal(result.durationMs, 10);
  assert.equal(result.aiGenerated, true);
});

test("server speech splits long dialogue without dropping text", async () => {
  const bodies = [];
  const speech = new OpenAISpeechService({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return new Response(Buffer.alloc(480), { status: 200 });
    },
  });
  const input = "This is one lively sentence. ".repeat(260).trim();
  const result = await speech.synthesize(input);
  assert.ok(bodies.length > 1);
  assert.equal(bodies.every(({ input: chunk }) => chunk.length <= 3_000), true);
  assert.equal(bodies.map(({ input: chunk }) => chunk).join(" "), input);
  assert.equal(bodies.every(({ response_format: format }) => format === "pcm"), true);
  assert.equal(result.chunkCount, bodies.length);
  assert.equal(result.durationMs, bodies.length * 10);
});

test("server speech rejects an unknown per-request voice before calling the provider", async () => {
  let called = false;
  const speech = new OpenAISpeechService({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return new Response(Buffer.from("unexpected"));
    },
  });
  await assert.rejects(
    () => speech.synthesize("Narrate this.", { voice: "not-a-real-voice" }),
    /Unknown TTS voice/,
  );
  assert.equal(called, false);
});

test("server speech rejects dialogue beyond the explicit limit instead of truncating it", async () => {
  let called = false;
  const speech = new OpenAISpeechService({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return new Response(Buffer.alloc(2));
    },
  });
  await assert.rejects(
    () => speech.synthesize("x".repeat(20_001)),
    /cannot exceed 20000 characters/,
  );
  assert.equal(called, false);
});

test("server speech reports the provider's bounded error", async () => {
  const speech = new OpenAISpeechService({
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "voice unavailable" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  });
  await assert.rejects(() => speech.synthesize("Narrate this."), /voice unavailable/);
});
