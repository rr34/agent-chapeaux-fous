import { nativeFirstClassObjectTypes } from "./native-object-types.mjs";

// Native object search is a bounded read path across searchable application
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

const maximumSelectedObjects = 12;

export const nativeObjectTypes = Object.freeze(nativeFirstClassObjectTypes
  .filter(({ searchType }) => searchType)
  .map((type) => Object.freeze({
    type: type.searchType, domainType: type.id, source: type.source, table: type.table, key: type.key,
    label: type.title, searchFields: type.searchFields, refPrefix: type.refPrefix,
  })));

const byType = new Map(nativeObjectTypes.map((definition) => [definition.type, definition]));
const byDomainType = new Map(nativeObjectTypes.map((definition) => [definition.domainType, definition]));

const exactCandidateReads = Object.freeze({
  contact: { display: "display_name", where: "status = 'active'" },
  todo_group: { display: "name", where: "archived_at_utc IS NULL" },
  todo: { display: "text", where: "status IN ('todo', 'ai_suggested') AND EXISTS (SELECT 1 FROM todo_groups WHERE todo_group_id = todo_personal.todo_group_id AND archived_at_utc IS NULL)" },
  journal_group: { display: "name", where: "archived_at_utc IS NULL" },
  tracker: { display: "name", where: "archived_at_utc IS NULL AND EXISTS (SELECT 1 FROM journal1_groups WHERE journal_group_id = journal2_trackers.journal_group_id AND archived_at_utc IS NULL)" },
  journal_entry: { display: "content_text", where: "EXISTS (SELECT 1 FROM journal2_trackers JOIN journal1_groups USING (journal_group_id) WHERE tracker_id = journal3_entries.tracker_id AND journal2_trackers.archived_at_utc IS NULL AND journal1_groups.archived_at_utc IS NULL)" },
  calendar_event: { display: "title", where: "status <> 'cancelled' AND COALESCE(ends_at_utc, starts_at_utc) >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MONTH)" },
  calendar_routine: { display: "title", where: "disabled_at_utc IS NULL" },
  file: { display: "COALESCE(title, original_filename)", where: "1 = 1" },
  profile_fact: { display: "fact_text", where: "fact_status = 'active'" },
  catch_up_question: { display: "question_text", where: "resolved_at IS NULL" },
  video_script: { display: "title", where: "status = 'draft'" },
  content_group: { display: "name", where: "archived_at_utc IS NULL" },
  content_item: { display: "title", where: "content_status IN ('active', 'queued') AND EXISTS (SELECT 1 FROM content_groups WHERE content_group_id = content_items.content_group_id AND archived_at_utc IS NULL)" },
});
const missingExactCandidateRead = nativeObjectTypes.find(({ type }) => !exactCandidateReads[type]);
if (missingExactCandidateRead) {
  throw new Error(`Searchable object type ${missingExactCandidateRead.type} has no exact candidate read`);
}


function canonicalCandidateId(value, definition) {
  if (definition?.key == null) return null;
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== "string" || !/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function compact(value, maximum) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text ? text.slice(0, maximum) : null;
}

export function normalizeSelectedObjectCandidates(value, { maximum = maximumSelectedObjects } = {}) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError("selectedObjectCandidates must be an array.");
  if (value.length > maximum) throw new TypeError(`At most ${maximum} selected objects are allowed.`);
  const output = [];
  const seen = new Set();
  for (const [index, candidate] of value.entries()) {
    const definition = byDomainType.get(candidate?.type);
    if (!definition) throw new TypeError(`selectedObjectCandidates[${index}].type is not searchable.`);
    const id = canonicalCandidateId(candidate?.id, definition);
    const display = compact(candidate?.display, 500);
    const mention = compact(candidate?.mention, 500);
    const expectedRef = id == null ? null : `${definition.refPrefix}${encodeURIComponent(String(id))}`;
    if (id == null || !display || mention !== `@${display}` || candidate?.source !== definition.source
        || candidate?.ref !== expectedRef) {
      throw new TypeError(`selectedObjectCandidates[${index}] is not a valid ${definition.label} identity.`);
    }
    if (seen.has(expectedRef)) continue;
    seen.add(expectedRef);
    output.push({ mention, type: definition.domainType, source: definition.source,
      id, ref: expectedRef, display });
  }
  return output;
}

function visibleMentionCount(text, mention) {
  let count = 0;
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(mention, offset);
    if (index < 0) break;
    const before = text[index - 1] ?? "";
    const after = text[index + mention.length] ?? "";
    const startsAtBoundary = !before || /[\s([{]/u.test(before);
    const endsAtBoundary = !after || /[\s,.;:!?()[\]{}]/u.test(after);
    if (startsAtBoundary && endsAtBoundary) count += 1;
    offset = index + mention.length;
  }
  return count;
}

export function selectedObjectMentionsAreVisible(requestText, selectedCandidates) {
  const text = String(requestText ?? "");
  const required = new Map();
  for (const { mention } of selectedCandidates) {
    required.set(mention, (required.get(mention) ?? 0) + 1);
  }
  return [...required].every(([mention, count]) => visibleMentionCount(text, mention) >= count);
}

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

function selectedSearchTypes(domainTypes) {
  if (domainTypes == null) return null;
  if (!Array.isArray(domainTypes)) throw new TypeError("Object search domainTypes must be an array.");
  const selected = new Set();
  for (const domainType of domainTypes) {
    const definition = byDomainType.get(domainType);
    if (!definition) throw new TypeError(`Object search domain type ${String(domainType)} is not searchable.`);
    selected.add(definition.type);
  }
  return selected;
}

function readCandidates(database, tokens, selectedTypes = null) {
  const candidates = [];
  const read = (type, select, from, baseWhere, fields, extras = [], order = "id DESC") => {
    if (selectedTypes && !selectedTypes.has(type)) return;
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
    "task.status IN ('todo', 'ai_suggested') AND todo_group.archived_at_utc IS NULL",
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
  read("calendar_event", `event.calendar_event_id AS id, event.title,
      event.starts_at_utc, event.location_text, event.status`,
    "calendar_events AS event", "event.status <> 'cancelled' AND COALESCE(event.ends_at_utc, event.starts_at_utc) >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MONTH)",
    ["event.title", "event.description", "event.location_text"], [],
    "event.starts_at_utc DESC, event.calendar_event_id DESC");
  read("calendar_routine", `routine.calendar_routine_id AS id, routine.title,
      routine.first_starts_at_utc, routine.time_zone, routine.recurrence_rule`,
    "calendar_routines AS routine", "routine.disabled_at_utc IS NULL",
    ["routine.title", "routine.description", "routine.location_text"], [],
    "routine.title, routine.calendar_routine_id");
  read("file", `file.file_id AS id, COALESCE(file.title, file.original_filename) AS title,
      file.original_filename, file.media_kind, file.mime_type`,
    "files AS file", "1 = 1", ["file.title", "file.original_filename", "file.description"], [],
    "file.created_at_utc DESC, file.file_id DESC");
  read("profile_fact", "fact.profile_fact_id AS id, fact.fact_text AS title, fact.fact_type, fact.fact_status",
    "profile_facts AS fact", "fact.fact_status = 'active'", ["fact.fact_text", "fact.fact_type"], [],
    "fact.profile_fact_id DESC");
  read("catch_up_question", `question.question_id AS id, question.question_text AS title,
      question.due_at_utc, question.calendar_event_id, question.tracker_id`,
    "catch_up_questions AS question", "question.resolved_at IS NULL",
    ["question.question_text", "question.comment"], [], "question.due_at_utc DESC, question.question_id DESC");
  read("video_script", "script.video_script_id AS id, script.title, script.status",
    "video_scripts AS script", "script.status = 'draft'", ["script.title"], [],
    "script.created_at_utc DESC, script.video_script_id DESC");
  read("content_group", "content_group.content_group_id AS id, content_group.name AS title",
    "content_groups AS content_group", "content_group.archived_at_utc IS NULL", ["content_group.name"], [],
    "content_group.sort_position, content_group.content_group_id");
  read("content_item", `content.content_id AS id, content.title,
      content.content_status, content.content_type, content.content_group_id AS parent_id,
      content_group.name AS parent_title`,
    "content_items AS content JOIN content_groups AS content_group USING (content_group_id)",
    "content.content_status IN ('active', 'queued') AND content_group.archived_at_utc IS NULL",
    ["content.title", "content.description", "content.personal_notes", "content_group.name"], [],
    "content.content_id DESC");
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
  const title = compact(row.title, 160) ?? "";
  const detail = type === "contact" ? [row.contact_kind, row.tag_labels].filter(Boolean).join(" · ")
    : type === "todo" ? [row.parent_title, row.status].filter(Boolean).join(" · ")
      : type === "tracker" ? [row.parent_title, row.unit].filter(Boolean).join(" · ")
        : type === "journal_entry" ? [row.parent_title, row.occurred_at_utc].filter(Boolean).join(" · ")
          : type === "calendar_event" ? [row.starts_at_utc, row.location_text].filter(Boolean).join(" · ")
            : type === "calendar_routine" ? [row.time_zone, row.recurrence_rule].filter(Boolean).join(" · ")
              : type === "file" ? [row.media_kind, row.original_filename].filter(Boolean).join(" · ")
                : type === "profile_fact" ? row.fact_type
                  : type === "catch_up_question" ? row.due_at_utc
                    : type === "content_item" ? [row.parent_title, row.content_status].filter(Boolean).join(" · ")
                      : row.status ?? "";
  return {
    type, domainType: definition.domainType, source: definition.source,
    table: definition.table, id, ref: `${definition.refPrefix}${id}`,
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

export function searchNativeObjects(database, { query, limit = 4, domainTypes = null } = {}) {
  const selectedTypes = selectedSearchTypes(domainTypes);
  const tokens = objectSearchTerms(query ?? "");
  if (!tokens.length) return { query: String(query ?? ""), source: "native_mariadb_object_tables",
    capturedAtUtc: new Date().toISOString(), objects: [] };
  const boundedLimit = Number(limit);
  if (!Number.isSafeInteger(boundedLimit) || boundedLimit < 1 || boundedLimit > 48) {
    throw new TypeError("Object search limit must be from 1 to 48.");
  }
  const ranked = readCandidates(database, tokens, selectedTypes)
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

export function resolveNativeObjectCandidates(database, selectedCandidates = []) {
  const normalized = normalizeSelectedObjectCandidates(selectedCandidates);
  const resolved = [];
  for (const selection of normalized) {
    const definition = byDomainType.get(selection.type);
    const read = exactCandidateReads[definition.type];
    const row = database.prepare(`SELECT ${read.display} AS title FROM ${definition.table}
      WHERE ${definition.key} = ? AND ${read.where} LIMIT 1`).get(selection.id);
    const title = compact(row?.title, 160);
    if (title !== selection.display) continue;
    resolved.push({
      type: definition.type, domainType: definition.domainType, source: definition.source,
      table: definition.table, id: selection.id, ref: selection.ref,
      label: definition.label, title, detail: "", matchedOn: ["selected stable reference"],
      related: [],
    });
  }
  return resolved;
}

export function registerNativeObjectContextView(registry, organizer) {
  registry.registerContextView("search", {
    id: "search.native_object_candidates",
    title: "Native objects named in this request",
    maximumItems: 12,
    description: "Read up to twelve exact selected or lexical candidates from bounded fields of searchable native object tables, with stable IDs and bounded relationships. Select when the request names a particular native object. Candidates do not prove intent or authorize an action.",
    execute({ requestText = "", selectedObjectCandidates = [] } = {}) {
      const result = organizer.searchNativeObjects({ query: requestText.slice(-400), limit: 6 });
      const selected = typeof organizer.resolveNativeObjectCandidates === "function"
        ? organizer.resolveNativeObjectCandidates(selectedObjectCandidates)
        : [];
      const objects = [...selected, ...result.objects]
        .filter((object, index, values) => values.findIndex(({ ref }) => ref === object.ref) === index)
        .slice(0, 12);
      return {
        source: result.source,
        capturedAtUtc: result.capturedAtUtc,
        data: { objects },
        count: objects.length,
        text: JSON.stringify({ objects }),
      };
    },
  });
}
