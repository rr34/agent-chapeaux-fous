import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { renderInteractionVideo } from "../video/src/render-interaction-video.mjs";

function boundedText(value, maximum, name) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.length > maximum) throw new Error(`${name} exceeds ${maximum} characters`);
  return normalized;
}

function integer(value, name) {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function fileDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relativeMediaPath(mediaRoot, filename) {
  const relative = path.relative(mediaRoot, filename);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("SLAYER_VIDEO_OUTPUT_ROOT must be inside SLAYER_MEDIA_ROOT");
  }
  return path.posix.join("media", ...relative.split(path.sep));
}

function actualActivity(source) {
  const useful = (source.events ?? []).filter((event) => [
    "transcription.complete", "context.sent", "model.request", "tool.call", "tool.result", "model.response",
  ].includes(event.type));
  const compact = [];
  for (const event of useful) {
    let label;
    let detail;
    if (event.type === "transcription.complete") {
      label = "Transcription";
      detail = "Converted the saved request audio to text";
    } else if (event.type === "context.sent") {
      label = "Context";
      detail = "Loaded the relevant working context";
    } else if (event.type === "model.request") {
      label = "Reasoning";
      detail = "Sent the exact request and callable tools to the model";
    } else if (event.type === "tool.call") {
      label = "Tool call";
      detail = `Ran ${event.name || "an application tool"}`;
    } else if (event.type === "tool.result") {
      label = event.status === "error" ? "Tool error" : "Tool result";
      detail = `${event.name || "Application tool"} ${event.status === "error" ? "returned an error" : "completed"}`;
    } else {
      label = "Response";
      detail = "Prepared the final response";
    }
    if (!compact.some((item) => item.label === label && item.detail === detail)) {
      compact.push({ label, detail, atMs: Math.max(0, event.occurredAtMs - source.submittedAtMs) });
    }
  }
  return compact.slice(0, 5).length ? compact.slice(0, 5) : [{ label: "Agent", detail: "Processed the request", atMs: 0 }];
}

export class VideoService {
  constructor({ ledger, mediaRoot, outputRoot, browserExecutable = null, render = renderInteractionVideo }) {
    this.ledger = ledger;
    this.mediaRoot = path.resolve(mediaRoot);
    this.outputRoot = path.resolve(outputRoot);
    const relativeOutput = path.relative(this.mediaRoot, this.outputRoot);
    if (!relativeOutput || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
      throw new Error("SLAYER_VIDEO_OUTPUT_ROOT must be a child directory of SLAYER_MEDIA_ROOT");
    }
    this.browserExecutable = browserExecutable;
    this.render = render;
  }

  async renderInteraction(args, context) {
    const source = context.videoSource;
    if (!source?.audioPath || !source?.audioFile) throw new Error("This video request has no stored source audio");
    const title = boundedText(args.title, 100, "title");
    const normalizedTranscript = boundedText(args.normalizedTranscript, 8_000, "normalizedTranscript");
    const audioStartMs = integer(args.audioStartMs, "audioStartMs");
    const audioEndMs = integer(args.audioEndMs, "audioEndMs");
    if (audioStartMs < 0 || audioEndMs <= audioStartMs) throw new Error("The audio range is invalid");
    if (audioEndMs > source.transcription.durationMs + 500) throw new Error("The audio range exceeds the saved recording");
    if (audioEndMs - audioStartMs > 30_000) throw new Error("The selected audio excerpt cannot exceed 30 seconds");
    const captionCues = args.captionCues.map((cue, index) => {
      const startMs = integer(cue.startMs, `captionCues[${index}].startMs`);
      const endMs = integer(cue.endMs, `captionCues[${index}].endMs`);
      if (startMs < audioStartMs || endMs <= startMs || endMs > audioEndMs + 250) {
        throw new Error(`captionCues[${index}] falls outside the selected audio range`);
      }
      return { startMs, endMs, text: boundedText(cue.text, 180, `captionCues[${index}].text`) };
    });
    const responseHighlights = args.responseHighlights.map((value, index) => boundedText(value, 240, `responseHighlights[${index}]`));
    const audioBytes = await fs.readFile(source.audioPath);
    const audioDataUrl = `data:${source.audioFile.mime_type || "audio/webm"};base64,${audioBytes.toString("base64")}`;
    const clipSeconds = (audioEndMs - audioStartMs) / 1000;
    const durationSeconds = Math.max(30, Math.min(45, Math.ceil(3 + clipSeconds + 7 + Math.max(5, responseHighlights.length * 1.6))));
    const now = new Date();
    const directory = path.join(
      this.outputRoot,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
    );
    const output = path.join(directory, `${randomUUID()}.mp4`);
    const operationId = `video-render:${context.callId}`;
    const input = {
      title,
      normalizedTranscript,
      captionCues,
      rawWords: source.transcription.words,
      audioStartMs,
      audioEndMs,
      audioDataUrl,
      responseHighlights,
      activity: actualActivity(source),
      render: { width: 1080, height: 1920, fps: 30, durationSeconds },
    };
    this.ledger.append({
      type: "video.render.started", phase: "start", status: "processing", actorType: "service",
      actorName: "Remotion", channel: context.channel, turnId: context.requestId,
      operationId, name: "Interaction video render",
      payload: {
        sourceRequestId: source.requestId,
        template: "slayer-interaction",
        audioStartMs,
        audioEndMs,
        normalizedTranscript,
        captionCues,
        responseHighlights,
        durationSeconds,
      },
      subjectType: "source_request", subjectId: source.requestId,
    });
    try {
      const rendered = await this.render({ input, outputLocation: output, browserExecutable: this.browserExecutable });
      const bytes = await fs.readFile(output);
      const storagePath = relativeMediaPath(this.mediaRoot, output);
      const registered = this.ledger.registerFile({
        storagePath,
        originalFilename: `slayer-interaction-${source.requestId.slice(0, 8)}.mp4`,
        mimeType: "video/mp4",
        sha256: fileDigest(bytes),
        byteSize: bytes.length,
        mediaKind: "video",
        durationMs: Math.round(rendered.durationSeconds * 1000),
        width: rendered.width,
        height: rendered.height,
      });
      if (registered.duplicate && registered.storagePath !== storagePath) {
        await fs.unlink(output).catch(() => {});
      }
      this.ledger.append({
        type: "video.render.completed", phase: "end", status: "complete", actorType: "service",
        actorName: "Remotion", channel: context.channel, turnId: context.requestId,
        operationId, name: "Interaction video rendered",
        payload: { sourceRequestId: source.requestId, fileId: registered.fileId, ...rendered, outputLocation: undefined },
        primaryFileId: registered.fileId, subjectType: "source_request", subjectId: source.requestId,
      });
      return {
        ok: true,
        sourceRequestId: source.requestId,
        fileId: registered.fileId,
        downloadUrl: `/api/videos/${registered.fileId}/download`,
        durationSeconds: rendered.durationSeconds,
        width: rendered.width,
        height: rendered.height,
      };
    } catch (error) {
      await fs.unlink(output).catch(() => {});
      this.ledger.append({
        type: "video.render.error", phase: "error", status: "error", actorType: "service",
        actorName: "Remotion", channel: context.channel, turnId: context.requestId,
        operationId, name: "Interaction video render failed",
        payload: { sourceRequestId: source.requestId },
        subjectType: "source_request", subjectId: source.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
