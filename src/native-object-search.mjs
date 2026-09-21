import { nativeFirstClassObjectTypes } from "./native-object-types.mjs";

// Native object search is a read path of the Contacts, To-do, and Journal
// domains. The catalog names selected columns in their authoritative tables;
// no object rows or searchable values are copied into another store.

const ignoredWords = new Set([
  "a", "about", "an", "and", "are", "can", "contact", "contacts", "could",
  "do", "entry", "entries", "for", "from", "group", "groups", "i", "in",
  "is", "item", "items", "journal", "log", "logs", "me", "my", "of",
  "on", "or", "please", "record", "records", "see", "some", "task",
  "tasks", "that", "the", "these", "this", "those", "to", "todo", "todos",
  "tracker", "trackers", "we", "what", "with", "would", "you",
]);

export const nativeObjectTypes = Object.freeze(nativeFirstClassObjectTypes
  .filter(({ searchType }) => searchType)
  .map((type) => Object.freeze({
    type: type.searchType, domainType: type.id, table: type.table, key: type.key,
    label: type.title, searchFields: type.searchFields, refPrefix: type.refPrefix,
  })));

const byType = new Map(nativeObjectTypes.map((definition) => [definition.type, definition]));

export function objectSearchTerms(query) {
  if (typeof query !== "string" || query.length > 400) throw new TypeError("Object search text must be at most 400 characters.");
  const words = query.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  return [...new Set(words.flatMap((word) => word.split(/[-']/u))
    .filter((word) => word.length >= 2 && !ignoredWords.has(word)))].slice(0, 8);
}

function matchWhere(tokens, fields, extra = []) {
  const parts = [];
  const values = [];
  for (const token of tokens) {
    const pattern = `%${token}%`;
    for (const field of fields) {
      parts.push(`LOWER(COALESCE(${field}, '')) LIKE ?`);
      values.push(pattern);
    }
    for (const expression of extra) {
      parts.push(expression);
      values.push(pattern);
    }
  }
  return { sql: `(${parts.join(" OR ")})`, values };
}

function readCandidates(database, tokens) {
  const candidates = [];
  const read = (type, select, from, baseWhere, fields, extras = [], order = "id DESC") => {
    const match = matchWhere(tokens, fields, extras);
    const rows = database.prepare(`SELECT ${select} FROM ${from}
      WHERE ${baseWhere} AND ${match.sql} ORDER BY ${order} LIMIT ?`)
      .all(...match.values, 24);
    for (const row of rows) candidates.push({ type, row });
  };

  read("contact",
    `c.contact_id AS id, c.display_name AS title, c.given_name, c.family_name,
     c.organization_name, c.contact_kind,
     (SELECT GROUP_CONCAT(tag.label ORDER BY tag.label SEPARATOR ', ')
      FROM contacts_tags_join AS assignment JOIN tags AS tag USING (tag_id)
      WHERE assignment.record_type = 'contact'
        AND assignment.record_id = CAST(c.contact_id AS CHAR)
        AND tag.is_active = 1) AS tag_labels`,
    "contacts AS c", "c.status = 'active'",
    ["c.display_name", "c.given_name", "c.family_name", "c.organization_name"],
    [`EXISTS (SELECT 1 FROM contacts_tags_join AS assignment
      JOIN tags AS tag USING (tag_id)
      WHERE assignment.record_type = 'contact'
        AND assignment.record_id = CAST(c.contact_id AS CHAR)
        AND tag.is_active = 1 AND LOWER(tag.label) LIKE ?)`],
    "c.display_name, c.contact_id");

  read("todo_group", "g.todo_group_id AS id, g.name AS title",
    "todo_groups AS g", "g.archived_at_utc IS NULL", ["g.name"], [], "g.name, g.todo_group_id");
  read("todo", `task.personal_task_id AS id, task.text AS title, task.status,
      task.todo_group_id AS parent_id, todo_group.name AS parent_title,
      task.related_contact_id AS contact_id, contact.display_name AS contact_title`,
    `todo_personal AS task JOIN todo_groups AS todo_group USING (todo_group_id)
      LEFT JOIN contacts AS contact ON contact.contact_id = task.related_contact_id`,
    "task.status NOT IN ('archive', 'ignore') AND todo_group.archived_at_utc IS NULL",
    ["task.text", "todo_group.name", "contact.display_name"], [], "task.personal_task_id DESC");

  read("journal_group", "journal_group.journal_group_id AS id, journal_group.name AS title",
    "journal1_groups AS journal_group", "journal_group.archived_at_utc IS NULL",
    ["journal_group.name"], [], "journal_group.name, journal_group.journal_group_id");
  read("tracker", `tracker.tracker_id AS id, tracker.name AS title, tracker.unit,
      tracker.journal_group_id AS parent_id, journal_group.name AS parent_title`,
    "journal2_trackers AS tracker JOIN journal1_groups AS journal_group USING (journal_group_id)",
    "tracker.archived_at_utc IS NULL AND journal_group.archived_at_utc IS NULL",
    ["tracker.name", "tracker.unit", "journal_group.name"], [], "tracker.name, tracker.tracker_id");
  read("journal_entry", `entry.journal_entry_id AS id, entry.content_text AS title,
      entry.occurred_at_utc, entry.tracker_id AS parent_id, tracker.name AS parent_title,
      tracker.journal_group_id AS grandparent_id, journal_group.name AS grandparent_title`,
    `journal3_entries AS entry JOIN journal2_trackers AS tracker USING (tracker_id)
      JOIN journal1_groups AS journal_group USING (journal_group_id)`,
    "tracker.archived_at_utc IS NULL AND journal_group.archived_at_utc IS NULL",
    ["entry.content_text", "tracker.name", "journal_group.name"], [],
    "entry.occurred_at_utc DESC, entry.journal_entry_id DESC");
  return candidates;
}

function scoreCandidate({ type, row }, tokens) {
  const fields = [
    ["title", row.title, 6],
    ["tags", row.tag_labels, 3],
    ["name", [row.given_name, row.family_name, row.organization_name].filter(Boolean).join(" "), 3],
    ["unit", row.unit, 2],
    ["parent", row.parent_title, 2],
    ["related contact", row.contact_title, 2],
    ["group", row.grandparent_title, 1],
  ];
  let score = 0;
  const matchedOn = new Set();
  for (const token of tokens) {
    let strongestMatch = 0;
    for (const [label, value, weight] of fields) {
      if (String(value ?? "").toLocaleLowerCase().includes(token)) {
        strongestMatch = Math.max(strongestMatch, weight);
        matchedOn.add(label);
      }
    }
    score += strongestMatch;
  }
  if (!score) return null;
  const normalizedTitle = String(row.title ?? "").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (normalizedTitle === tokens.join(" ")) score += 10;
  const definition = byType.get(type);
  const id = Number(row.id);
  const title = String(row.title ?? "").trim().slice(0, 160);
  const detail = type === "contact" ? [row.contact_kind, row.tag_labels].filter(Boolean).join(" · ")
    : type === "todo" ? [row.parent_title, row.status].filter(Boolean).join(" · ")
      : type === "tracker" ? [row.parent_title, row.unit].filter(Boolean).join(" · ")
        : type === "journal_entry" ? [row.parent_title, row.occurred_at_utc].filter(Boolean).join(" · ")
          : "";
  return {
    type, table: definition.table, id, ref: `${definition.refPrefix}${id}`,
    label: definition.label, title, detail: String(detail).slice(0, 160),
    matchedOn: [...matchedOn], score, row,
  };
}

function relatedObject(type, id, title) {
  const definition = byType.get(type);
  return { type, id: Number(id), ref: `${definition.refPrefix}${Number(id)}`,
    label: definition.label, title: String(title).trim().slice(0, 100) };
}

function relatedFor(database, item) {
  const { type, id, row } = item;
  if (type === "journal_group") {
    return database.prepare(`SELECT tracker_id AS id, name AS title FROM journal2_trackers
      WHERE journal_group_id = ? AND archived_at_utc IS NULL ORDER BY name LIMIT 3`)
      .all(id).map(({ id: relatedId, title }) => relatedObject("tracker", relatedId, title));
  }
  if (type === "tracker") {
    const entries = database.prepare(`SELECT journal_entry_id AS id, content_text AS title
      FROM journal3_entries WHERE tracker_id = ?
      ORDER BY occurred_at_utc DESC, journal_entry_id DESC LIMIT 2`).all(id)
      .map(({ id: relatedId, title }) => relatedObject("journal_entry", relatedId, title));
    return [relatedObject("journal_group", row.parent_id, row.parent_title), ...entries];
  }
  if (type === "journal_entry") {
    return [relatedObject("tracker", row.parent_id, row.parent_title),
      relatedObject("journal_group", row.grandparent_id, row.grandparent_title)];
  }
  if (type === "todo_group") {
    return database.prepare(`SELECT personal_task_id AS id, text AS title FROM todo_personal
      WHERE todo_group_id = ? AND status IN ('todo', 'ai_suggested')
      ORDER BY sort_position, personal_task_id LIMIT 3`).all(id)
      .map(({ id: relatedId, title }) => relatedObject("todo", relatedId, title));
  }
  if (type === "todo") {
    return [relatedObject("todo_group", row.parent_id, row.parent_title),
      ...(row.contact_id && row.contact_title
        ? [relatedObject("contact", row.contact_id, row.contact_title)] : [])];
  }
  if (type === "contact") {
    return database.prepare(`SELECT personal_task_id AS id, text AS title FROM todo_personal
      WHERE related_contact_id = ? AND status IN ('todo', 'ai_suggested')
      ORDER BY personal_task_id DESC LIMIT 2`).all(id)
      .map(({ id: relatedId, title }) => relatedObject("todo", relatedId, title));
  }
  return [];
}

export function searchNativeObjects(database, { query, limit = 4 } = {}) {
  const tokens = objectSearchTerms(query ?? "");
  if (!tokens.length) return { query: String(query ?? ""), source: "native_mariadb_object_tables",
    capturedAtUtc: new Date().toISOString(), objects: [] };
  const boundedLimit = Number(limit);
  if (!Number.isSafeInteger(boundedLimit) || boundedLimit < 1 || boundedLimit > 6) {
    throw new TypeError("Object search limit must be from 1 to 6.");
  }
  const ranked = readCandidates(database, tokens)
    .map((candidate) => scoreCandidate(candidate, tokens)).filter(Boolean)
    .sort((left, right) => right.score - left.score
      || left.label.localeCompare(right.label) || left.title.localeCompare(right.title));
  const objects = ranked.slice(0, boundedLimit).map((item) => {
    const { row: _row, score: _score, ...publicItem } = item;
    return { ...publicItem, related: relatedFor(database, item) };
  });
  return { query, source: "native_mariadb_object_tables",
    capturedAtUtc: new Date().toISOString(), objects };
}

export function registerNativeObjectContextView(registry, organizer) {
  registry.registerContextView("search", {
    id: "search.native_object_candidates",
    title: "Native objects named in this request",
    maximumItems: 6,
    description: "Read up to six lexical candidates from selected fields of native Contacts, To-do, and Journal rows, with stable IDs and bounded relationships. Select when the request names a particular native object. Candidates do not prove intent or authorize an action.",
    execute({ requestText = "" } = {}) {
      const result = organizer.searchNativeObjects({ query: requestText.slice(-400), limit: 6 });
      return {
        source: result.source,
        capturedAtUtc: result.capturedAtUtc,
        data: { objects: result.objects },
        count: result.objects.length,
        text: JSON.stringify({ objects: result.objects }),
      };
    },
  });
}
