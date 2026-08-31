import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { VideoService } from "../src/video-service.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("an interaction video uses saved audio, records render events, and registers the MP4", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const root = path.dirname(temporary.filename);
  const mediaRoot = path.join(root, "media");
  const audioPath = path.join(mediaRoot, "2026", "08", "source.webm");
  await fs.mkdir(path.dirname(audioPath), { recursive: true });
  await fs.writeFile(audioPath, Buffer.from("saved authentic audio"));
  const audio = ledger.registerFile({
    storagePath: "media/2026/08/source.webm",
    originalFilename: "recording.webm",
    mimeType: "audio/webm",
    sha256: "source-audio",
    byteSize: 21,
  });
  const sourceRequest = ledger.createRequest({ text: null, channel: "voice", primaryFileId: audio.fileId });
  const source = ledger.trace(sourceRequest.requestId)[0];
  ledger.append({
    type: "transcription.complete", status: "complete", turnId: sourceRequest.requestId,
    content: "make this readable", primaryFileId: audio.fileId,
  });
  ledger.finish(source, "I completed the work and retained the exact trace.");

  const videoRequest = ledger.createRequest({
    text: "Make the video", metadata: { requestKind: "interaction_video", sourceRequestId: sourceRequest.requestId },
  });
  const sourceData = ledger.interactionVideoSource(sourceRequest.requestId);
  const service = new VideoService({
    ledger,
    mediaRoot,
    outputRoot: path.join(mediaRoot, "videos"),
    async render({ input, outputLocation }) {
      assert.match(input.audioDataUrl, /^data:audio\/webm;base64,/);
      assert.equal(input.render.width, 1080);
      assert.equal(input.render.height, 1620);
      await fs.mkdir(path.dirname(outputLocation), { recursive: true });
      await fs.writeFile(outputLocation, Buffer.from("fake mp4"));
      return { outputLocation, durationSeconds: 30, width: 1080, height: 1620 };
    },
  });
  const result = await service.renderInteraction({
    title: "I let my agent handle it",
    normalizedTranscript: "Make this readable.",
    audioStartMs: 0,
    audioEndMs: 1000,
    captionCues: [{ startMs: 0, endMs: 1000, text: "Make this readable." }],
    responseHighlights: ["Completed the work", "Retained the exact trace"],
  }, {
    requestId: videoRequest.requestId,
    callId: "video-call",
    channel: "web",
    videoSource: {
      ...sourceData,
      audioPath,
      transcription: {
        text: "make this readable",
        durationMs: 1200,
        words: [{ word: "make", startMs: 0, endMs: 280, probability: 0.99 }],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.downloadUrl, `/api/videos/${result.fileId}/download`);
  const videoFile = ledger.file(result.fileId);
  assert.equal(videoFile.media_kind, "video");
  assert.equal(videoFile.duration_ms, 30_000);
  assert.equal(videoFile.width, 1080);
  assert.equal(videoFile.height, 1620);
  assert.deepEqual(
    ledger.trace(videoRequest.requestId).filter(({ type }) => type.startsWith("video.render.")).map(({ type }) => type),
    ["video.render.started", "video.render.completed"],
  );
  assert.equal(ledger.recentRequests().find(({ requestId }) => requestId === sourceRequest.requestId).video.fileId, result.fileId);
  assert.deepEqual(
    ledger.recentRequests().find(({ requestId }) => requestId === videoRequest.requestId).video,
    {
      requestId: videoRequest.requestId,
      status: "complete",
      fileId: result.fileId,
      downloadUrl: `/api/videos/${result.fileId}/download`,
      error: null,
    },
  );
});
