import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import rrulePackage from "rrule";
import { redactText, safeJson } from "./redaction.mjs";

const { rrulestr } = rrulePackage;
const dayMilliseconds = 86_400_000;
const defaultCalendarTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const calendarStatuses = new Set(["tentative", "confirmed", "cancelled", "completed"]);
const todoStatuses = new Set(["todo", "complete", "ignore", "archive", "ai_suggested"]);

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
  const zone = event.timeZone && !event.isAllDay ? event.timeZone : null;
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
    status: row.status,
    recurrenceRule: row.recurrence_rule,
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
    status: "confirmed",
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
    routineId: row.todo_routine_id,
    sequence: row.sequence,
    relatedContactId: row.related_contact_id,
    text: row.text,
    status: row.status,
    sortPosition: row.sort_position,
    scheduledAtUtc: row.scheduled_at_utc,
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
    archivedAtUtc: row.archived_at_utc,
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
      scheduled_at_utc, due_at_utc, source
    ) VALUES (?, ?, ?, 'todo', ?, ?, ?, 'routine')
    ON CONFLICT (todo_routine_id, scheduled_at_utc) WHERE
      todo_routine_id IS NOT NULL AND scheduled_at_utc IS NOT NULL
    DO NOTHING
  `).run(
    routine.todo_group_id, routine.todo_routine_id, routine.text, sortPosition,
    scheduled.toISOString(), dueAtUtc,
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

  listCalendar({ from, to }) {
    const fromUtc = isoDateTime(from, "from", { required: true });
    const toUtc = isoDateTime(to, "to", { required: true });
    if (fromUtc >= toUtc) throw new OrganizerInputError("to must be later than from.");
    const rangeMs = new Date(toUtc).getTime() - new Date(fromUtc).getTime();
    if (rangeMs > 370 * 86_400_000) throw new OrganizerInputError("Calendar ranges are limited to 370 days.");
    const ordinary = this.database.prepare(`
      SELECT *
      FROM calendar_events
      WHERE status <> 'cancelled'
        AND recurrence_rule IS NULL
        AND starts_at_utc < ?
        AND COALESCE(ends_at_utc, starts_at_utc) >= ?
      ORDER BY starts_at_utc, calendar_event_id
      LIMIT 2000
    `).all(toUtc, fromUtc).map(publicCalendarEvent);

    const masters = this.database.prepare(`
      SELECT *
      FROM calendar_events
      WHERE status <> 'cancelled'
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
             routine.recurrence_rule AS routine_recurrence_rule,
             routine.time_zone AS routine_time_zone
      FROM personal_tasks AS task
      JOIN todo_groups AS todo_group USING (todo_group_id)
      LEFT JOIN todo_routines AS routine USING (todo_routine_id)
      ${where}
      ORDER BY
        todo_group.name COLLATE NOCASE,
        task.sort_position,
        task.personal_task_id
      LIMIT ?
    `).all(boundedLimit).map(publicTodo);
  }

  listTodoGroups({ includeArchived = false } = {}) {
    return this.database.prepare(`
      SELECT *
      FROM todo_groups
      ${includeArchived ? "" : "WHERE archived_at_utc IS NULL"}
      ORDER BY name COLLATE NOCASE, todo_group_id
    `).all().map(publicTodoGroup);
  }

  createTodoGroup(input) {
    const name = requiredText(input?.name, "name", 10_000);
    const now = new Date().toISOString();
    try {
      const result = this.database.prepare(`
        INSERT INTO todo_groups (name, created_at_utc)
        VALUES (?, ?)
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

  createCalendar(input) {
    const event = {
      title: requiredText(input?.title, "title"),
      description: optionalText(input?.description, "description"),
      location: optionalText(input?.location, "location", 1000),
      startsAtUtc: isoDateTime(input?.startsAtUtc, "startsAtUtc", { required: true }),
      endsAtUtc: isoDateTime(input?.endsAtUtc, "endsAtUtc"),
      timeZone: timeZone(input?.timeZone),
      isAllDay: booleanInteger(input?.isAllDay),
      status: enumValue(input?.status, calendarStatuses, "status", "confirmed"),
    };
    if (event.endsAtUtc && event.endsAtUtc < event.startsAtUtc) {
      throw new OrganizerInputError("endsAtUtc cannot be earlier than startsAtUtc.");
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`
        INSERT INTO calendar_events (
          title, description, location_text, starts_at_utc, ends_at_utc,
          time_zone, is_all_day, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.title, event.description, event.location, event.startsAtUtc, event.endsAtUtc,
        event.timeZone, event.isAllDay, event.status,
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
    };
    if (after.endsAtUtc && after.endsAtUtc < after.startsAtUtc) {
      throw new OrganizerInputError("endsAtUtc cannot be earlier than startsAtUtc.");
    }
    const changes = changedFields(before, after, [
      "title", "description", "location", "startsAtUtc", "endsAtUtc", "timeZone", "isAllDay", "status",
    ]);
    if (Object.keys(changes).length === 0) return before;
    const updatedAt = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`
        UPDATE calendar_events
        SET title = ?, description = ?, location_text = ?, starts_at_utc = ?, ends_at_utc = ?,
            time_zone = ?, is_all_day = ?, status = ?, updated_at_utc = ?
        WHERE calendar_event_id = ?
          AND COALESCE(updated_at_utc, created_at_utc) = ?
      `).run(
        after.title, after.description, after.location, after.startsAtUtc, after.endsAtUtc,
        after.timeZone, after.isAllDay ? 1 : 0, after.status, updatedAt, id, before.version,
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
            time_zone, recurrence_rule
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          groupId, todo.text, todo.scheduledAtUtc, todo.dueAtUtc,
          todo.recurrenceTimeZone, todo.recurrenceRule,
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
          status, sort_position, scheduled_at_utc, due_at_utc, completed_at_utc, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'tailnet_web')
      `).run(
        groupId, routineId, todo.sequence, todo.relatedContactId, todo.text,
        todo.status, sortPosition, todo.scheduledAtUtc, todo.dueAtUtc, completedAtUtc,
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

  updateTodo(idValue, input) {
    const id = identifier(idValue, "todo id");
    const before = this.getTodo(id);
    if (!before) throw new OrganizerInputError("Todo not found.", 404);
    if (input?.version !== before.version) {
      throw new OrganizerInputError("This todo changed after you opened it. Refresh and try again.", 409);
    }
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
      dueAtUtc: input.dueAtUtc === undefined ? before.dueAtUtc : isoDateTime(input.dueAtUtc, "dueAtUtc"),
    };
    if (!this.database.prepare(
      "SELECT 1 FROM todo_groups WHERE todo_group_id = ? AND archived_at_utc IS NULL",
    ).get(after.groupId)) throw new OrganizerInputError("To-do group not found.", 404);
    if (after.scheduledAtUtc && after.dueAtUtc && after.dueAtUtc < after.scheduledAtUtc) {
      throw new OrganizerInputError("dueAtUtc cannot be earlier than scheduledAtUtc.");
    }
    if (after.status === "complete" && before.status !== "complete") after.completedAtUtc = new Date().toISOString();
    if (after.status !== "complete" && before.status === "complete") after.completedAtUtc = null;
    const changes = changedFields(before, after, [
      "groupId", "sequence", "relatedContactId", "text", "status", "sortPosition",
      "scheduledAtUtc", "dueAtUtc", "completedAtUtc",
    ]);
    if (Object.keys(changes).length === 0) return before;
    const updatedAt = new Date().toISOString();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = this.database.prepare(`
        UPDATE personal_tasks
        SET todo_group_id = ?, sequence = ?, related_contact_id = ?, text = ?, status = ?,
            sort_position = ?, scheduled_at_utc = ?, due_at_utc = ?,
            completed_at_utc = ?, updated_at_utc = ?
        WHERE personal_task_id = ?
          AND COALESCE(updated_at_utc, created_at_utc) = ?
      `).run(
        after.groupId, after.sequence, after.relatedContactId, after.text, after.status,
        after.sortPosition, after.scheduledAtUtc, after.dueAtUtc,
        after.completedAtUtc, updatedAt, id, before.version,
      );
      if (result.changes !== 1) {
        throw new OrganizerInputError("This todo changed while you were saving it. Refresh and try again.", 409);
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

