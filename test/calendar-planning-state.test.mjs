import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarPlanningSourceVersion,
  CatchUpService,
} from "../src/catch-up.mjs";

const now = "2026-09-13T12:00:00.000Z";

function source(id, prompt) {
  return {
    calendar_event_id: id,
    title: `Window ${id}`,
    status: "confirmed",
    starts_at_utc: `2026-09-${13 + id}T15:00:00.000Z`,
    ends_at_utc: `2026-09-${13 + id}T16:00:00.000Z`,
    planning_prompt_text: prompt,
    description: null,
    location_text: null,
    time_zone: "America/New_York",
    is_all_day: 0,
  };
}

function displayed(row) {
  return {
    id: Number(row.calendar_event_id),
    title: row.title,
    startsAtUtc: row.starts_at_utc,
    endsAtUtc: row.ends_at_utc,
    planningPromptText: row.planning_prompt_text,
    isGeneratedOccurrence: false,
  };
}

function sourceVersion(row) {
  return calendarPlanningSourceVersion({
    title: row.title,
    status: row.status,
    startsAtUtc: row.starts_at_utc,
    endsAtUtc: row.ends_at_utc,
    planningPromptText: row.planning_prompt_text,
    description: row.description,
    location: row.location_text,
    timeZone: row.time_zone,
    isAllDay: row.is_all_day,
  });
}

test("calendar planning indicators distinguish pending, deferred, planned, and absent prompts", () => {
  const pending = source(1, "What should happen in this block?");
  const deferred = source(2, "What should happen in this block?");
  const planned = source(3, "What should happen in this block?");
  const stale = source(4, "What should happen in this block?");
  const none = source(5, null);
  const sources = [pending, deferred, planned, stale, none];
  const questions = [
    {
      question_id: 2, calendar_event_id: 2, occurrence_key: "plan:event",
      source_version: sourceVersion(deferred), resolved_at: null,
      ask_after: "2026-09-14T12:00:00.000Z",
    },
    {
      question_id: 3, calendar_event_id: 3, occurrence_key: "plan:event",
      source_version: sourceVersion(planned), resolved_at: "2026-09-13T11:00:00.000Z",
      ask_after: null,
    },
    {
      question_id: 4, calendar_event_id: 4, occurrence_key: "plan:event",
      source_version: "stale", resolved_at: "2026-09-13T11:00:00.000Z",
      ask_after: null,
    },
  ];
  const database = { prepare(sql) {
    return { all() {
      if (sql.includes("FROM calendar_events")) return sources;
      if (sql.includes("FROM catch_up_questions")) return questions;
      throw new Error(`Unexpected SQL: ${sql}`);
    } };
  } };
  const service = new CatchUpService({ requireReady: () => database }, null, null, { now: () => now });

  assert.deepEqual(
    service.withCalendarPlanningStates(sources.map(displayed)).map(({ planningState }) => planningState),
    ["needs_planning", "deferred", "planned", "needs_planning", null],
  );
});

test("recurring calendar occurrences use their own planning resolution", () => {
  const recurring = source(7, "What is the plan for this occurrence?");
  const occurrence = {
    ...displayed(recurring),
    id: `recurrence:7:2026-09-27T15:00:00.000Z`,
    seriesId: 7,
    startsAtUtc: "2026-09-27T15:00:00.000Z",
    endsAtUtc: "2026-09-27T16:00:00.000Z",
    isGeneratedOccurrence: true,
  };
  const version = calendarPlanningSourceVersion({
    title: recurring.title,
    status: recurring.status,
    startsAtUtc: occurrence.startsAtUtc,
    endsAtUtc: occurrence.endsAtUtc,
    planningPromptText: recurring.planning_prompt_text,
    description: recurring.description,
    location: recurring.location_text,
    timeZone: recurring.time_zone,
    isAllDay: recurring.is_all_day,
  });
  const database = { prepare(sql) {
    return { all() {
      if (sql.includes("FROM calendar_events")) return [recurring];
      if (sql.includes("FROM catch_up_questions")) return [{
        question_id: 7,
        calendar_event_id: 7,
        occurrence_key: `plan:${occurrence.startsAtUtc}`,
        source_version: version,
        resolved_at: now,
        ask_after: null,
      }];
      throw new Error(`Unexpected SQL: ${sql}`);
    } };
  } };
  const service = new CatchUpService({ requireReady: () => database }, null, null, { now: () => now });
  assert.equal(service.withCalendarPlanningStates([occurrence])[0].planningState, "planned");
});
