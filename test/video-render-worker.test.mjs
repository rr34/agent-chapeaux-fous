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
  const longResponse = `Chapeaux Fous ${"works ".repeat(800)}`.trim();
  const typedRequest = ledger.createRequest({
    text: [
      "Summarize Chapeaux Fous.",
      "Reference code: request_id=123e4567-e89b-42d3-a456-426614174000",
    ].join("\n"),
    channel: "web",
  });
  ledger.finish(ledger.trace(typedRequest.requestId)[0], longResponse);
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
        voiceover: "Summarize Chapeaux Fous.", onScreenText: ["Summarize Chapeaux Fous."],
        cameraMotion: null, audioNotes: null, transition: null,
      },
      {
        sceneNumber: 4, durationSeconds: 6, sourceRequestIds: [typedRequest.requestId],
        renderSceneType: "response", visualPrompt: "The response card",
        voiceover: longResponse,
        onScreenText: ["The complete response"],
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
  const generatedTimingPaths = [];
  let renderedInput;
  const worker = new VideoRenderWorker({
    videoScripts,
    ledger,
    mediaRoot,
    outputRoot: path.join(mediaRoot, "videos"),
    transcriber: {
      async transcribe(filename, options) {
        assert.deepEqual(options, { wordTimestamps: true });
        if (filename !== audioPath) {
          generatedTimingPaths.push(filename);
          assert.match(filename, /\.narration-timing-[^/]+\/narration\.wav$/u);
          assert.equal((await fs.readFile(filename)).toString(), "generated narration");
          return {
            text: "Generated narration timing.", durationMs: 4_200,
            words: [
              { word: "Generated", startMs: 0, endMs: 1_300 },
              { word: "narration", startMs: 1_320, endMs: 2_900 },
              { word: "timing", startMs: 2_920, endMs: 4_100 },
            ],
          };
        }
        return {
          text: "Make the release plan.", durationMs: 31_300,
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
          bytes: Buffer.from("generated narration"), mimeType: "audio/wav",
          model: "test-tts", voice: options.voice, durationMs: 4_200, chunkCount: 2,
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

  assert.equal(speechCalls.length, 3);
  assert.deepEqual(
    speechCalls.map(({ options }) => options.voice),
    ["verse", "shimmer", "verse"],
  );
  assert.equal(speechCalls[0].text, "The release plan is ready.");
  assert.equal(speechCalls[1].text, "Summarize Chapeaux Fou.");
  assert.equal(speechCalls[2].text, longResponse.replace("Chapeaux Fous", "Chapeaux Fou"));
  assert.match(speechCalls[0].options.instructions, /energetic American guy/iu);
  assert.match(speechCalls[0].options.instructions, /extremely fast.+1\.3 times/iu);
  assert.match(speechCalls[1].options.instructions, /Parisian woman.+unmistakably strong native French accent/iu);
  assert.match(speechCalls[1].options.instructions, /extremely fast.+almost no dead air/iu);
  assert.match(speechCalls[1].options.instructions, /Never sound like an announcer.+tutorial/iu);
  assert.match(speechCalls[2].options.instructions, /no final S sound/iu);
  assert.deepEqual(
    renderedInput.scenes.map(({ renderSceneType }) => renderSceneType),
    ["request", "response", "request", "response"],
  );
  assert.equal(renderedInput.scenes.some((scene) => "activity" in scene), false);
  assert.equal(renderedInput.scenes[0].renderSceneType, "request");
  assert.equal(renderedInput.scenes[0].authenticAudio, true);
  assert.equal(renderedInput.scenes[0].audioEndMs, 31_300);
  assert.match(renderedInput.scenes[0].audioDataUrl, /^data:audio\/webm;base64,/);
  assert.equal(renderedInput.scenes[1].renderSceneType, "response");
  assert.equal(renderedInput.scenes[1].aiNarration, true);
  assert.equal(renderedInput.scenes[1].playbackRate, 1.3);
  assert.equal(renderedInput.scenes[1].rawWords.length, 3);
  assert.equal(renderedInput.scenes[2].renderSceneType, "request");
  assert.equal(renderedInput.scenes[2].aiNarration, true);
  assert.equal(renderedInput.scenes[3].renderSceneType, "response");
  assert.equal(renderedInput.scenes[3].aiNarration, true);
  assert.equal(renderedInput.scenes[3].durationSeconds, 5);
  assert.equal(renderedInput.scenes[3].responseText, longResponse);
  assert.equal(renderedInput.scenes[3].responseText.endsWith("…"), false);
  assert.equal(renderedInput.disclosure, "Includes AI-generated voices");
  assert.equal(generatedTimingPaths.length, 3);
  for (const timingPath of generatedTimingPaths) await assert.rejects(() => fs.access(timingPath));
  const finished = videoScripts.get(production.script.id);
  assert.equal(finished.render.status, "complete");
  assert.ok(finished.render.outputFileId);
  assert.equal(ledger.file(finished.render.outputFileId).media_kind, "video");
  assert.equal(store.requireReady().prepare(
    "SELECT status FROM video_jobs WHERE template = 'legacy-export'",
  ).get().status, "queued");
});
