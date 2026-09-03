function queryTokens(query) {
  return [...new Set(query.normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) ?? [])];
}

function quotedFtsToken(token) {
  return `"${token.replaceAll('"', '""')}"`;
}

function ftsExpression(query, mode, maxDistance) {
  const tokens = queryTokens(query);
  if (tokens.length === 0) {
    throw Object.assign(new Error("query must contain searchable words."), { statusCode: 400 });
  }
  if (mode === "phrase") return `"${tokens.join(" ").replaceAll('"', '""')}"`;
  if (mode === "near" && tokens.length > 1) {
    return `NEAR(${tokens.map(quotedFtsToken).join(" ")}, ${maxDistance})`;
  }
  return tokens.map(quotedFtsToken).join(" AND ");
}

function synchronizedFtsAvailable(database, tableName) {
  const table = database.prepare(`
    SELECT 1 AS present FROM sqlite_schema
    WHERE type = 'table' AND name = ?
  `).get(tableName);
  if (!table) return false;
  const triggers = database.prepare(`
    SELECT COUNT(*) AS count FROM sqlite_schema
    WHERE type = 'trigger' AND sql LIKE ?
  `).get(`%${tableName}%`);
  return Number(triggers?.count ?? 0) >= 3;
}

function fileHit(file, { snippet = null, matchedFields = [], rank = null } = {}) {
  return {
    provider: "files",
    kind: "stored_file",
    id: String(file.fileId),
    title: `File #${file.fileId} — ${file.title}`,
    snippet: snippet || file.description || file.originalFilename || file.title,
    matchedFields,
    occurredAtUtc: file.createdAtUtc,
    actionRef: { file_id: file.fileId },
    ...(rank == null ? {} : { providerRank: Number(rank) }),
  };
}

export class FileSearchProvider {
  constructor({ ledger }) {
    this.id = "files";
    this.description = "Durably stored uploads, including titles, descriptions, original filenames, and originating request text.";
    this.ledger = ledger;
  }

  capabilities() {
    const database = this.ledger.store.requireReady();
    const available = database.engine === "mariadb" || synchronizedFtsAvailable(database, "files_fts");
    return { phrase: available, proximity: available, snippets: available };
  }

  search({ query, mode, maxDistance, contextTokens, limit }) {
    const database = this.ledger.store.requireReady();
    if (database.engine === "mariadb") {
      const metadata = database.hybridSearch({
        table: "files",
        idColumn: "file_id",
        searchColumns: ["title", "description", "original_filename"],
        selectColumns: [
          "storage_path", "media_kind", "mime_type", "sha256", "byte_size", "duration_ms",
          "width", "height", "source_event_id", "created_at_utc", "title_source", "updated_at_utc",
        ],
        query,
        mode,
        maxDistance,
        contextTokens,
        limit: limit + 1,
      });
      const origins = database.hybridSearch({
        table: "activity_events",
        idColumn: "event_seq",
        searchColumns: ["name", "content_text", "source"],
        selectColumns: ["primary_file_id", "event_type"],
        query,
        mode,
        maxDistance,
        contextTokens,
        limit: limit + 1,
        whereSql: "primary_file_id IS NOT NULL AND event_type IN ('request.received', 'voice.request.received')",
      });
      const originRows = origins.rows.map((row) => ({ ...row, file_id: row.primary_file_id }));
      const combined = [];
      const seen = new Set();
      for (const row of [...metadata.rows, ...originRows]) {
        const fileId = Number(row.file_id);
        if (seen.has(fileId)) continue;
        seen.add(fileId);
        const file = this.ledger.fileDetails(fileId);
        if (!file) continue;
        combined.push({ file, row, origin: originRows.includes(row) });
      }
      const hasMore = metadata.hasMore || origins.hasMore || combined.length > limit;
      const selected = combined.slice(0, limit);
      return {
        native: { count: selected.length, files: selected.map(({ file }) => file) },
        matchMode: mode,
        exhaustive: !hasMore,
        hasMore,
        warnings: [],
        hits: selected.map(({ file, row, origin }) => fileHit(file, {
          snippet: row.search_snippet,
          matchedFields: [origin ? "originating_request_text" : "title_or_description_or_original_filename"],
          rank: row.search_rank,
        })),
      };
    }
    if (mode === "terms" || !synchronizedFtsAvailable(database, "files_fts")) {
      const result = this.ledger.listFiles({ query, limit });
      return {
        native: result,
        matchMode: mode === "terms" ? "terms" : "substring_fallback",
        exhaustive: result.count < limit,
        hasMore: result.count === limit,
        warnings: mode === "terms" ? [] : [
          "Synchronized FTS5 file search is unavailable; exact substring matching was used.",
        ],
        hits: result.files.map((file) => fileHit(file, {
          matchedFields: ["title", "description", "original_filename", "originating_request_text"],
        })),
      };
    }

    const expression = ftsExpression(query, mode, maxDistance);
    const metadataRows = database.prepare(`
      SELECT file.file_id, bm25(files_fts) AS search_rank,
             snippet(files_fts, 1, '[[', ']]', '…', ?) AS search_snippet
      FROM files_fts
      JOIN files AS file ON file.file_id = files_fts.rowid
      WHERE files_fts MATCH ?
      ORDER BY search_rank, file.file_id DESC
      LIMIT ?
    `).all(contextTokens, expression, limit + 1);

    let originRows = [];
    if (synchronizedFtsAvailable(database, "activity_events_fts")) {
      originRows = database.prepare(`
        SELECT DISTINCT event.primary_file_id AS file_id,
               bm25(activity_events_fts) AS search_rank,
               snippet(activity_events_fts, 1, '[[', ']]', '…', ?) AS search_snippet
        FROM activity_events_fts
        JOIN activity_events AS event ON event.event_seq = activity_events_fts.rowid
        WHERE activity_events_fts MATCH ?
          AND event.primary_file_id IS NOT NULL
          AND event.event_type IN ('request.received', 'voice.request.received')
        ORDER BY search_rank, event.event_seq DESC
        LIMIT ?
      `).all(contextTokens, expression, limit + 1);
    }

    const combined = [];
    const seen = new Set();
    for (const row of [...metadataRows, ...originRows]) {
      const fileId = Number(row.file_id);
      if (seen.has(fileId)) continue;
      seen.add(fileId);
      const file = this.ledger.fileDetails(fileId);
      if (!file) continue;
      combined.push({ file, row, origin: originRows.includes(row) });
    }
    const hasMore = metadataRows.length > limit || originRows.length > limit || combined.length > limit;
    const selected = combined.slice(0, limit);
    return {
      native: { count: selected.length, files: selected.map(({ file }) => file) },
      matchMode: mode,
      exhaustive: !hasMore,
      hasMore,
      warnings: [],
      hits: selected.map(({ file, row, origin }) => fileHit(file, {
        snippet: row.search_snippet,
        matchedFields: [origin ? "originating_request_text" : "title_or_description_or_original_filename"],
        rank: row.search_rank,
      })),
    };
  }
}
