import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { renderScriptedInteractionVideo } from "../video/src/render-interaction-video.mjs";
import { safeMediaPath } from "./request-attachments.mjs";

function dataUrl(bytes, mimeType) {
  return `data:${mimeType || "application/octet-stream"};base64,${bytes.toString("base64")}`;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function relativeMediaPath(mediaRoot, filename) {
  const relative = path.relative(mediaRoot, filename);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("SLAYER_VIDEO_OUTPUT_ROOT must be inside SLAYER_MEDIA_ROOT");
  }
  return path.posix.join("media", ...relative.split(path.sep));
}

function boundedText(value, maximum, fallback = "") {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim() || fallback;
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1).trimEnd()}…`;
}

function narrationSeconds(text) {
  const words = boundedText(text, 10_000).split(/\s+/u).filter(Boolean).length;
  return Math.max(3, Math.ceil(words / 2) + 2);
}

function renderDimensions(aspectRatio) {
  if (aspectRatio === "16:9") return { width: 1920, height: 1080 };
  if (aspectRatio === "1:1") return { width: 1080, height: 1080 };
  if (aspectRatio === "4:5") return { width: 1080, height: 1350 };
  return { width: 1080, height: 1920 };
}

function activityItems(source) {
  const originMs = Number(source.events[0]?.occurredAtMs) || 0;
  const useful = source.events.filter(({ type }) => [
    "transcription.complete", "context.prepared", "model.request", "tool.call", "tool.result",
    "assistant.response", "request.error",
  ].includes(type));
  const items = [];
  for (const event of useful) {
    let label = "Agent";
    let detail = "Processed the request";
    if (event.type === "transcription.complete") {
      label = "Transcription";
      detail = "Converted the saved recording into text";
    } else if (event.type === "context.prepared") {
      label = "Context";
      detail = "Prepared the bounded context selected during orientation";
    } else if (event.type === "model.request") {
      label = "Model";
      detail = "Sent the accepted brief and exact callable schemas";
    } else if (event.type === "tool.call") {
      label = "Tool call";
      detail = `Ran ${event.name || "an application tool"}`;
    } else if (event.type === "tool.result") {
      label = event.status === "error" ? "Tool error" : "Tool result";
      detail = `${event.name || "Application tool"} ${event.status === "error" ? "returned an error" : "completed"}`;
    } else if (event.type === "assistant.response") {
      label = "Response";
      detail = "Prepared the final response";
    } else if (event.type === "request.error") {
      label = "Request error";
      detail = "Recorded the observable failure";
    }
    if (!items.some((item) => item.label === label && item.detail === detail)) {
      items.push({
        label,
        detail,
        atMs: Math.max(0, (Number(event.occurredAtMs) || originMs) - originMs),
      });
    }
  }
  return items.slice(0, 6).length ? items.slice(0, 6) : [{ label: "Agent", detail: "Processed the request" }];
}

function captionCues(words, maximumMs) {
  const usable = words.filter((word) => word.startMs < maximumMs && word.endMs > 0);
  const cues = [];
  for (let index = 0; index < usable.length; index += 7) {
    const group = usable.slice(index, index + 7);
    cues.push({
      startMs: Math.max(0, group[0].startMs),
      endMs: Math.min(maximumMs, group.at(-1).endMs),
      text: group.map(({ word }) => word).join(" ").trim(),
    });
  }
  return cues.filter(({ text, endMs, startMs }) => text && endMs > startMs);
}

export class VideoRenderWorker {
  constructor({
    videoScripts,
    ledger,
    transcriber,
    speech,
    agentVoice = "cedar",
    agentInstructions = "Speak as a man in standard American English with a warm, precise, natural delivery. Do not add words.",
    userVoice = "coral",
    userInstructions = "Speak as a woman in English with a natural, subtle French accent and a warm delivery. Do not add words.",
    mediaRoot,
    outputRoot,
    browserExecutable = null,
    render = renderScriptedInteractionVideo,
  }) {
    this.videoScripts = videoScripts;
    this.ledger = ledger;
    this.transcriber = transcriber;
    this.speech = speech;
    this.narrationStyles = {
      agent: { voice: agentVoice, instructions: agentInstructions },
      user: { voice: userVoice, instructions: userInstructions },
    };
    this.mediaRoot = path.resolve(mediaRoot);
    this.outputRoot = path.resolve(outputRoot);
    const relativeOutput = path.relative(this.mediaRoot, this.outputRoot);
    if (!relativeOutput || relativeOutput.startsWith("..") || path.isAbsolute(relativeOutput)) {
      throw new Error("SLAYER_VIDEO_OUTPUT_ROOT must be a child directory of SLAYER_MEDIA_ROOT");
    }
    this.browserExecutable = browserExecutable;
    this.render = render;
    this.running = false;
    this.drainPromise = null;
    this.wakeRequested = false;
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this.videoScripts.recoverInterruptedRenderJobs();
    this.notify();
  }

  async stop() {
    this.stopped = true;
    await this.drainPromise;
  }

  notify() {
    if (this.stopped) return;
    this.wakeRequested = true;
    if (!this.drainPromise) {
      this.drainPromise = this.drain()
        .catch((error) => console.error("[agent-slayer] video render worker failed:", error))
        .finally(() => { this.drainPromise = null; });
    }
  }

  async drain() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      do {
        this.wakeRequested = false;
        let job;
        while (!this.stopped && (job = this.videoScripts.claimNextRenderJob())) await this.process(job);
      } while (this.wakeRequested && !this.stopped);
    } finally {
      this.running = false;
    }
  }

  async #sourceAudio(source, job, scene) {
    if (!source.audioFile) return null;
    const audioPath = safeMediaPath(this.mediaRoot, source.audioFile.storage_path);
    const operationId = `video-audio:${job.id}:${scene.sceneNumber}`;
    this.ledger.append({
      type: "video.source.transcription.start", phase: "start", status: "processing",
      actorType: "service", actorName: "faster-whisper", operationId,
      name: "Video source word timing", primaryFileId: source.audioFile.file_id,
      subjectType: "video_job", subjectId: String(job.id),
      payload: { videoScriptId: job.videoScriptId, sourceRequestId: source.requestId, sceneNumber: scene.sceneNumber },
    });
    const transcription = await this.transcriber.transcribe(audioPath, { wordTimestamps: true });
    if (!transcription.text?.trim() || !transcription.words?.length) {
      throw new Error(`Timed transcription was unavailable for source ${source.requestId}`);
    }
    const endMs = Math.min(30_000, Math.max(1_000, Number(transcription.durationMs) || 0));
    const bytes = await fs.readFile(audioPath);
    this.ledger.append({
      type: "video.source.transcription.complete", phase: "end", status: "complete",
      actorType: "service", actorName: "faster-whisper", operationId,
      name: "Video source word timing", content: transcription.text,
      primaryFileId: source.audioFile.file_id, subjectType: "video_job", subjectId: String(job.id),
      payload: { sourceRequestId: source.requestId, sceneNumber: scene.sceneNumber, durationMs: endMs },
    });
    return {
      audioDataUrl: dataUrl(bytes, source.audioFile.mime_type || "audio/webm"),
      audioStartMs: 0,
      audioEndMs: endMs,
      captionCues: captionCues(transcription.words, endMs),
      rawWords: transcription.words,
      durationSeconds: Math.ceil(endMs / 1000) + 1,
      authenticRequestAudio: true,
    };
  }

  async #narrationAudio(text, job, scene, speakerRole) {
    const style = this.narrationStyles[speakerRole];
    const operationId = `video-narration:${job.id}:${scene.sceneNumber}`;
    this.ledger.append({
      type: "video.narration.start", phase: "start", status: "processing",
      actorType: "service", actorName: "OpenAI speech", operationId,
      name: "AI narration generation", subjectType: "video_job", subjectId: String(job.id),
      payload: { videoScriptId: job.videoScriptId, sceneNumber: scene.sceneNumber, speakerRole },
    });
    const generated = await this.speech.synthesize(text, {
      voice: style.voice,
      instructions: style.instructions,
    });
    this.ledger.append({
      type: "video.narration.complete", phase: "end", status: "complete",
      actorType: "service", actorName: "OpenAI speech", operationId,
      name: "AI narration generated", subjectType: "video_job", subjectId: String(job.id),
      payload: {
        videoScriptId: job.videoScriptId,
        sceneNumber: scene.sceneNumber,
        model: generated.model,
        voice: generated.voice,
        speakerRole,
        byteSize: generated.bytes.length,
        aiGenerated: true,
      },
    });
    return {
      audioDataUrl: dataUrl(generated.bytes, generated.mimeType),
      audioStartMs: 0,
      audioEndMs: null,
      captionCues: [],
      rawWords: [],
      durationSeconds: narrationSeconds(text),
      authenticRequestAudio: false,
      aiNarration: true,
    };
  }

  async #prepare(job) {
    const script = this.videoScripts.get(job.videoScriptId);
    if (!script) throw new Error(`Video script ${job.videoScriptId} was not found`);
    const sources = new Map(script.sources.map(({ requestId }) => {
      const source = this.ledger.interactionReplaySource(requestId);
      return [requestId, source];
    }));
    const scenes = [];
    let usesAiNarration = false;
    for (const scene of script.plan.scenes) {
      const sceneSources = scene.sourceRequestIds.map((id) => sources.get(id)).filter(Boolean);
      const source = sceneSources[0];
      if (!source || sceneSources.length !== scene.sourceRequestIds.length) {
        throw new Error(`Scene ${scene.sceneNumber} has no retained source interaction`);
      }
      const useAuthenticAudio = scene.renderSceneType === "request" && source.audioFile;
      const speakerRole = scene.renderSceneType === "request" ? "user" : "agent";
      const narrationText = speakerRole === "user"
        ? boundedText(source.rawTranscript, 4_096, "Voice request")
        : scene.voiceover;
      const audio = useAuthenticAudio
        ? await this.#sourceAudio(source, job, scene)
        : await this.#narrationAudio(narrationText, job, scene, speakerRole);
      usesAiNarration ||= Boolean(audio.aiNarration);
      scenes.push({
        sceneNumber: scene.sceneNumber,
        renderSceneType: scene.renderSceneType,
        durationSeconds: Math.min(120, Math.max(scene.durationSeconds, audio.durationSeconds)),
        sourceRequestIds: scene.sourceRequestIds,
        requestId: source.requestId,
        sourceReference: sceneSources.map(({ requestId }) => `Request ${requestId.slice(0, 8)}`).join(" · "),
        requestText: boundedText(source.rawTranscript, 1_200, "Voice request"),
        responseText: boundedText(source.response, 2_400, "No response was recorded."),
        activity: (scene.renderSceneType === "activity"
          ? sceneSources.flatMap(activityItems).slice(0, 6)
          : activityItems(source)),
        heading: scene.renderSceneType === "intro" ? script.title : null,
        highlights: scene.renderSceneType === "response" ? scene.onScreenText : [],
        onScreenText: scene.onScreenText.join(" · "),
        voiceover: scene.voiceover,
        authenticAudio: Boolean(audio.authenticRequestAudio),
        ...audio,
      });
    }
    return {
      title: script.title,
      concept: script.plan.concept,
      aspectRatio: script.plan.aspectRatio,
      scenes,
      sourceCount: script.sources.length,
      usesAiNarration,
      disclosure: usesAiNarration ? "Includes AI-generated narration" : null,
      render: { fps: 30, ...renderDimensions(script.plan.aspectRatio) },
    };
  }

  async process(job) {
    let output = null;
    let outputRegistered = false;
    try {
      const input = await this.#prepare(job);
      this.videoScripts.markRenderRunning(job.id);
      const createdAt = new Date(job.createdAtUtc || Date.now());
      const directory = path.join(
        this.outputRoot,
        String(createdAt.getUTCFullYear()),
        String(createdAt.getUTCMonth() + 1).padStart(2, "0"),
      );
      output = path.join(directory, `video-job-${job.id}.mp4`);
      this.ledger.append({
        type: "video.render.started", phase: "start", status: "processing", actorType: "service",
        actorName: "Remotion", name: "Scripted interaction video render",
        payload: {
          videoJobId: job.id,
          videoScriptId: job.videoScriptId,
          template: "agent-ui-story",
          sceneCount: input.scenes.length,
          aiNarration: input.usesAiNarration,
        },
        subjectType: "video_job", subjectId: String(job.id),
      });
      const rendered = await this.render({ input, outputLocation: output, browserExecutable: this.browserExecutable });
      const bytes = await fs.readFile(output);
      const registered = this.ledger.registerFile({
        storagePath: relativeMediaPath(this.mediaRoot, output),
        originalFilename: `agent-story-${job.videoScriptId}-${job.id}.mp4`,
        mimeType: "video/mp4",
        sha256: digest(bytes),
        byteSize: bytes.length,
        mediaKind: "video",
        durationMs: Math.round(rendered.durationSeconds * 1000),
        width: rendered.width,
        height: rendered.height,
        title: this.videoScripts.get(job.videoScriptId)?.title || `Video script ${job.videoScriptId}`,
        description: input.disclosure,
      });
      outputRegistered = true;
      if (registered.duplicate && registered.storagePath !== relativeMediaPath(this.mediaRoot, output)) {
        await fs.unlink(output).catch(() => {});
      }
      this.videoScripts.completeRender(job.id, registered.fileId, {
        durationSeconds: rendered.durationSeconds,
        width: rendered.width,
        height: rendered.height,
        aiNarration: input.usesAiNarration,
      });
    } catch (error) {
      const failed = this.videoScripts.failRender(job.id, error);
      if (failed && output && !outputRegistered) await fs.unlink(output).catch(() => {});
    }
  }
}
