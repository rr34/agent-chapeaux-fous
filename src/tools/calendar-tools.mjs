import {
  buildRecurrenceRule, recurrenceSchema, validateTimeZone,
} from "../todo-recurrence.mjs";
import { searchCalendarEventRows } from "../calendar-search.mjs";
import { localDateForInstant } from "../temporal-consistency.mjs";
import { selectedFields } from "./record-fields.mjs";

const contactRecordSchema = {
  type: ["object", "null"],
  description: "Provides one address book for people, organizations, and services that other agent records need to identify or relate to.",
  properties: {
    contact_id: { description: "Stable local identifier for this person, organization, or service." },
    display_name: { description: "Preferred human-readable name used to show and refer to the contact." },
    birth_date: { description: "Contact's birth date, with an explicitly optional year, used to derive birthday calendar entries and age when possible. Do not invent a birth year; use --MM-DD when only month and day are known. Age is derived only when the stored value includes a year. Generated birthday labels are projections and must not be written back as permanent age text." },
  },
};

const calendarEventRecordSchema = {
  type: ["object", "null"],
  description: "Stores every commitment and scheduled event in the user's one authoritative agent calendar.",
  properties: {
    calendar_event_id: { description: "Stable local identifier for this calendar event." },
    ical_uid: { description: "Persistent iCalendar UID used to identify an imported event or recurrence family and prevent duplicate imports. This identifies imported calendar data; it does not identify a separate calendar." },
    ical_recurrence_id: { description: "Original iCalendar recurrence-instance identifier distinguishing this materialized occurrence within the shared UID. Together with ical_uid, this value prevents duplicate imports of the same recurring occurrence." },
    title: { description: "Human-readable event name shown on the calendar." },
    description: { description: "Complete available description or notes for the event." },
    location_text: { description: "Human-readable physical, virtual, or meeting location." },
    starts_at_utc: { description: "UTC instant when the event starts." },
    ends_at_utc: { description: "UTC instant when the event ends, when an end is known." },
    time_zone: { description: "IANA or provider time-zone name used to display the event in its intended local time." },
    is_all_day: { description: "1 when the event represents a calendar day rather than a precise time; otherwise 0." },
    status: { description: "Current scheduling state of the event. Calendar events happen; completion is represented only by the passage of time, not a stored event status. tentative: Event is proposed but not firmly confirmed. confirmed: Event is scheduled to occur. cancelled: Event will not occur." },
    recurrence_rule: { description: "iCalendar RRULE describing how the event repeats." },
    source_event_id: { description: "Ledger event that caused this calendar record to be created when known." },
    created_at_utc: { description: "UTC timestamp when this local calendar record was inserted." },
    updated_at_utc: { description: "UTC timestamp of the latest recorded change to this local calendar record." },
    planning_prompt_text: { description: "Optional question the agent should proactively ask to help the user decide how this scheduled time will be used. Null means no proactive planning question is attached to this event." },
  },
};

const statuses = ["tentative", "confirmed", "cancelled"];
const calendarEventFields = [
  "calendar_event_id", "ical_uid", "ical_recurrence_id", "title", "description",
  "location_text", "starts_at_utc", "ends_at_utc", "time_zone", "is_all_day",
  "status", "recurrence_rule", "planning_prompt_text", "source_event_id",
  "created_at_utc", "updated_at_utc",
];
const contactFields = ["contact_id", "display_name", "birth_date"];
const optionalText = { type: ["string", "null"] };

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

function validateCalendarTemporalTarget(startsAtUtc, context) {
  if (!startsAtUtc) return;
  const targets = Array.isArray(context?.temporalResolutions)
    ? context.temporalResolutions.filter((resolution) => (
        resolution.role === "target" && resolution.appliesTo === "calendar_start"
      ))
    : [];
  if (!targets.length) return;
  if (targets.some((target) => localDateForInstant(startsAtUtc, target.timeZone) === target.localDate)) return;
  const actual = [...new Set(targets.map((target) => (
    `${localDateForInstant(startsAtUtc, target.timeZone)} in ${target.timeZone}`
  )))].join("; ");
  const authorized = targets.map((target) => (
    `${target.weekday}, ${target.localDate} in ${target.timeZone}`
  )).join("; ");
  throw new Error(`starts_at_utc resolves to ${actual}, outside the source-authorized calendar target(s): ${authorized}`);
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
  registry, store, organizer, ledger, searchCoordinator = null,
) {
  registry = registry.withCapability?.("calendar") ?? registry;
  registry.register({
    name: "calendar_event_search",
    description: "Search stored native calendar event series by title, description, and location. Every whitespace-separated query term must match at least one of those fields. Results are stored event records, not expanded recurrence occurrences or derived contact birthdays, and archived events are excluded unless explicitly requested.",
    outputSchema: {
      type: "object",
      properties: {
        events: { type: "array", items: calendarEventRecordSchema },
      },
    },
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
      return {
        query: search.query,
        include_archived: search.includeArchived,
        count: events.length,
        events,
      };
    },
  });

  registry.register({
    name: "calendar_event_list",
    description: "List the user's calendar schedule in an explicit UTC range. Recurring events are expanded into computed occurrences and contact birthdays shown by the calendar are included. Stored records use exact calendar_events field names; occurrence_* fields describe the computed display instance.",
    outputSchema: {
      type: "object",
      properties: {
        occurrences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              calendar_events: calendarEventRecordSchema,
              contacts: contactRecordSchema,
              occurrence: {
                type: "object",
                description: "Computed schedule instance. occurrence_starts_at_utc and occurrence_ends_at_utc are UTC instants for this occurrence; stored event times describe its series.",
              },
            },
          },
        },
      },
    },
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
      return {
        starts_at_utc: normalizedIso(startsAtUtc, "starts_at_utc", { required: true }),
        ends_at_utc: normalizedIso(endsAtUtc, "ends_at_utc", { required: true }),
        count: occurrences.length,
        occurrences,
      };
    },
  });

  registry.register({
    name: "calendar_event_add",
    description: "Create one native calendar event with an optional planning_prompt_text containing the exact question to ask about still-unplanned time. Use is_all_day=true when the user names a day without a specific time, with starts_at_utc representing local midnight and time_zone preserving that local date. For repetition, supply structured recurrence concepts including numbered weekdays or days of the month; never write RRULE syntax.",
    outputSchema: {
      type: "object",
      properties: { event: calendarEventRecordSchema },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 500, description: "Human-readable event name shown on the calendar." },
        description: { ...optionalText, description: "Complete available description or notes for the event." },
        location_text: { ...optionalText, description: "Human-readable physical, virtual, or meeting location." },
        planning_prompt_text: { ...optionalText, description: "Optional question the agent should proactively ask to help the user decide how this scheduled time will be used. Null means no proactive planning question is attached to this event." },
        starts_at_utc: { type: "string", description: "UTC instant when the event starts." },
        ends_at_utc: { ...optionalText, description: "UTC instant when the event ends, when an end is known." },
        time_zone: { ...optionalText, description: "IANA or provider time-zone name used to display the event in its intended local time." },
        is_all_day: { type: "boolean", description: "True when the event represents a calendar day rather than a precise time; false otherwise." },
        status: { type: "string", enum: statuses, description: "Current scheduling state of the event. Calendar events happen; completion is represented only by the passage of time, not a stored event status. tentative: Event is proposed but not firmly confirmed. confirmed: Event is scheduled to occur. cancelled: Event will not occur." },
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
      validateCalendarTemporalTarget(startsAtUtc, context);
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
      database.exec("START TRANSACTION");
      try {
        const inserted = database.prepare(`
          INSERT INTO calendar_events (
            title, description, location_text, starts_at_utc, ends_at_utc,
            time_zone, is_all_day, status, recurrence_rule, planning_prompt_text
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING calendar_event_id
        `).get(
          normalizedText(input.title, "title", 500, { required: true }),
          normalizedText(input.description, "description", 10_000),
          normalizedText(input.location_text, "location_text", 1_000),
          startsAtUtc, endsAtUtc, timeZone, input.is_all_day ? 1 : 0, input.status,
          recurrenceRule, normalizedText(input.planning_prompt_text, "planning_prompt_text", 10_000),
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
        const result = { created: true, event };
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
    description: "Update or cancel a stored calendar event with explicit scope. Use scope=event for a one-time event or an already materialized exception. For a recurring master, scope=series is required: changes affect the whole series, including past and future generated occurrences; separately edited exceptions are not rewritten. Use calendar_event_occurrence_update with the series ID and original occurrence start to change just one occurrence. Choose series only when the user requests the whole series; if scope is unclear, offer just this occurrence or the whole series before changing anything. Null means leave a field unchanged; use an empty string to clear description, location_text, planning_prompt_text, ends_at_utc, or time_zone. Change recurrence separately with calendar_event_recurrence_set.",
    outputSchema: {
      type: "object",
      properties: {
        event: calendarEventRecordSchema,
        scope: { type: "string", enum: ["event", "series"], description: "Applied scope: event changed only this stored one-time event or exception; series changed the recurring master and its generated occurrences, without rewriting separately edited exceptions." },
      },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        calendar_event_id: { type: "integer", minimum: 1, description: "Stable local identifier for this calendar event." },
        scope: { type: "string", enum: ["event", "series"], description: "Required explicit scope. event edits only a one-time event or materialized exception and is rejected for a recurring master. series edits the recurring master for all generated occurrences and requires the user's whole-series intent. For just one occurrence of a series, use calendar_event_occurrence_update instead. Ask the user to choose when scope is unclear." },
        title: { ...optionalText, description: "Human-readable event name shown on the calendar." },
        description: { ...optionalText, description: "Complete available description or notes for the event." },
        location_text: { ...optionalText, description: "Human-readable physical, virtual, or meeting location." },
        planning_prompt_text: { ...optionalText, description: "Question to ask about this scheduled time. Null leaves it unchanged; an empty string clears it." },
        starts_at_utc: { ...optionalText, description: "UTC instant when the event starts." },
        ends_at_utc: { ...optionalText, description: "UTC instant when the event ends, when an end is known." },
        time_zone: { ...optionalText, description: "IANA or provider time-zone name used to display the event in its intended local time." },
        is_all_day: { type: ["boolean", "null"], description: "True when the event represents a calendar day rather than a precise time; false otherwise." },
        status: { type: ["string", "null"], enum: [...statuses, null], description: "Current scheduling state of the event. Calendar events happen; completion is represented only by the passage of time, not a stored event status. tentative: Event is proposed but not firmly confirmed. confirmed: Event is scheduled to occur. cancelled: Event will not occur." },
      },
      required: [
        "calendar_event_id", "scope", "title", "description", "location_text", "starts_at_utc",
        "ends_at_utc", "time_zone", "is_all_day", "status",
      ],
    },
    async execute(input, context) {
      const database = store.requireReady();
      const before = requireCalendarEvent(database, input.calendar_event_id);
      if (before.recurrence_rule && input.scope !== "series") {
        throw new Error("This event is a recurring series. No changes were made. To change just one occurrence, use calendar_event_occurrence_update with the series ID and original occurrence start. To change the whole series, use scope=series only when the user requests it. If unclear, ask: just this occurrence or the whole series?");
      }
      if (!before.recurrence_rule && input.scope !== "event") {
        throw new Error("This record is a one-time event or materialized exception, not a recurring master. Use scope=event to change only this event. To change a whole series, read and supply its recurring master ID with scope=series.");
      }
      const values = {};
      if (input.title !== null) values.title = normalizedText(input.title, "title", 500, { required: true });
      if (input.description !== null) values.description = normalizedText(input.description, "description", 10_000);
      if (input.location_text !== null) values.location_text = normalizedText(input.location_text, "location_text", 1_000);
      if (input.planning_prompt_text !== undefined && input.planning_prompt_text !== null) {
        values.planning_prompt_text = normalizedText(
          input.planning_prompt_text, "planning_prompt_text", 10_000,
        );
      }
      if (input.starts_at_utc !== null) {
        values.starts_at_utc = normalizedIso(input.starts_at_utc, "starts_at_utc", { required: true });
        validateCalendarTemporalTarget(values.starts_at_utc, context);
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
      database.exec("START TRANSACTION");
      try {
        const assignments = Object.keys(values).map((field) => `\`${field}\` = ?`).join(", ");
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
        const result = { updated: true, scope: input.scope, event };
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "calendar_event_occurrence_update",
    description: "Move, cancel, rename, or comment on exactly one occurrence of an active recurring calendar series. Read calendar_event_list or the source-linked catch-up question first. Supply the series calendar_event_id and exact original occurrence_starts_at_utc; never use a moved start as the occurrence identity. The calendar service atomically excludes the original occurrence and creates or updates its materialized exception, preserving other occurrences, participants, time zone, and duration. Repeating the same request reuses the exception. Null fields preserve current values; empty description clears it. To edit a one-time event use calendar_event_update.",
    parameters: { type: "object", additionalProperties: false, properties: {
      calendar_event_id: { type: "integer", minimum: 1 },
      occurrence_starts_at_utc: { type: "string", description: "Exact original UTC occurrence identity from the calendar or catch-up source_occurrence_key. Never pass a plan:-prefixed question key." },
      starts_at_utc: { ...optionalText, description: "New UTC start, or null to preserve. Duration is preserved unless ends_at_utc is supplied." },
      ends_at_utc: optionalText,
      title: optionalText, description: optionalText,
      status: { type: ["string", "null"], enum: [...statuses, null] },
    }, required: ["calendar_event_id", "occurrence_starts_at_utc", "starts_at_utc", "ends_at_utc", "title", "description", "status"] },
    outputSchema: { type: "object", properties: {
      event: calendarEventRecordSchema,
      series_calendar_event_id: { type: "integer" },
      original_occurrence_starts_at_utc: { type: "string" },
    } },
    async execute(input, context) {
      if (input.starts_at_utc) validateCalendarTemporalTarget(normalizedIso(input.starts_at_utc, "starts_at_utc", { required: true }), context);
      const result = organizer.updateCalendarOccurrence(input.calendar_event_id, {
        occurrenceStartsAtUtc: input.occurrence_starts_at_utc,
        startsAtUtc: input.starts_at_utc, endsAtUtc: input.ends_at_utc,
        title: input.title, description: input.description, status: input.status,
      }, { actorType: "tool", actorName: "calendar_event_occurrence_update", source: "agent-slayer",
        turnId: context.requestId, operationId: context.callId });
      return { event: { ...calendarEvent(store.requireReady(), result.event.id), calendar_event_id: Number(result.event.id) },
        series_calendar_event_id: result.seriesId, original_occurrence_starts_at_utc: result.occurrenceStartsAtUtc };
    },
  });

  registry.register({
    name: "calendar_event_recurrence_set",
    description: "Add, change, or remove recurrence for a native calendar event. Supply structured recurrence concepts and never write RRULE syntax. Set enabled=false and recurrence=null to make the event one-time.",
    outputSchema: {
      type: "object",
      properties: { event: calendarEventRecordSchema },
    },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        calendar_event_id: { type: "integer", minimum: 1, description: "Stable local identifier for this calendar event." },
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
      database.exec("START TRANSACTION");
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
        const result = { updated: true, event };
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });
}
