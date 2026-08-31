import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { renderScriptedInteractionVideo } from "../video/src/render-interaction-video.mjs";
import { safeMediaPath } from "./request-attachments.mjs";
import { videoDialogueText } from "./video-dialogue.mjs";

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

const maximumMessageCharacters = 20_000;
const maximumProductionCharacters = 60_000;
const generatedSpeechPlaybackRate = 1.3;

function boundedSourceText(value, label, fallback = "") {
  const text = String(value ?? "").trim() || fallback;
  if (text.length > maximumMessageCharacters) {
    throw new Error(
      `${label} contains ${text.length.toLocaleString()} characters; the video limit is ${maximumMessageCharacters.toLocaleString()}. Nothing was truncated and the video was not generated.`,
    );
  }
  return text;
}

function narrationSeconds(text) {
  const words = String(text ?? "").trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(2, Math.ceil(words / 2.75) + 1);
}

function speechPronunciation(text) {
  return text.replace(/\bChapeaux\s+Fous\b/giu, "Chapeaux Fou");
}

const productionRender = Object.freeze({ width: 1080, height: 1620 });

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
    agentVoice = "verse",
    agentInstructions = "Be an energetic American guy bantering with a friend. Talk extremely fast, around 1.3 times normal conversational speed, with almost no dead air, dramatic pauses, or slow emphasis. Stay animated, mischievous, loose, and intelligible. Never sound like an announcer, presenter, tutorial, corporate demo, audiobook, or polished sales pitch. Pronounce Chapeaux Fou in French as shah-POH FOO, with no final S sound. Speak the supplied words verbatim.",
    userVoice = "shimmer",
    userInstructions = "Be a quick-witted Parisian woman speaking English with an unmistakably strong native French accent in every sentence. Use French R sounds, rounded vowels, and French rhythm while staying easy to understand. Talk extremely fast, around 1.3 times normal conversational speed, with almost no dead air, dramatic pauses, or slow emphasis. Stay animated, warm, cheeky, and intelligible. Never sound like an announcer, presenter, tutorial, corporate demo, audiobook, or polished sales pitch. Pronounce Chapeaux Fou as shah-POH FOO, with no final S sound. Speak the supplied words verbatim.",
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
    const endMs = Math.max(1_000, Number(transcription.durationMs) || 0);
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

  async #narrationTiming(generated, job, scene, speakerRole) {
    await fs.mkdir(this.outputRoot, { recursive: true, mode: 0o700 });
    const temporaryDirectory = await fs.mkdtemp(path.join(this.outputRoot, ".narration-timing-"));
    const audioPath = path.join(temporaryDirectory, "narration.wav");
    const operationId = `video-narration-timing:${job.id}:${scene.sceneNumber}`;
    try {
      await fs.writeFile(audioPath, generated.bytes, { mode: 0o600 });
      this.ledger.append({
        type: "video.narration.timing.start", phase: "start", status: "processing",
        actorType: "service", actorName: "faster-whisper", operationId,
        name: "AI narration word timing", subjectType: "video_job", subjectId: String(job.id),
        payload: { videoScriptId: job.videoScriptId, sceneNumber: scene.sceneNumber, speakerRole },
      });
      const transcription = await this.transcriber.transcribe(audioPath, { wordTimestamps: true });
      if (!transcription.text?.trim() || !transcription.words?.length) {
        throw new Error(`Timed transcription was unavailable for generated scene ${scene.sceneNumber}`);
      }
      this.ledger.append({
        type: "video.narration.timing.complete", phase: "end", status: "complete",
        actorType: "service", actorName: "faster-whisper", operationId,
        name: "AI narration word timing", content: transcription.text,
        subjectType: "video_job", subjectId: String(job.id),
        payload: {
          videoScriptId: job.videoScriptId,
          sceneNumber: scene.sceneNumber,
          speakerRole,
          durationMs: transcription.durationMs,
          wordCount: transcription.words.length,
        },
      });
      return transcription;
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async #narrationAudio(text, job, scene, speakerRole) {
    const style = this.narrationStyles[speakerRole];
    const spokenText = speechPronunciation(text);
    const operationId = `video-narration:${job.id}:${scene.sceneNumber}`;
    this.ledger.append({
      type: "video.narration.start", phase: "start", status: "processing",
      actorType: "service", actorName: "OpenAI speech", operationId,
      name: "AI narration generation", subjectType: "video_job", subjectId: String(job.id),
      payload: { videoScriptId: job.videoScriptId, sceneNumber: scene.sceneNumber, speakerRole },
    });
    const generated = await this.speech.synthesize(spokenText, {
      voice: style.voice,
      instructions: style.instructions,
    });
    const timing = await this.#narrationTiming(generated, job, scene, speakerRole);
    const durationMs = Math.max(
      1,
      Number(generated.durationMs) || Number(timing.durationMs) || 0,
    );
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
        chunkCount: generated.chunkCount ?? 1,
        aiGenerated: true,
      },
    });
    return {
      audioDataUrl: dataUrl(generated.bytes, generated.mimeType),
      audioStartMs: 0,
      audioEndMs: durationMs,
      captionCues: captionCues(timing.words, durationMs),
      rawWords: timing.words,
      playbackRate: generatedSpeechPlaybackRate,
      durationSeconds: durationMs > 1
        ? Math.max(2, Math.ceil(durationMs / generatedSpeechPlaybackRate / 1_000) + 1)
        : narrationSeconds(spokenText),
      authenticRequestAudio: false,
      aiNarration: true,
    };
  }

  async #prepare(job) {
    const script = this.videoScripts.get(job.videoScriptId);
    if (!script) throw new Error(`Video script ${job.videoScriptId} was not found`);
    const sources = script.sources.map(({ requestId }) => {
      const source = this.ledger.interactionReplaySource(requestId);
      const rawRequestText = boundedSourceText(source.rawTranscript, `Request ${requestId}`, "Voice request");
      const rawResponseText = boundedSourceText(source.response, `Response ${requestId}`, "No response was recorded.");
      const requestText = videoDialogueText(rawRequestText, "Voice request");
      return {
        source,
        requestText,
        responseText: videoDialogueText(rawResponseText, "No response was recorded."),
        requestTextWasFiltered: requestText !== rawRequestText,
      };
    });
    const productionCharacters = sources.reduce(
      (total, source) => total + source.requestText.length + source.responseText.length,
      0,
    );
    if (productionCharacters > maximumProductionCharacters) {
      throw new Error(
        `The selected dialogue contains ${productionCharacters.toLocaleString()} characters; the video limit is ${maximumProductionCharacters.toLocaleString()}. Nothing was truncated and the video was not generated.`,
      );
    }
    const scenes = [];
    let usesAiNarration = false;
    for (const { source, requestText, responseText, requestTextWasFiltered } of sources) {
      const { requestId } = source;
      const requestScene = { sceneNumber: scenes.length + 1 };
      const requestAudio = source.audioFile && !requestTextWasFiltered
        ? await this.#sourceAudio(source, job, requestScene)
        : await this.#narrationAudio(requestText, job, requestScene, "user");
      usesAiNarration ||= Boolean(requestAudio.aiNarration);
      scenes.push({
        sceneNumber: requestScene.sceneNumber,
        renderSceneType: "request",
        durationSeconds: requestAudio.durationSeconds,
        sourceRequestIds: [requestId],
        requestId,
        requestText,
        responseText,
        authenticAudio: Boolean(requestAudio.authenticRequestAudio),
        ...requestAudio,
      });

      const responseScene = { sceneNumber: scenes.length + 1 };
      const responseAudio = await this.#narrationAudio(responseText, job, responseScene, "agent");
      usesAiNarration ||= Boolean(responseAudio.aiNarration);
      scenes.push({
        sceneNumber: responseScene.sceneNumber,
        renderSceneType: "response",
        durationSeconds: responseAudio.durationSeconds,
        sourceRequestIds: [requestId],
        requestId,
        requestText,
        responseText,
        authenticAudio: false,
        ...responseAudio,
      });
    }
    return {
      title: script.title,
      concept: script.plan.concept,
      aspectRatio: "2:3",
      scenes,
      sourceCount: script.sources.length,
      usesAiNarration,
      disclosure: usesAiNarration ? "Includes AI-generated voices" : null,
      render: { fps: 30, ...productionRender },
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
