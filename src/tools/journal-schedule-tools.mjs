import { recurrenceSchema } from "../todo-recurrence.mjs";

const nullableText = { type: ["string", "null"] };

export function registerJournalScheduleTools(rootRegistry, service) {
  const registry = rootRegistry.withCapability("journal", {
    tracker_asking_schedule_set: {
      protocol: "agent-slayer.tool-description",
      version: 1,
      summary: "Set or disable a journal tracker's calendar-based logging schedule.",
      actionClasses: ["UPDATE"],
      effectClassifications: ["MUTATING"],
    },
  });
  registry.register({
    name: "tracker_asking_schedule_set",
    description: "Set or disable one journal tracker's calendar-based logging schedule. Supply a first period start and structured recurrence; never ask the user to write RRULE. Existing observations satisfy their calendar period. Null recurrence and starts_at_utc disable the schedule without archiving the tracker or changing observations.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        tracker_id: { type: "integer", minimum: 1 },
        starts_at_utc: nullableText,
        recurrence: recurrenceSchema,
      },
      required: ["tracker_id", "starts_at_utc", "recurrence"],
    },
    outputSchema: {
      type: "object",
      properties: {
        tracker_id: { type: "integer", minimum: 1 },
        asking_starts_at_utc: nullableText,
        asking_recurrence_rule: nullableText,
        asking_time_zone: nullableText,
      },
    },
    execute: (input, context) => service.setTrackerSchedule(input, context),
  });
}
