import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import rrulePackage from "rrule";
import { redactText, safeJson } from "./redaction.mjs";
import { archiveEmptyTodoGroup, renameTodoGroup } from "./todo-group-operations.mjs";
import { moveOverdueTodosToToday } from "./todo-schedule-operations.mjs";

const { rrulestr } = rrulePackage;
const dayMilliseconds = 86_400_000;
const defaultCalendarTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const calendarStatuses = new Set(["active", "archived"]);
const visibleCalendarStorageStatuses = ["tentative", "confirmed"];
const todoStatuses = new Set(["todo", "complete", "ignore", "archive", "ai_suggested"]);
const contactKinds = new Set(["person", "organization", "service"]);
const contactStatuses = new Set(["active", "inactive", "blocked", "deceased"]);
const contactMethodKinds = new Set(["email", "phone", "postal_address", "handle", "url", "other"]);

export class OrganizerInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "OrganizerInputError";
    this.statusCode = statusCode;
  }
}

function requiredText(value, label, maximum = 500) {
  if (typeof value !== "string" || !value.trim()) {
    throw new OrganizerInputError(`${label} is required.`);
  }
  return value.trim().slice(0, maximum);
}

function optionalText(value, label, maximum = 10_000) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new OrganizerInputError(`${label} must be text.`);
  return value.trim().slice(0, maximum) || null;
}

function enumValue(value, allowed, label, fallback) {
  const result = value == null || value === "" ? fallback : value;
  if (!allowed.has(result)) throw new OrganizerInputError(`${label} is invalid.`);
  return result;
}

function booleanInteger(value, fallback = 0) {
  if (value == null) return fallback;
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  throw new OrganizerInputError("isAllDay must be a boolean.");
}

function contactBirthDate(value) {
  const result = optionalText(value, "birthDate", 10);
  if (result === null) return null;
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(result);
  const partial = /^--(\d{2})-(\d{2})$/.exec(result);
  const comparable = full ? result : partial ? `2000-${partial[1]}-${partial[2]}` : null;
  const date = comparable ? new Date(`${comparable}T00:00:00.000Z`) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== comparable) {
    throw new OrganizerInputError("birthDate must be YYYY-MM-DD or --MM-DD.");
  }
  return result;
}

function normalizedContactMethod(kind, value) {
  if (kind === "email") return value.toLowerCase();
  if (kind === "phone") {
    const digits = value.replace(/\D/g, "");
    return value.startsWith("+") ? `+${digits}` : digits;
  }
  return value.toLowerCase().replace(/\s+/g, " ");
}

function contactMethodBoolean(value, label, fallback) {
  if (value == null) return fallback;
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new OrganizerInputError(`${label} must be a boolean.`);
}

function contactMethods(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 100) {
    throw new OrganizerInputError("methods must be an array of at most 100 contact methods.");
  }
  const seen = new Set();
  return value.map((method, index) => {
    if (!method || typeof method !== "object" || Array.isArray(method)) {
      throw new OrganizerInputError(`methods[${index}] must be an object.`);
    }
    const kind = enumValue(method.kind, contactMethodKinds, `methods[${index}].kind`, "other");
    const item = {
      id: optionalPositiveInteger(method.id, `methods[${index}].id`),
      kind,
      label: optionalText(method.label, `methods[${index}].label`, 100),
      value: requiredText(method.value, `methods[${index}].value`, 2000),
      isPrimary: contactMethodBoolean(method.isPrimary, `methods[${index}].isPrimary`, false),
      canReceive: contactMethodBoolean(method.canReceive, `methods[${index}].canReceive`, true),
    };
    item.normalizedValue = normalizedContactMethod(item.kind, item.value);
    const key = `${item.kind}\u0000${item.normalizedValue}`;
    if (seen.has(key)) throw new OrganizerInputError("Duplicate contact methods are not allowed.");
    seen.add(key);
    return item;
  });
}

function contactTags(value) {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 50) {
    throw new OrganizerInputError("tags must be an array of at most 50 labels.");
  }
  const tags = [];
  const seen = new Set();
  for (const [index, valueItem] of value.entries()) {
    const label = requiredText(valueItem, `tags[${index}]`, 100);
    const slug = label.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
    if (!slug) throw new OrganizerInputError(`tags[${index}] must contain a letter or number.`);
    if (seen.has(slug)) continue;
    seen.add(slug);
    tags.push({ slug, label });
  }
  return tags;
}

function integer(value, label, { fallback = 0, minimum = -100, maximum = 100 } = {}) {
  const result = value == null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new OrganizerInputError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return result;
}

function optionalPositiveInteger(value, label) {
  if (value == null || value === "") return null;
  return integer(value, label, { minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
}

function optionalFiniteNumber(value, label) {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new OrganizerInputError(`${label} must be a finite number.`);
  }
  return value;
}

function identifier(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new OrganizerInputError(`${label} is invalid.`);
  }
  return result;
}

function isoDateTime(value, label, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw new OrganizerInputError(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string") throw new OrganizerInputError(`${label} must be an ISO-8601 date and time.`);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new OrganizerInputError(`${label} must be an ISO-8601 date and time.`);
  return date.toISOString();
}

function timeZone(value) {
  const result = optionalText(value, "timeZone", 100);
  if (!result) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: result }).format(new Date());
  } catch {
    throw new OrganizerInputError("timeZone must be a valid IANA time zone.");
  }
  return result;
}

function zonedParts(date, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts
    .filter(({ type }) => type !== "literal")
    .map(({ type, value }) => [type, Number(value)]));
}

function zonedPartsToUtc(parts, zone) {
  const desired = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0,
  );
  let candidate = desired;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(new Date(candidate), zone);
    const represented = Date.UTC(
      actual.year, actual.month - 1, actual.day,
      actual.hour, actual.minute, actual.second,
    );
    const correction = desired - represented;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}

function basicDateTime(parts, suffix = "") {
  const values = [parts.year, parts.month, parts.day, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0];
  const [year, month, day, hour, minute, second] = values.map((value, index) => (
    String(value).padStart(index === 0 ? 4 : 2, "0")
  ));
  return `${year}${month}${day}T${hour}${minute}${second}${suffix}`;
}

function utcParts(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function localizeUtcUntil(rule, zone) {
  if (!zone) return rule;
  return rule.replace(/UNTIL=(\d{8}T\d{6})Z/i, (match, value) => {
    const parsed = new Date(
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T`
      + `${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`,
    );
    return Number.isFinite(parsed.getTime())
      ? `UNTIL=${basicDateTime(zonedParts(parsed, zone))}`
      : match;
  });
}

function recurrenceIdentifierDate(value, event) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!match) return null;
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
  };
  if (!match[7] && event.timeZone && !event.isAllDay) return zonedPartsToUtc(parts, event.timeZone);
  return new Date(Date.UTC(
    parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second,
  ));
}

function occurrenceDates(event, fromUtc, toUtc) {
  const start = new Date(event.startsAtUtc);
  const zone = event.timeZone || null;
  const startParts = zone ? zonedParts(start, zone) : utcParts(start);
  const rule = localizeUtcUntil(String(event.recurrenceRule).replace(/^RRULE:/i, ""), zone);
  const parsed = rrulestr(`DTSTART:${basicDateTime(startParts, zone ? "" : "Z")}\nRRULE:${rule}`);
  const duration = event.endsAtUtc
    ? Math.max(0, new Date(event.endsAtUtc).getTime() - start.getTime())
    : 0;
  const margin = Math.max(dayMilliseconds * 2, duration);
  return parsed.between(
    new Date(new Date(fromUtc).getTime() - margin),
    new Date(new Date(toUtc).getTime() + dayMilliseconds * 2),
    true,
  ).map((date) => (zone ? zonedPartsToUtc(utcParts(date), zone) : date));
}

function nextOccurrence(event, afterUtc) {
  const start = new Date(event.startsAtUtc);
  const zone = event.timeZone || null;
  const startParts = zone ? zonedParts(start, zone) : utcParts(start);
  const rule = localizeUtcUntil(String(event.recurrenceRule).replace(/^RRULE:/i, ""), zone);
  const parsed = rrulestr(`DTSTART:${basicDateTime(startParts, zone ? "" : "Z")}\nRRULE:${rule}`);
  const after = new Date(afterUtc);
  const afterParts = zone ? zonedParts(after, zone) : null;
  const comparison = afterParts
    ? new Date(Date.UTC(
      afterParts.year, afterParts.month - 1, afterParts.day,
      afterParts.hour, afterParts.minute, afterParts.second,
    ))
    : after;
  const next = parsed.after(comparison, false);
  return next && (zone ? zonedPartsToUtc(utcParts(next), zone) : next);
}

function ordinal(value) {
  const remainder100 = value % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`;
  return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
}

function publicCalendarEvent(row) {
  if (!row) return null;
  return {
    id: row.calendar_event_id,
    icalUid: row.ical_uid,
    icalRecurrenceId: row.ical_recurrence_id,
    title: row.title,
    description: row.description,
    location: row.location_text,
    startsAtUtc: row.starts_at_utc,
    endsAtUtc: row.ends_at_utc,
    timeZone: row.time_zone,
    isAllDay: Boolean(row.is_all_day),
    status: visibleCalendarStorageStatuses.includes(row.status) ? "active" : "archived",
    recurrenceRule: row.recurrence_rule,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    version: row.updated_at_utc ?? row.created_at_utc,
  };
}

function publicContactMethod(row) {
  return {
    id: row.contact_method_id,
    kind: row.method_kind,
    label: row.label,
    value: row.value,
    isPrimary: Boolean(row.is_primary),
    canReceive: Boolean(row.can_receive),
  };
}

function publicContact(row, methods = [], tags = []) {
  if (!row) return null;
  return {
    id: row.contact_id,
    kind: row.contact_kind,
    displayName: row.display_name,
    givenName: row.given_name,
    familyName: row.family_name,
    organizationName: row.organization_name,
    isSelf: Boolean(row.is_self),
    status: row.status,
    birthDate: row.birth_date,
    notes: row.notes,
    methods,
    tags,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    version: row.updated_at_utc ?? row.created_at_utc,
  };
}

function recurringOccurrence(event, startsAt, duration) {
  const startMs = startsAt.getTime();
  return {
    ...event,
    id: `recurrence:${event.id}:${startsAt.toISOString()}`,
    seriesId: event.id,
    seriesStartsAtUtc: event.startsAtUtc,
    seriesEndsAtUtc: event.endsAtUtc,
    startsAtUtc: startsAt.toISOString(),
    endsAtUtc: duration > 0 ? new Date(startMs + duration).toISOString() : null,
    isGeneratedOccurrence: true,
    readOnly: true,
  };
}

function birthdayParts(value) {
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (full) return { year: Number(full[1]), month: Number(full[2]), day: Number(full[3]) };
  const partial = /^--(\d{2})-(\d{2})$/.exec(value ?? "");
  return partial ? { year: null, month: Number(partial[1]), day: Number(partial[2]) } : null;
}

function birthdayOccurrence(contact, year, fromUtc, toUtc) {
  const birth = birthdayParts(contact.birth_date);
  if (!birth) return null;
  const localStart = { year, month: birth.month, day: birth.day, hour: 0, minute: 0, second: 0 };
  const start = zonedPartsToUtc(localStart, defaultCalendarTimeZone);
  const represented = zonedParts(start, defaultCalendarTimeZone);
  if (represented.year !== year || represented.month !== birth.month || represented.day !== birth.day) {
    return null;
  }
  const nextDate = new Date(Date.UTC(year, birth.month - 1, birth.day + 1));
  const end = zonedPartsToUtc({
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: nextDate.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  }, defaultCalendarTimeZone);
  if (start >= new Date(toUtc) || end <= new Date(fromUtc)) return null;
  const age = birth.year == null ? null : year - birth.year;
  const possessive = contact.display_name.endsWith("s") ? `${contact.display_name}’` : `${contact.display_name}’s`;
  return {
    id: `birthday:${contact.contact_id}:${year}`,
    contactId: contact.contact_id,
    title: `${possessive} ${age == null ? "birthday" : `${ordinal(age)} birthday`}`,
    description: null,
    location: null,
    startsAtUtc: start.toISOString(),
    endsAtUtc: end.toISOString(),
    timeZone: defaultCalendarTimeZone,
    isAllDay: true,
    status: "active",
    recurrenceRule: null,
    sourceKind: "contact_birthday",
    age,
    isGeneratedOccurrence: true,
    readOnly: true,
    version: null,
  };
}

function publicTodo(row) {
  if (!row) return null;
  return {
    id: row.personal_task_id,
    groupId: row.todo_group_id,
    groupName: row.group_name,
    groupArchivedAtUtc: row.group_archived_at_utc ?? null,
    routineId: row.todo_routine_id,
    sequence: row.sequence,
    relatedContactId: row.related_contact_id,
    text: row.text,
    status: row.status,
    sortPosition: row.sort_position,
    scheduledAtUtc: row.scheduled_at_utc,
    isAllDay: Boolean(row.is_all_day),
    dueAtUtc: row.due_at_utc,
    completedAtUtc: row.completed_at_utc,
    recurrenceRule: row.routine_recurrence_rule,
    recurrenceTimeZone: row.routine_time_zone,
    source: row.source,
    externalId: row.external_id,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    version: row.updated_at_utc ?? row.created_at_utc,
  };
}

function publicTodoGroup(row) {
  if (!row) return null;
  return {
    id: row.todo_group_id,
    name: row.name,
    sortPosition: row.sort_position,
    archivedAtUtc: row.archived_at_utc,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function publicLogTracker(row) {
  if (!row) return null;
  return {
    id: row.tracker_id,
    groupId: row.log_group_id,
    groupName: row.group_name,
    groupArchivedAtUtc: row.group_archived_at_utc ?? null,
    name: row.name,
    defaultUnit: row.default_unit,
    archivedAtUtc: row.archived_at_utc,
    entryCount: Number(row.entry_count ?? 0),
    lastLoggedAtUtc: row.last_logged_at_utc ?? null,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

function publicLogEntry(row) {
  if (!row) return null;
  return {
    id: row.log_entry_id,
    trackerId: row.tracker_id,
    trackerName: row.tracker_name,
    groupId: row.log_group_id,
    groupName: row.group_name,
    occurredAtUtc: row.occurred_at_utc,
    contentText: row.content_text,
    numberValue: row.number_value,
    unit: row.unit,
    source: row.source,
    externalId: row.external_id,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

export function generateNextRoutineTask(database, personalTaskId, { now = new Date() } = {}) {
  const todo = database.prepare(`
    SELECT * FROM personal_tasks WHERE personal_task_id = ?
  `).get(personalTaskId);
  if (!todo?.todo_routine_id) return null;
  const routine = database.prepare(`
    SELECT * FROM todo_routines
    WHERE todo_routine_id = ? AND disabled_at_utc IS NULL
  `).get(todo.todo_routine_id);
  if (!routine) return null;
  const threshold = new Date(Math.max(
    now.getTime(),
    todo.scheduled_at_utc ? new Date(todo.scheduled_at_utc).getTime() : 0,
  ));
  let scheduled;
  try {
    scheduled = nextOccurrence({
      startsAtUtc: routine.first_scheduled_at_utc,
      timeZone: routine.time_zone,
      recurrenceRule: routine.recurrence_rule,
    }, threshold);
  } catch {
    return null;
  }
  if (!scheduled) return null;
  const dueOffset = routine.first_due_at_utc
    ? new Date(routine.first_due_at_utc).getTime() - new Date(routine.first_scheduled_at_utc).getTime()
    : null;
  const dueAtUtc = dueOffset == null ? null : new Date(scheduled.getTime() + dueOffset).toISOString();
  const sortPosition = Number(database.prepare(`
    SELECT COALESCE(MAX(sort_position), 0) + 10 AS next_position
    FROM personal_tasks WHERE todo_group_id = ?
  `).get(routine.todo_group_id).next_position);
  const result = database.prepare(`
    INSERT INTO personal_tasks (
      todo_group_id, todo_routine_id, text, status, sort_position,
      scheduled_at_utc, is_all_day, due_at_utc, source
    ) VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, 'routine')
    ON CONFLICT (todo_routine_id, scheduled_at_utc) WHERE
      todo_routine_id IS NOT NULL AND scheduled_at_utc IS NOT NULL
    DO NOTHING
  `).run(
    routine.todo_group_id, routine.todo_routine_id, routine.text, sortPosition,
    scheduled.toISOString(), routine.is_all_day, dueAtUtc,
  );
  return result.changes === 1 ? Number(result.lastInsertRowid) : null;
}

function changedFields(before, after, fields) {
  return Object.fromEntries(fields
    .filter((field) => before[field] !== after[field])
    .map((field) => [field, { before: before[field], after: after[field] }]));
}

export class OrganizerStore {
  constructor(databasePath) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  }

  close() {
    this.database.close();
  }

  #activity({
    eventType, status, name, subjectType, subjectId, contentText, payload,
    actorType = "user", actorName = "Nate", source = "tailnet_web",
  }) {
    const eventId = randomUUID();
    this.database.prepare(`
      INSERT INTO activity_events (
        event_id, event_type, event_phase, status, actor_type, actor_name,
        source, channel, name, content_text, payload_json, subject_type, subject_id
      ) VALUES (?, ?, 'point', ?, ?, ?, ?, 'tailnet_web', ?, ?, ?, ?, ?)
    `).run(
      eventId,
      eventType,
      status,
      actorType,
      actorName,
      source,
      name,
      redactText(contentText),
      safeJson(payload),
      subjectType,
      String(subjectId),
    );
    return eventId;
  }

  #contact(id) {
    const row = this.database.prepare("SELECT * FROM contacts WHERE contact_id = ?").get(id);
    if (!row) return null;
    const methods = this.database.prepare(`
      SELECT * FROM contact_methods
      WHERE contact_id = ?
      ORDER BY is_primary DESC, method_kind, contact_method_id
    `).all(id).map(publicContactMethod);
    const tags = this.database.prepare(`
      SELECT tag.label
      FROM record_tags AS assignment
      JOIN tags AS tag USING (tag_id)
      WHERE assignment.record_type = 'contact'
        AND assignment.record_id = ?
        AND tag.is_active = 1
      ORDER BY tag.label COLLATE NOCASE, tag.tag_id
    `).all(String(id)).map(({ label }) => label);
    return publicContact(row, methods, tags);
  }

  #replaceContactMethods(contactId, methods) {
    if (methods === null) return;
    const existingIds = new Set(this.database.prepare(
      "SELECT contact_method_id FROM contact_methods WHERE contact_id = ?",
    ).all(contactId).map(({ contact_method_id: id }) => Number(id)));
    for (const method of methods) {
      if (method.id !== null && !existingIds.has(method.id)) {
        throw new OrganizerInputError("A contact method does not belong to this contact.", 409);
      }
    }
    this.database.prepare("DELETE FROM contact_methods WHERE contact_id = ?").run(contactId);
    const insert = this.database.prepare(`
      INSERT INTO contact_methods (
        contact_method_id, contact_id, method_kind, label, value,
        normalized_value, is_primary, can_receive
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const method of methods) {
      insert.run(
        method.id, contactId, method.kind, method.label, method.value,
        method.normalizedValue, method.isPrimary ? 1 : 0, method.canReceive ? 1 : 0,
      );
    }
  }

  #replaceContactTags(contactId, tags) {
    if (tags === null) return;
    const recordId = String(contactId);
    this.database.prepare(
      "DELETE FROM record_tags WHERE record_type = 'contact' AND record_id = ?",
    ).run(recordId);
    const find = this.database.prepare("SELECT tag_id FROM tags WHERE slug = ?");
    const insertTag = this.database.prepare("INSERT INTO tags (slug, label) VALUES (?, ?)");
    const reactivate = this.database.prepare("UPDATE tags SET label = ?, is_active = 1 WHERE tag_id = ?");
    const assign = this.database.prepare(`
      INSERT INTO record_tags (tag_id, record_type, record_id)
      VALUES (?, 'contact', ?)
    `);
    for (const tag of tags) {
      let row = find.get(tag.slug);
      if (!row) {
        const result = insertTag.run(tag.slug, tag.label);
        row = { tag_id: Number(result.lastInsertRowid) };
      } else {
        reactivate.run(tag.label, row.tag_id);
      }
      assign.run(row.tag_id, recordId);
    }
  }

  listContacts({ scope = "active", limit = 500 } = {}) {
    if (!new Set(["active", "all"]).has(scope)) {
      throw new OrganizerInputError("scope must be active or all.");
    }
    const boundedLimit = integer(limit, "limit", { fallback: 500, minimum: 1, maximum: 1000 });
    const rows = this.database.prepare(`
      SELECT * FROM contacts
      ${scope === "active" ? "WHERE status = 'active'" : ""}
      ORDER BY status <> 'active', display_name COLLATE NOCASE, contact_id
      LIMIT ?
    `).all(boundedLimit);
    if (rows.length === 0) return [];
    const methodsByContact = new Map();
    const tagsByContact = new Map();
    const placeholders = rows.map(() => "?").join(", ");
    const methods = this.database.prepare(`
      SELECT * FROM contact_methods
      WHERE contact_id IN (${placeholders})
      ORDER BY is_primary DESC, method_kind, contact_method_id
    `).all(...rows.map(({ contact_id: id }) => id));
    for (const method of methods) {
      const values = methodsByContact.get(method.contact_id) ?? [];
      values.push(publicContactMethod(method));
      methodsByContact.set(method.contact_id, values);
    }
    const assignments = this.database.prepare(`
      SELECT assignment.record_id, tag.label
      FROM record_tags AS assignment
      JOIN tags AS tag USING (tag_id)
      WHERE assignment.record_type = 'contact'
        AND assignment.record_id IN (${placeholders})
        AND tag.is_active = 1
      ORDER BY tag.label COLLATE NOCASE, tag.tag_id
    `).all(...rows.map(({ contact_id: id }) => String(id)));
    for (const assignment of assignments) {
      const values = tagsByContact.get(assignment.record_id) ?? [];
      values.push(assignment.label);
      tagsByContact.set(assignment.record_id, values);
    }
    return rows.map((row) => publicContact(
      row,
      methodsByContact.get(row.contact_id) ?? [],
      tagsByContact.get(String(row.contact_id)) ?? [],
    ));
  }

  createContact(input) {
    const contact = {
      kind: enumValue(input?.kind, contactKinds, "kind", "person"),
      displayName: requiredText(input?.displayName, "displayName", 500),
      givenName: optionalText(input?.givenName, "givenName", 500),
      familyName: optionalText(input?.familyName, "familyName", 500),
      organizationName: optionalText(input?.organizationName, "organizationName", 500),
      status: enumValue(input?.status, contactStatuses, "status", "active"),
      birthDate: contactBirthDate(input?.birthDate),
      notes: optionalText(input?.notes, "notes", 10_000),
      methods: contactMethods(input?.methods) ?? [],
      tags: contactTags(input?.tags) ?? [],
    };
    const now = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`
        INSERT INTO contacts (
          contact_kind, display_name, given_name, family_name,
          organization_name, status, birth_date, notes, updated_at_utc
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        contact.kind, contact.displayName, contact.givenName, contact.familyName,
        contact.organizationName, contact.status, contact.birthDate, contact.notes, now,
      );
      const id = Number(result.lastInsertRowid);
      this.#replaceContactMethods(id, contact.methods);
      this.#replaceContactTags(id, contact.tags);
      const created = this.#contact(id);
      this.#activity({
        eventType: "contact.created",
        status: "complete",
        name: "Contact created",
        subjectType: "contact",
        subjectId: id,
        contentText: created.displayName,
        payload: { contact: created },
      });
      this.database.exec("COMMIT");
      return created;
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (String(error?.message).includes("UNIQUE constraint failed: contact_methods")) {
        throw new OrganizerInputError("Duplicate contact methods are not allowed.", 409);
      }
      throw error;
    }
  }

  updateContact(idValue, input) {
    const id = identifier(idValue, "contact id");
    const before = this.#contact(id);
    if (!before) throw new OrganizerInputError("Contact not found.", 404);
    if (typeof input?.version !== "string" || input.version !== before.version) {
      throw new OrganizerInputError("This contact changed after it was opened. Refresh and try again.", 409);
    }
    const contact = {
      kind: enumValue(input?.kind, contactKinds, "kind", before.kind),
      displayName: input?.displayName == null
        ? before.displayName
        : requiredText(input.displayName, "displayName", 500),
      givenName: input?.givenName === undefined ? before.givenName : optionalText(input.givenName, "givenName", 500),
      familyName: input?.familyName === undefined ? before.familyName : optionalText(input.familyName, "familyName", 500),
      organizationName: input?.organizationName === undefined
        ? before.organizationName
        : optionalText(input.organizationName, "organizationName", 500),
      status: enumValue(input?.status, contactStatuses, "status", before.status),
      birthDate: input?.birthDate === undefined ? before.birthDate : contactBirthDate(input.birthDate),
      notes: input?.notes === undefined ? before.notes : optionalText(input.notes, "notes", 10_000),
      methods: contactMethods(input?.methods),
      tags: contactTags(input?.tags),
    };
    const candidate = new Date().toISOString();
    const now = candidate > before.version
      ? candidate
      : new Date(new Date(before.version).getTime() + 1).toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(`
        UPDATE contacts
        SET contact_kind = ?, display_name = ?, given_name = ?, family_name = ?,
            organization_name = ?, status = ?, birth_date = ?, notes = ?, updated_at_utc = ?
        WHERE contact_id = ?
      `).run(
        contact.kind, contact.displayName, contact.givenName, contact.familyName,
        contact.organizationName, contact.status, contact.birthDate, contact.notes, now, id,
      );
      this.#replaceContactMethods(id, contact.methods);
      this.#replaceContactTags(id, contact.tags);
      const updated = this.#contact(id);
      this.#activity({
        eventType: "contact.updated",
        status: "complete",
        name: "Contact updated",
        subjectType: "contact",
        subjectId: id,
        contentText: updated.displayName,
        payload: {
          contact: updated,
          changedFields: changedFields(before, updated, [
            "kind", "displayName", "givenName", "familyName", "organizationName",
            "status", "birthDate", "notes", "methods", "tags",
          ]),
        },
      });
      this.database.exec("COMMIT");
      return updated;
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (String(error?.message).includes("UNIQUE constraint failed: contact_methods")) {
        throw new OrganizerInputError("Duplicate contact methods are not allowed.", 409);
      }
      throw error;
    }
  }

  mergeContacts(input) {
    const keepId = identifier(input?.keepContactId, "kept contact id");
    if (!Array.isArray(input?.mergeContactIds) || input.mergeContactIds.length === 0 || input.mergeContactIds.length > 20) {
      throw new OrganizerInputError("mergeContactIds must contain 1 through 20 contact ids.");
    }
    const mergeIds = input.mergeContactIds.map((value) => identifier(value, "merged contact id"));
    if (mergeIds.includes(keepId) || new Set(mergeIds).size !== mergeIds.length) {
      throw new OrganizerInputError("Merged contact ids must be unique and cannot include the kept contact.");
    }
    const allIds = [keepId, ...mergeIds];
    const records = allIds.map((id) => this.#contact(id));
    if (records.some((contact) => !contact)) throw new OrganizerInputError("A contact to merge was not found.", 404);
    for (const contact of records) {
      if (input?.versions?.[String(contact.id)] !== contact.version) {
        throw new OrganizerInputError("A contact changed while the merge was being reviewed. Refresh and try again.", 409);
      }
    }

    const kept = records[0];
    const firstValue = (field) => records.map((contact) => contact[field]).find((value) => value != null && value !== "") ?? null;
    const combinedMethods = [];
    const methodByKey = new Map();
    for (const [contactIndex, contact] of records.entries()) {
      for (const method of contact.methods) {
        const key = `${method.kind}\u0000${normalizedContactMethod(method.kind, method.value)}`;
        const existing = methodByKey.get(key);
        if (existing) {
          if (!existing.label && method.label) existing.label = method.label;
          if (method.isPrimary) existing.isPrimary = true;
          if (method.canReceive) existing.canReceive = true;
          continue;
        }
        const combined = { ...method, id: contactIndex === 0 ? method.id : null };
        combinedMethods.push(combined);
        methodByKey.set(key, combined);
      }
    }
    const tagValues = contactTags(records.flatMap((contact) => contact.tags));
    const notes = [];
    if (kept.notes) notes.push(kept.notes);
    for (const contact of records.slice(1)) {
      if (contact.notes && !notes.includes(contact.notes)) notes.push(`From ${contact.displayName}:\n${contact.notes}`);
    }
    const candidate = new Date().toISOString();
    const latestVersion = records.map(({ version }) => version).sort().at(-1);
    const now = candidate > latestVersion
      ? candidate
      : new Date(new Date(latestVersion).getTime() + 1).toISOString();
    const mergedOn = now.slice(0, 10);

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const deactivate = this.database.prepare(`
        UPDATE contacts
        SET status = 'inactive', notes = ?, updated_at_utc = ?
        WHERE contact_id = ?
      `);
      for (const contact of records.slice(1)) {
        const mergeNote = `Merged into ${kept.displayName} (#${keepId}) on ${mergedOn}.`;
        deactivate.run(contact.notes ? `${mergeNote}\n\n${contact.notes}` : mergeNote, now, contact.id);
      }
      this.database.prepare(`
        UPDATE contacts
        SET contact_kind = ?, display_name = ?, given_name = ?, family_name = ?,
            organization_name = ?, is_self = ?, status = 'active', birth_date = ?,
            notes = ?, updated_at_utc = ?
        WHERE contact_id = ?
      `).run(
        kept.kind,
        kept.displayName,
        firstValue("givenName"),
        firstValue("familyName"),
        firstValue("organizationName"),
        records.some(({ isSelf }) => isSelf) ? 1 : 0,
        firstValue("birthDate"),
        notes.join("\n\n") || null,
        now,
        keepId,
      );
      this.#replaceContactMethods(keepId, contactMethods(combinedMethods));
      this.#replaceContactTags(keepId, tagValues);
      const result = this.#contact(keepId);
      this.#activity({
        eventType: "contacts.merged",
        status: "complete",
        name: "Contacts merged",
        subjectType: "contact",
        subjectId: keepId,
        contentText: `${records.slice(1).map(({ displayName }) => displayName).join(", ")} → ${result.displayName}`,
        payload: { keptContact: result, mergedContactIds: mergeIds },
      });
      this.database.exec("COMMIT");
      return { contact: result, mergedContactIds: mergeIds };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listCalendar({ from, to }) {
    const fromUtc = isoDateTime(from, "from", { required: true });
    const toUtc = isoDateTime(to, "to", { required: true });
    if (fromUtc >= toUtc) throw new OrganizerInputError("to must be later than from.");
    const rangeMs = new Date(toUtc).getTime() - new Date(fromUtc).getTime();
    if (rangeMs > 370 * 86_400_000) throw new OrganizerInputError("Calendar ranges are limited to 370 days.");
    const ordinary = this.database.prepare(`
      SELECT *
      FROM calendar_events
      WHERE status IN ('tentative', 'confirmed')
        AND recurrence_rule IS NULL
        AND starts_at_utc < ?
        AND COALESCE(ends_at_utc, starts_at_utc) >= ?
      ORDER BY starts_at_utc, calendar_event_id
      LIMIT 2000
    `).all(toUtc, fromUtc).map(publicCalendarEvent);

    const masters = this.database.prepare(`
      SELECT *
      FROM calendar_events
      WHERE status IN ('tentative', 'confirmed')
        AND recurrence_rule IS NOT NULL
      ORDER BY calendar_event_id
    `).all().map(publicCalendarEvent);
    const exclusions = this.database.prepare(`
      SELECT calendar_event_id, excluded_starts_at_utc
      FROM calendar_event_exclusions
    `).all();
    const exclusionsByMaster = new Map();
    for (const exclusion of exclusions) {
      const values = exclusionsByMaster.get(exclusion.calendar_event_id) ?? new Set();
      const date = new Date(exclusion.excluded_starts_at_utc);
      if (Number.isFinite(date.getTime())) values.add(date.getTime());
      exclusionsByMaster.set(exclusion.calendar_event_id, values);
    }

    const exceptionRows = this.database.prepare(`
      SELECT *
      FROM calendar_events
      WHERE ical_uid IS NOT NULL
        AND ical_recurrence_id IS NOT NULL
    `).all().map(publicCalendarEvent);
    const exceptionsByUid = new Map();
    for (const exception of exceptionRows) {
      const values = exceptionsByUid.get(exception.icalUid) ?? [];
      values.push(exception);
      exceptionsByUid.set(exception.icalUid, values);
    }

    const recurring = [];
    for (const master of masters) {
      const duration = master.endsAtUtc
        ? Math.max(0, new Date(master.endsAtUtc).getTime() - new Date(master.startsAtUtc).getTime())
        : 0;
      const omitted = new Set(exclusionsByMaster.get(master.id) ?? []);
      for (const exception of exceptionsByUid.get(master.icalUid) ?? []) {
        const original = recurrenceIdentifierDate(exception.icalRecurrenceId, master);
        if (original) omitted.add(original.getTime());
      }
      try {
        for (const start of occurrenceDates(master, fromUtc, toUtc)) {
          const endMs = start.getTime() + duration;
          if (omitted.has(start.getTime())) continue;
          if (start.getTime() >= new Date(toUtc).getTime()) continue;
          if (endMs < new Date(fromUtc).getTime()) continue;
          recurring.push(recurringOccurrence(master, start, duration));
        }
      } catch {
        const start = new Date(master.startsAtUtc);
        const end = master.endsAtUtc ? new Date(master.endsAtUtc) : start;
        if (start < new Date(toUtc) && end >= new Date(fromUtc)) ordinary.push(master);
      }
    }

    const contacts = this.database.prepare(`
      SELECT contact_id, display_name, birth_date
      FROM contacts
      WHERE contact_kind = 'person'
        AND status <> 'blocked'
        AND birth_date IS NOT NULL
    `).all();
    const birthdays = [];
    const firstYear = new Date(fromUtc).getUTCFullYear() - 1;
    const lastYear = new Date(toUtc).getUTCFullYear() + 1;
    for (const contact of contacts) {
      for (let year = firstYear; year <= lastYear; year += 1) {
        const birthday = birthdayOccurrence(contact, year, fromUtc, toUtc);
        if (birthday) birthdays.push(birthday);
      }
    }

    return [...ordinary, ...recurring, ...birthdays]
      .sort((left, right) => left.startsAtUtc.localeCompare(right.startsAtUtc) || String(left.id).localeCompare(String(right.id)))
      .slice(0, 2000);
  }

  listTodos({ scope = "active", limit = 500 } = {}) {
    const boundedLimit = integer(limit, "limit", { fallback: 500, minimum: 1, maximum: 1000 });
    if (!new Set(["active", "all", "completed"]).has(scope)) {
      throw new OrganizerInputError("scope must be active, completed, or all.");
    }
    const where = scope === "active"
      ? "WHERE task.status IN ('todo', 'ai_suggested')"
      : scope === "completed"
        ? "WHERE task.status = 'complete'"
        : "";
    return this.database.prepare(`
      SELECT task.*, todo_group.name AS group_name,
             todo_group.archived_at_utc AS group_archived_at_utc,
             routine.recurrence_rule AS routine_recurrence_rule,
             routine.time_zone AS routine_time_zone
      FROM personal_tasks AS task
      JOIN todo_groups AS todo_group USING (todo_group_id)
      LEFT JOIN todo_routines AS routine USING (todo_routine_id)
      ${where}
      ORDER BY
        todo_group.sort_position,
        todo_group.todo_group_id,
        task.sort_position,
        task.personal_task_id
      LIMIT ?
    `).all(boundedLimit).map(publicTodo);
  }

  moveOverdueTodosToToday(input) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = moveOverdueTodosToToday(this.database, input ?? {});
      const movedTodoIds = result.moves.map(({ id }) => id);
      if (movedTodoIds.length > 0) {
        this.#activity({
          eventType: "personal_todos.moved_to_today",
          status: "complete",
          name: "Overdue tasks moved to today",
          subjectType: "personal_task_batch",
          subjectId: result.localDate,
          contentText: `Moved ${movedTodoIds.length} overdue ${movedTodoIds.length === 1 ? "task" : "tasks"} to ${result.localDate}`,
          payload: {
            localDate: result.localDate,
            timeZone: result.timeZone,
            movedTodoIds,
          },
        });
      }
      this.database.exec("COMMIT");
      return { movedCount: movedTodoIds.length, movedTodoIds };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listTodoGroups({ includeArchived = false } = {}) {
    return this.database.prepare(`
      SELECT *
      FROM todo_groups
      ${includeArchived ? "" : "WHERE archived_at_utc IS NULL"}
      ORDER BY sort_position, todo_group_id
    `).all().map(publicTodoGroup);
  }

  createTodoGroup(input) {
    const name = requiredText(input?.name, "name", 10_000);
    const now = new Date().toISOString();
    try {
      const result = this.database.prepare(`
        INSERT INTO todo_groups (name, sort_position, created_at_utc)
        SELECT ?, COALESCE(MAX(sort_position), 0) + 10, ?
        FROM todo_groups
      `).run(name, now);
      return publicTodoGroup(this.database.prepare(
        "SELECT * FROM todo_groups WHERE todo_group_id = ?",
      ).get(Number(result.lastInsertRowid)));
    } catch (error) {
      if (error?.code === "ERR_SQLITE_ERROR") {
        throw new OrganizerInputError("A to-do group with that name already exists.", 409);
      }
      throw error;
    }
  }

  renameTodoGroup(idValue, input) {
    const id = identifier(idValue, "to-do group id");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = renameTodoGroup(this.database, { groupId: id, newName: input?.name });
      this.#activity({
        eventType: "personal_todo_group.renamed",
        status: "complete",
        name: "Personal to-do group renamed",
        subjectType: "todo_group",
        subjectId: id,
        contentText: `${result.group.previousName} → ${result.group.name}`,
        payload: result,
      });
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  archiveTodoGroup(idValue) {
    const id = identifier(idValue, "to-do group id");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = archiveEmptyTodoGroup(this.database, { groupId: id });
      this.#activity({
        eventType: "personal_todo_group.archived",
        status: "complete",
        name: "Personal to-do group archived",
        subjectType: "todo_group",
        subjectId: id,
        contentText: result.group.name,
        payload: result,
      });
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  reorderTodoGroups(input) {
    if (!Array.isArray(input?.orderedGroupIds) || input.orderedGroupIds.length === 0) {
      throw new OrganizerInputError("orderedGroupIds must contain at least one to-do group id.");
    }
    const orderedGroupIds = input.orderedGroupIds.map((value) => identifier(value, "to-do group id"));
    if (new Set(orderedGroupIds).size !== orderedGroupIds.length) {
      throw new OrganizerInputError("orderedGroupIds cannot contain duplicates.");
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.database.prepare(`
        SELECT todo_group_id
        FROM todo_groups
        WHERE archived_at_utc IS NULL
        ORDER BY sort_position, todo_group_id
      `).all();
      if (rows.length === 0) throw new OrganizerInputError("There are no active to-do groups.", 404);
      const activeGroupIds = new Set(rows.map((row) => Number(row.todo_group_id)));
      if (orderedGroupIds.some((id) => !activeGroupIds.has(id))) {
        throw new OrganizerInputError("Every reordered group must be active.", 409);
      }

      const reorderedSet = new Set(orderedGroupIds);
      let reorderedIndex = 0;
      const completeOrder = rows.map((row) => {
        const id = Number(row.todo_group_id);
        return reorderedSet.has(id) ? orderedGroupIds[reorderedIndex++] : id;
      });
      const updatedAt = new Date().toISOString();
      const update = this.database.prepare(`
        UPDATE todo_groups
        SET sort_position = ?, updated_at_utc = ?
        WHERE todo_group_id = ? AND archived_at_utc IS NULL
      `);
      completeOrder.forEach((id, index) => update.run((index + 1) * 10, updatedAt, id));
      this.#activity({
        eventType: "personal_todo_group.reordered",
        status: "complete",
        name: "Personal to-do groups reordered",
        subjectType: "todo_group_order",
        subjectId: "active",
        contentText: `Reordered ${completeOrder.length} groups`,
        payload: { orderedGroupIds: completeOrder },
      });
      this.database.exec("COMMIT");
      return this.listTodoGroups();
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listLogTrackers({ groupId = null, includeArchived = false, limit = 200 } = {}) {
    const conditions = [];
    const values = [];
    if (!includeArchived) {
      conditions.push("tracker.archived_at_utc IS NULL");
      conditions.push("log_group.archived_at_utc IS NULL");
    }
    if (groupId != null && groupId !== "") {
      conditions.push("tracker.log_group_id = ?");
      values.push(identifier(groupId, "log group id"));
    }
    const boundedLimit = integer(limit, "limit", { fallback: 200, minimum: 1, maximum: 500 });
    return this.database.prepare(`
      SELECT tracker.*, log_group.name AS group_name,
             log_group.archived_at_utc AS group_archived_at_utc,
             COUNT(entry.log_entry_id) AS entry_count,
             MAX(entry.occurred_at_utc) AS last_logged_at_utc
      FROM trackers AS tracker
      JOIN log_groups AS log_group USING (log_group_id)
      LEFT JOIN log_entries AS entry USING (tracker_id)
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      GROUP BY tracker.tracker_id
      ORDER BY log_group.name COLLATE NOCASE, tracker.name COLLATE NOCASE
      LIMIT ?
    `).all(...values, boundedLimit).map(publicLogTracker);
  }

  listLogEntries({ trackerId = null, groupId = null, limit = 200 } = {}) {
    const conditions = [];
    const values = [];
    if (trackerId != null && trackerId !== "") {
      conditions.push("entry.tracker_id = ?");
      values.push(identifier(trackerId, "tracker id"));
    }
    if (groupId != null && groupId !== "") {
      conditions.push("tracker.log_group_id = ?");
      values.push(identifier(groupId, "log group id"));
    }
    const boundedLimit = integer(limit, "limit", { fallback: 200, minimum: 1, maximum: 500 });
    return this.database.prepare(`
      SELECT entry.*, tracker.name AS tracker_name, tracker.log_group_id,
             log_group.name AS group_name
      FROM log_entries AS entry
      JOIN trackers AS tracker USING (tracker_id)
      JOIN log_groups AS log_group USING (log_group_id)
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY entry.occurred_at_utc DESC, entry.log_entry_id DESC
      LIMIT ?
    `).all(...values, boundedLimit).map(publicLogEntry);
  }

  createLogEntry(input) {
    const trackerId = input?.trackerId == null || input.trackerId === ""
      ? null
      : identifier(input.trackerId, "tracker id");
    const trackerName = trackerId == null ? requiredText(input?.trackerName, "trackerName", 200) : null;
    const groupName = optionalText(input?.groupName, "groupName", 200) ?? "General";
    const contentText = requiredText(input?.contentText, "contentText", 10_000);
    const numberValue = optionalFiniteNumber(input?.numberValue, "numberValue");
    const suppliedUnit = optionalText(input?.unit, "unit", 100);
    if (suppliedUnit !== null && numberValue === null) {
      throw new OrganizerInputError("unit requires a numeric value.");
    }
    const occurredAtUtc = isoDateTime(
      input?.occurredAtUtc ?? new Date().toISOString(),
      "occurredAtUtc",
      { required: true },
    );
    const now = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      let tracker = trackerId == null
        ? this.database.prepare(`
          SELECT tracker.*, log_group.name AS group_name,
                 log_group.archived_at_utc AS group_archived_at_utc
          FROM trackers AS tracker
          JOIN log_groups AS log_group USING (log_group_id)
          WHERE tracker.name = ? COLLATE NOCASE
        `).get(trackerName)
        : this.database.prepare(`
          SELECT tracker.*, log_group.name AS group_name,
                 log_group.archived_at_utc AS group_archived_at_utc
          FROM trackers AS tracker
          JOIN log_groups AS log_group USING (log_group_id)
          WHERE tracker.tracker_id = ?
        `).get(trackerId);

      if (!tracker) {
        if (trackerId !== null) throw new OrganizerInputError("Tracker not found.", 404);
        let group = this.database.prepare(
          "SELECT * FROM log_groups WHERE name = ? COLLATE NOCASE",
        ).get(groupName);
        if (!group) {
          group = this.database.prepare(`
            INSERT INTO log_groups (name, updated_at_utc) VALUES (?, ?) RETURNING *
          `).get(groupName, now);
        } else if (group.archived_at_utc !== null) {
          group = this.database.prepare(`
            UPDATE log_groups SET archived_at_utc = NULL, updated_at_utc = ?
            WHERE log_group_id = ? RETURNING *
          `).get(now, group.log_group_id);
        }
        const created = this.database.prepare(`
          INSERT INTO trackers (log_group_id, name, default_unit, updated_at_utc)
          VALUES (?, ?, ?, ?) RETURNING *
        `).get(group.log_group_id, trackerName, suppliedUnit, now);
        tracker = {
          ...created,
          group_name: group.name,
          group_archived_at_utc: group.archived_at_utc,
        };
      } else {
        if (tracker.archived_at_utc !== null || (tracker.default_unit === null && suppliedUnit !== null)) {
          this.database.prepare(`
            UPDATE trackers
            SET archived_at_utc = NULL,
                default_unit = COALESCE(default_unit, ?),
                updated_at_utc = ?
            WHERE tracker_id = ?
          `).run(suppliedUnit, now, tracker.tracker_id);
        }
        if (tracker.group_archived_at_utc !== null) {
          this.database.prepare(`
            UPDATE log_groups SET archived_at_utc = NULL, updated_at_utc = ?
            WHERE log_group_id = ?
          `).run(now, tracker.log_group_id);
        }
        tracker = this.database.prepare(`
          SELECT tracker.*, log_group.name AS group_name,
                 log_group.archived_at_utc AS group_archived_at_utc
          FROM trackers AS tracker
          JOIN log_groups AS log_group USING (log_group_id)
          WHERE tracker.tracker_id = ?
        `).get(tracker.tracker_id);
      }

      const unit = numberValue === null ? null : suppliedUnit ?? tracker.default_unit;
      const result = this.database.prepare(`
        INSERT INTO log_entries (
          tracker_id, occurred_at_utc, content_text, number_value, unit, updated_at_utc, source
        ) VALUES (?, ?, ?, ?, ?, ?, 'tailnet_web')
      `).run(tracker.tracker_id, occurredAtUtc, contentText, numberValue, unit, now);
      const id = Number(result.lastInsertRowid);
      const entry = publicLogEntry(this.database.prepare(`
        SELECT entry.*, tracker.name AS tracker_name, tracker.log_group_id,
               log_group.name AS group_name
        FROM log_entries AS entry
        JOIN trackers AS tracker USING (tracker_id)
        JOIN log_groups AS log_group USING (log_group_id)
        WHERE entry.log_entry_id = ?
      `).get(id));
      const eventId = this.#activity({
        eventType: "personal_log.created",
        status: "complete",
        name: "Personal log recorded",
        subjectType: "log_entry",
        subjectId: id,
        contentText: entry.contentText,
        payload: { logEntry: entry },
      });
      this.database.prepare("UPDATE log_entries SET source_event_id = ? WHERE log_entry_id = ?")
        .run(eventId, id);
      this.database.exec("COMMIT");
      return entry;
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (String(error?.message).includes("UNIQUE constraint failed: trackers.name")) {
        throw new OrganizerInputError("A tracker with that name already exists.", 409);
      }
      throw error;
    }
  }

  createCalendar(input) {
    const event = {
      title: requiredText(input?.title, "title"),
      description: optionalText(input?.description, "description"),
      location: optionalText(input?.location, "location", 1000),
      startsAtUtc: isoDateTime(input?.startsAtUtc, "startsAtUtc", { required: true }),
      endsAtUtc: isoDateTime(input?.endsAtUtc, "endsAtUtc"),
      timeZone: timeZone(input?.timeZone),
      isAllDay: booleanInteger(input?.isAllDay),
      status: enumValue(input?.status, calendarStatuses, "status", "active"),
      recurrenceRule: optionalText(input?.recurrenceRule, "recurrenceRule", 2000),
    };
    if (event.endsAtUtc && event.endsAtUtc < event.startsAtUtc) {
      throw new OrganizerInputError("endsAtUtc cannot be earlier than startsAtUtc.");
    }
    if (event.recurrenceRule) {
      try {
        nextOccurrence(event, new Date(new Date(event.startsAtUtc).getTime() - 1000).toISOString());
      } catch {
        throw new OrganizerInputError("recurrenceRule must be a valid RRULE.");
      }
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`
        INSERT INTO calendar_events (
          title, description, location_text, starts_at_utc, ends_at_utc,
          time_zone, is_all_day, status, recurrence_rule
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.title, event.description, event.location, event.startsAtUtc, event.endsAtUtc,
        event.timeZone, event.isAllDay, event.status === "active" ? "confirmed" : "cancelled",
        event.recurrenceRule,
      );
      const id = Number(result.lastInsertRowid);
      const created = this.getCalendar(id);
      const eventId = this.#activity({
        eventType: "calendar.event.created",
        status: created.status,
        name: "Calendar event created",
        subjectType: "calendar_event",
        subjectId: id,
        contentText: created.title,
        payload: { calendarEvent: created },
      });
      this.database.prepare("UPDATE calendar_events SET source_event_id = ? WHERE calendar_event_id = ?")
        .run(eventId, id);
      this.database.exec("COMMIT");
      return this.getCalendar(id);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getCalendar(id) {
    return publicCalendarEvent(this.database.prepare(
      "SELECT * FROM calendar_events WHERE calendar_event_id = ?",
    ).get(identifier(id, "calendar event id")));
  }

  updateCalendar(idValue, input) {
    const id = identifier(idValue, "calendar event id");
    const before = this.getCalendar(id);
    if (!before) throw new OrganizerInputError("Calendar event not found.", 404);
    if (input?.version !== before.version) {
      throw new OrganizerInputError("This calendar event changed after you opened it. Refresh and try again.", 409);
    }
    const after = {
      ...before,
      title: input.title === undefined ? before.title : requiredText(input.title, "title"),
      description: input.description === undefined ? before.description : optionalText(input.description, "description"),
      location: input.location === undefined ? before.location : optionalText(input.location, "location", 1000),
      startsAtUtc: input.startsAtUtc === undefined
        ? before.startsAtUtc
        : isoDateTime(input.startsAtUtc, "startsAtUtc", { required: true }),
      endsAtUtc: input.endsAtUtc === undefined ? before.endsAtUtc : isoDateTime(input.endsAtUtc, "endsAtUtc"),
      timeZone: input.timeZone === undefined ? before.timeZone : timeZone(input.timeZone),
      isAllDay: input.isAllDay === undefined ? before.isAllDay : Boolean(booleanInteger(input.isAllDay)),
      status: input.status === undefined
        ? before.status
        : enumValue(input.status, calendarStatuses, "status", before.status),
      recurrenceRule: input.recurrenceRule === undefined
        ? before.recurrenceRule
        : optionalText(input.recurrenceRule, "recurrenceRule", 2000),
    };
    if (after.endsAtUtc && after.endsAtUtc < after.startsAtUtc) {
      throw new OrganizerInputError("endsAtUtc cannot be earlier than startsAtUtc.");
    }
    if (after.recurrenceRule) {
      try {
        nextOccurrence(after, new Date(new Date(after.startsAtUtc).getTime() - 1000).toISOString());
      } catch {
        throw new OrganizerInputError("recurrenceRule must be a valid RRULE.");
      }
    }
    const changes = changedFields(before, after, [
      "title", "description", "location", "startsAtUtc", "endsAtUtc", "timeZone", "isAllDay", "status",
      "recurrenceRule",
    ]);
    if (Object.keys(changes).length === 0) return before;
    const updatedAt = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`
        UPDATE calendar_events
        SET title = ?, description = ?, location_text = ?, starts_at_utc = ?, ends_at_utc = ?,
            time_zone = ?, is_all_day = ?, status = ?, recurrence_rule = ?, updated_at_utc = ?
        WHERE calendar_event_id = ?
          AND COALESCE(updated_at_utc, created_at_utc) = ?
      `).run(
        after.title, after.description, after.location, after.startsAtUtc, after.endsAtUtc,
        after.timeZone, after.isAllDay ? 1 : 0,
        after.status === "active" ? "confirmed" : "cancelled", after.recurrenceRule,
        updatedAt, id, before.version,
      );
      if (result.changes !== 1) {
        throw new OrganizerInputError("This calendar event changed while you were saving it. Refresh and try again.", 409);
      }
      this.#activity({
        eventType: "calendar.event.updated",
        status: after.status,
        name: "Calendar event updated",
        subjectType: "calendar_event",
        subjectId: id,
        contentText: after.title,
        payload: { changes },
      });
      this.database.exec("COMMIT");
      return this.getCalendar(id);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createTodo(input) {
    const todo = {
      groupId: input?.groupId == null ? null : identifier(input.groupId, "group id"),
      sequence: optionalPositiveInteger(input?.sequence, "sequence"),
      relatedContactId: input?.relatedContactId == null
        ? null
        : identifier(input.relatedContactId, "related contact id"),
      text: requiredText(input?.text, "text", 10_000),
      status: enumValue(input?.status, todoStatuses, "status", "todo"),
      scheduledAtUtc: isoDateTime(input?.scheduledAtUtc, "scheduledAtUtc"),
      isAllDay: Boolean(booleanInteger(input?.isAllDay)),
      dueAtUtc: isoDateTime(input?.dueAtUtc, "dueAtUtc"),
      recurrenceRule: optionalText(input?.recurrenceRule, "recurrenceRule", 2000),
      recurrenceTimeZone: timeZone(input?.recurrenceTimeZone) ?? defaultCalendarTimeZone,
    };
    const groupId = todo.groupId ?? this.database.prepare(
      "SELECT todo_group_id FROM todo_groups WHERE name = 'Inbox' COLLATE NOCASE",
    ).get()?.todo_group_id;
    if (!groupId || !this.database.prepare(
      "SELECT 1 FROM todo_groups WHERE todo_group_id = ? AND archived_at_utc IS NULL",
    ).get(groupId)) throw new OrganizerInputError("To-do group not found.", 404);
    if (todo.recurrenceRule && !todo.scheduledAtUtc) {
      throw new OrganizerInputError("A routine requires a scheduled date and time.");
    }
    if (todo.isAllDay && !todo.scheduledAtUtc) {
      throw new OrganizerInputError("An all-day to-do requires a scheduled date.");
    }
    if (todo.scheduledAtUtc && todo.dueAtUtc && todo.dueAtUtc < todo.scheduledAtUtc) {
      throw new OrganizerInputError("dueAtUtc cannot be earlier than scheduledAtUtc.");
    }
    if (todo.recurrenceRule) {
      try {
        nextOccurrence({
          startsAtUtc: todo.scheduledAtUtc,
          timeZone: todo.recurrenceTimeZone,
          recurrenceRule: todo.recurrenceRule,
        }, new Date(new Date(todo.scheduledAtUtc).getTime() - 1000).toISOString());
      } catch {
        throw new OrganizerInputError("recurrenceRule must be a valid RRULE.");
      }
    }
    const completedAtUtc = todo.status === "complete" ? new Date().toISOString() : null;

    this.database.exec("BEGIN IMMEDIATE");
    try {
      let routineId = null;
      if (todo.recurrenceRule) {
        const routine = this.database.prepare(`
          INSERT INTO todo_routines (
            todo_group_id, text, first_scheduled_at_utc, first_due_at_utc,
            time_zone, is_all_day, recurrence_rule
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          groupId, todo.text, todo.scheduledAtUtc, todo.dueAtUtc,
          todo.recurrenceTimeZone, todo.isAllDay ? 1 : 0, todo.recurrenceRule,
        );
        routineId = Number(routine.lastInsertRowid);
      }
      const sortPosition = Number(this.database.prepare(`
        SELECT COALESCE(MAX(sort_position), 0) + 10 AS next_position
        FROM personal_tasks
        WHERE todo_group_id = ?
      `).get(groupId).next_position);
      const result = this.database.prepare(`
        INSERT INTO personal_tasks (
          todo_group_id, todo_routine_id, sequence, related_contact_id, text,
          status, sort_position, scheduled_at_utc, is_all_day, due_at_utc, completed_at_utc, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tailnet_web')
      `).run(
        groupId, routineId, todo.sequence, todo.relatedContactId, todo.text,
        todo.status, sortPosition, todo.scheduledAtUtc, todo.isAllDay ? 1 : 0,
        todo.dueAtUtc, completedAtUtc,
      );
      const id = Number(result.lastInsertRowid);
      const created = this.getTodo(id);
      const eventId = this.#activity({
        eventType: "personal_todo.created",
        status: created.status,
        name: "Personal todo created",
        subjectType: "personal_task",
        subjectId: id,
        contentText: created.text,
        payload: { personalTodo: created },
      });
      this.database.prepare(
        "UPDATE personal_tasks SET source_event_id = ? WHERE personal_task_id = ?",
      ).run(eventId, id);
      this.database.exec("COMMIT");
      return this.getTodo(id);
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (String(error?.message).includes("personal_tasks.todo_group_id, personal_tasks.sequence")) {
        throw new OrganizerInputError("That sequence is already used in this to-do group.", 409);
      }
      throw error;
    }
  }

  getTodo(id) {
    return publicTodo(this.database.prepare(
      `SELECT task.*, todo_group.name AS group_name,
              todo_group.archived_at_utc AS group_archived_at_utc,
              routine.recurrence_rule AS routine_recurrence_rule,
              routine.time_zone AS routine_time_zone
       FROM personal_tasks AS task
       JOIN todo_groups AS todo_group USING (todo_group_id)
       LEFT JOIN todo_routines AS routine USING (todo_routine_id)
       WHERE task.personal_task_id = ?`,
    ).get(identifier(id, "todo id")));
  }

  #generateNextRoutine(todo) {
    const id = generateNextRoutineTask(this.database, todo.id);
    if (!id) return null;
    const generated = this.getTodo(id);
    const sourceEventId = this.#activity({
      eventType: "personal_todo.generated",
      status: generated.status,
      name: "Routine task generated",
      subjectType: "personal_task",
      subjectId: id,
      contentText: generated.text,
      payload: { personalTodo: generated, routineId: todo.routineId },
      actorType: "system",
      actorName: "Slayer routine scheduler",
      source: "todo_routine",
    });
    this.database.prepare(
      "UPDATE personal_tasks SET source_event_id = ? WHERE personal_task_id = ?",
    ).run(sourceEventId, id);
    return this.getTodo(id);
  }

  reorderTodos(groupIdValue, input) {
    const groupId = identifier(groupIdValue, "to-do group id");
    if (!Array.isArray(input?.orderedTodoIds) || input.orderedTodoIds.length === 0) {
      throw new OrganizerInputError("orderedTodoIds must contain at least one to-do id.");
    }
    const orderedTodoIds = input.orderedTodoIds.map((value) => identifier(value, "todo id"));
    if (new Set(orderedTodoIds).size !== orderedTodoIds.length) {
      throw new OrganizerInputError("orderedTodoIds cannot contain duplicates.");
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.database.prepare(`
        SELECT personal_task_id
        FROM personal_tasks
        WHERE todo_group_id = ?
        ORDER BY sort_position, personal_task_id
      `).all(groupId);
      if (rows.length === 0) throw new OrganizerInputError("To-do group has no tasks.", 404);
      const groupTodoIds = new Set(rows.map((row) => Number(row.personal_task_id)));
      if (orderedTodoIds.some((id) => !groupTodoIds.has(id))) {
        throw new OrganizerInputError("Every reordered todo must belong to the selected group.", 409);
      }

      const reorderedSet = new Set(orderedTodoIds);
      let reorderedIndex = 0;
      const completeOrder = rows.map((row) => {
        const id = Number(row.personal_task_id);
        return reorderedSet.has(id) ? orderedTodoIds[reorderedIndex++] : id;
      });
      const updatedAt = new Date().toISOString();
      const update = this.database.prepare(`
        UPDATE personal_tasks
        SET sort_position = ?, updated_at_utc = ?
        WHERE personal_task_id = ? AND todo_group_id = ?
      `);
      completeOrder.forEach((id, index) => update.run((index + 1) * 10, updatedAt, id, groupId));
      this.#activity({
        eventType: "personal_todo.reordered",
        status: "complete",
        name: "Personal todos reordered",
        subjectType: "todo_group",
        subjectId: groupId,
        contentText: `Reordered ${completeOrder.length} tasks`,
        payload: { orderedTodoIds: completeOrder },
      });
      this.database.exec("COMMIT");
      return completeOrder.map((id) => this.getTodo(id));
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  updateTodo(idValue, input) {
    const id = identifier(idValue, "todo id");
    const before = this.getTodo(id);
    if (!before) throw new OrganizerInputError("Todo not found.", 404);
    if (input?.version !== before.version) {
      throw new OrganizerInputError("This todo changed after you opened it. Refresh and try again.", 409);
    }
    const requestedRecurrenceRule = input.recurrenceRule === undefined
      ? before.recurrenceRule
      : optionalText(input.recurrenceRule, "recurrenceRule", 2000);
    const requestedRecurrenceTimeZone = input.recurrenceTimeZone === undefined
      ? before.recurrenceTimeZone
      : timeZone(input.recurrenceTimeZone);
    const after = {
      ...before,
      groupId: input.groupId === undefined ? before.groupId : identifier(input.groupId, "group id"),
      sequence: input.sequence === undefined ? before.sequence : optionalPositiveInteger(input.sequence, "sequence"),
      relatedContactId: input.relatedContactId === undefined
        ? before.relatedContactId
        : (input.relatedContactId == null ? null : identifier(input.relatedContactId, "related contact id")),
      text: input.text === undefined ? before.text : requiredText(input.text, "text", 10_000),
      status: input.status === undefined
        ? before.status
        : enumValue(input.status, todoStatuses, "status", before.status),
      sortPosition: input.sortPosition === undefined
        ? before.sortPosition
        : integer(input.sortPosition, "sortPosition", { minimum: -1_000_000_000, maximum: 1_000_000_000 }),
      scheduledAtUtc: input.scheduledAtUtc === undefined
        ? before.scheduledAtUtc
        : isoDateTime(input.scheduledAtUtc, "scheduledAtUtc"),
      isAllDay: input.isAllDay === undefined
        ? before.isAllDay
        : Boolean(booleanInteger(input.isAllDay)),
      dueAtUtc: input.dueAtUtc === undefined ? before.dueAtUtc : isoDateTime(input.dueAtUtc, "dueAtUtc"),
      recurrenceRule: requestedRecurrenceRule,
      recurrenceTimeZone: requestedRecurrenceRule
        ? (requestedRecurrenceTimeZone ?? defaultCalendarTimeZone)
        : null,
    };
    if (!this.database.prepare(
      "SELECT 1 FROM todo_groups WHERE todo_group_id = ? AND archived_at_utc IS NULL",
    ).get(after.groupId)) throw new OrganizerInputError("To-do group not found.", 404);
    if (after.scheduledAtUtc && after.dueAtUtc && after.dueAtUtc < after.scheduledAtUtc) {
      throw new OrganizerInputError("dueAtUtc cannot be earlier than scheduledAtUtc.");
    }
    if (after.isAllDay && !after.scheduledAtUtc) {
      throw new OrganizerInputError("An all-day to-do requires a scheduled date.");
    }
    if (after.recurrenceRule && !after.scheduledAtUtc) {
      throw new OrganizerInputError("A routine requires a scheduled date and time.");
    }
    if (after.recurrenceRule) {
      try {
        nextOccurrence({
          startsAtUtc: after.scheduledAtUtc,
          timeZone: after.recurrenceTimeZone,
          recurrenceRule: after.recurrenceRule,
        }, new Date(new Date(after.scheduledAtUtc).getTime() - 1000).toISOString());
      } catch {
        throw new OrganizerInputError("recurrenceRule must be a valid RRULE.");
      }
    }
    if (after.status === "complete" && before.status !== "complete") after.completedAtUtc = new Date().toISOString();
    if (after.status !== "complete" && before.status === "complete") after.completedAtUtc = null;
    const changes = changedFields(before, after, [
      "groupId", "sequence", "relatedContactId", "text", "status", "sortPosition",
      "scheduledAtUtc", "isAllDay", "dueAtUtc", "completedAtUtc", "recurrenceRule", "recurrenceTimeZone",
    ]);
    if (Object.keys(changes).length === 0) return before;
    const updatedAt = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`
        UPDATE personal_tasks
        SET todo_group_id = ?, sequence = ?, related_contact_id = ?, text = ?, status = ?,
            sort_position = ?, scheduled_at_utc = ?, is_all_day = ?, due_at_utc = ?,
            completed_at_utc = ?, updated_at_utc = ?
        WHERE personal_task_id = ?
          AND COALESCE(updated_at_utc, created_at_utc) = ?
      `).run(
        after.groupId, after.sequence, after.relatedContactId, after.text, after.status,
        after.sortPosition, after.scheduledAtUtc, after.isAllDay ? 1 : 0, after.dueAtUtc,
        after.completedAtUtc, updatedAt, id, before.version,
      );
      if (result.changes !== 1) {
        throw new OrganizerInputError("This todo changed while you were saving it. Refresh and try again.", 409);
      }
      if (after.recurrenceRule && before.routineId) {
        this.database.prepare(`
          UPDATE todo_routines
          SET todo_group_id = ?, text = ?, first_scheduled_at_utc = ?, first_due_at_utc = ?,
              time_zone = ?, is_all_day = ?, recurrence_rule = ?, disabled_at_utc = NULL, updated_at_utc = ?
          WHERE todo_routine_id = ?
        `).run(
          after.groupId, after.text, after.scheduledAtUtc, after.dueAtUtc,
          after.recurrenceTimeZone, after.isAllDay ? 1 : 0,
          after.recurrenceRule, updatedAt, before.routineId,
        );
      } else if (after.recurrenceRule) {
        const routine = this.database.prepare(`
          INSERT INTO todo_routines (
            todo_group_id, text, first_scheduled_at_utc, first_due_at_utc,
            time_zone, is_all_day, recurrence_rule
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          after.groupId, after.text, after.scheduledAtUtc, after.dueAtUtc,
          after.recurrenceTimeZone, after.isAllDay ? 1 : 0, after.recurrenceRule,
        );
        this.database.prepare(`
          UPDATE personal_tasks SET todo_routine_id = ? WHERE personal_task_id = ?
        `).run(Number(routine.lastInsertRowid), id);
      } else if (before.routineId) {
        this.database.prepare(`
          UPDATE todo_routines SET disabled_at_utc = ?, updated_at_utc = ?
          WHERE todo_routine_id = ?
        `).run(updatedAt, updatedAt, before.routineId);
        this.database.prepare(`
          UPDATE personal_tasks SET todo_routine_id = NULL WHERE personal_task_id = ?
        `).run(id);
      }
      this.#activity({
        eventType: "personal_todo.updated",
        status: after.status,
        name: "Personal todo updated",
        subjectType: "personal_task",
        subjectId: id,
        contentText: after.text,
        payload: { changes },
      });
      if (["complete", "ignore"].includes(after.status) && !["complete", "ignore"].includes(before.status)) {
        this.#generateNextRoutine(this.getTodo(id));
      }
      this.database.exec("COMMIT");
      return this.getTodo(id);
    } catch (error) {
      this.database.exec("ROLLBACK");
      if (String(error?.message).includes("personal_tasks.todo_group_id, personal_tasks.sequence")) {
        throw new OrganizerInputError("That sequence is already used in this to-do group.", 409);
      }
      throw error;
    }
  }
}
