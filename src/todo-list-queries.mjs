import { createHash } from "node:crypto";
import { localDateUtcBounds } from "./temporal-consistency.mjs";

export const todoStatuses = ["unplanned", "todo", "complete", "ignore", "archive", "ai_suggested"];

const localDateRange = {
  type: ["object", "null"], additionalProperties: false,
  description: "Inclusive local calendar-date range. Use identical start_date and end_date for one day; null disables this filter.",
  properties: {
    start_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    end_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  },
  required: ["start_date", "end_date"],
};

export const todoQueryFilterProperties = {
  group: { type: ["string", "null"], description: "Exact group name; null selects all groups." },
  status: {
    type: ["string", "null"], enum: [...todoStatuses, null],
    description: "unplanned: needs a plan; todo: intended work; complete: finished; ignore: intentionally skipped; archive: retained history; ai_suggested: awaiting acceptance. Null excludes terminal tasks unless a completion range or task IDs are supplied, in which case all statuses are eligible.",
  },
  personal_task_ids: {
    type: ["array", "null"], minItems: 1, maxItems: 200, uniqueItems: true,
    items: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    description: "Exact task IDs to retrieve, including terminal tasks when status is null. Null disables ID filtering. Combined with all other filters using AND.",
  },
  completed_date_range: localDateRange,
  time_zone: { type: ["string", "null"], description: "IANA time zone required when completed_date_range is supplied." },
};

export const todoListInputSchema = {
  type: "object", additionalProperties: false,
  properties: {
    queries: {
      type: "array", minItems: 1, maxItems: 20,
      description: "Independent paginated lookups. Use a one-item batch for one lookup and a single date-range query for a whole week.",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          query_id: { type: "string", minLength: 1, maxLength: 80, description: "Unique label within this batch, echoed with the corresponding results." },
          ...todoQueryFilterProperties,
          limit: { type: "integer", minimum: 1, maximum: 200, description: "Maximum tasks on this query's page. Follow next_cursor to retrieve remaining matches." },
          cursor: { type: ["string", "null"], minLength: 1, maxLength: 4096, description: "Null for the first page; otherwise the exact next_cursor from this query's previous page. Keep all filters unchanged." },
        },
        required: ["query_id", "group", "status", "limit"],
      },
    },
  },
  required: ["queries"],
};

function dateRangeBounds(range, timeZone, label) {
  if (range == null) return null;
  const first = localDateUtcBounds({ localDate: range.start_date, timeZone });
  const last = localDateUtcBounds({ localDate: range.end_date, timeZone });
  if (range.start_date > range.end_date) throw new Error(`${label}.start_date must not follow end_date.`);
  return { startsAtUtc: first.startsAtUtc, endsAtUtc: last.endsAtUtc };
}

// Ordering matches the existing list views. The final unique ID breaks ties;
// continuation compares stored sort values rather than an offset or a live row.
function sortFields(filters) {
  const id = { sql: "task.personal_task_id", key: row => Number(row.personal_task_id), direction: "ASC", type: "number" };
  if (filters.completed_date_range) return [
    { sql: "task.completed_at_utc", key: row => row.completed_at_utc, direction: "DESC", type: "string" },
    { ...id, direction: "DESC" },
  ];
  return [
    { sql: "todo_group.name", key: row => row.group_name, direction: "ASC", type: "string" },
    { sql: "(task.sequence IS NULL)", key: row => Number(row.sequence == null), direction: "ASC", type: "number" },
    { sql: "COALESCE(task.sequence, 0)", key: row => Number(row.sequence ?? 0), direction: "DESC", type: "number" },
    { sql: "task.sort_position", key: row => Number(row.sort_position), direction: "ASC", type: "number" }, id,
  ];
}

function prepareQuery(query) {
  const filters = {
    group: query.group?.trim() || null,
    status: query.status ?? null,
    personal_task_ids: query.personal_task_ids ? [...query.personal_task_ids].sort((a, b) => a - b) : null,
    completed_date_range: query.completed_date_range == null ? null : {
      start_date: query.completed_date_range.start_date, end_date: query.completed_date_range.end_date,
    },
    time_zone: query.completed_date_range ? query.time_zone?.trim() ?? null : null,
  };
  const conditions = [];
  const parameters = [];
  if (filters.group) { conditions.push("todo_group.name = ?"); parameters.push(filters.group); }
  if (filters.status) { conditions.push("task.status = ?"); parameters.push(filters.status); }
  else if (!filters.completed_date_range && !filters.personal_task_ids) {
    conditions.push("task.status NOT IN ('complete', 'ignore', 'archive')");
  }
  if (filters.personal_task_ids) {
    conditions.push(`task.personal_task_id IN (${filters.personal_task_ids.map(() => "?").join(", ")})`);
    parameters.push(...filters.personal_task_ids);
  }
  for (const [column, name] of [["completed_at_utc", "completed_date_range"]]) {
    const bounds = dateRangeBounds(filters[name], filters.time_zone, name);
    if (!bounds) continue;
    conditions.push(`task.${column} >= ? AND task.${column} < ?`);
    parameters.push(bounds.startsAtUtc, bounds.endsAtUtc);
  }
  const order = sortFields(filters);
  const fingerprint = createHash("sha256").update(JSON.stringify(filters)).digest("hex");
  if (query.cursor != null) {
    let cursor;
    try { cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")); } catch {}
    if (cursor?.version !== 1 || cursor.fingerprint !== fingerprint
      || !Array.isArray(cursor.keys) || cursor.keys.length !== order.length
      || cursor.keys.some((value, index) => typeof value !== order[index].type
        || (typeof value === "number" && !Number.isSafeInteger(value)))) {
      throw new Error(`Invalid cursor for query ${query.query_id}; reuse the original filters or start with cursor null.`);
    }
    const alternatives = order.map((field, index) => {
      const equal = order.slice(0, index).map((prior, previous) => {
        parameters.push(cursor.keys[previous]);
        return `${prior.sql} = ?`;
      });
      parameters.push(cursor.keys[index]);
      return `(${[...equal, `${field.sql} ${field.direction === "DESC" ? "<" : ">"} ?`].join(" AND ")})`;
    });
    conditions.push(`(${alternatives.join(" OR ")})`);
  }
  return { query, filters, conditions, parameters, order, fingerprint };
}

export function listTodoQueryPages(database, queries) {
  const ids = queries.map(query => query.query_id);
  if (new Set(ids).size !== ids.length) throw new Error("queries must have unique query_id values.");
  // Validate the entire batch before starting any reads.
  const prepared = queries.map(prepareQuery);
  const results = prepared.map(({ query, filters, conditions, parameters, order, fingerprint }) => {
    const rows = database.prepare(`
      SELECT task.*, todo_group.name AS group_name,
             interaction_guide.name AS interaction_guide_name,
             interaction_guide.status AS interaction_guide_status,
             interaction_guide.version AS interaction_guide_version
      FROM todo_personal AS task
      JOIN todo_groups AS todo_group USING (todo_group_id)
      LEFT JOIN interaction_guides AS interaction_guide
        ON interaction_guide.interaction_guide_id = task.interaction_guide_id
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY ${order.map(field => `${field.sql} ${field.direction}`).join(", ")}
      LIMIT ?
    `).all(...parameters, query.limit + 1);
    const hasMore = rows.length > query.limit;
    const tasks = rows.slice(0, query.limit);
    const nextCursor = hasMore ? Buffer.from(JSON.stringify({
      version: 1, fingerprint, keys: order.map(field => field.key(tasks.at(-1))),
    })).toString("base64url") : null;
    return { query_id: query.query_id, filters, tasks, count: tasks.length, has_more: hasMore, next_cursor: nextCursor };
  });
  return { results, has_more: results.some(result => result.has_more) };
}
