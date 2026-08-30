import assert from "node:assert/strict";
import test from "node:test";
import { OpenAISpeechService } from "../src/openai-speech.mjs";

test("server speech sends a bounded MP3 request and returns provider audio", async () => {
  let received;
  const speech = new OpenAISpeechService({
    apiKey: "test-key",
    baseUrl: "https://speech.example/v1/",
    model: "gpt-4o-mini-tts",
    voice: "cedar",
    fetchImpl: async (url, options) => {
      received = { url, options, body: JSON.parse(options.body) };
      return new Response(Buffer.from("fake mp3"), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
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
    response_format: "mp3",
  });
  assert.equal(result.bytes.toString(), "fake mp3");
  assert.equal(result.mimeType, "audio/mpeg");
  assert.equal(result.voice, "coral");
  assert.equal(result.aiGenerated, true);
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
