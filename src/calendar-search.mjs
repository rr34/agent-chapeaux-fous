function calendarSearchError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function escapedLikeTerm(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function searchCalendarEventRows(database, {
  query,
  includeArchived = false,
  limit = 100,
  nowUtc = new Date().toISOString(),
} = {}) {
  if (typeof query !== "string" || !query.trim()) {
    throw calendarSearchError("query is required.");
  }
  const normalizedQuery = query.trim();
  if (normalizedQuery.length > 200) throw calendarSearchError("query must be at most 200 characters.");
  if (typeof includeArchived !== "boolean") throw calendarSearchError("includeArchived must be a boolean.");
  const boundedLimit = Number(limit);
  if (!Number.isInteger(boundedLimit) || boundedLimit < 1 || boundedLimit > 200) {
    throw calendarSearchError("limit must be an integer from 1 to 200.");
  }
  const parsedNow = new Date(nowUtc);
  if (typeof nowUtc !== "string" || !Number.isFinite(parsedNow.getTime())) {
    throw calendarSearchError("nowUtc must be an ISO-8601 date-time.");
  }
  const terms = normalizedQuery.split(/\s+/u).map((term) => `%${escapedLikeTerm(term)}%`);
  const termClause = `(
    title LIKE ? ESCAPE '\\\\'
    OR COALESCE(description, '') LIKE ? ESCAPE '\\\\'
    OR COALESCE(location_text, '') LIKE ? ESCAPE '\\\\'
  )`;
  const filters = terms.map(() => termClause).join(" AND ");
  const parameters = terms.flatMap((term) => [term, term, term]);
  const normalizedNow = parsedNow.toISOString();
  const rows = database.prepare(`
    SELECT *
    FROM calendar_events
    WHERE ${includeArchived ? "1 = 1" : "status IN ('tentative', 'confirmed')"}
      AND ${filters}
    ORDER BY
      CASE WHEN status IN ('tentative', 'confirmed') THEN 0 ELSE 1 END,
      CASE WHEN starts_at_utc >= ? THEN 0 ELSE 1 END,
      CASE WHEN starts_at_utc >= ? THEN starts_at_utc END ASC,
      CASE WHEN starts_at_utc < ? THEN starts_at_utc END DESC,
      calendar_event_id DESC
    LIMIT ?
  `).all(...parameters, normalizedNow, normalizedNow, normalizedNow, boundedLimit);
  return {
    query: normalizedQuery,
    includeArchived,
    limit: boundedLimit,
    rows,
  };
}
