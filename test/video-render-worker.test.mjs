import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { VideoRenderWorker } from "../src/video-render-worker.mjs";
import { VideoScripts } from "../src/video-scripts.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("the background worker preserves recordings and assigns distinct user and Agent voices", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const videoScripts = new VideoScripts({ store, ledger });
  const mediaRoot = path.join(path.dirname(temporary.filename), "media");
  const audioPath = path.join(mediaRoot, "source.webm");
  await fs.mkdir(mediaRoot, { recursive: true });
  await fs.writeFile(audioPath, Buffer.from("authentic source audio"));
  const audio = ledger.registerFile({
    storagePath: "media/source.webm",
    originalFilename: "request.webm",
    mimeType: "audio/webm",
    sha256: "worker-source-audio",
    byteSize: 22,
  });
  const sourceRequest = ledger.createRequest({ channel: "voice", primaryFileId: audio.fileId });
  const sourceEvent = ledger.trace(sourceRequest.requestId)[0];
  ledger.append({
    type: "transcription.complete", status: "complete", turnId: sourceRequest.requestId,
    content: "Make the release plan.", primaryFileId: audio.fileId,
  });
  ledger.finish(sourceEvent, "The release plan is ready.");
  const typedRequest = ledger.createRequest({ text: "Summarize the release plan.", channel: "web" });
  ledger.finish(ledger.trace(typedRequest.requestId)[0], "The release plan has three phases.");
  const generation = ledger.createRequest({
    text: "Create a video production.",
    metadata: {
      requestKind: "video_production",
      sourceRequestIds: [sourceRequest.requestId, typedRequest.requestId],
    },
  });
  const production = videoScripts.create({
    sourceRequestIds: [sourceRequest.requestId, typedRequest.requestId],
    title: "The release plan",
    concept: "Show the exact interaction.",
    audience: "The Agent's audience",
    durationSeconds: 24,
    aspectRatio: "2:3",
    visualStyle: "Faithful Agent interface",
    generatorPrompt: "Reproduce the supplied interaction without invention.",
    scenes: [
      {
        sceneNumber: 1, durationSeconds: 6, sourceRequestIds: [sourceRequest.requestId],
        renderSceneType: "request", visualPrompt: "The request card", voiceover: "Make the release plan.",
        onScreenText: ["The request"], cameraMotion: null, audioNotes: null, transition: null,
      },
      {
        sceneNumber: 2, durationSeconds: 6, sourceRequestIds: [sourceRequest.requestId],
        renderSceneType: "response", visualPrompt: "The first response bubble",
        voiceover: "The release plan is ready.", onScreenText: ["The release plan is ready."],
        cameraMotion: null, audioNotes: null, transition: null,
      },
      {
        sceneNumber: 3, durationSeconds: 6, sourceRequestIds: [typedRequest.requestId],
        renderSceneType: "request", visualPrompt: "The typed request card",
        voiceover: "Summarize the release plan.", onScreenText: ["Summarize the release plan."],
        cameraMotion: null, audioNotes: null, transition: null,
      },
      {
        sceneNumber: 4, durationSeconds: 6, sourceRequestIds: [typedRequest.requestId],
        renderSceneType: "response", visualPrompt: "The response card",
        voiceover: "The release plan has three phases.",
        onScreenText: ["The release plan has three phases."],
        cameraMotion: null, audioNotes: null, transition: null,
      },
    ],
    continuityNotes: [],
    negativeConstraints: ["Do not fabricate activity."],
  }, {
    requestId: generation.requestId,
    requestEventId: generation.eventId,
    callId: "production-call",
    channel: "web",
    actorName: "video_production_create",
  }, { queueRender: true });
  store.requireReady().prepare(`
    INSERT INTO video_jobs (renderer, template, status)
    VALUES ('adobe_premiere', 'legacy-export', 'queued')
  `).run();
  const speechCalls = [];
  let renderedInput;
  const worker = new VideoRenderWorker({
    videoScripts,
    ledger,
    mediaRoot,
    outputRoot: path.join(mediaRoot, "videos"),
    transcriber: {
      async transcribe(filename, options) {
        assert.equal(filename, audioPath);
        assert.deepEqual(options, { wordTimestamps: true });
        return {
          text: "Make the release plan.", durationMs: 1300,
          words: [
            { word: "Make", startMs: 0, endMs: 250 },
            { word: "the", startMs: 260, endMs: 420 },
            { word: "release", startMs: 430, endMs: 800 },
            { word: "plan", startMs: 810, endMs: 1200 },
          ],
        };
      },
    },
    speech: {
      async synthesize(text, options) {
        speechCalls.push({ text, options });
        return {
          bytes: Buffer.from("generated narration"), mimeType: "audio/mpeg",
          model: "test-tts", voice: options.voice,
        };
      },
    },
    async render({ input, outputLocation }) {
      renderedInput = input;
      assert.deepEqual(input.render, { fps: 30, width: 1080, height: 1620 });
      await fs.mkdir(path.dirname(outputLocation), { recursive: true });
      await fs.writeFile(outputLocation, Buffer.from("scripted mp4"));
      return { durationSeconds: 14, width: 1080, height: 1620 };
    },
  });

  await worker.drain();

  assert.deepEqual(speechCalls.map(({ text, options }) => ({ text, voice: options.voice })), [
    { text: "The release plan is ready.", voice: "cedar" },
    { text: "Summarize the release plan.", voice: "coral" },
    { text: "The release plan has three phases.", voice: "cedar" },
  ]);
  assert.match(speechCalls[0].options.instructions, /man.+standard American/iu);
  assert.match(speechCalls[1].options.instructions, /woman.+French accent/iu);
  assert.match(speechCalls[1].options.instructions, /brisk.+playful/iu);
  assert.match(speechCalls[2].options.instructions, /man.+standard American/iu);
  assert.deepEqual(
    renderedInput.scenes.map(({ renderSceneType }) => renderSceneType),
    ["request", "response", "request", "response"],
  );
  assert.equal(renderedInput.scenes.some((scene) => "activity" in scene), false);
  assert.equal(renderedInput.scenes[0].renderSceneType, "request");
  assert.equal(renderedInput.scenes[0].authenticAudio, true);
  assert.match(renderedInput.scenes[0].audioDataUrl, /^data:audio\/webm;base64,/);
  assert.equal(renderedInput.scenes[1].renderSceneType, "response");
  assert.equal(renderedInput.scenes[1].aiNarration, true);
  assert.equal(renderedInput.scenes[2].renderSceneType, "request");
  assert.equal(renderedInput.scenes[2].aiNarration, true);
  assert.equal(renderedInput.scenes[3].renderSceneType, "response");
  assert.equal(renderedInput.scenes[3].aiNarration, true);
  assert.equal(renderedInput.disclosure, "Includes AI-generated voices");
  const finished = videoScripts.get(production.script.id);
  assert.equal(finished.render.status, "complete");
  assert.ok(finished.render.outputFileId);
  assert.equal(ledger.file(finished.render.outputFileId).media_kind, "video");
  assert.equal(store.requireReady().prepare(
    "SELECT status FROM video_jobs WHERE template = 'legacy-export'",
  ).get().status, "queued");
});
