import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { registerCalendarTools } from "../src/tools/calendar-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { temporaryDatabase } from "./helpers.mjs";


function calendarFixture(context) {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const organizer = new OrganizerStore(temporary.target);
  context.after(() => organizer.close());
  const ledger = new Ledger(store);
  const registry = new ToolRegistry();
  registerCalendarTools(registry, store, organizer, ledger);
  return { store, ledger, registry };
}

test("calendar_event_search returns exact stored fields with strict bounded arguments", async (context) => {
  const { store, registry } = calendarFixture(context);
  const database = store.requireReady();
  database.prepare(`
    INSERT INTO calendar_events (
      title, description, location_text, starts_at_utc, time_zone, status, recurrence_rule
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "Library planning",
    "Discuss the autumn program",
    "East branch",
    "2099-09-10T18:30:00.000Z",
    "America/New_York",
    "confirmed",
    "FREQ=MONTHLY;COUNT=3",
  );
  database.prepare(`
    INSERT INTO calendar_events (title, starts_at_utc, status)
    VALUES (?, ?, ?)
  `).run("Archived library planning", "2099-09-11T18:30:00.000Z", "cancelled");

  const definition = registry.toolDefinitions().find(({ name }) => name === "calendar_event_search");
  assert.deepEqual(definition.inputSchema.required, [
    "query", "include_archived", "limit", "result_filter",
  ]);
  assert.equal(definition.inputSchema.additionalProperties, false);

  const result = await registry.execute("calendar_event_search", {
    query: "library East",
    include_archived: false,
    limit: 20,
  }, { requestId: "search", callId: "calendar-search" });
  assert.equal(result.count, 1);
  assert.equal(result.events[0].title, "Library planning");
  assert.equal(result.events[0].location_text, "East branch");
  assert.equal(Object.hasOwn(result.events[0], "startsAtUtc"), false);

  const archived = await registry.execute("calendar_event_search", {
    query: "archived library",
    include_archived: true,
    limit: 20,
  }, { requestId: "search", callId: "calendar-search-archived" });
  assert.equal(archived.count, 1);
  assert.equal(archived.events[0].status, "cancelled");
});

test("native calendar tools create, list, update, and cancel stored events", async (context) => {
  const { ledger, registry } = calendarFixture(context);
  const request = ledger.createRequest({ text: "Schedule a dentist visit" });
  const toolContext = {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "calendar",
  };
  const created = await registry.execute("calendar_event_add", {
    title: "Dentist",
    description: "Cleaning",
    location_text: "Main Street",
    starts_at_utc: "2026-08-18T19:00:00Z",
    ends_at_utc: "2026-08-18T20:00:00Z",
    time_zone: "America/New_York",
    is_all_day: false,
    status: "confirmed",
    recurrence: null,
  }, toolContext);
  assert.equal(created.event.title, "Dentist");
  assert.equal(created.event.location_text, "Main Street");
  assert.equal(Object.hasOwn(created.event, "startsAtUtc"), false);
  assert.ok(created.event.source_event_id);

  const listed = await registry.execute("calendar_event_list", {
    starts_at_utc: "2026-08-18T00:00:00Z",
    ends_at_utc: "2026-08-19T00:00:00Z",
  }, toolContext);
  assert.equal(listed.count, 1);
  assert.equal(listed.occurrences[0].calendar_events.calendar_event_id, created.event.calendar_event_id);
  assert.deepEqual(listed.occurrences[0].occurrence, {
    source_kind: "calendar_event",
    occurrence_starts_at_utc: "2026-08-18T19:00:00.000Z",
    occurrence_ends_at_utc: "2026-08-18T20:00:00.000Z",
    is_generated_occurrence: false,
  });

  const updated = await registry.execute("calendar_event_update", {
    calendar_event_id: created.event.calendar_event_id,
    scope: "event",
    title: "Dental cleaning",
    description: null,
    location_text: "",
    starts_at_utc: null,
    ends_at_utc: null,
    time_zone: null,
    is_all_day: null,
    status: "cancelled",
  }, toolContext);
  assert.equal(updated.event.title, "Dental cleaning");
  assert.equal(updated.scope, "event");
  assert.equal(updated.event.location_text, null);
  assert.equal(updated.event.status, "cancelled");

  const afterCancellation = await registry.execute("calendar_event_list", {
    starts_at_utc: "2026-08-18T00:00:00Z",
    ends_at_utc: "2026-08-19T00:00:00Z",
  }, toolContext);
  assert.equal(afterCancellation.count, 0);
});

test("calendar updates distinguish series changes from one occurrence and preserve exceptions", async (context) => {
  const { store, registry } = calendarFixture(context);
  const created = await registry.execute("calendar_event_add", {
    title: "Family time", description: null, location_text: null,
    starts_at_utc: "2026-09-04T21:00:00.000Z", ends_at_utc: "2026-09-05T18:00:00.000Z",
    time_zone: "America/New_York", is_all_day: false, status: "confirmed",
    recurrence: { frequency: "WEEKLY", interval: 1, weekdays: ["FR"], count: 3,
      until_date: null, time_zone: "America/New_York" },
  });
  const id = Number(created.event.calendar_event_id);
  const update = { calendar_event_id: id, scope: "event", title: null,
    description: "Visit Grandma this weekend", location_text: null, starts_at_utc: null,
    ends_at_utc: null, time_zone: null, is_all_day: null, status: null };
  const db = store.requireReady();
  const before = db.prepare("SELECT * FROM calendar_events WHERE calendar_event_id = ?").get(id);
  const receiptCount = db.prepare("SELECT COUNT(*) AS n FROM activity_events").get().n;
  await assert.rejects(registry.execute("calendar_event_update", update), /calendar_event_occurrence_update/);
  assert.deepEqual(db.prepare("SELECT * FROM calendar_events WHERE calendar_event_id = ?").get(id), before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity_events").get().n, receiptCount);

  const occurrenceInput = { calendar_event_id: id, occurrence_starts_at_utc: "2026-09-11T21:00:00.000Z",
    starts_at_utc: null, ends_at_utc: null, title: null, description: update.description, status: null };
  const exception = await registry.execute("calendar_event_occurrence_update", occurrenceInput);
  const repeated = await registry.execute("calendar_event_occurrence_update", occurrenceInput);
  assert.equal(repeated.event.calendar_event_id, exception.event.calendar_event_id);

  const range = { starts_at_utc: "2026-09-04T00:00:00.000Z", ends_at_utc: "2026-09-20T00:00:00.000Z" };
  const single = await registry.execute("calendar_event_list", range);
  assert.deepEqual(single.occurrences.map(item => item.calendar_events.description),
    [null, update.description, null]);

  const result = await registry.execute("calendar_event_update", {
    ...update, scope: "series", description: "Standing family commitment",
  });
  assert.equal(result.scope, "series");
  assert.equal(result.event.recurrence_rule, created.event.recurrence_rule);
  const series = await registry.execute("calendar_event_list", range);
  assert.deepEqual(series.occurrences.map(item => item.calendar_events.description),
    ["Standing family commitment", update.description, "Standing family commitment"]);

  await assert.rejects(registry.execute("calendar_event_update", {
    ...update, calendar_event_id: exception.event.calendar_event_id, scope: "series",
  }), /Use scope=event/);
  const edited = await registry.execute("calendar_event_update", {
    ...update, calendar_event_id: exception.event.calendar_event_id, description: "Revised weekend plan",
  });
  assert.equal(edited.scope, "event");
  const final = await registry.execute("calendar_event_list", range);
  assert.deepEqual(final.occurrences.map(item => item.calendar_events.description),
    ["Standing family commitment", "Revised weekend plan", "Standing family commitment"]);
});

test("calendar events store and clear an optional planning prompt", async (context) => {
  const { registry } = calendarFixture(context);
  const created = await registry.execute("calendar_event_add", {
    title: "Time with the kids",
    description: null,
    location_text: null,
    planning_prompt_text: "What should we do during this block?",
    starts_at_utc: "2026-09-05T20:00:00.000Z",
    ends_at_utc: "2026-09-06T00:00:00.000Z",
    time_zone: "America/New_York",
    is_all_day: false,
    status: "confirmed",
    recurrence: null,
  });
  assert.equal(created.event.planning_prompt_text, "What should we do during this block?");

  const updated = await registry.execute("calendar_event_update", {
    calendar_event_id: created.event.calendar_event_id,
    scope: "event",
    title: null,
    description: null,
    location_text: null,
    planning_prompt_text: "",
    starts_at_utc: null,
    ends_at_utc: null,
    time_zone: null,
    is_all_day: null,
    status: null,
  });
  assert.equal(updated.event.planning_prompt_text, null);
});

test("calendar mutations reject a start instant outside the source-authorized weekday target", async (context) => {
  const { store, registry } = calendarFixture(context);
  const temporalResolutions = [{
    sourceText: "Sunday afternoon",
    sourceEventSeqs: [16651],
    weekday: "Sunday",
    localDate: "2026-09-06",
    timeZone: "America/New_York",
    role: "target",
    appliesTo: "calendar_start",
  }];
  const input = {
    title: "Watch work",
    description: null,
    location_text: null,
    starts_at_utc: "2026-08-31T20:00:00Z",
    ends_at_utc: "2026-08-31T23:00:00Z",
    time_zone: "America/New_York",
    is_all_day: false,
    status: "confirmed",
    recurrence: null,
  };
  await assert.rejects(registry.execute("calendar_event_add", input, {
    requestId: "calendar-temporal-guard",
    callId: "wrong-monday",
    temporalResolutions,
  }), /outside the source-authorized calendar target/);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM calendar_events").get().count, 0);

  const created = await registry.execute("calendar_event_add", {
    ...input,
    starts_at_utc: "2026-09-06T20:00:00Z",
    ends_at_utc: "2026-09-06T23:00:00Z",
  }, {
    requestId: "calendar-temporal-guard",
    callId: "correct-sunday",
    temporalResolutions,
  });
  assert.equal(created.event.starts_at_utc, "2026-09-06T20:00:00.000Z");
});

test("calendar recurrence stays at local time across daylight saving changes", async (context) => {
  const { registry } = calendarFixture(context);
  const created = await registry.execute("calendar_event_add", {
    title: "Sunday planning",
    description: null,
    location_text: null,
    starts_at_utc: "2026-03-01T05:00:00Z",
    ends_at_utc: null,
    time_zone: "America/New_York",
    is_all_day: true,
    status: "confirmed",
    recurrence: {
      frequency: "WEEKLY",
      interval: 1,
      weekdays: ["SU"],
      count: 4,
      until_date: null,
      time_zone: "America/New_York",
    },
  }, { requestId: "recurrence", callId: "add" });
  assert.equal(
    created.event.recurrence_rule,
    "FREQ=WEEKLY;INTERVAL=1;BYDAY=SU;COUNT=4",
  );

  const listed = await registry.execute("calendar_event_list", {
    starts_at_utc: "2026-03-14T00:00:00Z",
    ends_at_utc: "2026-03-16T12:00:00Z",
  }, { requestId: "recurrence", callId: "list" });
  assert.equal(listed.count, 1);
  assert.equal(listed.occurrences[0].occurrence.source_kind, "recurrence");
  assert.equal(listed.occurrences[0].occurrence.occurrence_starts_at_utc, "2026-03-15T04:00:00.000Z");

  const disabled = await registry.execute("calendar_event_recurrence_set", {
    calendar_event_id: created.event.calendar_event_id,
    enabled: false,
    recurrence: null,
  }, { requestId: "recurrence", callId: "disable" });
  assert.equal(disabled.event.recurrence_rule, null);
});

test("calendar range results preserve derived contact birthdays separately", async (context) => {
  const { store, registry } = calendarFixture(context);
  store.requireReady().prepare(`
    INSERT INTO contacts (display_name, birth_date) VALUES (?, ?)
  `).run("Alex", "1990-08-20");
  const listed = await registry.execute("calendar_event_list", {
    starts_at_utc: "2026-08-20T00:00:00Z",
    ends_at_utc: "2026-08-21T12:00:00Z",
  }, { requestId: "birthday", callId: "list" });
  assert.equal(listed.count, 1);
  assert.equal(listed.occurrences[0].calendar_events, null);
  assert.equal(listed.occurrences[0].contacts.display_name, "Alex");
  assert.equal(listed.occurrences[0].occurrence.source_kind, "contact_birthday");
});
