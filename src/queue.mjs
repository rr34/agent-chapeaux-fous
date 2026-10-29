import { randomUUID } from "node:crypto";
import { readRequestAttachment, safeMediaPath } from "./request-attachments.mjs";

export class RequestCancelledError extends Error {
  constructor(message = "Request cancelled before execution") {
    super(message);
    this.name = "RequestCancelledError";
  }
}

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
    this.drainScheduled = false;
    this.wakeRequested = false;
    this.pendingTurnBriefApprovals = new Map();
  }

  notify() {
    this.wakeRequested = true;
    if (this.running || this.drainScheduled) return;
    this.drainScheduled = true;
    setImmediate(() => {
      this.drainScheduled = false;
      void this.drain();
    });
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
      const attachmentFileIds = Array.isArray(request.payload?.attachmentFileIds)
        ? request.payload.attachmentFileIds
        : (request.primaryFileId == null ? [] : [request.primaryFileId]);
      const attachedFiles = attachmentFileIds.map((fileId) => this.ledger.file(Number(fileId))).filter(Boolean);
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
      } else if (attachedFiles.length && attachedFiles.every((entry) => entry.media_kind === "audio")) {
        const files = attachedFiles.map((entry) => ({
          fileId: Number(entry.file_id),
          title: entry.title || entry.original_filename,
          description: entry.description ?? null,
          titleSource: entry.title_source ?? "original_filename",
          originalFilename: entry.original_filename,
          filename: entry.original_filename,
          mediaKind: entry.media_kind,
          mimeType: entry.mime_type,
          byteSize: entry.byte_size == null ? null : Number(entry.byte_size),
          durationMs: entry.duration_ms == null ? null : Number(entry.duration_ms),
          sha256: entry.sha256,
        }));
        attachment = {
          ...files[0],
          mediaKind: "audio_group",
          filename: `${files.length} uploaded MP3 ${files.length === 1 ? "file" : "files"}`,
          files,
          text: JSON.stringify({
            purpose: "Use the user request, filenames, existing ID3-derived descriptions, and any explicitly selected public-web evidence to populate schema-v2 music_metadata with file_update. Release owns album/disc/side/track placement; work owns the composition; sequences subdivide the work. Unknown facts remain null. Never send audio bytes or unrelated private text to web search.",
            files: files.map(({ fileId, originalFilename, title, titleSource, description, durationMs }) => ({
              fileId, originalFilename, title, titleSource, description, durationMs,
            })),
          }, null, 2),
        };
        this.ledger.append({
          type: "attachment.read", status: "complete", actorType: "service",
          actorName: "Music upload metadata reader", channel: request.channel,
          turnId: request.turnId, name: `Prepared ${files.length} MP3 metadata records for the agent`,
          payload: {
            fileIds: files.map(({ fileId }) => fileId),
            fileCount: files.length,
            bytesReadFromAudio: 0,
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
        runLimits: request.payload?.runLimits ?? null,
        selectedObjectCandidates: request.payload?.selectedObjectCandidates ?? [],
        model: request.payload?.model ?? null,
        effort: request.payload?.effort ?? null,
        allowedToolNames: null,
        supplementalInstructions: "",
        ...(request.payload?.runLimits?.promptForTurnBrief === true
          ? { awaitTurnBriefApproval: (plan) => this.awaitTurnBriefApproval(request, plan) }
          : {}),
      });
      this.ledger.finish(request, response);
    } catch (error) {
      if (error instanceof RequestCancelledError) this.ledger.cancel(request);
      else this.ledger.fail(request, error);
    }
  }

  awaitTurnBriefApproval(request, plan) {
    if (this.pendingTurnBriefApprovals.has(request.turnId)) {
      throw new Error(`Plan approval is already pending for request ${request.turnId}`);
    }
    const approvalId = randomUUID();
    this.ledger.append({
      type: "turn.brief.approval_required", phase: "start", status: "waiting",
      actorType: "service", actorName: "Plan approval gate",
      channel: request.channel, turnId: request.turnId,
      operationId: approvalId, name: "Plan approval required",
      content: plan.summary,
      payload: { approvalId, ...plan },
      subjectType: "turn_brief", subjectId: request.turnId,
    });
    return new Promise((resolve) => {
      this.pendingTurnBriefApprovals.set(request.turnId, {
        approvalId,
        request,
        resolve,
      });
    }).then((decision) => {
      if (decision === "cancel") throw new RequestCancelledError();
    });
  }

  continueTurnBrief(requestId, approvalId) {
    return this.#resolveTurnBriefApproval(requestId, approvalId, "continue");
  }

  cancelTurnBrief(requestId, approvalId) {
    return this.#resolveTurnBriefApproval(requestId, approvalId, "cancel");
  }

  #resolveTurnBriefApproval(requestId, approvalId, decision) {
    const pending = this.pendingTurnBriefApprovals.get(requestId);
    if (!pending || pending.approvalId !== approvalId) return false;
    this.pendingTurnBriefApprovals.delete(requestId);
    const continuing = decision === "continue";
    this.ledger.append({
      type: continuing ? "turn.brief.approved" : "turn.brief.cancelled",
      phase: "end", status: continuing ? "complete" : "cancelled",
      actorType: "user", actorName: "User",
      channel: pending.request.channel, turnId: pending.request.turnId,
      operationId: pending.approvalId,
      name: continuing ? "Plan approved" : "Plan cancelled",
      content: continuing
        ? "The user continued with the displayed plan."
        : "The user cancelled before execution.",
      payload: { approvalId: pending.approvalId, decision },
      subjectType: "turn_brief", subjectId: pending.request.turnId,
    });
    pending.resolve(decision);
    return true;
  }
}
