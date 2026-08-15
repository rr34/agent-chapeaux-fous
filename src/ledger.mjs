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
      actorName: "Nate",
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

  recentRequests(limit = 100) {
    const bounded = Math.min(200, Math.max(1, Number(limit) || 100));
    const received = this.store.requireReady().prepare(`
      SELECT * FROM activity_events
      WHERE event_type = 'request.received'
      ORDER BY event_seq DESC LIMIT ?
    `).all(bounded).map(publicEvent);
    return received.map((request) => {
      const events = this.trace(request.turnId);
      const terminal = [...events].reverse().find((event) => ["request.complete", "request.error"].includes(event.type));
      const response = [...events].reverse().find((event) => event.type === "assistant.response");
      const transcript = events.find((event) => event.type === "transcription.complete");
      return {
        requestId: request.turnId,
        channel: request.channel,
        submittedAtMs: request.occurredAtMs,
        status: terminal?.status || (events.some((event) => event.type === "request.processing") ? "processing" : "queued"),
        request: request.content || transcript?.content || "Voice request",
        response: response?.content || null,
        error: terminal?.error || null,
        eventCount: events.length,
      };
    });
  }

  recentConversation({ beforeRequestId = null, limit = 4 } = {}) {
    const database = this.store.requireReady();
    const before = beforeRequestId
      ? database.prepare("SELECT event_seq FROM activity_events WHERE turn_id = ? AND event_type = 'request.received' ORDER BY event_seq LIMIT 1").get(beforeRequestId)?.event_seq
      : null;
    const rows = database.prepare(`
      SELECT * FROM activity_events
      WHERE event_type IN ('request.received', 'assistant.response')
        AND (? IS NULL OR event_seq < ?)
      ORDER BY event_seq DESC LIMIT ?
    `).all(before ?? null, before ?? null, Math.min(20, Math.max(2, limit * 2))).map(publicEvent).reverse();
    return rows.map((event) => ({
      role: event.type === "request.received" ? "user" : "assistant",
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
      WHERE event_type IN ('request.received', 'assistant.response')
        AND content_text LIKE ? ESCAPE '\\'
      ORDER BY event_seq DESC LIMIT ?
    `).all(escaped, bounded).map(publicEvent);
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
