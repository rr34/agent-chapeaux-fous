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
    return { phrase: true, proximity: true, snippets: true };
  }

  search({ query, mode, maxDistance, contextTokens, limit }) {
    const database = this.ledger.store.requireReady();
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
}
