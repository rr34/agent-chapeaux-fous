import { createHash, randomUUID } from "node:crypto";
import { safeJson } from "./redaction.mjs";

function publicEvent(row) {
  if (!row) return null;
  let payload = {};
  try { payload = JSON.parse(row.payload_json || "{}"); } catch { payload = { parseError: true }; }
  return {
    eventSeq: Number(row.event_seq),
    eventId: row.event_id,
    occurredAtMs: Number(row.occurred_at_ms),
    occurredAtUtc: row.occurred_at_utc,
    type: row.event_type,
    phase: row.event_phase,
    status: row.status,
    actorType: row.actor_type,
    actorName: row.actor_name,
    source: row.source,
    channel: row.channel,
    sessionId: row.session_id,
    turnId: row.turn_id,
    traceId: row.trace_id,
    operationId: row.operation_id,
    name: row.name,
    content: row.content_text,
    payload,
    primaryFileId: row.primary_file_id == null ? null : Number(row.primary_file_id),
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    error: row.error_text,
  };
}

const receivedEventTypes = ["request.received", "voice.request.received"];
const responseEventTypes = ["assistant.response", "agent.turn.end"];
const conversationTextEventTypes = [
  ...receivedEventTypes,
  ...responseEventTypes,
  "transcription.complete",
  "voice.transcription.end",
];
const terminalEventTypes = [
  "request.complete",
  "request.error",
  "agent.turn.end",
  "agent.turn.error",
  "voice.request.interrupted",
  "voice.transcription.error",
];
const emailMutationToolNames = ["email_cleanup_apply", "email_bulk_update", "email_update"];

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function escapedLike(value) {
  return `%${value.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function historyTopic(query) {
  if (query == null) return { query: null, terms: [] };
  if (typeof query !== "string" || !query.trim()) {
    throw new Error("History topic query must be a non-empty string or null");
  }
  const normalized = query.trim();
  if (normalized.length > 500) throw new Error("History topic query cannot exceed 500 characters");
  const terms = [...new Set(
    (normalized.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || [])
      .map((term) => term.toLowerCase()),
  )];
  if (terms.length === 0) throw new Error("History topic query must contain searchable text");
  if (terms.length > 12) throw new Error("History topic query must contain no more than 12 terms");
  return { query: normalized, terms };
}

function requestChannel(request) {
  if (request.type === "voice.request.received") {
    return request.payload?.inputKind === "voice" ? "voice" : "web";
  }
  return request.channel;
}

function operationFinished(events, start, terminalTypes) {
  return events.some((event) => (
    event.eventSeq > start.eventSeq
    && terminalTypes.includes(event.type)
    && (!start.operationId || event.operationId === start.operationId)
  ));
}

function activeOperation(events, startType, terminalTypes) {
  return [...events].reverse().find((event) => (
    event.type === startType
    && event.phase === "start"
    && !operationFinished(events, event, terminalTypes)
  ));
}

export function requestProgress(events, startedAtMs) {
  const last = events.at(-1);
  const tool = activeOperation(events, "tool.call", ["tool.result"]);
  const transcription = activeOperation(events, "transcription.start", ["transcription.complete", "request.error"]);
  const videoTranscription = activeOperation(events, "video.source.transcription.start", ["video.source.transcription.complete", "request.error"]);
  const model = activeOperation(events, "model.request", ["model.response", "request.error"]);
  let label = "Queued";
  if (tool) label = `Running ${tool.name || tool.actorName || "tool"}`;
  else if (videoTranscription) label = "Timing video captions";
  else if (transcription) label = "Transcribing";
  else if (model) label = "Waiting for model";
  else if (last?.type === "tools.sent" || last?.type === "context.sent") label = "Building model request";
  else if (last?.type === "model.response" || last?.type === "model.usage" || last?.type === "assistant.response") label = "Finishing response";
  else if (last?.type === "request.processing") label = "Preparing request";
  else if (last?.type !== "request.received" && last?.type !== "voice.request.received") label = "Processing request";
  return {
    label,
    startedAtMs,
    lastActivityAtMs: last?.occurredAtMs ?? startedAtMs,
    modelCalls: events.filter((event) => event.type === "model.request" && event.phase === "start").length,
    toolCalls: events.filter((event) => event.type === "tool.call" && event.phase === "start").length,
  };
}

export class Ledger {
  constructor(store) {
    this.store = store;
  }

  append({
    type, phase = "point", status = null, actorType = "service", actorName = "Agent Slayer",
    source = "agent-slayer", channel = "web", sessionId = "main", turnId = null,
    traceId = turnId, operationId = null, name = null, content = null, payload = {},
    primaryFileId = null, subjectType = null, subjectId = null, error = null,
  }) {
    const database = this.store.requireReady();
    const eventId = randomUUID();
    database.prepare(`
      INSERT INTO activity_events (
        event_id, event_type, event_phase, status, actor_type, actor_name,
        source, channel, session_id, turn_id, trace_id, operation_id,
        name, content_text, payload_json, primary_file_id, subject_type, subject_id, error_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId, type, phase, status, actorType, actorName, source, channel,
      sessionId, turnId, traceId, operationId, name, content, safeJson(payload),
      primaryFileId, subjectType, subjectId, error,
    );
    return eventId;
  }

  createRequest({ text = null, channel = "web", primaryFileId = null, runLimits = null, metadata = {} }) {
    const requestId = randomUUID();
    const eventId = this.append({
      type: "request.received",
      status: "queued",
      actorType: "user",
      actorName: "User",
      source: channel === "voice" ? "voice_recorder" : "web_client",
      channel,
      turnId: requestId,
      name: "User request",
      content: text,
      payload: { ...metadata, ...(runLimits === null ? {} : { runLimits }) },
      primaryFileId,
    });
    return { requestId, eventId };
  }

  nextQueuedRequest() {
    const row = this.store.requireReady().prepare(`
      SELECT received.*
      FROM activity_events AS received
      WHERE received.event_type = 'request.received'
        AND NOT EXISTS (
          SELECT 1 FROM activity_events AS terminal
          WHERE terminal.turn_id = received.turn_id
            AND terminal.event_type IN ('request.complete', 'request.error')
        )
      ORDER BY received.event_seq
      LIMIT 1
    `).get();
    return publicEvent(row);
  }

  markProcessing(request) {
    this.append({
      type: "request.processing", phase: "start", status: "processing",
      channel: request.channel, turnId: request.turnId, name: "Request processing",
      primaryFileId: request.primaryFileId,
    });
  }

  finish(request, responseText) {
    this.append({
      type: "assistant.response", status: "complete", actorType: "model", actorName: "Slayer",
      channel: request.channel, turnId: request.turnId, name: "Assistant response", content: responseText,
    });
    this.append({
      type: "request.complete", phase: "end", status: "complete",
      channel: request.channel, turnId: request.turnId, name: "Request complete",
    });
  }

  fail(request, error) {
    const message = error instanceof Error ? error.message : String(error);
    this.append({
      type: "request.error", phase: "error", status: "error",
      channel: request.channel, turnId: request.turnId, name: "Request failed",
      content: message, error: message,
    });
  }

  trace(requestId) {
    return this.store.requireReady().prepare(`
      SELECT * FROM activity_events WHERE turn_id = ? ORDER BY event_seq
    `).all(requestId).map(publicEvent);
  }

  resolveRequestId(requestIdOrPrefix) {
    const candidate = String(requestIdOrPrefix || "").toLowerCase();
    if (!/^[0-9a-f][0-9a-f-]{7,35}$/.test(candidate)) return { status: "invalid", requestId: null };
    const rows = this.store.requireReady().prepare(`
      SELECT DISTINCT turn_id
      FROM activity_events
      WHERE turn_id LIKE ?
      ORDER BY turn_id
      LIMIT 2
    `).all(`${candidate}%`);
    if (rows.length === 0) return { status: "missing", requestId: null };
    if (rows.length > 1) return { status: "ambiguous", requestId: null };
    return { status: "resolved", requestId: rows[0].turn_id };
  }

  #requestDetails(request, { includeVideo = true } = {}) {
    const events = this.trace(request.turnId);
    const terminal = [...events].reverse().find((event) => terminalEventTypes.includes(event.type));
    const response = [...events].reverse().find((event) => responseEventTypes.includes(event.type));
    const transcript = events.find((event) => ["transcription.complete", "voice.transcription.end"].includes(event.type));
    const usage = [...events].reverse().find((event) => event.type === "model.usage");
    const status = terminal?.status || (events.some((event) => ["request.processing", "agent.turn.start", "voice.transcription.start"].includes(event.type)) ? "processing" : "queued");
    const requestKind = request.payload?.requestKind ?? null;
    const sourceFile = request.primaryFileId == null ? null : this.file(request.primaryFileId);
    const videoEligible = requestKind !== "interaction_video"
      && Boolean(terminal)
      && sourceFile?.media_kind === "audio";
    const video = includeVideo && requestKind !== "interaction_video"
      ? this.videoForSourceRequest(request.turnId)
      : null;
    return {
      requestId: request.turnId,
      channel: requestChannel(request),
      submittedAtMs: request.occurredAtMs,
      elapsedMs: terminal ? Math.max(0, terminal.occurredAtMs - request.occurredAtMs) : null,
      status,
      request: request.content || transcript?.content || "Voice request",
      response: response?.content || null,
      error: terminal?.error || (terminal?.status === "error" ? terminal.content : null),
      usage: usage?.payload || null,
      eventCount: events.length,
      ...(requestKind ? { requestKind } : {}),
      ...(videoEligible ? { videoEligible: true } : {}),
      ...(video ? { video } : {}),
      ...(events.some((event) => event.type === "conversation.started")
        ? { conversationStarted: true }
        : {}),
      ...(!terminal ? { progress: requestProgress(events, request.occurredAtMs) } : {}),
    };
  }

  unfinishedRequestCount() {
    const row = this.store.requireReady().prepare(`
      SELECT COUNT(*) AS count
      FROM activity_events AS received
      WHERE received.event_type IN (${placeholders(receivedEventTypes)})
        AND NOT EXISTS (
          SELECT 1 FROM activity_events AS terminal
          WHERE terminal.turn_id = received.turn_id
            AND terminal.event_type IN (${placeholders(terminalEventTypes)})
        )
    `).get(...receivedEventTypes, ...terminalEventTypes);
    return Number(row?.count ?? 0);
  }

  currentModelConversation() {
    const marker = this.store.requireReady().prepare(`
      SELECT * FROM activity_events
      WHERE event_type IN ('conversation.started', 'conversation.reset')
      ORDER BY event_seq DESC
      LIMIT 1
    `).get();
    const event = publicEvent(marker);
    if (!event || event.type === "conversation.reset") {
      return {
        conversationId: null,
        markerEventSeq: event?.eventSeq ?? 0,
        toolFingerprint: null,
        capabilities: [],
        reset: Boolean(event),
      };
    }
    const conversationId = typeof event.payload?.conversationId === "string"
      ? event.payload.conversationId
      : null;
    const recordedFingerprint = typeof event.payload?.toolFingerprint === "string"
      ? event.payload.toolFingerprint
      : null;
    const conversationStartEventSeq = Number.isSafeInteger(event.payload?.conversationStartEventSeq)
      ? event.payload.conversationStartEventSeq
      : event.eventSeq;
    return {
      conversationId,
      markerEventSeq: conversationStartEventSeq,
      toolFingerprint: recordedFingerprint,
      capabilities: Array.isArray(event.payload?.capabilities)
        ? event.payload.capabilities.filter((value) => typeof value === "string")
        : [],
      reset: false,
    };
  }

  activeModelConversation(toolFingerprint) {
    const state = this.currentModelConversation();
    if (state.reset || (!state.conversationId && !state.toolFingerprint)) {
      return { conversationId: null, markerEventSeq: state.markerEventSeq, reason: "new" };
    }
    const conversationId = state.conversationId;
    const recordedFingerprint = state.toolFingerprint;
    if (!conversationId || !recordedFingerprint || recordedFingerprint !== toolFingerprint) {
      return { conversationId: null, markerEventSeq: state.markerEventSeq, reason: "tools_changed" };
    }
    return { conversationId, markerEventSeq: state.markerEventSeq, reason: "continue" };
  }

  markConversationStarted({ conversationId, toolFingerprint, capabilities = [], requestId, channel = "web" }) {
    if (typeof conversationId !== "string" || !conversationId.trim()) {
      throw new Error("A model conversation ID is required");
    }
    if (typeof toolFingerprint !== "string" || !toolFingerprint.trim()) {
      throw new Error("A callable-tool fingerprint is required");
    }
    const requestStart = this.store.requireReady().prepare(`
      SELECT MIN(event_seq) AS event_seq
      FROM activity_events
      WHERE turn_id = ? AND event_type IN (${placeholders(receivedEventTypes)})
    `).get(requestId, ...receivedEventTypes);
    const conversationStartEventSeq = Math.max(0, Number(requestStart?.event_seq ?? 1) - 1);
    return this.append({
      type: "conversation.started", status: "complete", actorType: "service",
      actorName: "Conversation manager", channel, turnId: requestId,
      name: "New model conversation", content: "Started a new model conversation",
      payload: { conversationId, toolFingerprint, capabilities, conversationStartEventSeq },
      subjectType: "model_conversation", subjectId: conversationId,
    });
  }

  resetModelConversation({ channel = "web" } = {}) {
    return this.append({
      type: "conversation.reset", status: "complete", actorType: "user",
      actorName: "User", channel, name: "New conversation requested",
      content: "Start the next request in a new model conversation",
    });
  }

  recentRequests(limit = 100) {
    const bounded = Math.min(200, Math.max(1, Number(limit) || 100));
    const received = this.store.requireReady().prepare(`
      SELECT * FROM activity_events
      WHERE event_type IN (${placeholders(receivedEventTypes)})
      ORDER BY event_seq DESC LIMIT ?
    `).all(...receivedEventTypes, bounded).map(publicEvent);
    return received.map((request) => this.#requestDetails(request));
  }

  interactionVideoSource(requestId) {
    const requestRow = this.store.requireReady().prepare(`
      SELECT * FROM activity_events
      WHERE turn_id = ? AND event_type IN (${placeholders(receivedEventTypes)})
      ORDER BY event_seq LIMIT 1
    `).get(requestId, ...receivedEventTypes);
    const request = publicEvent(requestRow);
    if (!request) throw Object.assign(new Error("Source interaction was not found"), { statusCode: 404 });
    const events = this.trace(requestId);
    const terminal = [...events].reverse().find((event) => terminalEventTypes.includes(event.type));
    if (!terminal) throw Object.assign(new Error("Wait for the source interaction to finish before making its video"), { statusCode: 409 });
    const audioFile = request.primaryFileId == null ? null : this.file(request.primaryFileId);
    if (!audioFile || audioFile.media_kind !== "audio") {
      throw Object.assign(new Error("A video requires a voice interaction with saved source audio"), { statusCode: 409 });
    }
    const transcript = events.find((event) => ["transcription.complete", "voice.transcription.end"].includes(event.type));
    const response = [...events].reverse().find((event) => responseEventTypes.includes(event.type));
    return {
      requestId,
      requestEventId: request.eventId,
      submittedAtMs: request.occurredAtMs,
      rawTranscript: transcript?.content || request.content || "",
      response: response?.content || terminal.content || terminal.error || "",
      error: terminal.status === "error" ? (terminal.error || terminal.content || null) : null,
      audioFile,
      events,
    };
  }

  videoForSourceRequest(sourceRequestId) {
    const rows = this.store.requireReady().prepare(`
      SELECT * FROM activity_events
      WHERE event_type = 'request.received'
      ORDER BY event_seq DESC
      LIMIT 1000
    `).all().map(publicEvent);
    const videoRequest = rows.find((event) => (
      event.payload?.requestKind === "interaction_video"
      && event.payload?.sourceRequestId === sourceRequestId
    ));
    if (!videoRequest) return null;
    const details = this.#requestDetails(videoRequest, { includeVideo: false });
    const rendered = [...this.trace(videoRequest.turnId)].reverse().find((event) => event.type === "video.render.completed");
    const fileId = rendered?.primaryFileId ?? rendered?.payload?.fileId ?? null;
    return {
      requestId: videoRequest.turnId,
      status: details.status === "complete" && !fileId ? "error" : details.status,
      fileId,
      downloadUrl: fileId == null ? null : `/api/videos/${fileId}/download`,
      error: details.error || (details.status === "complete" && !fileId ? "Video request completed without producing an MP4" : null),
    };
  }

  conversationRange({
    startAtUtc, endAtUtc, query = null, afterRequestId = null, limit = 50, excludeRequestId = null,
  }) {
    const start = new Date(startAtUtc);
    const end = new Date(endAtUtc);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
      throw new Error("History range boundaries must be valid ISO-8601 date-times");
    }
    if (start >= end) throw new Error("History range endAtUtc must be later than startAtUtc");
    const topic = historyTopic(query);
    const bounded = Math.min(100, Math.max(1, Number(limit) || 50));
    const database = this.store.requireReady();
    let afterEventSeq = 0;
    if (afterRequestId) {
      const cursor = database.prepare(`
        SELECT event_seq FROM activity_events
        WHERE turn_id = ? AND event_type IN (${placeholders(receivedEventTypes)})
        ORDER BY event_seq LIMIT 1
      `).get(afterRequestId, ...receivedEventTypes);
      if (!cursor) throw new Error("History range cursor request was not found");
      afterEventSeq = Number(cursor.event_seq);
    }
    const topicParameters = [];
    const topicClauses = topic.terms.map((term) => {
      topicParameters.push(...conversationTextEventTypes, escapedLike(term));
      return `AND EXISTS (
        SELECT 1 FROM activity_events AS topic_event
        WHERE topic_event.turn_id = received.turn_id
          AND topic_event.event_type IN (${placeholders(conversationTextEventTypes)})
          AND topic_event.content_text LIKE ? ESCAPE '\\'
      )`;
    }).join("\n");
    const rows = database.prepare(`
      SELECT received.* FROM activity_events AS received
      WHERE received.event_type IN (${placeholders(receivedEventTypes)})
        AND received.occurred_at_ms >= ?
        AND received.occurred_at_ms < ?
        AND received.event_seq > ?
        AND (? IS NULL OR received.turn_id <> ?)
        ${topicClauses}
      ORDER BY received.event_seq
      LIMIT ?
    `).all(
      ...receivedEventTypes,
      start.getTime(),
      end.getTime(),
      afterEventSeq,
      excludeRequestId,
      excludeRequestId,
      ...topicParameters,
      bounded + 1,
    ).map(publicEvent);
    const hasMore = rows.length > bounded;
    const selected = rows.slice(0, bounded);
    const entries = selected.map((request) => {
      const details = this.#requestDetails(request);
      return {
        requestId: details.requestId,
        channel: details.channel,
        submittedAtUtc: request.occurredAtUtc,
        status: details.status,
        request: details.request,
        response: details.response,
        error: details.error,
      };
    });
    return {
      range: { startAtUtc: start.toISOString(), endAtUtc: end.toISOString() },
      topic: { query: topic.query, terms: topic.terms },
      count: entries.length,
      hasMore,
      nextAfterRequestId: hasMore ? entries.at(-1)?.requestId ?? null : null,
      entries,
    };
  }

  recentConversation({ beforeRequestId = null, afterEventSeq = 0, limit = 4 } = {}) {
    const database = this.store.requireReady();
    const before = beforeRequestId
      ? database.prepare(`
          SELECT event_seq FROM activity_events
          WHERE turn_id = ? AND event_type IN (${placeholders(receivedEventTypes)})
          ORDER BY event_seq LIMIT 1
        `).get(beforeRequestId, ...receivedEventTypes)?.event_seq
      : null;
    const rows = database.prepare(`
      SELECT * FROM activity_events
      WHERE event_type IN (${placeholders([...receivedEventTypes, ...responseEventTypes])})
        AND event_seq > ?
        AND (? IS NULL OR event_seq < ?)
      ORDER BY event_seq DESC LIMIT ?
    `).all(
      ...receivedEventTypes,
      ...responseEventTypes,
      Math.max(0, Number(afterEventSeq) || 0),
      before ?? null,
      before ?? null,
      Math.min(20, Math.max(2, limit * 2)),
    ).map(publicEvent).reverse();
    return rows.map((event) => ({
      role: receivedEventTypes.includes(event.type) ? "user" : "assistant",
      content: event.content,
      requestId: event.turnId,
      occurredAtUtc: event.occurredAtUtc,
    })).filter((entry) => entry.content);
  }

  searchHistory(query, limit = 20) {
    const bounded = Math.min(100, Math.max(1, Number(limit) || 20));
    const escaped = escapedLike(String(query));
    return this.store.requireReady().prepare(`
      SELECT * FROM activity_events
      WHERE event_type IN (${placeholders([...receivedEventTypes, ...responseEventTypes])})
        AND content_text LIKE ? ESCAPE '\\'
      ORDER BY event_seq DESC LIMIT ?
    `).all(...receivedEventTypes, ...responseEventTypes, escaped, bounded).map(publicEvent);
  }

  recentEmailCleanupReceipts(limit = 5) {
    const bounded = Math.min(10, Math.max(1, Number(limit) || 5));
    const rows = this.store.requireReady().prepare(`
      SELECT * FROM activity_events
      WHERE event_type = 'tool.result'
        AND status = 'complete'
        AND name IN (${placeholders(emailMutationToolNames)})
      ORDER BY event_seq DESC
      LIMIT 200
    `).all(...emailMutationToolNames).map(publicEvent);
    const turnIds = [];
    for (const row of rows) {
      if (!row.turnId || turnIds.includes(row.turnId)) continue;
      turnIds.push(row.turnId);
      if (turnIds.length >= bounded) break;
    }
    return turnIds.map((turnId) => {
      const events = this.trace(turnId);
      const request = events.find((event) => receivedEventTypes.includes(event.type));
      const response = [...events].reverse().find((event) => responseEventTypes.includes(event.type));
      const messagesById = new Map();
      for (const event of events.filter((item) => item.type === "tool.result" && item.status === "complete")) {
        const result = event.payload?.result;
        const messages = [
          ...(Array.isArray(result?.messages) ? result.messages : []),
          ...(Array.isArray(result?.list) ? result.list : []),
        ];
        for (const message of messages) {
          if (message?.id) messagesById.set(message.id, message);
        }
      }
      const operations = events
        .filter((event) => (
          event.type === "tool.result"
          && event.status === "complete"
          && emailMutationToolNames.includes(event.name)
        ))
        .map((resultEvent) => {
          const call = events.find((event) => (
            event.type === "tool.call"
            && event.operationId === resultEvent.operationId
            && event.name === resultEvent.name
          ));
          const args = call?.payload?.arguments ?? {};
          const result = resultEvent.payload?.result ?? {};
          const directMessages = Array.isArray(result.messages) ? result.messages : [];
          for (const message of directMessages) {
            if (message?.id) messagesById.set(message.id, message);
          }
          const emailIds = resultEvent.name === "email_cleanup_apply"
            ? directMessages.map(({ id }) => id)
            : resultEvent.name === "email_bulk_update"
              ? (result.emailIds ?? args.email_ids ?? [])
              : [args.email_id].filter(Boolean);
          const action = result.action
            ?? args.action
            ?? (args.destroy ? "permanent_destroy" : "update");
          return {
            tool: resultEvent.name,
            action,
            occurredAtUtc: resultEvent.occurredAtUtc,
            emailIds,
          };
        });
      const ids = [...new Set(operations.flatMap(({ emailIds }) => emailIds))];
      const messages = ids.map((id) => {
        const message = messagesById.get(id);
        return {
          id,
          threadId: message?.threadId ?? null,
          receivedAt: message?.receivedAt ?? null,
          from: message?.from ?? null,
          subject: message?.subject ?? null,
        };
      });
      return {
        requestId: turnId,
        requestedAtUtc: request?.occurredAtUtc ?? null,
        request: request?.content ?? null,
        response: response?.content ?? null,
        operationCount: operations.length,
        affectedCount: ids.length,
        operations,
        messages,
      };
    });
  }

  registerFile({
    storagePath, originalFilename, mimeType, sha256, byteSize, mediaKind = "audio",
    durationMs = null, width = null, height = null,
  }) {
    const database = this.store.requireReady();
    const existing = database.prepare("SELECT * FROM files WHERE sha256 = ? AND byte_size = ? ORDER BY file_id LIMIT 1").get(sha256, byteSize);
    if (existing) return { fileId: Number(existing.file_id), duplicate: true, storagePath: existing.storage_path };
    const result = database.prepare(`
      INSERT INTO files (
        storage_path, original_filename, media_kind, mime_type, sha256, byte_size,
        duration_ms, width, height
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(storagePath, originalFilename, mediaKind, mimeType, sha256, byteSize, durationMs, width, height);
    return { fileId: Number(result.lastInsertRowid), duplicate: false, storagePath };
  }

  file(fileId) {
    return this.store.requireReady().prepare("SELECT * FROM files WHERE file_id = ?").get(fileId);
  }

  requestHash(text) {
    return createHash("sha256").update(text).digest("hex");
  }
}
