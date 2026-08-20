import { searchCalendarEventRows } from "../../calendar-search.mjs";

function searchableFields(row, query) {
  const terms = query.toLocaleLowerCase().split(/\s+/u);
  return ["title", "description", "location_text"].filter((field) => {
    const value = String(row[field] ?? "").toLocaleLowerCase();
    return terms.some((term) => value.includes(term));
  });
}

export class CalendarSearchProvider {
  constructor({ store }) {
    this.id = "calendar";
    this.description = "Stored native calendar event series.";
    this.store = store;
    this.capabilities = { phrase: false, proximity: false, snippets: false };
  }

  search({ query, mode, limit, options = {} }) {
    const native = searchCalendarEventRows(this.store.requireReady(), {
      query,
      limit,
      includeArchived: options.includeArchived ?? false,
      ...(options.nowUtc ? { nowUtc: options.nowUtc } : {}),
    });
    return {
      native,
      matchMode: "terms",
      exhaustive: native.rows.length < native.limit,
      hasMore: native.rows.length === native.limit,
      warnings: mode === "terms" ? [] : [
        `Calendar search does not support ${mode} matching; native all-term matching was used.`,
      ],
      hits: native.rows.map((row) => ({
        provider: this.id,
        kind: "calendar_event",
        id: String(row.calendar_event_id),
        title: row.title,
        snippet: row.description || row.location_text || null,
        matchedFields: searchableFields(row, native.query),
        occurredAtUtc: row.starts_at_utc,
        actionRef: { calendar_event_id: row.calendar_event_id },
      })),
    };
  }
}
