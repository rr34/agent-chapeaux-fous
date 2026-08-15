import path from "node:path";

function safeMediaPath(mediaRoot, storagePath) {
  const root = path.resolve(mediaRoot);
  const relative = String(storagePath ?? "").replace(/^media\//, "");
  const filename = path.resolve(root, relative);
  if (!filename.startsWith(`${root}${path.sep}`)) throw new Error("Stored media path escapes the media directory");
  return filename;
}

export class RequestQueue {
  constructor({ ledger, runtime, transcriber, mediaRoot }) {
    this.ledger = ledger;
    this.runtime = runtime;
    this.transcriber = transcriber;
    this.mediaRoot = mediaRoot;
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
      if (!text) {
        const file = this.ledger.file(request.primaryFileId);
        if (!file) throw new Error("Voice request has no stored audio file");
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
      const response = await this.runtime.run({
        requestId: request.turnId,
        requestEventId: request.eventId,
        text,
        channel: request.channel,
      });
      this.ledger.finish(request, response);
    } catch (error) {
      this.ledger.fail(request, error);
    }
  }
}
