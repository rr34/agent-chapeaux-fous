import {
  buildRecurrenceRule, recurrenceSchema, validateTimeZone,
} from "../todo-recurrence.mjs";
import { searchCalendarEventRows } from "../calendar-search.mjs";
import { selectedFields, withSchemaProjection } from "./schema-result.mjs";

const statuses = ["tentative", "confirmed", "cancelled", "completed"];
const calendarEventFields = [
  "calendar_event_id", "ical_uid", "ical_recurrence_id", "title", "description",
  "location_text", "starts_at_utc", "ends_at_utc", "time_zone", "is_all_day",
  "status", "recurrence_rule", "source_event_id", "created_at_utc", "updated_at_utc",
];
const contactFields = ["contact_id", "display_name", "birth_date"];
const optionalText = { type: ["string", "null"] };

const calendarProjection = {
  schemaObjects: ["calendar_events"],
  fields: { calendar_events: calendarEventFields },
};

function calendarResult(schemaSemantics, context, result, { name, purpose, contacts = false }) {
  return withSchemaProjection(schemaSemantics, context, result, {
    name,
    purpose,
    schemaObjects: contacts ? ["calendar_events", "contacts"] : calendarProjection.schemaObjects,
    fields: contacts
      ? { ...calendarProjection.fields, contacts: contactFields }
      : calendarProjection.fields,
  });
}

function normalizedIso(value, label, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  const parsed = new Date(value);
  if (typeof value !== "string" || !Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} must be an ISO-8601 date-time`);
  }
  return parsed.toISOString();
}

function normalizedText(value, label, maximum, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${label} must be text`);
  const result = value.trim();
  if (!result && required) throw new Error(`${label} is required`);
  return result.slice(0, maximum) || null;
}

function calendarEvent(database, id) {
  return selectedFields(database.prepare(
    "SELECT * FROM calendar_events WHERE calendar_event_id = ?",
  ).get(id), calendarEventFields);
}

function requireCalendarEvent(database, id) {
  const row = calendarEvent(database, id);
  if (!row) throw new Error(`Calendar event ${id} does not exist`);
  return row;
}

function changed(before, after) {
  return Object.fromEntries(Object.keys(after)
    .filter((field) => before[field] !== after[field])
    .map((field) => [field, { before: before[field], after: after[field] }]));
}

function displayOccurrence(database, item) {
  if (item.sourceKind === "contact_birthday") {
    const contact = selectedFields(database.prepare(
      "SELECT contact_id, display_name, birth_date FROM contacts WHERE contact_id = ?",
    ).get(item.contactId), contactFields);
    return {
      calendar_events: null,
      contacts: contact,
      occurrence: {
        source_kind: "contact_birthday",
        display_title: item.title,
        occurrence_starts_at_utc: item.startsAtUtc,
        occurrence_ends_at_utc: item.endsAtUtc,
        is_generated_occurrence: true,
      },
    };
  }
  const id = Number(item.seriesId ?? item.id);
  return {
    calendar_events: calendarEvent(database, id),
    contacts: null,
    occurrence: {
      source_kind: item.isGeneratedOccurrence ? "recurrence" : "calendar_event",
      occurrence_starts_at_utc: item.startsAtUtc,
      occurrence_ends_at_utc: item.endsAtUtc,
      is_generated_occurrence: Boolean(item.isGeneratedOccurrence),
    },
  };
}

function writeEvent(database, ledger, context, {
  toolName, eventType, eventName, event, before = null,
}) {
  const payload = before ? { before, event, changes: changed(before, event) } : { event };
  const sourceEventId = ledger.append({
    type: eventType,
    status: event.status,
    actorType: "tool",
    actorName: toolName,
    channel: context.channel,
    turnId: context.requestId,
    operationId: context.callId,
    name: eventName,
    content: event.title,
    payload,
    subjectType: "calendar_event",
    subjectId: String(event.calendar_event_id),
  });
  return sourceEventId;
}

export function registerCalendarTools(
  registry, store, organizer, ledger, schemaSemantics = null, searchCoordinator = null,
) {
  registry = registry.withCapability?.("calendar") ?? registry;
  registry.register({
    name: "calendar_event_search",
    description: "Search stored native calendar event series by title, description, and location. Every whitespace-separated query term must match at least one of those fields. Results are stored event records, not expanded recurrence occurrences or derived contact birthdays, and archived events are excluded unless explicitly requested.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200 },
        include_archived: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["query", "include_archived", "limit"],
    },
    async execute({ query, include_archived: includeArchived, limit }, context) {
      const database = store.requireReady();
      const search = searchCoordinator
        ? (await searchCoordinator.searchScope("calendar", {
            query, limit, options: { includeArchived },
          })).native
        : searchCalendarEventRows(database, { query, includeArchived, limit });
      const events = search.rows.map((row) => selectedFields(row, calendarEventFields));
      return calendarResult(schemaSemantics, context, {
        query: search.query,
        include_archived: search.includeArchived,
        count: events.length,
        events,
      }, {
        name: "calendar_event_search",
        purpose: "Return stored calendar event records matching title, description, or location search terms.",
      });
    },
  });

  registry.register({
    name: "calendar_event_list",
    description: "List the user's calendar schedule in an explicit UTC range. Recurring events are expanded into computed occurrences and contact birthdays shown by the calendar are included. Stored records use exact calendar_events field names; occurrence_* fields describe the computed display instance.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        starts_at_utc: { type: "string", description: "Inclusive ISO-8601 UTC range start." },
        ends_at_utc: { type: "string", description: "Exclusive ISO-8601 UTC range end." },
      },
      required: ["starts_at_utc", "ends_at_utc"],
    },
    async execute({ starts_at_utc: startsAtUtc, ends_at_utc: endsAtUtc }, context) {
      const database = store.requireReady();
      const occurrences = organizer.listCalendar({ from: startsAtUtc, to: endsAtUtc })
        .map((item) => displayOccurrence(database, item));
      return calendarResult(schemaSemantics, context, {
        starts_at_utc: normalizedIso(startsAtUtc, "starts_at_utc", { required: true }),
        ends_at_utc: normalizedIso(endsAtUtc, "ends_at_utc", { required: true }),
        count: occurrences.length,
        occurrences,
      }, {
        name: "calendar_event_list",
        purpose: "Return stored calendar event records and computed occurrences visible in the requested schedule range.",
        contacts: true,
      });
    },
  });

  registry.register({
    name: "calendar_event_add",
    description: "Create one native calendar event. Use is_all_day=true when the user names a day without a specific time, with starts_at_utc representing local midnight and time_zone preserving that local date. For repetition, supply structured recurrence concepts; never write RRULE syntax.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 500 },
        description: optionalText,
        location_text: optionalText,
        starts_at_utc: { type: "string" },
        ends_at_utc: optionalText,
        time_zone: optionalText,
        is_all_day: { type: "boolean" },
        status: { type: "string", enum: statuses },
        recurrence: recurrenceSchema,
      },
      required: [
        "title", "description", "location_text", "starts_at_utc", "ends_at_utc",
        "time_zone", "is_all_day", "status", "recurrence",
      ],
    },
    async execute(input, context) {
      const database = store.requireReady();
      const startsAtUtc = normalizedIso(input.starts_at_utc, "starts_at_utc", { required: true });
      const endsAtUtc = normalizedIso(input.ends_at_utc, "ends_at_utc");
      if (endsAtUtc && endsAtUtc < startsAtUtc) {
        throw new Error("ends_at_utc cannot be earlier than starts_at_utc");
      }
      if (!statuses.includes(input.status)) throw new Error("status is invalid");
      let timeZone = input.time_zone ? validateTimeZone(input.time_zone) : null;
      let recurrenceRule = null;
      if (input.recurrence) {
        recurrenceRule = buildRecurrenceRule(input.recurrence);
        const recurrenceTimeZone = validateTimeZone(input.recurrence.time_zone, timeZone || undefined);
        if (timeZone && timeZone !== recurrenceTimeZone) {
          throw new Error("time_zone and recurrence.time_zone must match");
        }
        timeZone = recurrenceTimeZone;
      }
      database.exec("BEGIN IMMEDIATE");
      try {
        const inserted = database.prepare(`
          INSERT INTO calendar_events (
            title, description, location_text, starts_at_utc, ends_at_utc,
            time_zone, is_all_day, status, recurrence_rule
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING calendar_event_id
        `).get(
          normalizedText(input.title, "title", 500, { required: true }),
          normalizedText(input.description, "description", 10_000),
          normalizedText(input.location_text, "location_text", 1_000),
          startsAtUtc, endsAtUtc, timeZone, input.is_all_day ? 1 : 0, input.status, recurrenceRule,
        );
        let event = calendarEvent(database, inserted.calendar_event_id);
        const sourceEventId = writeEvent(database, ledger, context, {
          toolName: "calendar_event_add",
          eventType: "calendar.event.created",
          eventName: "Calendar event created",
          event,
        });
        database.prepare(`
          UPDATE calendar_events SET source_event_id = ? WHERE calendar_event_id = ?
        `).run(sourceEventId, event.calendar_event_id);
        event = calendarEvent(database, event.calendar_event_id);
        const result = calendarResult(schemaSemantics, context, { created: true, event }, {
          name: "calendar_event_add",
          purpose: "Return the calendar event created by the native calendar tool.",
        });
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "calendar_event_update",
    description: "Update or cancel one native calendar event by calendar_event_id. Null means leave a field unchanged; use an empty string to clear description, location_text, ends_at_utc, or time_zone. Change recurrence separately with calendar_event_recurrence_set.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        calendar_event_id: { type: "integer", minimum: 1 },
        title: optionalText,
        description: optionalText,
        location_text: optionalText,
        starts_at_utc: optionalText,
        ends_at_utc: optionalText,
        time_zone: optionalText,
        is_all_day: { type: ["boolean", "null"] },
        status: { type: ["string", "null"], enum: [...statuses, null] },
      },
      required: [
        "calendar_event_id", "title", "description", "location_text", "starts_at_utc",
        "ends_at_utc", "time_zone", "is_all_day", "status",
      ],
    },
    async execute(input, context) {
      const database = store.requireReady();
      const before = requireCalendarEvent(database, input.calendar_event_id);
      const values = {};
      if (input.title !== null) values.title = normalizedText(input.title, "title", 500, { required: true });
      if (input.description !== null) values.description = normalizedText(input.description, "description", 10_000);
      if (input.location_text !== null) values.location_text = normalizedText(input.location_text, "location_text", 1_000);
      if (input.starts_at_utc !== null) {
        values.starts_at_utc = normalizedIso(input.starts_at_utc, "starts_at_utc", { required: true });
      }
      if (input.ends_at_utc !== null) values.ends_at_utc = normalizedIso(input.ends_at_utc, "ends_at_utc");
      if (input.time_zone !== null) values.time_zone = input.time_zone ? validateTimeZone(input.time_zone) : null;
      if (input.is_all_day !== null) values.is_all_day = input.is_all_day ? 1 : 0;
      if (input.status !== null) values.status = input.status;
      if (Object.keys(values).length === 0) throw new Error("No calendar event changes were supplied");
      const prospective = { ...before, ...values };
      if (prospective.ends_at_utc && prospective.ends_at_utc < prospective.starts_at_utc) {
        throw new Error("ends_at_utc cannot be earlier than starts_at_utc");
      }
      values.updated_at_utc = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const assignments = Object.keys(values).map((field) => `"${field}" = ?`).join(", ");
        database.prepare(`UPDATE calendar_events SET ${assignments} WHERE calendar_event_id = ?`)
          .run(...Object.values(values), input.calendar_event_id);
        const event = calendarEvent(database, input.calendar_event_id);
        writeEvent(database, ledger, context, {
          toolName: "calendar_event_update",
          eventType: "calendar.event.updated",
          eventName: "Calendar event updated",
          event,
          before,
        });
        const result = calendarResult(schemaSemantics, context, { updated: true, event }, {
          name: "calendar_event_update",
          purpose: "Return the stored calendar event after updating it.",
        });
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "calendar_event_recurrence_set",
    description: "Add, change, or remove recurrence for a native calendar event. Supply structured recurrence concepts and never write RRULE syntax. Set enabled=false and recurrence=null to make the event one-time.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        calendar_event_id: { type: "integer", minimum: 1 },
        enabled: { type: "boolean" },
        recurrence: recurrenceSchema,
      },
      required: ["calendar_event_id", "enabled", "recurrence"],
    },
    async execute({ calendar_event_id: eventId, enabled, recurrence }, context) {
      const database = store.requireReady();
      const before = requireCalendarEvent(database, eventId);
      if (enabled && !recurrence) throw new Error("recurrence is required when enabled is true");
      const recurrenceRule = enabled ? buildRecurrenceRule(recurrence) : null;
      const recurrenceTimeZone = enabled
        ? validateTimeZone(recurrence.time_zone, before.time_zone || undefined)
        : before.time_zone;
      const updatedAt = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare(`
          UPDATE calendar_events
          SET recurrence_rule = ?, time_zone = ?, updated_at_utc = ?
          WHERE calendar_event_id = ?
        `).run(recurrenceRule, recurrenceTimeZone, updatedAt, eventId);
        const event = calendarEvent(database, eventId);
        writeEvent(database, ledger, context, {
          toolName: "calendar_event_recurrence_set",
          eventType: enabled ? "calendar.event.recurrence_set" : "calendar.event.recurrence_disabled",
          eventName: enabled ? "Calendar event recurrence set" : "Calendar event recurrence disabled",
          event,
          before,
        });
        const result = calendarResult(schemaSemantics, context, { updated: true, event }, {
          name: "calendar_event_recurrence_set",
          purpose: "Return the stored calendar event after changing recurrence.",
        });
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });
}
