import assert from "node:assert/strict";
import test from "node:test";
import { OrganizerInputError, OrganizerStore } from "../src/organizer-store.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("calendar events use the existing tables with optimistic concurrency", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const created = organizer.createCalendar({
      title: "Dentist",
      startsAtUtc: "2026-08-18T19:00:00.000Z",
      endsAtUtc: "2026-08-18T20:00:00.000Z",
      timeZone: "America/New_York",
    });
    assert.equal(created.status, "active");
    assert.equal(organizer.listCalendar({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    }).some(({ id }) => id === created.id), true);

    const updated = organizer.updateCalendar(created.id, {
      version: created.version,
      title: "Dental cleaning",
      status: "archived",
    });
    assert.equal(updated.title, "Dental cleaning");
    assert.equal(updated.status, "archived");
    assert.equal(organizer.listCalendar({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    }).some(({ id }) => id === created.id), false);
    assert.throws(
      () => organizer.updateCalendar(created.id, { version: created.version, title: "Stale" }),
      (error) => error instanceof OrganizerInputError && error.statusCode === 409,
    );
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("calendar events can create, display, edit, and stop recurring series", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const created = organizer.createCalendar({
      title: "Weekly planning",
      startsAtUtc: "2026-08-17T13:00:00.000Z",
      endsAtUtc: "2026-08-17T14:00:00.000Z",
      timeZone: "America/New_York",
      recurrenceRule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=3",
    });
    assert.equal(created.recurrenceRule, "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=3");

    const occurrences = organizer.listCalendar({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-15T00:00:00.000Z",
    }).filter(({ seriesId }) => seriesId === created.id);
    assert.equal(occurrences.length, 3);
    assert.equal(occurrences[0].seriesStartsAtUtc, created.startsAtUtc);
    assert.equal(occurrences[0].seriesEndsAtUtc, created.endsAtUtc);

    const updated = organizer.updateCalendar(created.id, {
      version: created.version,
      recurrenceRule: null,
    });
    assert.equal(updated.recurrenceRule, null);
    assert.equal(organizer.listCalendar({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-15T00:00:00.000Z",
    }).filter(({ id }) => id === created.id).length, 1);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("contacts support searchable-page data, multiple methods, and safe edits", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const created = organizer.createContact({
      kind: "person",
      displayName: "Alex Rivera",
      givenName: "Alex",
      familyName: "Rivera",
      birthDate: "--08-18",
      notes: "Met through the neighborhood garden.",
      tags: ["Friend", "Garden"],
      methods: [
        { kind: "email", label: "Personal", value: "Alex@Example.test", isPrimary: true },
        { kind: "phone", label: "Mobile", value: "+1 (555) 010-0200" },
      ],
    });
    assert.equal(created.displayName, "Alex Rivera");
    assert.equal(created.methods.length, 2);
    assert.deepEqual(created.tags, ["Friend", "Garden"]);
    assert.equal(created.methods[0].kind, "email");
    assert.equal(organizer.listContacts()[0].birthDate, "--08-18");

    const email = created.methods.find(({ kind }) => kind === "email");
    const updated = organizer.updateContact(created.id, {
      version: created.version,
      status: "inactive",
      methods: [{ ...email, value: "alex.rivera@example.test" }],
    });
    assert.equal(updated.status, "inactive");
    assert.equal(updated.methods.length, 1);
    assert.equal(updated.methods[0].id, email.id);
    assert.deepEqual(organizer.listContacts(), []);
    assert.equal(organizer.listContacts({ scope: "all" })[0].displayName, "Alex Rivera");
    assert.throws(
      () => organizer.updateContact(created.id, { version: "stale", displayName: "Stale" }),
      (error) => error instanceof OrganizerInputError && error.statusCode === 409,
    );
    assert.throws(
      () => organizer.createContact({ displayName: "Bad birthday", birthDate: "--02-30" }),
      (error) => error instanceof OrganizerInputError && /birthDate/.test(error.message),
    );
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM activity_events
      WHERE event_type IN ('contact.created', 'contact.updated')
    `).get().count, 2);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("contact merges combine methods and tags while retaining inactive source records", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const kept = organizer.createContact({
      displayName: "Jordan Lee",
      givenName: "Jordan",
      tags: ["Friend"],
      methods: [{ kind: "email", value: "jordan@example.test", isPrimary: true }],
    });
    const duplicate = organizer.createContact({
      displayName: "Jordan A. Lee",
      familyName: "Lee",
      birthDate: "1985-03-12",
      notes: "Met at the library.",
      tags: ["Library"],
      methods: [
        { kind: "email", value: "JORDAN@example.test" },
        { kind: "phone", value: "+1 555 010 0199" },
      ],
    });
    const merged = organizer.mergeContacts({
      keepContactId: kept.id,
      mergeContactIds: [duplicate.id],
      versions: { [kept.id]: kept.version, [duplicate.id]: duplicate.version },
    });
    assert.equal(merged.contact.displayName, "Jordan Lee");
    assert.notEqual(merged.contact.version, kept.version);
    assert.equal(merged.contact.familyName, "Lee");
    assert.equal(merged.contact.birthDate, "1985-03-12");
    assert.deepEqual(merged.contact.methods.map(({ kind }) => kind), ["email", "phone"]);
    assert.deepEqual(merged.contact.tags, ["Friend", "Library"]);
    assert.equal(organizer.listContacts().length, 1);
    const source = organizer.listContacts({ scope: "all" }).find(({ id }) => id === duplicate.id);
    assert.equal(source.status, "inactive");
    assert.match(source.notes, /Merged into Jordan Lee/);
    assert.throws(
      () => organizer.updateContact(kept.id, { version: kept.version, displayName: "Stale merge edit" }),
      (error) => error instanceof OrganizerInputError && error.statusCode === 409,
    );
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM activity_events WHERE event_type = 'contacts.merged'
    `).get().count, 1);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("grouped and recurring todos use the existing task tables", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Health" });
    const created = organizer.createTodo({
      text: "Weekly review",
      groupId: group.id,
      scheduledAtUtc: "2026-08-17T04:00:00.000Z",
      dueAtUtc: "2026-08-17T20:00:00.000Z",
      isAllDay: true,
      recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
      recurrenceTimeZone: "America/New_York",
    });
    assert.equal(created.groupName, "Health");
    assert.equal(created.isAllDay, true);
    assert.ok(created.routineId);

    const completed = organizer.updateTodo(created.id, {
      version: created.version,
      status: "complete",
    });
    assert.ok(completed.completedAtUtc);
    const generated = organizer.listTodos({ scope: "active" })
      .find((todo) => todo.routineId === created.routineId);
    assert.ok(generated);
    assert.equal(generated.isAllDay, true);
    assert.ok(new Date(generated.scheduledAtUtc) > new Date(created.scheduledAtUtc));
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("personal log entries and grouped trackers are available to the web organizer", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const first = organizer.createLogEntry({
      trackerName: "Weight",
      groupName: "Health",
      contentText: "72.1 kg after dinner",
      numberValue: 72.1,
      unit: "kg",
      occurredAtUtc: "2026-08-16T00:30:00.000Z",
    });
    assert.equal(first.trackerName, "Weight");
    assert.equal(first.groupName, "Health");
    assert.equal(first.source, "tailnet_web");
    assert.equal(first.numberValue, 72.1);

    const second = organizer.createLogEntry({
      trackerId: first.trackerId,
      contentText: "71.8 kg before breakfast",
      numberValue: 71.8,
      unit: null,
      occurredAtUtc: "2026-08-16T08:00:00.000Z",
    });
    assert.equal(second.unit, "kg");
    assert.deepEqual(
      organizer.listLogEntries({ trackerId: first.trackerId }).map(({ contentText }) => contentText),
      ["71.8 kg before breakfast", "72.1 kg after dinner"],
    );

    const trackers = organizer.listLogTrackers();
    assert.equal(trackers.length, 1);
    assert.equal(trackers[0].entryCount, 2);
    assert.equal(trackers[0].lastLoggedAtUtc, "2026-08-16T08:00:00.000Z");
    assert.throws(
      () => organizer.createLogEntry({
        trackerName: "Mood",
        contentText: "Calm",
        numberValue: null,
        unit: "points",
      }),
      (error) => error instanceof OrganizerInputError && /requires a numeric value/.test(error.message),
    );
    assert.equal(organizer.database.prepare(
      "SELECT COUNT(*) AS count FROM activity_events WHERE event_type = 'personal_log.created'",
    ).get().count, 2);
    assert.equal(organizer.database.prepare(
      "SELECT COUNT(*) AS count FROM log_entries WHERE source_event_id IS NOT NULL",
    ).get().count, 2);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("recurrence can be added, edited, and removed through todo updates", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Home" });
    const created = organizer.createTodo({
      text: "Water plants",
      groupId: group.id,
      scheduledAtUtc: "2026-08-18T12:00:00.000Z",
    });
    assert.equal(created.routineId, null);

    const recurring = organizer.updateTodo(created.id, {
      version: created.version,
      recurrenceRule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR;COUNT=8",
      recurrenceTimeZone: "America/New_York",
    });
    assert.ok(recurring.routineId);
    assert.equal(recurring.recurrenceRule, "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR;COUNT=8");

    const edited = organizer.updateTodo(created.id, {
      version: recurring.version,
      text: "Water all plants",
      recurrenceRule: "FREQ=MONTHLY;INTERVAL=1;UNTIL=20261231T235959Z",
      recurrenceTimeZone: "America/New_York",
    });
    assert.equal(edited.routineId, recurring.routineId);
    assert.equal(edited.recurrenceRule, "FREQ=MONTHLY;INTERVAL=1;UNTIL=20261231T235959Z");
    assert.equal(organizer.database.prepare(
      "SELECT text FROM todo_routines WHERE todo_routine_id = ?",
    ).get(recurring.routineId).text, "Water all plants");

    const oneTime = organizer.updateTodo(created.id, {
      version: edited.version,
      recurrenceRule: null,
      recurrenceTimeZone: null,
    });
    assert.equal(oneTime.routineId, null);
    assert.equal(oneTime.recurrenceRule, null);
    assert.ok(organizer.database.prepare(
      "SELECT disabled_at_utc FROM todo_routines WHERE todo_routine_id = ?",
    ).get(recurring.routineId).disabled_at_utc);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("group reordering atomically normalizes every task position", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Ordered work" });
    const tasks = ["First", "Second", "Third", "Fourth"]
      .map((text) => organizer.createTodo({ text, groupId: group.id }));

    organizer.reorderTodos(group.id, {
      orderedTodoIds: [tasks[3].id, tasks[0].id, tasks[1].id, tasks[2].id],
    });
    organizer.reorderTodos(group.id, {
      orderedTodoIds: [tasks[2].id, tasks[0].id],
    });

    const ordered = organizer.listTodos({ scope: "all" }).filter(({ groupId }) => groupId === group.id);
    assert.deepEqual(ordered.map(({ text }) => text), ["Fourth", "Third", "Second", "First"]);
    assert.deepEqual(ordered.map(({ sortPosition }) => sortPosition), [10, 20, 30, 40]);
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM activity_events WHERE event_type = 'personal_todo.reordered'
    `).get().count, 2);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("to-do group reordering atomically moves whole groups", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const first = organizer.createTodoGroup({ name: "First custom group" });
    const second = organizer.createTodoGroup({ name: "Second custom group" });
    organizer.createTodo({ text: "First grouped task", groupId: first.id });
    organizer.createTodo({ text: "Second grouped task", groupId: second.id });

    organizer.reorderTodoGroups({ orderedGroupIds: [second.id, first.id, 1, 2] });
    organizer.reorderTodoGroups({ orderedGroupIds: [2, second.id] });

    const groups = organizer.listTodoGroups();
    assert.deepEqual(
      groups.map(({ name }) => name),
      ["Development", "First custom group", "Inbox", "Second custom group"],
    );
    assert.deepEqual(groups.map(({ sortPosition }) => sortPosition), [10, 20, 30, 40]);
    assert.deepEqual(
      organizer.listTodos({ scope: "all" }).map(({ text }) => text),
      ["First grouped task", "Second grouped task"],
    );
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM activity_events
      WHERE event_type = 'personal_todo_group.reordered'
    `).get().count, 2);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("renaming a group preserves membership and explicit ordering", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Zulu" });
    const task = organizer.createTodo({ text: "Keeps its group ID", groupId: group.id });
    const result = organizer.renameTodoGroup(group.id, { name: "Alpha" });
    assert.equal(result.group.previousName, "Zulu");
    assert.equal(result.group.name, "Alpha");
    assert.equal(organizer.getTodo(task.id).groupName, "Alpha");
    assert.deepEqual(
      organizer.listTodoGroups().map(({ name }) => name),
      ["Development", "Inbox", "Alpha"],
    );
    assert.throws(
      () => organizer.renameTodoGroup(group.id, { name: "Development" }),
      (error) => error.statusCode === 409 && /already exists/.test(error.message),
    );
    assert.throws(
      () => organizer.renameTodoGroup(1, { name: "Incoming" }),
      (error) => error.statusCode === 409 && /cannot be renamed/.test(error.message),
    );
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("archiving a group fails on active tasks and preserves terminal task history", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Temporary" });
    const active = organizer.createTodo({ text: "Still active", groupId: group.id });
    const completed = organizer.createTodo({
      text: "Already done", groupId: group.id, status: "complete", sequence: 7,
    });
    assert.throws(
      () => organizer.archiveTodoGroup(group.id),
      (error) => error.statusCode === 409 && /active task/.test(error.message),
    );

    organizer.updateTodo(active.id, { version: active.version, status: "ignore" });
    const result = organizer.archiveTodoGroup(group.id);
    assert.equal(result.retainedTerminalTaskCount, 2);
    assert.equal(organizer.listTodoGroups().some(({ id }) => id === group.id), false);
    assert.ok(organizer.listTodoGroups({ includeArchived: true }).find(({ id }) => id === group.id)?.archivedAtUtc);
    const retained = [organizer.getTodo(active.id), organizer.getTodo(completed.id)];
    assert.deepEqual(retained.map(({ groupName }) => groupName), ["Temporary", "Temporary"]);
    assert.deepEqual(retained.map(({ sequence }) => sequence), [null, 7]);
    assert.ok(retained.every(({ groupArchivedAtUtc }) => groupArchivedAtUtc));
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});
