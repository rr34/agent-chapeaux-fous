import { readRequestAttachment, safeMediaPath } from "./request-attachments.mjs";

export class RequestQueue {
  constructor({
    ledger, runtime, transcriber, mediaRoot,
    maxTextAttachmentBytes = 10 * 1024 * 1024,
    maxRequestAttachmentBytes = 50 * 1024 * 1024,
  }) {
    this.ledger = ledger;
    this.runtime = runtime;
    this.transcriber = transcriber;
    this.mediaRoot = mediaRoot;
    this.maxTextAttachmentBytes = maxTextAttachmentBytes;
    this.maxRequestAttachmentBytes = maxRequestAttachmentBytes;
    this.running = false;
    this.wakeRequested = false;
  }

  notify() {
    this.wakeRequested = true;
    void this.drain();
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      do {
        this.wakeRequested = false;
        let request;
        while ((request = this.ledger.nextQueuedRequest())) await this.process(request);
      } while (this.wakeRequested);
    } finally {
      this.running = false;
    }
  }

  async process(request) {
    this.ledger.markProcessing(request);
    try {
      let text = request.content?.trim() || "";
      const file = request.primaryFileId == null ? null : this.ledger.file(request.primaryFileId);
      if (!text) {
        if (!file || file.media_kind !== "audio") throw new Error("Voice request has no stored audio file");
        const operationId = `transcription:${request.turnId}`;
        this.ledger.append({
          type: "transcription.start", phase: "start", status: "processing", actorType: "service",
          actorName: "faster-whisper", channel: "voice", turnId: request.turnId,
          operationId, name: "Voice transcription", primaryFileId: request.primaryFileId,
        });
        const result = await this.transcriber.transcribe(safeMediaPath(this.mediaRoot, file.storage_path));
        text = result.text?.trim() || "";
        if (!text) throw new Error("Transcription returned no text");
        this.ledger.append({
          type: "transcription.complete", phase: "end", status: "complete", actorType: "service",
          actorName: "faster-whisper", channel: "voice", turnId: request.turnId,
          operationId, name: "Voice transcription", content: text, payload: result,
          primaryFileId: request.primaryFileId,
        });
      }
      let attachment = null;
      if (["document", "image"].includes(file?.media_kind)) {
        attachment = await readRequestAttachment({
          mediaRoot: this.mediaRoot,
          file,
          maximumBytes: this.maxRequestAttachmentBytes,
          maximumTextBytes: this.maxTextAttachmentBytes,
        });
        attachment = {
          ...attachment,
          fileId: Number(file.file_id),
          title: file.title || file.original_filename,
          description: file.description ?? null,
          titleSource: file.title_source ?? "original_filename",
          originalFilename: file.original_filename,
        };
        this.ledger.append({
          type: "attachment.read", status: "complete", actorType: "service",
          actorName: "Request attachment reader", channel: request.channel,
          turnId: request.turnId, name: "Request attachment read",
          payload: {
            filename: attachment.filename,
            mediaKind: attachment.mediaKind,
            mimeType: attachment.mimeType,
            byteSize: attachment.byteSize,
            sha256: attachment.sha256,
          },
          primaryFileId: request.primaryFileId,
        });
      }
      let videoSource = null;
      let supplementalInstructions = "";
      if (request.payload?.requestKind === "interaction_video") {
        videoSource = this.ledger.interactionVideoSource(request.payload.sourceRequestId);
        const operationId = `video-source-transcription:${request.turnId}`;
        this.ledger.append({
          type: "video.source.transcription.start", phase: "start", status: "processing", actorType: "service",
          actorName: "faster-whisper", channel: request.channel, turnId: request.turnId,
          operationId, name: "Video source word timing", primaryFileId: videoSource.audioFile.file_id,
          subjectType: "source_request", subjectId: videoSource.requestId,
        });
        const audioPath = safeMediaPath(this.mediaRoot, videoSource.audioFile.storage_path);
        const transcription = await this.transcriber.transcribe(audioPath, { wordTimestamps: true });
        if (!transcription.text?.trim() || !transcription.words?.length) {
          throw new Error("Video source transcription returned no timed words");
        }
        videoSource = { ...videoSource, audioPath, transcription };
        this.ledger.append({
          type: "video.source.transcription.complete", phase: "end", status: "complete", actorType: "service",
          actorName: "faster-whisper", channel: request.channel, turnId: request.turnId,
          operationId, name: "Video source word timing", content: transcription.text,
          payload: transcription, primaryFileId: videoSource.audioFile.file_id,
          subjectType: "source_request", subjectId: videoSource.requestId,
        });
        const activity = videoSource.events
          .filter((event) => ["transcription.complete", "context.sent", "model.request", "tool.call", "tool.result", "model.response", "assistant.response", "request.error"].includes(event.type))
          .map((event) => ({
            atMs: Math.max(0, event.occurredAtMs - videoSource.submittedAtMs),
            type: event.type,
            name: event.name,
            status: event.status,
            error: event.error,
          }));
        supplementalInstructions = [
          "# Exact source interaction for this video",
          `Source request ID: ${videoSource.requestId}`,
          `Raw Whisper transcript: ${videoSource.rawTranscript}`,
          `Fresh timed transcript: ${transcription.text}`,
          `Actual assistant response or error: ${videoSource.response}`,
          `Source ended with error: ${videoSource.error || "no"}`,
          `Recording duration: ${transcription.durationMs} ms`,
          `Word timings (absolute source milliseconds):\n${JSON.stringify(transcription.words)}`,
          `Exact activity sequence:\n${JSON.stringify(activity)}`,
        ].join("\n\n");
      }
      const response = await this.runtime.run({
        requestId: request.turnId,
        requestEventId: request.eventId,
        text,
        channel: request.channel,
        attachment,
        runLimits: request.payload?.runLimits ?? null,
        model: request.payload?.model ?? null,
        effort: request.payload?.effort ?? null,
        supplementalInstructions,
        videoSource,
        capabilityOverride: request.payload?.requestKind === "interaction_video" ? ["video"] : null,
      });
      if (request.payload?.requestKind === "interaction_video") {
        const videoEvents = this.ledger.trace(request.turnId);
        const rendered = videoEvents.some((event) => event.type === "video.render.completed");
        if (!rendered) {
          const renderError = [...videoEvents].reverse().find((event) => event.type === "video.render.error");
          throw new Error(renderError?.error || "The video request finished without producing an MP4");
        }
      }
      this.ledger.finish(request, response);
    } catch (error) {
      this.ledger.fail(request, error);
    }
  }
}
