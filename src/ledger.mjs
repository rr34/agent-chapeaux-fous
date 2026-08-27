import { createHash, randomUUID } from "node:crypto";
import { activeDeferredActionReferences } from "./deferred-actions.mjs";
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

function publicFile(row) {
  if (!row) return null;
  return {
    fileId: Number(row.file_id),
    title: row.title || row.original_filename || `File ${row.file_id}`,
    description: row.description ?? null,
    titleSource: row.title_source ?? "original_filename",
    originalFilename: row.original_filename ?? null,
    mediaKind: row.media_kind,
    mimeType: row.mime_type ?? null,
    sha256: row.sha256 ?? null,
    byteSize: row.byte_size == null ? null : Number(row.byte_size),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    sourceEventId: row.source_event_id ?? null,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc ?? null,
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

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function escapedLike(value) {
  return `%${value.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function receiptEnvelope(resultEvent, callPayload = {}) {
  return {
    receiptEventSeq: resultEvent.eventSeq,
    requestId: resultEvent.turnId,
    occurredAtUtc: resultEvent.occurredAtUtc,
    tool: resultEvent.name,
    call: {
      callId: callPayload.callId ?? resultEvent.operationId,
      arguments: callPayload.arguments ?? {},
    },
    outcome: {
      ok: resultEvent.status === "complete",
      status: resultEvent.status,
      result: resultEvent.payload?.result ?? null,
      error: resultEvent.error ?? null,
    },
  };
}

function edgeBoundedBlocks(blocks, maximumCharacters) {
  if (!blocks.length) return { blocks: [], omitted: 0 };
  const selectedIndexes = new Set();
  let used = 0;
  const tryAdd = (index) => {
    if (selectedIndexes.has(index)) return true;
    const additional = blocks[index].length + (selectedIndexes.size ? 2 : 0);
    if (selectedIndexes.size && used + additional > maximumCharacters) return false;
    selectedIndexes.add(index);
    used += additional;
    return true;
  };
  for (let index = 0; index < Math.min(4, blocks.length); index += 1) {
    if (!tryAdd(index)) break;
  }
  for (let index = blocks.length - 1; index >= 4; index -= 1) {
    if (!tryAdd(index)) break;
  }
  const selected = [...selectedIndexes].sort((left, right) => left - right).map((index) => blocks[index]);
  return { blocks: selected, omitted: blocks.length - selected.length };
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
  const activeStep = activeOperation(events, "agent.step", ["agent.step"]);
  if (tool) label = `Running ${tool.name || tool.actorName || "tool"}`;
  else if (videoTranscription) label = "Timing video captions";
  else if (transcription) label = "Transcribing";
  else if (model) label = model.payload?.workflowStep
    ? `${model.payload.workflowStepLabel || model.payload.workflowStep} · waiting for model`
    : "Waiting for model";
  else if (activeStep) label = activeStep.name || "Processing request step";
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

function emptyTokenUsage() {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function addTokenUsage(total, usage) {
  for (const key of Object.keys(total)) total[key] += Number(usage?.[key] ?? 0);
  return total;
}

function requestUsage(events) {
  const usageEvents = events.filter((event) => event.type === "model.usage");
  if (!usageEvents.length) return null;
  const tokenUsage = usageEvents.reduce(
    (total, event) => addTokenUsage(total, event.payload?.tokenUsage),
    emptyTokenUsage(),
  );
  const estimatedCosts = usageEvents
    .map((event) => Number(event.payload?.estimatedCostUsd))
    .filter(Number.isFinite);
  const latest = usageEvents.at(-1)?.payload ?? {};
  return {
    ...latest,
    tokenUsage,
    ...(estimatedCosts.length
      ? { estimatedCostUsd: estimatedCosts.reduce((total, value) => total + value, 0) }
      : {}),
    modelCallCount: usageEvents.length,
  };
}

function workflowSteps(events) {
  const starts = events.filter((event) => event.type === "agent.step" && event.phase === "start");
  return starts.map((start) => {
    const terminal = events.find((event) => (
      event.type === "agent.step"
      && event.eventSeq > start.eventSeq
      && event.operationId === start.operationId
      && ["end", "error"].includes(event.phase)
    ));
    const usageEvents = events.filter((event) => (
      event.type === "model.usage"
      && event.payload?.workflowStep === start.payload?.workflowStep
      && event.eventSeq > start.eventSeq
      && (!terminal || event.eventSeq < terminal.eventSeq)
    ));
    const tokenUsage = usageEvents.reduce(
      (total, event) => addTokenUsage(total, event.payload?.tokenUsage),
      emptyTokenUsage(),
    );
    const costs = usageEvents
      .map((event) => Number(event.payload?.estimatedCostUsd))
      .filter(Number.isFinite);
    return {
      step: start.payload?.workflowStep ?? start.name ?? "step",
      label: start.name ?? start.payload?.workflowStep ?? "Step",
      status: terminal?.status ?? "processing",
      effort: start.payload?.reasoningEffort ?? null,
      elapsedMs: terminal ? Math.max(0, terminal.occurredAtMs - start.occurredAtMs) : null,
      modelCalls: usageEvents.length,
      tokenUsage,
      estimatedCostUsd: costs.length ? costs.reduce((total, value) => total + value, 0) : null,
      summary: terminal?.content ?? null,
    };
  });
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

  eventSequence(eventId) {
    const row = this.store.requireReady().prepare(`
      SELECT event_seq FROM activity_events WHERE event_id = ?
    `).get(eventId);
    return row ? Number(row.event_seq) : null;
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
    if (primaryFileId !== null) {
      this.store.requireReady().prepare(`
        UPDATE files
        SET source_event_id = COALESCE(source_event_id, ?)
        WHERE file_id = ?
      `).run(eventId, primaryFileId);
    }
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
    const usage = requestUsage(events);
    const compiled = [...events].reverse().find((event) => (
      event.type === "context.sent"
      && Array.isArray(event.payload?.capabilitySelection?.explicitHats)
    ));
    const explicitHats = compiled?.payload.capabilitySelection.explicitHats ?? [];
    const status = terminal?.status || (events.some((event) => ["request.processing", "agent.turn.start", "voice.transcription.start"].includes(event.type)) ? "processing" : "queued");
    const requestKind = request.payload?.requestKind ?? null;
    const sourceFile = request.primaryFileId == null ? null : this.file(request.primaryFileId);
    const scriptSelectable = terminal?.status === "complete"
      && !["interaction_video", "video_script"].includes(requestKind);
    const ownRenderedVideo = requestKind === "interaction_video"
      ? [...events].reverse().find((event) => event.type === "video.render.completed")
      : null;
    const ownVideoFileId = ownRenderedVideo?.primaryFileId ?? ownRenderedVideo?.payload?.fileId ?? null;
    const video = requestKind === "interaction_video" && ownVideoFileId != null
      ? {
          requestId: request.turnId,
          status: "complete",
          fileId: ownVideoFileId,
          downloadUrl: `/api/videos/${ownVideoFileId}/download`,
          error: null,
        }
      : includeVideo && requestKind !== "interaction_video"
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
      usage,
      steps: workflowSteps(events),
      eventCount: events.length,
      ...(sourceFile ? { attachment: publicFile(sourceFile) } : {}),
      ...(explicitHats.length ? { explicitHats } : {}),
      ...(requestKind ? { requestKind } : {}),
      ...(scriptSelectable ? { scriptSelectable: true } : {}),
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

  conversationBoundaryEventSeq() {
    const row = this.store.requireReady().prepare(`
      SELECT event_seq FROM activity_events
      WHERE event_type = 'conversation.reset'
      ORDER BY event_seq DESC
      LIMIT 1
    `).get();
    return Math.max(0, Number(row?.event_seq ?? 0));
  }

  latestConversationState({ afterEventSeq = 0 } = {}) {
    const row = this.store.requireReady().prepare(`
      SELECT * FROM activity_events
      WHERE event_type = 'conversation.state'
        AND event_seq > ?
      ORDER BY event_seq DESC
      LIMIT 1
    `).get(Math.max(0, Number(afterEventSeq) || 0));
    const event = publicEvent(row);
    return event?.payload?.state ?? null;
  }

  activeDeferredActionReferences({ afterEventSeq = 0 } = {}) {
    const rows = this.store.requireReady().prepare(`
      SELECT result.*, call.payload_json AS call_payload_json
      FROM activity_events AS result
      LEFT JOIN activity_events AS call
        ON call.operation_id = result.operation_id
       AND call.event_type = 'tool.call'
       AND call.name = result.name
      WHERE result.event_type = 'tool.result'
        AND result.event_seq > ?
      ORDER BY result.event_seq
    `).all(Math.max(0, Number(afterEventSeq) || 0));
    const receipts = rows.map((row) => {
      const event = publicEvent(row);
      let callPayload = {};
      try { callPayload = JSON.parse(row.call_payload_json || "{}"); } catch {}
      return {
        receiptEventSeq: event.eventSeq,
        requestId: event.turnId,
        tool: event.name,
        arguments: callPayload.arguments ?? {},
        result: event.payload?.result ?? null,
        deferredActionReference: event.payload?.deferredActionReference ?? null,
        ok: event.status === "complete",
      };
    });
    return activeDeferredActionReferences(receipts);
  }

  latestModelContextUsage({ afterEventSeq = 0 } = {}) {
    const row = this.store.requireReady().prepare(`
      SELECT usage.*, response.payload_json AS response_payload_json
      FROM activity_events AS usage
      LEFT JOIN activity_events AS response
        ON response.operation_id = usage.operation_id
       AND response.event_type = 'model.response'
      WHERE usage.event_type = 'model.usage'
        AND usage.event_seq > ?
      ORDER BY usage.event_seq DESC
      LIMIT 1
    `).get(Math.max(0, Number(afterEventSeq) || 0));
    const event = publicEvent(row);
    if (!event) return null;
    const tokenUsage = event.payload?.tokenUsage ?? {};
    const inputTokens = Number(event.payload?.contextInputTokens ?? tokenUsage.inputTokens);
    let contextWindowTokens = Number(event.payload?.contextWindowTokens);
    if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) {
      const matches = [...String(row.response_payload_json ?? "").matchAll(/"modelContextWindow":(\d+)/gu)];
      contextWindowTokens = Number(matches.at(-1)?.[1]);
    }
    if (!Number.isFinite(inputTokens) || inputTokens < 0) return null;
    return {
      eventSeq: event.eventSeq,
      requestId: event.turnId,
      occurredAtUtc: event.occurredAtUtc,
      inputTokens,
      cachedInputTokens: Number(tokenUsage.cachedInputTokens ?? 0),
      contextWindowTokens: Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
        ? contextWindowTokens
        : null,
      usedPercent: Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
        ? (inputTokens / contextWindowTokens) * 100
        : null,
    };
  }

  modelUsage({ limit = 1000 } = {}) {
    const selectedLimit = Math.max(1, Math.min(10_000, Number.parseInt(String(limit), 10) || 1000));
    const rows = this.store.requireReady().prepare(`
      SELECT usage.*, response.actor_name AS response_model,
             response.payload_json AS response_payload_json
      FROM activity_events AS usage
      LEFT JOIN activity_events AS response
        ON response.operation_id = usage.operation_id
       AND response.event_type = 'model.response'
      WHERE usage.event_type = 'model.usage'
      ORDER BY usage.event_seq DESC
      LIMIT ?
    `).all(selectedLimit);
    return rows.map((row) => {
      const event = publicEvent(row);
      let responsePayload = {};
      try { responsePayload = JSON.parse(row.response_payload_json || "{}"); } catch {}
      const tokenUsage = event.payload?.tokenUsage ?? {};
      return {
        eventSeq: event.eventSeq,
        requestId: event.turnId,
        occurredAtUtc: event.occurredAtUtc,
        model: row.response_model ?? null,
        transport: responsePayload.transport ?? event.payload?.provider ?? null,
        workflowStep: event.payload?.workflowStep ?? null,
        reasoningEffort: event.payload?.reasoningEffort ?? null,
        inputTokens: Number(tokenUsage.inputTokens ?? 0),
        cachedInputTokens: Number(tokenUsage.cachedInputTokens ?? 0),
        cacheWriteTokens: Number(tokenUsage.cacheWriteTokens ?? 0),
        outputTokens: Number(tokenUsage.outputTokens ?? 0),
        reasoningOutputTokens: Number(tokenUsage.reasoningOutputTokens ?? 0),
        totalTokens: Number(tokenUsage.totalTokens ?? 0),
        recordedEstimatedCostUsd: Number.isFinite(Number(event.payload?.estimatedCostUsd))
          ? Number(event.payload.estimatedCostUsd)
          : null,
      };
    });
  }

  conversationCheckpoint({ afterEventSeq = 0, beforeRequestId = null, maximumCharacters = 48 * 1024 } = {}) {
    const database = this.store.requireReady();
    const maximum = Number(maximumCharacters);
    if (!Number.isSafeInteger(maximum) || maximum < 4_000 || maximum > 256 * 1024) {
      throw new Error("Conversation checkpoint maximumCharacters must be an integer from 4000 to 262144");
    }
    const before = beforeRequestId
      ? database.prepare(`
          SELECT event_seq FROM activity_events
          WHERE turn_id = ? AND event_type IN (${placeholders(receivedEventTypes)})
          ORDER BY event_seq LIMIT 1
        `).get(beforeRequestId, ...receivedEventTypes)?.event_seq
      : null;
    const conversation = database.prepare(`
      SELECT * FROM activity_events
      WHERE event_type IN (${placeholders([...receivedEventTypes, ...responseEventTypes])})
        AND event_seq > ?
        AND (? IS NULL OR event_seq < ?)
      ORDER BY event_seq
    `).all(
      ...receivedEventTypes,
      ...responseEventTypes,
      Math.max(0, Number(afterEventSeq) || 0),
      before ?? null,
      before ?? null,
    ).map(publicEvent).filter((event) => event.content);
    const carriedCheckpoint = database.prepare(`
      SELECT content_text
      FROM activity_events
      WHERE event_type = 'conversation.checkpoint'
        AND event_seq > ?
        AND (? IS NULL OR event_seq < ?)
      ORDER BY event_seq DESC
      LIMIT 1
    `).get(
      Math.max(0, Number(afterEventSeq) || 0),
      before ?? null,
      before ?? null,
    )?.content_text ?? null;
    const receiptCount = Number(database.prepare(`
      SELECT COUNT(*) AS count
      FROM activity_events
      WHERE event_type = 'tool.result'
        AND event_seq > ?
        AND (? IS NULL OR event_seq < ?)
    `).get(
      Math.max(0, Number(afterEventSeq) || 0),
      before ?? null,
      before ?? null,
    )?.count ?? 0);
    const receipts = database.prepare(`
      SELECT event_seq, occurred_at_utc, turn_id, name, status, error_text,
             length(payload_json) AS payload_characters
      FROM activity_events
      WHERE event_type = 'tool.result'
        AND event_seq > ?
        AND (? IS NULL OR event_seq < ?)
      ORDER BY event_seq DESC
      LIMIT 100
    `).all(
      Math.max(0, Number(afterEventSeq) || 0),
      before ?? null,
      before ?? null,
    );
    const receiptLines = receipts.slice(0, 100).map((receipt) => (
      `- receipt_event_seq=${receipt.event_seq} | request_id=${receipt.turn_id ?? "none"} | tool=${receipt.name ?? "unknown"} | status=${receipt.status ?? "unknown"} | stored_characters=${receipt.payload_characters ?? 0}`
    ));
    const header = [
      "# Conversation checkpoint",
      "This checkpoint preserves user/assistant intent across a native model-thread replacement. Raw tool payloads are intentionally omitted; exact tool calls and results remain in the durable receipt ledger and can be paged with the receipt tools.",
    ].join("\n");
    const carriedBudget = Math.min(12 * 1024, Math.floor(maximum * 0.25));
    const carriedText = carriedCheckpoint
      ? `# Carried checkpoint from the preceding model thread\n${String(carriedCheckpoint).slice(0, carriedBudget)}`
      : "";
    const receiptBudget = Math.min(12 * 1024, Math.floor(maximum * 0.25));
    const boundedReceipts = edgeBoundedBlocks(receiptLines, receiptBudget);
    const receiptText = receiptLines.length
      ? [
          "# Durable tool receipt index",
          ...(boundedReceipts.omitted ? [`[${boundedReceipts.omitted} older receipt entries omitted from this checkpoint]`] : []),
          ...boundedReceipts.blocks,
        ].join("\n")
      : "# Durable tool receipt index\nNo tool receipts were recorded in this conversation range.";
    const conversationBudget = Math.max(
      1_000,
      maximum - header.length - carriedText.length - receiptText.length - 10,
    );
    const conversationBlocks = conversation.map((event) => {
      const role = receivedEventTypes.includes(event.type) ? "USER" : "ASSISTANT";
      const attachmentReference = event.primaryFileId == null
        ? ""
        : ` primary_file_id=${event.primaryFileId}`;
      return `${role} [request_id=${event.turnId ?? "none"} at=${event.occurredAtUtc}${attachmentReference}]: ${event.content}`;
    });
    const boundedConversation = edgeBoundedBlocks(conversationBlocks, conversationBudget);
    const conversationText = [
      "# User and assistant exchange history",
      ...(boundedConversation.omitted ? [`[${boundedConversation.omitted} middle exchange entries omitted]`] : []),
      ...boundedConversation.blocks,
    ].join("\n\n");
    const text = [header, carriedText, conversationText, receiptText].filter(Boolean).join("\n\n").slice(0, maximum);
    return {
      text,
      afterEventSeq: Math.max(0, Number(afterEventSeq) || 0),
      beforeEventSeq: before ?? null,
      exchangeEntryCount: conversationBlocks.length,
      includedExchangeEntryCount: boundedConversation.blocks.length,
      omittedExchangeEntryCount: boundedConversation.omitted,
      receiptCount,
      includedReceiptCount: boundedReceipts.blocks.length,
      olderReceiptsOmitted: receiptCount > receipts.length || boundedReceipts.omitted > 0,
      carriedCheckpointCharacters: carriedText.length,
      sentCharacters: text.length,
    };
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
      Math.min(40, Math.max(2, limit * 2)),
    ).map(publicEvent).reverse();
    return rows.map((event) => ({
      eventSeq: event.eventSeq,
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

  toolReceiptList({ requestId = null, beforeEventSeq = null, limit = 20 } = {}) {
    const bounded = Number(limit);
    if (!Number.isSafeInteger(bounded) || bounded < 1 || bounded > 100) {
      throw new Error("Tool receipt limit must be an integer from 1 to 100");
    }
    const before = beforeEventSeq == null ? null : Number(beforeEventSeq);
    if (before !== null && (!Number.isSafeInteger(before) || before < 1)) {
      throw new Error("Tool receipt beforeEventSeq must be a positive integer or null");
    }
    if (requestId !== null && (typeof requestId !== "string" || !requestId.trim())) {
      throw new Error("Tool receipt requestId must be a non-empty string or null");
    }
    const rows = this.store.requireReady().prepare(`
      SELECT result.*, call.payload_json AS call_payload_json
      FROM activity_events AS result
      LEFT JOIN activity_events AS call
        ON call.operation_id = result.operation_id
       AND call.event_type = 'tool.call'
       AND call.name = result.name
      WHERE result.event_type = 'tool.result'
        AND (? IS NULL OR result.turn_id = ?)
        AND (? IS NULL OR result.event_seq < ?)
      ORDER BY result.event_seq DESC
      LIMIT ?
    `).all(requestId, requestId, before, before, bounded + 1);
    const hasMore = rows.length > bounded;
    const receipts = rows.slice(0, bounded).map((row) => {
      const event = publicEvent(row);
      let callPayload = {};
      try { callPayload = JSON.parse(row.call_payload_json || "{}"); } catch {}
      const resultText = JSON.stringify(event.payload?.result ?? null);
      const argumentsText = JSON.stringify(callPayload.arguments ?? {});
      return {
        receiptEventSeq: event.eventSeq,
        requestId: event.turnId,
        occurredAtUtc: event.occurredAtUtc,
        tool: event.name,
        status: event.status,
        ok: event.status === "complete",
        resultCharacters: resultText.length,
        argumentCharacters: argumentsText.length,
        error: event.error,
      };
    });
    return {
      count: receipts.length,
      hasMore,
      nextBeforeEventSeq: hasMore ? receipts.at(-1)?.receiptEventSeq ?? null : null,
      receipts,
    };
  }

  toolReceiptRead({ receiptEventSeq, offset = 0, maxCharacters = 16 * 1024 }) {
    const eventSeq = Number(receiptEventSeq);
    const boundedOffset = Number(offset);
    const boundedMaximum = Number(maxCharacters);
    if (!Number.isSafeInteger(eventSeq) || eventSeq < 1) {
      throw new Error("receiptEventSeq must be a positive integer");
    }
    if (!Number.isSafeInteger(boundedOffset) || boundedOffset < 0 || boundedOffset > 10_000_000) {
      throw new Error("offset must be an integer from 0 to 10000000");
    }
    if (!Number.isSafeInteger(boundedMaximum) || boundedMaximum < 1 || boundedMaximum > 32 * 1024) {
      throw new Error("maxCharacters must be an integer from 1 to 32768");
    }
    const row = this.store.requireReady().prepare(`
      SELECT result.*, call.payload_json AS call_payload_json
      FROM activity_events AS result
      LEFT JOIN activity_events AS call
        ON call.operation_id = result.operation_id
       AND call.event_type = 'tool.call'
       AND call.name = result.name
      WHERE result.event_type = 'tool.result'
        AND result.event_seq = ?
      LIMIT 1
    `).get(eventSeq);
    if (!row) throw new Error(`Tool receipt event ${eventSeq} was not found`);
    const event = publicEvent(row);
    let callPayload = {};
    try { callPayload = JSON.parse(row.call_payload_json || "{}"); } catch {}
    const serialized = JSON.stringify(receiptEnvelope(event, callPayload));
    if (boundedOffset > serialized.length) {
      throw new Error(`offset exceeds the receipt length of ${serialized.length} characters`);
    }
    const chunk = serialized.slice(boundedOffset, boundedOffset + boundedMaximum);
    const nextOffset = boundedOffset + chunk.length < serialized.length
      ? boundedOffset + chunk.length
      : null;
    return {
      receiptEventSeq: eventSeq,
      tool: event.name,
      requestId: event.turnId,
      totalCharacters: serialized.length,
      offset: boundedOffset,
      count: chunk.length,
      hasMore: nextOffset !== null,
      nextOffset,
      chunk,
    };
  }

  recentSuccessfulToolRequestIds(toolNames, limit = 5) {
    const names = [...new Set(toolNames ?? [])].filter((name) => typeof name === "string" && name);
    if (names.length === 0) return [];
    const bounded = Math.min(100, Math.max(1, Number(limit) || 5));
    const rows = this.store.requireReady().prepare(`
      SELECT turn_id FROM activity_events
      WHERE event_type = 'tool.result'
        AND status = 'complete'
        AND name IN (${placeholders(names)})
      ORDER BY event_seq DESC
      LIMIT 1000
    `).all(...names);
    const turnIds = [];
    for (const row of rows) {
      if (!row.turn_id || turnIds.includes(row.turn_id)) continue;
      turnIds.push(row.turn_id);
      if (turnIds.length >= bounded) break;
    }
    return turnIds;
  }

  registerFile({
    storagePath, originalFilename, mimeType, sha256, byteSize, mediaKind = "audio",
    durationMs = null, width = null, height = null, title = originalFilename, description = null,
  }) {
    const database = this.store.requireReady();
    const existing = database.prepare("SELECT * FROM files WHERE sha256 = ? AND byte_size = ? ORDER BY file_id LIMIT 1").get(sha256, byteSize);
    if (existing) return { ...publicFile(existing), duplicate: true, storagePath: existing.storage_path };
    const row = database.prepare(`
      INSERT INTO files (
        storage_path, original_filename, title, description, title_source, media_kind, mime_type,
        sha256, byte_size, duration_ms, width, height
      ) VALUES (?, ?, ?, ?, 'original_filename', ?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `).get(
      storagePath, originalFilename, String(title || originalFilename || "Stored file").trim(),
      description == null ? null : String(description).trim(), mediaKind, mimeType,
      sha256, byteSize, durationMs, width, height,
    );
    return { ...publicFile(row), duplicate: false, storagePath };
  }

  file(fileId) {
    return this.store.requireReady().prepare("SELECT * FROM files WHERE file_id = ?").get(fileId);
  }

  fileDetails(fileId) {
    const row = this.file(fileId);
    if (!row) return null;
    const origins = this.store.requireReady().prepare(`
      SELECT event_seq, event_id, turn_id, content_text, occurred_at_utc
      FROM activity_events
      WHERE primary_file_id = ?
        AND event_type IN ('request.received', 'voice.request.received')
      ORDER BY event_seq
      LIMIT 20
    `).all(fileId).map((origin) => ({
      eventSeq: Number(origin.event_seq),
      eventId: origin.event_id,
      requestId: origin.turn_id,
      request: origin.content_text,
      occurredAtUtc: origin.occurred_at_utc,
    }));
    return { ...publicFile(row), origins };
  }

  listFiles({ query = null, limit = 100 } = {}) {
    const bounded = Number(limit);
    if (!Number.isSafeInteger(bounded) || bounded < 1 || bounded > 500) {
      throw new Error("File list limit must be an integer from 1 to 500");
    }
    const selectedQuery = String(query ?? "").trim();
    const pattern = `%${selectedQuery.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const rows = this.store.requireReady().prepare(`
      SELECT DISTINCT file.*
      FROM files AS file
      LEFT JOIN activity_events AS event
        ON event.primary_file_id = file.file_id
       AND event.event_type IN ('request.received', 'voice.request.received')
      WHERE ? = ''
         OR file.title LIKE ? ESCAPE '\\'
         OR file.description LIKE ? ESCAPE '\\'
         OR file.original_filename LIKE ? ESCAPE '\\'
         OR event.content_text LIKE ? ESCAPE '\\'
      ORDER BY file.created_at_utc DESC, file.file_id DESC
      LIMIT ?
    `).all(selectedQuery, pattern, pattern, pattern, pattern, bounded).map(publicFile);
    return { query: selectedQuery || null, count: rows.length, files: rows };
  }

  updateFile(fileId, { title, description, titleSource = "user" }) {
    if (!Number.isSafeInteger(fileId) || fileId < 1) throw new Error("File ID must be a positive integer");
    const selectedTitle = String(title ?? "").trim();
    const selectedDescription = description == null ? null : String(description).trim() || null;
    if (!["ai", "user"].includes(titleSource)) throw new Error("File title source must be ai or user");
    if (!selectedTitle || selectedTitle.length > 200) throw new Error("File title must contain 1 to 200 characters");
    if (selectedDescription && selectedDescription.length > 5000) throw new Error("File description cannot exceed 5000 characters");
    const database = this.store.requireReady();
    const existing = database.prepare("SELECT title_source FROM files WHERE file_id = ?").get(fileId);
    if (!existing) throw new Error(`File ${fileId} does not exist`);
    if (titleSource === "ai" && existing.title_source === "user") {
      throw new Error(`File ${fileId} has a user-edited title and cannot be overwritten by AI`);
    }
    const row = database.prepare(`
      UPDATE files
      SET title = ?, description = ?, title_source = ?, updated_at_utc = ?
      WHERE file_id = ?
      RETURNING *
    `).get(selectedTitle, selectedDescription, titleSource, new Date().toISOString(), fileId);
    return publicFile(row);
  }

  requestHash(text) {
    return createHash("sha256").update(text).digest("hex");
  }
}
