const historyEventTypes = [
  "request.received", "voice.request.received", "assistant.response", "agent.turn.end",
];

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

function publicHistoryEvent(row) {
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

export class HistorySearchProvider {
  constructor({ ledger }) {
    this.id = "history";
    this.description = "Application-owned user and assistant conversation history.";
    this.ledger = ledger;
  }

  capabilities() {
    return { phrase: true, proximity: true, snippets: true };
  }

  search({ query, mode, maxDistance, contextTokens, limit }) {
    const database = this.ledger.store.requireReady();
    const result = database.hybridSearch({
        table: "activity_events",
        idColumn: "event_seq",
        searchColumns: ["name", "content_text", "source"],
        selectColumns: [
          "event_id", "occurred_at_ms", "recorded_at_ms", "occurred_at_utc", "event_type",
          "event_phase", "status", "actor_type", "actor_name", "channel", "session_id", "turn_id",
          "trace_id", "operation_id", "span_id", "parent_span_id", "parent_event_id", "payload_json",
          "primary_file_id", "subject_type", "subject_id", "external_ref", "error_text",
        ],
        query,
        mode,
        maxDistance,
        contextTokens,
        limit: limit + 1,
        whereSql: `event_type IN (${placeholders(historyEventTypes)})`,
        whereValues: historyEventTypes,
    });
    const hasMore = result.hasMore || result.rows.length > limit;
    const selected = result.rows.slice(0, limit);
    return {
      native: { entries: selected.map(publicHistoryEvent) },
      matchMode: mode,
      exhaustive: !hasMore,
      hasMore,
      warnings: [],
      hits: selected.map((row) => ({
        provider: this.id,
        kind: "conversation_event",
        id: String(row.event_seq),
        title: row.name || (row.event_type.includes("request") ? "User request" : "Assistant response"),
        snippet: row.search_snippet,
        matchedFields: ["name", "content_text", "source"],
        occurredAtUtc: row.occurred_at_utc,
        actionRef: { event_seq: Number(row.event_seq), request_id: row.turn_id },
        providerRank: Number(row.search_rank),
      })),
    };
  }
}
