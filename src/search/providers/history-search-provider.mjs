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

function queryTokens(query) {
  return [...new Set(query.normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [])];
}

function quotedFtsToken(token) {
  return `"${token.replaceAll('"', '""')}"`;
}

function ftsExpression(query, mode, maxDistance) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) throw Object.assign(new Error("query must contain searchable words."), { statusCode: 400 });
  if (mode === "phrase") return `"${tokens.join(" ").replaceAll('"', '""')}"`;
  if (mode === "near" && tokens.length > 1) {
    return `NEAR(${tokens.map(quotedFtsToken).join(" ")}, ${maxDistance})`;
  }
  return tokens.map(quotedFtsToken).join(" AND ");
}

function synchronizedFtsAvailable(database) {
  const table = database.prepare(`
    SELECT 1 AS present FROM sqlite_schema
    WHERE type = 'table' AND name = 'activity_events_fts'
  `).get();
  if (!table) return false;
  const triggers = database.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_schema
    WHERE type = 'trigger' AND sql LIKE '%activity_events_fts%'
  `).get();
  return Number(triggers?.count ?? 0) >= 3;
}

export class HistorySearchProvider {
  constructor({ ledger }) {
    this.id = "history";
    this.description = "Application-owned user and assistant conversation history.";
    this.ledger = ledger;
  }

  capabilities() {
    const available = synchronizedFtsAvailable(this.ledger.store.requireReady());
    return { phrase: available, proximity: available, snippets: available };
  }

  search({ query, mode, maxDistance, contextTokens, limit }) {
    const database = this.ledger.store.requireReady();
    if (mode === "terms" || !synchronizedFtsAvailable(database)) {
      const entries = this.ledger.searchHistory(query, limit);
      return {
        native: { entries },
        matchMode: mode === "terms" ? "terms" : "substring_fallback",
        exhaustive: entries.length < limit,
        hasMore: entries.length === limit,
        warnings: mode === "terms" ? [] : [
          "Synchronized FTS5 history search is unavailable; exact substring matching was used.",
        ],
        hits: entries.map((entry) => ({
          provider: this.id,
          kind: "conversation_event",
          id: String(entry.eventSeq),
          title: entry.name || (entry.type?.includes("request") ? "User request" : "Assistant response"),
          snippet: entry.content,
          matchedFields: ["content_text"],
          occurredAtUtc: entry.occurredAtUtc,
          actionRef: { event_seq: entry.eventSeq, request_id: entry.turnId },
        })),
      };
    }

    const rows = database.prepare(`
      SELECT event.*, bm25(activity_events_fts) AS search_rank,
             snippet(activity_events_fts, 1, '[[', ']]', '…', ?) AS search_snippet
      FROM activity_events_fts
      JOIN activity_events AS event ON event.event_seq = activity_events_fts.rowid
      WHERE activity_events_fts MATCH ?
        AND event.event_type IN (${placeholders(historyEventTypes)})
      ORDER BY search_rank, event.event_seq DESC
      LIMIT ?
    `).all(contextTokens, ftsExpression(query, mode, maxDistance), ...historyEventTypes, limit + 1);
    const hasMore = rows.length > limit;
    const selected = rows.slice(0, limit);
    const entries = selected.map(publicHistoryEvent);
    return {
      native: { entries },
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
        matchedFields: ["content_text"],
        occurredAtUtc: row.occurred_at_utc,
        actionRef: { event_seq: Number(row.event_seq), request_id: row.turn_id },
        providerRank: Number(row.search_rank),
      })),
    };
  }
}
