import assert from "node:assert/strict";
import test from "node:test";
import { OrganizerInputError, OrganizerStore } from "../src/organizer-store.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("calendar events use the existing tables with optimistic concurrency and safe deletion", () => {
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
    assert.throws(
      () => organizer.deleteCalendar(created.id, { version: created.version }),
      (error) => error instanceof OrganizerInputError && error.statusCode === 409,
    );
    const deleted = organizer.deleteCalendar(created.id, { version: updated.version });
    assert.equal(deleted.deleted.title, "Dental cleaning");
    assert.equal(organizer.getCalendar(created.id), null);
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM activity_events WHERE event_type = 'calendar.event.deleted'
    `).get().count, 1);
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

test("calendar search matches all terms across stored event details and optionally includes archived events", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const matching = organizer.createCalendar({
      title: "Dental cleaning",
      description: "Bring insurance card",
      location: "Main Street clinic",
      startsAtUtc: "2099-08-18T19:00:00.000Z",
      endsAtUtc: "2099-08-18T20:00:00.000Z",
      timeZone: "America/New_York",
    });
    organizer.createCalendar({
      title: "Garden planning",
      description: "Bring sketches",
      startsAtUtc: "2099-08-19T19:00:00.000Z",
    });
    organizer.createCalendar({
      title: "Archived dental follow-up",
      location: "Main Street clinic",
      startsAtUtc: "2099-08-20T19:00:00.000Z",
      status: "archived",
    });
    const percentage = organizer.createCalendar({
      title: "Plan the 100% milestone",
      startsAtUtc: "2099-08-21T19:00:00.000Z",
    });

    const active = organizer.searchCalendar({ query: "cleaning Main", limit: 20 });
    assert.equal(active.query, "cleaning Main");
    assert.deepEqual(active.events.map(({ id }) => id), [matching.id]);
    assert.equal(active.events[0].location, "Main Street clinic");

    assert.equal(organizer.searchCalendar({ query: "archived dental" }).events.length, 0);
    assert.equal(organizer.searchCalendar({
      query: "archived dental",
      includeArchived: true,
    }).events[0].status, "archived");
    assert.deepEqual(
      organizer.searchCalendar({ query: "%" }).events.map(({ id }) => id),
      [percentage.id],
    );
    assert.throws(() => organizer.searchCalendar({ query: "   " }), /query is required/);
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
    assert.equal(updated.givenName, "Alex");
    assert.equal(updated.familyName, "Rivera");
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

test("bulk contact tagging and deletion are version-checked and atomic", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const first = organizer.createContact({
      displayName: "First Contact",
      tags: ["Friend"],
      methods: [{ kind: "email", value: "first@example.test" }],
    });
    const second = organizer.createContact({ displayName: "Second Contact", tags: ["Work"] });
    const retained = organizer.createContact({ displayName: "Retained Contact", tags: ["Keep"] });

    const tagged = organizer.bulkContacts({
      action: "add_tag",
      tag: "Holiday Card",
      contacts: [
        { id: first.id, expectedVersion: first.version },
        { id: second.id, expectedVersion: second.version },
      ],
    });
    assert.deepEqual(tagged, { action: "add_tag", affectedCount: 2, tag: "Holiday Card" });
    assert.deepEqual(organizer.getContact(first.id).tags, ["Friend", "Holiday Card"]);
    assert.deepEqual(organizer.getContact(second.id).tags, ["Holiday Card", "Work"]);
    assert.deepEqual(organizer.getContact(retained.id).tags, ["Keep"]);

    const firstTagged = organizer.getContact(first.id);
    const secondTagged = organizer.getContact(second.id);
    const secondChanged = organizer.updateContact(second.id, {
      version: secondTagged.version,
      notes: "Changed after selection",
    });
    assert.throws(
      () => organizer.bulkContacts({
        action: "delete",
        contacts: [
          { id: first.id, expectedVersion: firstTagged.version },
          { id: second.id, expectedVersion: secondTagged.version },
        ],
      }),
      (error) => error instanceof OrganizerInputError && error.statusCode === 409,
    );
    assert.ok(organizer.getContact(first.id));
    assert.ok(organizer.getContact(second.id));

    const deleted = organizer.bulkContacts({
      action: "delete",
      contacts: [
        { id: first.id, expectedVersion: firstTagged.version },
        { id: second.id, expectedVersion: secondChanged.version },
      ],
    });
    assert.deepEqual(deleted, { action: "delete", affectedCount: 2 });
    assert.equal(organizer.getContact(first.id), null);
    assert.equal(organizer.getContact(second.id), null);
    assert.equal(organizer.getContact(retained.id).displayName, "Retained Contact");
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM record_tags
      WHERE record_type = 'contact' AND record_id IN (?, ?)
    `).get(String(first.id), String(second.id)).count, 0);
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM activity_events
      WHERE event_type IN ('contacts.tag_added', 'contacts.deleted')
    `).get().count, 2);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("contact tag rename merges existing destinations without touching other record types", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const first = organizer.createContact({ displayName: "First", tags: ["Old Tag", "Target"] });
    const second = organizer.createContact({ displayName: "Second", tags: ["Old Tag"] });
    const third = organizer.createContact({ displayName: "Third", tags: ["Target"] });
    const oldTag = organizer.database.prepare("SELECT tag_id FROM tags WHERE slug = 'old-tag'").get();
    organizer.database.prepare(`
      INSERT INTO record_tags (tag_id, record_type, record_id)
      VALUES (?, 'future_record', 'example')
    `).run(oldTag.tag_id);

    const renamed = organizer.renameContactTag({ currentTag: "Old Tag", newTag: "Target" });
    assert.deepEqual(renamed, {
      previousTag: "Old Tag",
      tag: "Target",
      affectedContactCount: 2,
      mergedWithExistingTag: true,
    });
    assert.deepEqual(organizer.getContact(first.id).tags, ["Target"]);
    assert.deepEqual(organizer.getContact(second.id).tags, ["Target"]);
    assert.deepEqual(organizer.getContact(third.id).tags, ["Target"]);
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM record_tags
      WHERE tag_id = ? AND record_type = 'contact'
    `).get(oldTag.tag_id).count, 0);
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM record_tags
      WHERE tag_id = ? AND record_type = 'future_record'
    `).get(oldTag.tag_id).count, 1);
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM activity_events WHERE event_type = 'contacts.tag_renamed'
    `).get().count, 1);
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
    const birthdays = organizer.listCalendar({
      from: "2026-03-11T00:00:00.000Z",
      to: "2026-03-14T00:00:00.000Z",
    }).filter(({ sourceKind }) => sourceKind === "contact_birthday");
    assert.deepEqual(birthdays.map(({ contactId }) => contactId), [kept.id]);
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

test("contact duplicate review requires a shared name part and method to connect different full names", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const first = organizer.createContact({
      displayName: "Aaron Williams",
      methods: [
        { kind: "email", value: "aaron@example.test" },
        { kind: "phone", value: "+1 (555) 010-0101" },
      ],
    });
    const second = organizer.createContact({
      displayName: "AARON-WILLIAMS",
      methods: [{ kind: "email", value: "AARON@example.test" }],
    });
    const third = organizer.createContact({
      displayName: "Anne Ritchie",
      methods: [
        { kind: "email", value: "anne@example.test" },
        { kind: "phone", value: "1-555-010-0101" },
      ],
    });
    const fourth = organizer.createContact({
      displayName: "ANNE RITCHIE",
      methods: [{ kind: "email", value: "ANNE@example.test" }],
    });
    const ranked = organizer.createContact({
      displayName: "SSgt. Allen",
      methods: [{ kind: "phone", value: "+1 555 010 0199" }],
    });
    const named = organizer.createContact({
      displayName: "Brandon Allen",
      methods: [{ kind: "phone", value: "1-555-010-0199" }],
    });
    organizer.createContact({
      displayName: "Inactive copy",
      status: "inactive",
      methods: [{ kind: "phone", value: "1-555-010-0199" }],
    });

    const review = organizer.listContactDuplicates({ limit: 10 });
    assert.equal(review.activeContactCount, 6);
    assert.equal(review.scannedContactCount, 6);
    assert.equal(review.scanTruncated, false);
    assert.equal(review.totalDuplicateGroups, 3);
    assert.equal(review.hasMore, false);
    const aaronGroup = review.groups.find(({ contactIds }) => contactIds.includes(first.id));
    const anneGroup = review.groups.find(({ contactIds }) => contactIds.includes(third.id));
    const allenGroup = review.groups.find(({ contactIds }) => contactIds.includes(ranked.id));
    assert.deepEqual(new Set(aaronGroup.contactIds), new Set([first.id, second.id]));
    assert.deepEqual(aaronGroup.evidence, ["same name", "same email"]);
    assert.deepEqual(new Set(anneGroup.contactIds), new Set([third.id, fourth.id]));
    assert.deepEqual(anneGroup.evidence, ["same name", "same email"]);
    assert.equal(aaronGroup.contactIds.includes(third.id), false);
    assert.deepEqual(new Set(allenGroup.contactIds), new Set([ranked.id, named.id]));
    assert.deepEqual(allenGroup.evidence, ["same name part", "same phone"]);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("automatic contact dedupe leaves partial-name matches for review", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const insertContact = organizer.database.prepare(`
      INSERT INTO contacts (display_name, source, external_id, updated_at_utc)
      VALUES (?, ?, ?, '2026-08-17T12:00:00.000Z') RETURNING contact_id
    `);
    const insertPhone = organizer.database.prepare(`
      INSERT INTO contact_methods (
        contact_id, method_kind, label, value, normalized_value, is_primary, can_receive
      ) VALUES (?, 'phone', 'Imported', ?, ?, 1, 1)
    `);
    const add = (displayName, source, externalId, phone) => {
      const { contact_id: contactId } = insertContact.get(displayName, source, externalId);
      insertPhone.run(contactId, phone, phone.replace(/\D/g, ""));
    };
    add("Brandon Allen", "source-a", "source-a-brandon", "+1 555 010 0199");
    add("BRANDON-ALLEN", "source-b", "source-b-brandon", "1-555-010-0199");
    add("SSgt. Allen", "source-c", "source-c-allen", "1 (555) 010-0199");

    assert.equal(organizer.listContactDuplicates({ limit: 10 }).groups[0].contactIds.length, 3);
    const result = organizer.dedupeClearContacts({ maxGroups: 10, preferredSource: "source-a" });
    assert.equal(result.candidateGroupCount, 1);
    assert.equal(result.mergedGroupCount, 1);
    assert.equal(result.mergedContactCount, 1);
    assert.deepEqual(
      new Set(organizer.listContacts().map(({ displayName }) => displayName)),
      new Set(["Brandon Allen", "SSgt. Allen"]),
    );
    assert.equal(organizer.listContactDuplicates({ limit: 10 }).totalDuplicateGroups, 1);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("contact merge batches roll back every group when one reviewed version is stale", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const firstKeep = organizer.createContact({ displayName: "First", methods: [{ kind: "email", value: "first@example.test" }] });
    const firstMerge = organizer.createContact({ displayName: "First copy", methods: [{ kind: "email", value: "FIRST@example.test" }] });
    const secondKeep = organizer.createContact({ displayName: "Second", methods: [{ kind: "email", value: "second@example.test" }] });
    const secondMerge = organizer.createContact({ displayName: "Second copy", methods: [{ kind: "email", value: "SECOND@example.test" }] });
    const operation = (keep, merged, keepVersion = keep.version) => ({
      keepContactId: keep.id,
      mergeContactIds: [merged.id],
      versions: { [keep.id]: keepVersion, [merged.id]: merged.version },
    });
    assert.throws(
      () => organizer.mergeContactBatch([
        operation(firstKeep, firstMerge),
        operation(secondKeep, secondMerge, "stale-version"),
      ]),
      /changed while the merge was being reviewed/,
    );
    assert.equal(organizer.listContacts().length, 4);
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM activity_events WHERE event_type = 'contacts.merged'
    `).get().count, 0);

    const merged = organizer.mergeContactBatch([
      operation(firstKeep, firstMerge),
      operation(secondKeep, secondMerge),
    ]);
    assert.equal(merged.mergedGroupCount, 2);
    assert.equal(merged.mergedContactCount, 2);
    assert.equal(organizer.listContacts().length, 2);
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

test("reserved routine templates preview and publish as idempotent one-time todos", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const routineGroup = organizer.ensureRoutineGroup();
    assert.equal(routineGroup.name, "Routine");
    assert.equal(organizer.ensureRoutineGroup().id, routineGroup.id);
    const template = organizer.createTodo({
      text: "Monthly finance review",
      groupId: routineGroup.id,
      scheduledAtUtc: "2026-09-04T13:00:00.000Z",
      recurrenceRule: "FREQ=MONTHLY;INTERVAL=1;BYDAY=FR;BYSETPOS=1",
      recurrenceTimeZone: "UTC",
    });
    const preview = organizer.previewRoutines({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    });
    assert.equal(preview.occurrences.length, 1);
    assert.equal(preview.occurrences[0].templateTodoId, template.id);
    assert.equal(preview.occurrences[0].scheduledAtUtc, "2026-09-04T13:00:00.000Z");
    const earlierRepresentativeMonth = organizer.previewRoutines({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(earlierRepresentativeMonth.occurrences.length, 1);
    assert.equal(earlierRepresentativeMonth.occurrences[0].scheduledAtUtc, "2026-08-07T13:00:00.000Z");

    const first = organizer.publishRoutines({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    });
    assert.equal(first.createdCount, 1);
    assert.equal(first.existingCount, 0);
    assert.equal(first.todos[0].routineId, null);
    assert.equal(first.todos[0].source, "routine_publish");
    assert.equal(first.todos[0].groupName, "Inbox");
    assert.ok(organizer.database.prepare(
      "SELECT source_event_id FROM personal_tasks WHERE personal_task_id = ?",
    ).get(first.todos[0].id).source_event_id);
    const second = organizer.publishRoutines({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    });
    assert.equal(second.createdCount, 0);
    assert.equal(second.existingCount, 1);
    assert.equal(organizer.database.prepare(
      "SELECT COUNT(*) AS count FROM calendar_events",
    ).get().count, 0);
    assert.throws(
      () => organizer.renameTodoGroup(routineGroup.id, { name: "Habits" }),
      /cannot be renamed/,
    );
    assert.throws(() => organizer.archiveTodoGroup(routineGroup.id), /cannot be archived/);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("overdue active todos move onto the requested local day as one batch", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Catch up" });
    const timed = organizer.createTodo({
      text: "Overdue timed task",
      groupId: group.id,
      scheduledAtUtc: "2026-08-15T13:30:00.000Z",
      dueAtUtc: "2026-08-16T15:00:00.000Z",
    });
    const allDay = organizer.createTodo({
      text: "Overdue all-day task",
      groupId: group.id,
      scheduledAtUtc: "2026-08-16T04:00:00.000Z",
      isAllDay: true,
    });
    const today = organizer.createTodo({
      text: "Already today",
      groupId: group.id,
      scheduledAtUtc: "2026-08-17T04:00:00.000Z",
      isAllDay: true,
    });
    const completed = organizer.createTodo({
      text: "Completed in the past",
      groupId: group.id,
      scheduledAtUtc: "2026-08-14T14:00:00.000Z",
      status: "complete",
    });

    const result = organizer.moveOverdueTodosToToday({
      localDate: "2026-08-17",
      timeZone: "America/New_York",
    });

    assert.deepEqual(result, { movedCount: 2, movedTodoIds: [timed.id, allDay.id] });
    assert.equal(organizer.getTodo(timed.id).scheduledAtUtc, "2026-08-17T13:30:00.000Z");
    assert.equal(organizer.getTodo(timed.id).dueAtUtc, "2026-08-18T15:00:00.000Z");
    assert.equal(organizer.getTodo(allDay.id).scheduledAtUtc, "2026-08-17T04:00:00.000Z");
    assert.equal(organizer.getTodo(today.id).scheduledAtUtc, "2026-08-17T04:00:00.000Z");
    assert.equal(organizer.getTodo(completed.id).scheduledAtUtc, "2026-08-14T14:00:00.000Z");
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM activity_events
      WHERE event_type = 'personal_todos.moved_to_today'
    `).get().count, 1);
    assert.deepEqual(organizer.moveOverdueTodosToToday({
      localDate: "2026-08-17",
      timeZone: "America/New_York",
    }), { movedCount: 0, movedTodoIds: [] });
    assert.throws(
      () => organizer.moveOverdueTodosToToday({ localDate: "2026-02-30", timeZone: "UTC" }),
      /valid calendar date/,
    );
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

test("one-time todos can clear only their scheduled date", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Unscheduled" });
    const created = organizer.createTodo({
      text: "Pick up supplies",
      groupId: group.id,
      scheduledAtUtc: "2026-08-18T04:00:00.000Z",
      dueAtUtc: "2026-08-20T16:00:00.000Z",
      isAllDay: true,
    });
    const updated = organizer.updateTodo(created.id, {
      version: created.version,
      scheduledAtUtc: null,
      isAllDay: false,
    });
    assert.equal(updated.scheduledAtUtc, null);
    assert.equal(updated.isAllDay, false);
    assert.equal(updated.dueAtUtc, created.dueAtUtc);
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

test("to-do group sequence mode assigns stable next numbers only while enabled", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const group = organizer.createTodoGroup({ name: "Watch Jobs" });
    const numbered = organizer.createTodo({ text: "Existing numbered task", groupId: group.id, sequence: 7 });
    const first = organizer.createTodo({ text: "First unnumbered task", groupId: group.id });
    const second = organizer.createTodo({ text: "Second unnumbered task", groupId: group.id });

    const enabled = organizer.setTodoGroupSequenceMode(group.id, { usesSequence: true });
    assert.equal(enabled.changed, true);
    assert.equal(enabled.assignedTaskCount, 2);
    assert.equal(organizer.listTodoGroups().find(({ id }) => id === group.id).usesSequence, true);
    assert.deepEqual(
      [numbered.id, first.id, second.id].map((id) => organizer.getTodo(id).sequence),
      [7, 8, 9],
    );
    assert.equal(organizer.createTodo({ text: "Next watch job", groupId: group.id }).sequence, 10);
    assert.deepEqual(
      organizer.listTodos({ scope: "all" })
        .filter(({ groupId }) => groupId === group.id)
        .map(({ sequence }) => sequence),
      [10, 9, 8, 7],
    );

    const reassigned = organizer.assignNextTodoSequence(first.id, {
      version: organizer.getTodo(first.id).version,
    });
    assert.equal(reassigned.sequence, 11);
    assert.equal(organizer.getTodo(second.id).sequence, 9);

    const disabled = organizer.setTodoGroupSequenceMode(group.id, { usesSequence: false });
    assert.equal(disabled.changed, true);
    assert.equal(disabled.assignedTaskCount, 0);
    assert.equal(organizer.createTodo({ text: "Optional number", groupId: group.id }).sequence, null);
    assert.equal(organizer.getTodo(numbered.id).sequence, 7);
    assert.throws(
      () => organizer.assignNextTodoSequence(numbered.id, {
        version: organizer.getTodo(numbered.id).version,
      }),
      (error) => error.statusCode === 409 && /does not use automatic sequence/.test(error.message),
    );
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

test("to-dos expose related contacts and carry them into recurring occurrences", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    const contact = organizer.createContact({ displayName: "Acme Watch Company" });
    const task = organizer.createTodo({
      text: "Check the open watch job",
      relatedContactId: contact.id,
      scheduledAtUtc: "2099-08-17T14:00:00.000Z",
      recurrenceRule: "FREQ=DAILY;COUNT=2",
      recurrenceTimeZone: "America/New_York",
    });
    assert.equal(task.relatedContactId, contact.id);
    assert.equal(task.relatedContactName, "Acme Watch Company");
    assert.equal(task.relatedContactStatus, "active");
    assert.equal(organizer.listTodos()[0].relatedContactName, "Acme Watch Company");

    const completed = organizer.updateTodo(task.id, { version: task.version, status: "complete" });
    assert.equal(completed.status, "complete");
    const next = organizer.listTodos().find(({ routineId }) => routineId === task.routineId);
    assert.ok(next);
    assert.equal(next.relatedContactId, contact.id);
    assert.equal(next.relatedContactName, "Acme Watch Company");

    const detached = organizer.updateTodo(next.id, {
      version: next.version,
      relatedContactId: null,
    });
    assert.equal(detached.relatedContactId, null);
    assert.equal(detached.relatedContactName, null);
    assert.throws(
      () => organizer.createTodo({ text: "Unknown customer", relatedContactId: 999_999 }),
      (error) => error instanceof OrganizerInputError
        && error.statusCode === 404
        && /Related contact/.test(error.message),
    );
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});

test("grouped content supports sequence-aware CRUD, filtering, and safe group lifecycle", () => {
  const temporary = temporaryDatabase();
  const organizer = new OrganizerStore(temporary.filename);
  try {
    assert.deepEqual(organizer.listContentGroups().map(({ name }) => name), ["General"]);
    const campaigns = organizer.createContentGroup({ name: "Campaigns" });
    const research = organizer.createContentGroup({ name: "Research" });
    organizer.reorderContentGroups({ orderedGroupIds: [research.id, campaigns.id, 1] });
    assert.deepEqual(
      organizer.listContentGroups().map(({ name }) => name),
      ["Research", "Campaigns", "General"],
    );

    const first = organizer.createContent({
      groupId: research.id,
      sequence: 1,
      contentType: "podcast",
      title: "Launch interview",
      transcript: "An unabridged conversation about the launch.",
      description: "Long-form founder interview.",
      publishedAtUtc: "2026-08-17T15:00:00.000Z",
      contentHost: "spotify",
      contentStatus: "active",
      contentUrl: "https://example.test/launch-interview",
    });
    const second = organizer.createContent({
      groupId: research.id,
      sequence: 2,
      contentType: "image",
      title: "Launch graphic",
      description: "Square social asset.",
      publishedAtUtc: "2026-08-18T15:00:00.000Z",
      contentHost: "none",
      contentStatus: "queued",
    });
    assert.deepEqual(organizer.listContent({ groupId: research.id }).map(({ sequence }) => sequence), [2, 1]);
    assert.deepEqual(organizer.listContent({ status: "active" }).map(({ id }) => id), [first.id]);
    assert.deepEqual(organizer.listContent({ query: "unabridged" }).map(({ id }) => id), [first.id]);
    assert.throws(
      () => organizer.createContent({
        groupId: research.id,
        title: "Unsafe link",
        contentUrl: "javascript:alert(1)",
      }),
      (error) => error instanceof OrganizerInputError && /http or https/.test(error.message),
    );
    assert.throws(
      () => organizer.createContent({ groupId: research.id, sequence: 2, title: "Duplicate sequence" }),
      (error) => error instanceof OrganizerInputError && error.statusCode === 409,
    );

    const updated = organizer.updateContent(first.id, {
      version: first.version,
      groupId: 1,
      sequence: 1,
      title: "Published launch interview",
      contentStatus: "obsolete",
    });
    assert.equal(updated.groupName, "General");
    assert.equal(updated.title, "Published launch interview");
    assert.throws(
      () => organizer.archiveContentGroup(research.id),
      (error) => error instanceof OrganizerInputError && error.statusCode === 409,
    );

    organizer.deleteContent(second.id, { version: second.version });
    const archived = organizer.archiveContentGroup(research.id);
    assert.ok(archived.group.archivedAtUtc);
    assert.equal(organizer.listContentGroups().some(({ id }) => id === research.id), false);
    assert.equal(organizer.getContent(first.id).transcript, "An unabridged conversation about the launch.");
    assert.equal(organizer.database.prepare(`
      SELECT COUNT(*) AS count FROM activity_events
      WHERE event_type IN (
        'content_group.created', 'content_group.reordered', 'content.created',
        'content.updated', 'content.deleted', 'content_group.archived'
      )
    `).get().count, 8);
  } finally {
    organizer.close();
    temporary.cleanup();
  }
});
