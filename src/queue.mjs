import { readTextAttachment, safeMediaPath } from "./request-attachments.mjs";

export class RequestQueue {
  constructor({ ledger, runtime, transcriber, mediaRoot, maxTextAttachmentBytes = 10 * 1024 * 1024 }) {
    this.ledger = ledger;
    this.runtime = runtime;
    this.transcriber = transcriber;
    this.mediaRoot = mediaRoot;
    this.maxTextAttachmentBytes = maxTextAttachmentBytes;
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
      if (file?.media_kind === "document") {
        attachment = await readTextAttachment({
          mediaRoot: this.mediaRoot,
          file,
          maximumBytes: this.maxTextAttachmentBytes,
        });
        this.ledger.append({
          type: "attachment.read", status: "complete", actorType: "service",
          actorName: "Request attachment reader", channel: request.channel,
          turnId: request.turnId, name: "Request attachment read",
          payload: {
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            byteSize: attachment.byteSize,
            sha256: attachment.sha256,
          },
          primaryFileId: request.primaryFileId,
        });
      }
      const response = await this.runtime.run({
        requestId: request.turnId,
        requestEventId: request.eventId,
        text,
        channel: request.channel,
        attachment,
      });
      this.ledger.finish(request, response);
    } catch (error) {
      this.ledger.fail(request, error);
    }
  }
}
