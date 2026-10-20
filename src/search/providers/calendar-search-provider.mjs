import { searchCalendarEventRows } from "../../calendar-search.mjs";
import { nativeObjectHit } from "./native-object-domain-search-provider.mjs";

function searchableFields(row, query) {
  const terms = query.toLocaleLowerCase().split(/\s+/u);
  return ["title", "description", "location_text"].filter((field) => {
    const value = String(row[field] ?? "").toLocaleLowerCase();
    return terms.some((term) => value.includes(term));
  });
}

export class CalendarSearchProvider {
  constructor({ store, organizer = null }) {
    this.id = "calendar";
    this.description = "Stored native calendar event series.";
    this.store = store;
    this.organizer = organizer;
    this.capabilities = { phrase: false, proximity: false, snippets: false };
  }

  search({ query, mode, limit, options = {} }) {
    const native = searchCalendarEventRows(this.store.requireReady(), {
      query,
      limit,
      includeArchived: options.includeArchived ?? false,
      ...(options.nowUtc ? { nowUtc: options.nowUtc } : {}),
    });
    const routines = this.organizer?.searchNativeObjects({
      query,
      limit: Math.min(48, limit),
      domainTypes: ["calendar.routine"],
    }).objects ?? [];
    return {
      native,
      matchMode: "terms",
      exhaustive: native.rows.length < native.limit && routines.length < Math.min(48, limit),
      hasMore: native.rows.length === native.limit || routines.length === Math.min(48, limit),
      warnings: mode === "terms" ? [] : [
        `Calendar search does not support ${mode} matching; native all-term matching was used.`,
      ],
      hits: [...native.rows.map((row) => ({
        provider: this.id,
        kind: "calendar_event",
        id: String(row.calendar_event_id),
        ref: `agent-slayer://calendar-events/${row.calendar_event_id}`,
        objectType: "calendar.event",
        source: "native:calendar",
        title: row.title,
        snippet: row.description || row.location_text || null,
        matchedFields: searchableFields(row, native.query),
        occurredAtUtc: row.starts_at_utc,
        actionRef: { calendar_event_id: row.calendar_event_id },
      })), ...routines.map((object) => nativeObjectHit(this.id, object))],
    };
  }
}
