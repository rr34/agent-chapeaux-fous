import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { SchemaSemantics } from "../src/schema-semantics.mjs";
import { registerCalendarTools } from "../src/tools/calendar-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { temporaryDatabase } from "./helpers.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function calendarFixture(context, { semantics = false } = {}) {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const organizer = new OrganizerStore(temporary.filename);
  context.after(() => organizer.close());
  const ledger = new Ledger(store);
  const schemaSemantics = semantics ? new SchemaSemantics({
    filename: path.join(repositoryRoot, "db", "schema-semantics.json"),
    ledger,
  }) : null;
  const registry = new ToolRegistry();
  registerCalendarTools(registry, store, organizer, ledger, schemaSemantics);
  return { store, ledger, registry };
}

test("native calendar tools create, list, update, and cancel stored events", async (context) => {
  const { ledger, registry } = calendarFixture(context, { semantics: true });
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
  assert.match(
    created.schemaProjection.schemaProjection.schemaObjects.calendar_events.fields.starts_at_utc.meaning,
    /UTC instant/,
  );

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
  assert.equal(updated.event.location_text, null);
  assert.equal(updated.event.status, "cancelled");

  const afterCancellation = await registry.execute("calendar_event_list", {
    starts_at_utc: "2026-08-18T00:00:00Z",
    ends_at_utc: "2026-08-19T00:00:00Z",
  }, toolContext);
  assert.equal(afterCancellation.count, 0);
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
  const { store, registry } = calendarFixture(context, { semantics: true });
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
  assert.ok(listed.schemaProjection.schemaProjection.schemaObjects.contacts);
});
