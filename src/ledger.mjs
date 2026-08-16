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
const terminalEventTypes = [
  "request.complete",
  "request.error",
  "agent.turn.end",
  "agent.turn.error",
  "voice.request.interrupted",
  "voice.transcription.error",
];

function placeholders(values) {
  return values.map(() => "?").join(", ");
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
  const model = activeOperation(events, "model.request", ["model.response", "request.error"]);
  let label = "Queued";
  if (tool) label = `Running ${tool.name || tool.actorName || "tool"}`;
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

  createRequest({ text = null, channel = "web", primaryFileId = null }) {
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

  recentRequests(limit = 100) {
    const bounded = Math.min(200, Math.max(1, Number(limit) || 100));
    const received = this.store.requireReady().prepare(`
      SELECT * FROM activity_events
      WHERE event_type IN (${placeholders(receivedEventTypes)})
      ORDER BY event_seq DESC LIMIT ?
    `).all(...receivedEventTypes, bounded).map(publicEvent);
    return received.map((request) => {
      const events = this.trace(request.turnId);
      const terminal = [...events].reverse().find((event) => terminalEventTypes.includes(event.type));
      const response = [...events].reverse().find((event) => responseEventTypes.includes(event.type));
      const transcript = events.find((event) => ["transcription.complete", "voice.transcription.end"].includes(event.type));
      const usage = [...events].reverse().find((event) => event.type === "model.usage");
      const status = terminal?.status || (events.some((event) => ["request.processing", "agent.turn.start", "voice.transcription.start"].includes(event.type)) ? "processing" : "queued");
      return {
        requestId: request.turnId,
        channel: requestChannel(request),
        submittedAtMs: request.occurredAtMs,
        status,
        request: request.content || transcript?.content || "Voice request",
        response: response?.content || null,
        error: terminal?.error || (terminal?.status === "error" ? terminal.content : null),
        usage: usage?.payload || null,
        eventCount: events.length,
        ...(!terminal ? { progress: requestProgress(events, request.occurredAtMs) } : {}),
      };
    });
  }

  recentConversation({ beforeRequestId = null, limit = 4 } = {}) {
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
        AND (? IS NULL OR event_seq < ?)
      ORDER BY event_seq DESC LIMIT ?
    `).all(
      ...receivedEventTypes,
      ...responseEventTypes,
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
    const escaped = `%${String(query).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    return this.store.requireReady().prepare(`
      SELECT * FROM activity_events
      WHERE event_type IN (${placeholders([...receivedEventTypes, ...responseEventTypes])})
        AND content_text LIKE ? ESCAPE '\\'
      ORDER BY event_seq DESC LIMIT ?
    `).all(...receivedEventTypes, ...responseEventTypes, escaped, bounded).map(publicEvent);
  }

  registerFile({ storagePath, originalFilename, mimeType, sha256, byteSize, mediaKind = "audio" }) {
    const database = this.store.requireReady();
    const existing = database.prepare("SELECT * FROM files WHERE sha256 = ? AND byte_size = ? ORDER BY file_id LIMIT 1").get(sha256, byteSize);
    if (existing) return { fileId: Number(existing.file_id), duplicate: true, storagePath: existing.storage_path };
    const result = database.prepare(`
      INSERT INTO files (storage_path, original_filename, media_kind, mime_type, sha256, byte_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(storagePath, originalFilename, mediaKind, mimeType, sha256, byteSize);
    return { fileId: Number(result.lastInsertRowid), duplicate: false, storagePath };
  }

  file(fileId) {
    return this.store.requireReady().prepare("SELECT * FROM files WHERE file_id = ?").get(fileId);
  }

  requestHash(text) {
    return createHash("sha256").update(text).digest("hex");
  }
}
