import { randomUUID } from "node:crypto";
import { readRequestAttachment, safeMediaPath } from "./request-attachments.mjs";
import { repeatableExchangeToolNames } from "./structured-interaction-generation.mjs";

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
    this.wakeRequested = false;
    this.pendingTurnBriefApprovals = new Map();
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
      const response = await this.runtime.run({
        requestId: request.turnId,
        requestEventId: request.eventId,
        text,
        channel: request.channel,
        attachment,
        runLimits: request.payload?.runLimits ?? null,
        model: request.payload?.model ?? null,
        effort: request.payload?.effort ?? null,
        allowedToolNames: request.payload?.requestKind === "structured_interaction_generation"
          ? repeatableExchangeToolNames
          : null,
        supplementalInstructions: "",
        awaitTurnBriefApproval: (plan) => this.awaitTurnBriefApproval(request, plan),
      });
      this.ledger.finish(request, response);
    } catch (error) {
      if (error instanceof RequestCancelledError) this.ledger.cancel(request);
      else this.ledger.fail(request, error);
    }
  }

  awaitTurnBriefApproval(request, plan) {
    if (this.pendingTurnBriefApprovals.has(request.turnId)) {
      throw new Error(`TurnBrief approval is already pending for request ${request.turnId}`);
    }
    const approvalId = randomUUID();
    this.ledger.append({
      type: "turn.brief.approval_required", phase: "start", status: "waiting",
      actorType: "service", actorName: "TurnBrief approval gate",
      channel: request.channel, turnId: request.turnId,
      operationId: approvalId, name: "TurnBrief approval required",
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
      name: continuing ? "TurnBrief approved" : "TurnBrief cancelled",
      content: continuing
        ? "The user continued with the displayed TurnBrief."
        : "The user cancelled before execution.",
      payload: { approvalId: pending.approvalId, decision },
      subjectType: "turn_brief", subjectId: pending.request.turnId,
    });
    pending.resolve(decision);
    return true;
  }
}
