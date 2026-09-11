import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CatchUpService } from "../src/catch-up.mjs";
import { currentLoggingPeriod, OrganizerStore } from "../src/organizer-store.mjs";
import { SlayerDatabase, modelWritableTables } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { ToolRegistry, schemaProblem } from "../src/tools/registry.mjs";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { registerCatchUpTools } from "../src/tools/catch-up-tools.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { registerJournalTools } from "../src/tools/journal-tools.mjs";
import { registerCalendarTools } from "../src/tools/calendar-tools.mjs";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { runDatabaseMigrations } from "../scripts/migrate-database.mjs";
import { verifyDatabase } from "../scripts/verify-database.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { temporaryDatabase, baselineBeforeCatchUp } from "./helpers.mjs";

const scope = { local_date: "2026-09-08", time_zone: "America/New_York", lookback_days: 7 };
const recurrence = { frequency: "DAILY", interval: 1, weekdays: [], count: null, until_date: null, time_zone: "America/New_York" };
function harness(t) {
  const temp = temporaryDatabase(); t.after(temp.cleanup);
  const store = new SlayerDatabase(temp.target); t.after(() => store.close());
  assert.equal(store.status.ready, true, store.status.reason);
  const organizer = new OrganizerStore(temp.target); t.after(() => organizer.close());
  const ledger = new Ledger(store);
  let now = "2026-09-08T22:00:00.000Z";
  const service = new CatchUpService(store, organizer, ledger, { now: () => now });
  const registry = registerNativeCapabilities(new ToolRegistry());
  registerCatchUpTools(registry, service);
  registerCalendarTools(registry, store, organizer, ledger);
  registerTodoTools(registry, store, ledger);
  registerJournalTools(registry, store, ledger);
  const db = store.requireReady();
  const task = (text = "Call electrician", scheduled = "2026-09-08T13:00:00.000Z") => Number(db.prepare(`INSERT INTO todo_personal
    (todo_group_id, text, scheduled_at_utc) SELECT todo_group_id, ?, ? FROM todo_groups WHERE name='Inbox' RETURNING personal_task_id`)
    .get(text, scheduled).personal_task_id);
  const tracker = () => {
    db.exec("INSERT INTO journal_groups (name) VALUES ('Health')");
    return Number(db.prepare("INSERT INTO trackers (journal_group_id, name, unit) SELECT journal_group_id, 'Weight', 'kg' FROM journal_groups WHERE name='Health' RETURNING tracker_id").get().tracker_id);
  };
  const answer = (q, action, extra = {}) => service.update({ question_id: q.question_id, expected_version: q.version,
    action, ask_after: null, comment: null, ...extra });
  return { temp, store, db, organizer, service, registry, task, tracker, answer, setNow: value => { now = value; } };
}

test("source FKs and occurrence uniqueness are enforced; refresh is idempotent and resolution persists without chats", t => {
  const { db, service, task, answer } = harness(t);
  const id = task();
  assert.equal(service.refresh(scope).due_count, 1);
  const q = service.list().questions[0];
  assert.equal(q.personal_task_id, id);
  assert.equal(q.calendar_event_id, null);
  assert.equal(q.tracker_id, null);
  service.refresh(scope);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM catch_up_questions").get().n), 1);
  assert.throws(() => db.prepare(`INSERT INTO catch_up_questions (personal_task_id, occurrence_key, source_version, question_text, due_at_utc)
    VALUES (?, 'task', ?, 'Duplicate', ?)`).run(id, q.source_version, q.due_at_utc), /Duplicate/i);
  assert.throws(() => db.prepare("UPDATE catch_up_questions SET personal_task_id = 999999 WHERE question_id = ?").run(q.question_id), /foreign key/i);
  db.exec("INSERT INTO calendar_events (calendar_event_id, title, starts_at_utc) VALUES (902, 'Other source', '2026-10-01T13:00:00.000Z')");
  assert.throws(() => db.prepare("UPDATE catch_up_questions SET calendar_event_id=902 WHERE question_id = ?").run(q.question_id), /CONSTRAINT/i);
  assert.throws(() => db.prepare("UPDATE catch_up_questions SET personal_task_id = NULL WHERE question_id = ?").run(q.question_id), /CONSTRAINT/i);
  answer(q, "resolve", { comment: "Plan is settled" });
  service.refresh(scope);
  assert.equal(service.list().count, 0);
  assert.equal(db.prepare("SELECT status FROM todo_personal WHERE personal_task_id = ?").get(id).status, "todo");
  assert.equal(service.list({ question_id: q.question_id }).questions[0].comment, "Plan is settled");
});

test("deferral survives refresh, source moves reset eligibility, and stale answers are rejected", t => {
  const { db, service, task, answer, setNow } = harness(t);
  const id = task(); service.refresh(scope);
  const q = service.list().questions[0];
  answer(q, "defer", { ask_after: "2026-09-09T14:00:00Z" });
  service.refresh(scope);
  assert.equal(service.list().count, 0);
  assert.throws(() => answer(q, "resolve"), /changed/);
  setNow("2026-09-09T14:00:00.000Z");
  const due = service.list().questions[0];
  db.prepare("UPDATE todo_personal SET scheduled_at_utc = '2026-09-11T13:00:00.000Z' WHERE personal_task_id = ?").run(id);
  assert.equal(service.list().refresh_required, true);
  assert.throws(() => answer(due, "resolve"), /Source data changed/);
  service.refresh(scope);
  assert.equal(service.list().count, 0);
  setNow("2026-09-11T14:00:00.000Z");
  const moved = service.list().questions[0];
  assert.equal(moved.question_id, q.question_id);
  assert.equal(moved.ask_after, null);
  assert.equal(moved.resolved_at, null);
  db.prepare("UPDATE todo_personal SET status='complete' WHERE personal_task_id = ?").run(id);
  service.refresh({ ...scope, local_date: "2026-09-11" });
  assert.equal(service.list().count, 0);
  db.prepare("UPDATE todo_personal SET status='todo' WHERE personal_task_id = ?").run(id);
  service.refresh({ ...scope, local_date: "2026-09-11" });
  assert.equal(service.list().count, 1);
});

test("completed and unscheduled tasks do not generate nags; cancellation reconciles even outside the scan", t => {
  const { db, service, task } = harness(t);
  task("Unscheduled", null);
  const done = task("Already done");
  db.prepare("UPDATE todo_personal SET status='complete' WHERE personal_task_id = ?").run(done);
  const event = db.prepare("INSERT INTO calendar_events (title, starts_at_utc) VALUES ('Dentist', '2026-09-08T14:00:00.000Z') RETURNING calendar_event_id").get();
  service.refresh(scope);
  assert.equal(service.list().count, 1);
  db.prepare("UPDATE calendar_events SET status='cancelled' WHERE calendar_event_id = ?").run(event.calendar_event_id);
  service.refresh({ ...scope, local_date: "2026-10-08", lookback_days: 0 });
  assert.equal(service.list().count, 0);
});

test("tracker schedules are opt-in; existing observations satisfy periods and missed periods consolidate", t => {
  const { db, service, tracker, setNow } = harness(t);
  const id = tracker(); service.refresh(scope);
  assert.equal(service.list().count, 0);
  service.setTrackerSchedule({ tracker_id: id, starts_at_utc: "2026-08-01T04:00:00Z", recurrence });
  service.refresh(scope);
  const first = service.list().questions[0];
  assert.equal(first.occurrence_key, "2026-09-08T04:00:00.000Z");
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM catch_up_questions").get().n), 1);
  db.prepare("INSERT INTO journal_entries (tracker_id, occurred_at_utc, content_text) VALUES (?, '2026-09-08T15:00:00.000Z', 'Skipped weighing today')").run(id);
  service.refresh(scope);
  assert.equal(service.list().count, 0);
  setNow("2026-09-20T22:00:00.000Z"); service.refresh({ ...scope, local_date: "2026-09-20" });
  assert.equal(service.list().count, 1);
  assert.equal(service.list().questions[0].occurrence_key, "2026-09-20T04:00:00.000Z");
  service.setTrackerSchedule({ tracker_id: id, starts_at_utc: null, recurrence: null });
  service.refresh(scope);
  assert.equal(service.list().count, 0);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get().n), 1);
});

test("logging periods preserve local midnight through DST and support monthly and finite recurrence", () => {
  const schedule = { startsAtUtc: "2026-03-01T05:00:00.000Z", timeZone: "America/New_York", recurrenceRule: "FREQ=DAILY;INTERVAL=1" };
  assert.deepEqual(currentLoggingPeriod(schedule, "2026-03-08T18:00:00.000Z"), {
    startsAtUtc: "2026-03-08T05:00:00.000Z", endsAtUtc: "2026-03-09T04:00:00.000Z",
  });
  assert.deepEqual(currentLoggingPeriod({ ...schedule, recurrenceRule: "FREQ=MONTHLY;INTERVAL=1" }, "2026-09-08T22:00:00.000Z"), {
    startsAtUtc: "2026-09-01T04:00:00.000Z", endsAtUtc: "2026-10-01T04:00:00.000Z",
  });
  assert.equal(currentLoggingPeriod(schedule, "2026-02-28T22:00:00.000Z"), null);
  assert.equal(currentLoggingPeriod({ ...schedule, recurrenceRule: "FREQ=DAILY;COUNT=2" }, "2026-09-08T22:00:00.000Z").startsAtUtc, "2026-03-02T05:00:00.000Z");
});

test("one recurring appointment can move or cancel without changing the series or duplicating exceptions", async t => {
  const { db, service, registry, answer, organizer } = harness(t);
  const id = Number(db.prepare(`INSERT INTO calendar_events (title, starts_at_utc, ends_at_utc, time_zone, recurrence_rule)
    VALUES ('Dentist', '2026-09-01T13:00:00.000Z', '2026-09-01T14:00:00.000Z', 'America/New_York', 'FREQ=WEEKLY;BYDAY=TU') RETURNING calendar_event_id`).get().calendar_event_id);
  db.exec("INSERT INTO contacts (contact_id, display_name) VALUES (901, 'Dentist')");
  db.prepare("INSERT INTO calendar_event_contacts (calendar_event_id, contact_id, response_status) VALUES (?, 901, 'accepted')").run(id);
  service.refresh(scope);
  const questions = service.list().questions;
  assert.equal(questions.length, 2);
  answer(questions[0], "resolve");
  assert.equal(service.list().count, 1);
  const input = { calendar_event_id: id, occurrence_starts_at_utc: "2026-09-08T13:00:00.000Z",
    starts_at_utc: "2026-09-11T13:00:00.000Z", ends_at_utc: null, title: null, description: null, status: null };
  await assert.rejects(registry.execute("calendar_event_occurrence_update", { ...input, ends_at_utc: "2026-09-10T13:00:00.000Z" }, {}), /end.*precede/i);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM calendar_event_exclusions").get().n), 0);
  await assert.rejects(registry.execute("calendar_event_occurrence_update", { ...input, occurrence_starts_at_utc: "2026-09-09T13:00:00.000Z" }, {}), /occurrence does not exist/i);
  const result = await registry.execute("calendar_event_occurrence_update", input, {});
  assert.equal(result.event.ends_at_utc, "2026-09-11T14:00:00.000Z");
  const repeated = await registry.execute("calendar_event_occurrence_update", input, {});
  assert.equal(repeated.event.calendar_event_id, result.event.calendar_event_id);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM calendar_events").get().n), 2);
  assert.equal(db.prepare("SELECT response_status FROM calendar_event_contacts WHERE calendar_event_id = ?").get(result.event.calendar_event_id).response_status, "accepted");
  service.refresh(scope);
  assert.equal(service.list().count, 0);
  assert.equal(organizer.listCalendar({ from: "2026-09-15T00:00:00Z", to: "2026-09-16T00:00:00Z" })[0].startsAtUtc, "2026-09-15T13:00:00.000Z");
  await registry.execute("calendar_event_occurrence_update", { ...input, starts_at_utc: null, status: "cancelled" }, {});
  assert.equal(organizer.listCalendar({ from: "2026-09-11T00:00:00Z", to: "2026-09-12T00:00:00Z" }).length, 0);
  assert.equal(db.prepare("SELECT status FROM calendar_events WHERE calendar_event_id = ?").get(id).status, "confirmed");
  const extra = Number(db.prepare("INSERT INTO calendar_events (title, starts_at_utc, recurrence_rule) VALUES ('Too frequent', '2026-09-08T00:00:00.000Z', 'FREQ=SECONDLY') RETURNING calendar_event_id").get().calendar_event_id);
  assert.throws(() => service.refresh(scope), /bounded occurrence scan/);
  db.prepare("DELETE FROM calendar_events WHERE calendar_event_id = ?").run(extra);
});

test("context preparation only reads already generated rows; refresh is advertised as mutating", async t => {
  const { db, service, registry, task } = harness(t);
  task();
  await registry.prepareContext(["catch-up.pending"]);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM catch_up_questions").get().n), 0);
  assert.equal(registry.get("catch_up_refresh").annotations.readOnlyHint, false);
  assert.equal(registry.get("catch_up_list").annotations.readOnlyHint, true);
  assert.equal(modelWritableTables.has("catch_up_questions"), false);
  assert.equal(modelWritableTables.has("trackers"), false);
  const definitions = registry.toolDefinitions();
  const read = definitions.find(tool => tool.name === "catch_up_list");
  assert.ok(read.inputSchema.required.includes("result_filter"));
  assert.equal(definitions.find(tool => tool.name === "catch_up_refresh").inputSchema.properties.result_filter, undefined);
  const refresh = await registry.execute("catch_up_refresh", scope, {});
  assert.equal(schemaProblem(refresh, definitions.find(tool => tool.name === "catch_up_refresh").outputSchema), null);
  const listed = await registry.execute("catch_up_list", { question_id: null, after_id: 0, limit: 2 });
  assert.equal(schemaProblem(listed, read.outputSchema), null);
  const updated = await registry.execute("catch_up_question_update", { question_id: listed.questions[0].question_id,
    expected_version: listed.questions[0].version, action: "comment", ask_after: null, comment: "Still pending" });
  assert.equal(schemaProblem(updated, definitions.find(tool => tool.name === "catch_up_question_update").outputSchema), null);
  const context = await registry.prepareContext(["catch-up.pending"]);
  assert.match(context[0].text, /personal_task_id/);
});

test("refresh rolls back question creation and reconciliation if a source cannot be read", t => {
  const { db, service, task, organizer } = harness(t);
  task();
  const original = organizer.listCalendar;
  organizer.listCalendar = () => { throw new Error("calendar unavailable"); };
  assert.throws(() => service.refresh(scope), /calendar unavailable/);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM catch_up_questions").get().n), 0);
  organizer.listCalendar = original;
  service.refresh(scope);
  assert.equal(service.list().count, 1);
});

test("question pages preserve all due rows and comments reject stale versions", t => {
  const { service, task, answer } = harness(t);
  for (let i = 0; i < 4; i++) task(`Task ${i}`);
  service.refresh(scope);
  const first = service.list({ limit: 2 });
  const second = service.list({ limit: 2, after_id: first.next_after_id });
  assert.equal(new Set([...first.questions, ...second.questions].map(q => q.question_id)).size, 4);
  assert.equal(second.next_after_id, null);
  const q = first.questions[0];
  answer(q, "comment", { comment: "Waiting for a reply" });
  assert.throws(() => answer(q, "resolve"), /Question changed/);
  assert.throws(() => answer(second.questions[0], "defer", { ask_after: "yesterday" }), /ISO timestamp/);
  assert.equal(service.list().count, 4);
});

test("migration adds only one table, preserves domain rows, replays partial DDL, and verifies actual foreign keys", async t => {
  const temp = temporaryDatabase({ schema: baselineBeforeCatchUp(fs.readFileSync(baselineFilename, "utf8")) });
  t.after(temp.cleanup);
  const db = new MariaDatabaseSync(temp.target.connection); t.after(() => db.close());
  db.exec("INSERT INTO journal_groups (journal_group_id, name) VALUES (901, 'Health')");
  db.exec("INSERT INTO trackers (tracker_id, journal_group_id, name, unit) VALUES (901, 901, 'Weight', 'kg')");
  const options = { connectionSettings: temp.target.connection, backupConfirmed: true, writersStopped: true, output: { write() {} } };
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [36, 37, 38]);
  assert.equal(db.prepare("SELECT asking_recurrence_rule FROM trackers WHERE tracker_id=901").get().asking_recurrence_rule, null);
  await verifyDatabase(db);
  db.exec("UPDATE database_meta SET schema_version=35 WHERE singleton=1");
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [36, 37, 38]);
  assert.deepEqual((await runDatabaseMigrations(options)).applied, []);
  db.exec("ALTER TABLE catch_up_questions DROP FOREIGN KEY catch_up_tracker");
  await assert.rejects(verifyDatabase(db), /source foreign key catch_up_tracker/);
});


test("existing task and journal mutation tools satisfy questions, while failed writes leave them pending", async t => {
  const { service, registry, task, tracker } = harness(t);
  const taskId = task();
  const trackerId = tracker();
  await registry.execute("tracker_asking_schedule_set", { tracker_id: trackerId,
    starts_at_utc: "2026-09-01T04:00:00Z", recurrence }, {});
  await registry.execute("catch_up_refresh", scope, {});
  assert.equal(service.list().count, 2);
  const change = { personal_task_id: taskId, text: null, group: null, status: "complete",
    scheduled_at_utc: null, due_at_utc: null };
  await assert.rejects(registry.execute("todo_update", { updates: [{ ...change, personal_task_id: 999999 }] }, {}), /does not exist/);
  service.refresh(scope);
  assert.equal(service.list().count, 2);
  const completed = await registry.execute("todo_update", { updates: [change] }, {});
  assert.equal(completed.items[0].task.status, "complete");
  await registry.execute("journal_add", { tracker: "Weight", group: null, content_text: "Weight was 72 kg this morning",
    number_value: 72, tracker_unit: null, occurred_at_utc: "2026-09-08T13:00:00Z", create_if_missing: false }, {});
  service.refresh(scope);
  assert.equal(service.list().count, 0);
});

const selection = overrides => ({ time_zone: "America/New_York", logs_date: null, plan_through_date: null,
  todos_before_utc: null, events_before_utc: null, lookback_days: 7, ...overrides });

test("selected past-day logs include unscheduled trackers, persist scope across service instances, and record the selected day", async t => {
  const { service, registry, tracker, task, db, store, organizer } = harness(t);
  tracker(); task();
  service.refresh(scope); // An unrelated due task must not leak into logs-only catch-up.
  const selected = selection({ logs_date: "2026-09-07" });
  const result = service.refresh({ ...scope, scope: selected });
  assert.equal(result.due_count, 1);
  const q = service.list().questions[0];
  assert.equal(q.question_kind, "journal");
  assert.equal(q.occurrence_key, "day:2026-09-07:America/New_York");
  assert.equal(q.period_starts_at_utc, "2026-09-07T04:00:00.000Z");
  assert.equal(q.period_ends_at_utc, "2026-09-08T04:00:00.000Z");
  const resumed = new CatchUpService(store, organizer, new Ledger(store), { now: () => "2026-09-08T22:00:00.000Z" });
  assert.deepEqual(resumed.list().scope, selected);
  await registry.execute("journal_add", { tracker: "Weight", group: null, content_text: "Yesterday's weight",
    number_value: 72, tracker_unit: null, occurred_at_utc: "2026-09-07T13:00:00Z", create_if_missing: false }, {});
  resumed.refresh(scope); // Null/omitted scope must retain yesterday.
  assert.equal(resumed.list().count, 0);
  assert.equal(db.prepare("SELECT asking_recurrence_rule FROM trackers").get().asking_recurrence_rule, null);
  resumed.refresh({ ...scope, scope: selection({ logs_date: "2026-09-08" }) });
  assert.equal(resumed.list().count, 1);
});

test("weekly and monthly journal questions use the selected historical period and existing entries satisfy them", t => {
  const { service, tracker, db } = harness(t);
  const id = tracker();
  service.setTrackerSchedule({ tracker_id: id, starts_at_utc: "2026-08-03T04:00:00Z",
    recurrence: { ...recurrence, frequency: "WEEKLY", weekdays: ["MO"] } });
  service.refresh({ ...scope, scope: selection({ logs_date: "2026-09-02" }) });
  let q = service.list().questions[0];
  assert.equal(q.period_starts_at_utc, "2026-08-31T04:00:00.000Z");
  assert.equal(q.period_ends_at_utc, "2026-09-07T04:00:00.000Z");
  db.prepare("INSERT INTO journal_entries (tracker_id, occurred_at_utc, content_text) VALUES (?, '2026-09-04T13:00:00Z', 'Weekly entry')").run(id);
  service.refresh(scope);
  assert.equal(service.list().count, 0);
  service.setTrackerSchedule({ tracker_id: id, starts_at_utc: "2026-08-01T04:00:00Z",
    recurrence: { ...recurrence, frequency: "MONTHLY" } });
  service.refresh({ ...scope, scope: selection({ logs_date: "2026-08-15" }) });
  q = service.list().questions[0];
  assert.equal(q.period_starts_at_utc, "2026-08-01T04:00:00.000Z");
  assert.equal(q.period_ends_at_utc, "2026-09-01T04:00:00.000Z");
});

test("planning is available ahead of time, survives refresh, reopens on event changes, and is independent of follow-up", t => {
  const { db, service, answer, setNow } = harness(t);
  const id = db.prepare(`INSERT INTO calendar_events (title, starts_at_utc, ends_at_utc, planning_prompt_text)
    VALUES ('Dentist', '2026-09-09T14:00:00.000Z', '2026-09-09T15:00:00.000Z', 'How will you get there?') RETURNING calendar_event_id`).get().calendar_event_id;
  db.exec("INSERT INTO calendar_events (title, starts_at_utc) VALUES ('No planning prompt', '2026-09-09T17:00:00.000Z')");
  service.refresh({ ...scope, scope: selection({ plan_through_date: "2026-09-09" }) });
  let q = service.list().questions[0];
  assert.equal(service.list().count, 1);
  assert.equal(q.question_kind, "planning");
  assert.equal(q.source_occurrence_key, "event");
  answer(q, "resolve"); service.refresh(scope);
  assert.equal(service.list().count, 0);
  db.prepare("UPDATE calendar_events SET starts_at_utc = '2026-09-09T16:00:00.000Z', ends_at_utc = '2026-09-09T17:00:00.000Z' WHERE calendar_event_id = ?").run(id);
  service.refresh(scope);
  q = service.list().questions[0];
  assert.equal(q.resolved_at, null);
  answer(q, "resolve");
  setNow("2026-09-09T17:30:00.000Z");
  service.refresh({ ...scope, scope: selection({ events_before_utc: "2026-09-09T17:30:00.000Z" }) });
  const review = service.list().questions.find(row => row.calendar_event_id === Number(id));
  assert.equal(review.question_kind, "event_review");
  assert.notEqual(review.question_id, q.question_id);
  assert.match(review.question_text, /How did/);
});

test("deadline selection excludes scheduled-only tasks and respects the exclusive cutoff before pagination", t => {
  const { db, service, task, tracker } = harness(t);
  const due = task("Deadline yesterday but scheduled tomorrow", "2026-09-09T13:00:00.000Z");
  db.prepare("UPDATE todo_personal SET due_at_utc='2026-09-07T13:00:00.000Z' WHERE personal_task_id=?").run(due);
  task("Only scheduled yesterday", "2026-09-07T13:00:00.000Z");
  const boundary = task("At cutoff");
  db.prepare("UPDATE todo_personal SET due_at_utc='2026-09-08T22:00:00.000Z' WHERE personal_task_id=?").run(boundary);
  tracker(); service.refresh({ ...scope, scope: selection({ logs_date: "2026-09-08" }) });
  service.refresh({ ...scope, scope: selection({ todos_before_utc: "2026-09-08T22:00:00.000Z" }) });
  const page = service.list({ limit: 1 });
  assert.equal(page.count, 1);
  assert.equal(page.questions[0].personal_task_id, due);
  assert.equal(page.next_after_id, null);
});

test("recurring event planning has separate occurrence identities and returns unprefixed calendar keys", t => {
  const { db, service, answer } = harness(t);
  db.exec(`INSERT INTO calendar_events (title, starts_at_utc, ends_at_utc, time_zone, recurrence_rule, planning_prompt_text)
    VALUES ('Daily appointment', '2026-09-09T14:00:00.000Z', '2026-09-09T15:00:00.000Z', 'America/New_York', 'FREQ=DAILY;COUNT=3', 'What needs preparing?')`);
  service.refresh({ ...scope, scope: selection({ plan_through_date: "2026-09-10" }) });
  const questions = service.list().questions;
  assert.equal(questions.length, 2);
  assert.equal(questions[0].source_occurrence_key, "2026-09-09T14:00:00.000Z");
  assert.equal(questions[1].source_occurrence_key, "2026-09-10T14:00:00.000Z");
  answer(questions[0], "resolve"); service.refresh(scope);
  assert.equal(service.list().count, 1);
});

test("selected daily journal windows respect DST and deferrals survive scope switches", t => {
  const { service, tracker, answer, setNow } = harness(t);
  tracker();
  const selected = selection({ logs_date: "2026-03-08" });
  service.refresh({ ...scope, scope: selected });
  let q = service.list().questions[0];
  assert.equal(q.period_starts_at_utc, "2026-03-08T05:00:00.000Z");
  assert.equal(q.period_ends_at_utc, "2026-03-09T04:00:00.000Z");
  answer(q, "defer", { ask_after: "2026-09-09T12:00:00Z" });
  service.refresh({ ...scope, scope: selection({ logs_date: "2026-09-08" }) });
  service.refresh({ ...scope, scope: selected });
  assert.equal(service.list().count, 0);
  setNow("2026-09-09T13:00:00.000Z");
  assert.equal(service.list().count, 1);
});

test("past-event review includes the cutoff instant and excludes events still in progress", t => {
  const { db, service } = harness(t);
  db.exec(`INSERT INTO calendar_events (title, starts_at_utc, ends_at_utc) VALUES
    ('At cutoff', '2026-09-08T22:00:00.000Z', NULL),
    ('Still happening', '2026-09-08T21:00:00.000Z', '2026-09-08T23:00:00.000Z'),
    ('Too old', '2026-09-07T21:00:00.000Z', '2026-09-07T23:00:00.000Z')`);
  const result = service.refresh({ ...scope, scope: selection({ events_before_utc: '2026-09-08T22:00:00.000Z', lookback_days: 0 }) });
  assert.equal(result.due_count, 1);
  assert.match(service.list().questions[0].question_text, /At cutoff/);
});
