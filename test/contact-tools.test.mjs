import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { SchemaSemantics } from "../src/schema-semantics.mjs";
import { registerContactTools } from "../src/tools/contact-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { temporaryDatabase } from "./helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function harness(context) {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const organizer = new OrganizerStore(temporary.target);
  context.after(() => organizer.close());
  const schemaSemantics = new SchemaSemantics({
    filename: path.join(root, "db", "schema-semantics.json"),
    ledger,
  });
  const registry = new ToolRegistry();
  registerContactTools(registry, store, organizer, ledger, schemaSemantics);
  const request = ledger.createRequest({ text: "Import the attached contacts" });
  return { store, organizer, ledger, registry, request };
}

function contact(overrides = {}) {
  return {
    external_id: "row-1",
    contact_kind: "person",
    display_name: "Alex Rivera",
    given_name: "Alex",
    family_name: "Rivera",
    organization_name: null,
    status: "active",
    birth_date: "--08-18",
    notes: "Uncle; watch customer.",
    methods: [
      {
        method_kind: "email", label: "Personal", value: "Alex@Example.test",
        is_primary: true, can_receive: true,
      },
      {
        method_kind: "phone", label: "Mobile", value: "+1 (555) 010-0200",
        is_primary: false, can_receive: true,
      },
    ],
    tags: ["Family", "Wedding Attendee", "Watch Customer"],
    ...overrides,
  };
}

test("contact_import stores methods and overlapping tags and is replay-safe", async (context) => {
  const { store, ledger, registry, request } = harness(context);
  const batch = { source: "phone-export-2026", entries: [contact()] };
  const toolContext = {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "contact-import",
  };

  const imported = await registry.execute("contact_import", batch, toolContext);
  assert.deepEqual(
    [imported.imported_count, imported.unchanged_count, imported.conflict_count],
    [1, 0, 0],
  );
  assert.equal(imported.items[0].contact.source, "phone-export-2026");
  assert.equal(imported.items[0].contact.contact_methods[0].normalized_value, "alex@example.test");
  assert.deepEqual(
    imported.items[0].contact.tags.map(({ slug }) => slug),
    ["family", "watch-customer", "wedding-attendee"],
  );
  assert.ok(imported.schemaProjection.schemaProjection.schemaObjects.contacts);
  assert.ok(imported.schemaProjection.schemaProjection.schemaObjects.tags);

  const replay = await registry.execute("contact_import", batch, {
    ...toolContext, callId: "contact-replay",
  });
  assert.deepEqual(
    [replay.imported_count, replay.unchanged_count, replay.conflict_count],
    [0, 1, 0],
  );
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM contacts").get().count, 1);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM tags").get().count, 3);
  const [tagContext] = await registry.prepareContext(["contacts.active_tags"]);
  assert.deepEqual(tagContext.data.tags.map(({ label, slug, contactCount }) => ({
    label, slug, contactCount,
  })), [
    { label: "Family", slug: "family", contactCount: 1 },
    { label: "Watch Customer", slug: "watch-customer", contactCount: 1 },
    { label: "Wedding Attendee", slug: "wedding-attendee", contactCount: 1 },
  ]);
  assert.match(tagContext.text, /Wedding Attendee \[wedding-attendee\] \| contacts: 1/);
  assert.doesNotMatch(tagContext.text, /Alex Rivera/);

  const conflict = await registry.execute("contact_import", {
    ...batch,
    entries: [contact({ notes: "Changed source representation." })],
  }, { ...toolContext, callId: "contact-conflict" });
  assert.deepEqual(
    [conflict.imported_count, conflict.unchanged_count, conflict.conflict_count],
    [0, 0, 1],
  );
  assert.equal(conflict.items[0].contact.notes, "Uncle; watch customer.");
  assert.equal(
    ledger.trace(request.requestId).filter(({ type }) => type === "contacts.imported").length,
    3,
  );
});

test("contact_tag_rename atomically renames or combines tags for the agent", async (context) => {
  const { store, organizer, registry, request } = harness(context);
  organizer.createContact({ displayName: "One", tags: ["Mailing List"] });
  organizer.createContact({ displayName: "Two", tags: ["Mailing List", "Newsletter"] });
  organizer.createContact({ displayName: "Three", tags: ["Newsletter"] });
  const definition = registry.toolDefinitions().find(({ name }) => name === "contact_tag_rename");
  assert.deepEqual(definition.inputSchema.required, ["current_tag", "new_tag"]);

  const result = await registry.execute("contact_tag_rename", {
    current_tag: "Mailing List",
    new_tag: "Newsletter",
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "rename-contact-tag",
    channel: "web",
  });
  assert.deepEqual({
    previous_tag: result.previous_tag,
    tag: result.tag,
    affected_contact_count: result.affected_contact_count,
    merged_with_existing_tag: result.merged_with_existing_tag,
  }, {
    previous_tag: "Mailing List",
    tag: "Newsletter",
    affected_contact_count: 2,
    merged_with_existing_tag: true,
  });
  assert.equal(organizer.listContacts().every(({ tags }) => tags.length === 1 && tags[0] === "Newsletter"), true);
  assert.equal(store.requireReady().prepare(`
    SELECT COUNT(*) AS count FROM activity_events
    WHERE event_type = 'contacts.tag_renamed'
      AND actor_type = 'tool' AND actor_name = 'contact_tag_rename'
  `).get().count, 1);
});

test("contact_search exposes the Contacts UI substring search to the agent", async (context) => {
  const { organizer, registry, request } = harness(context);
  organizer.createContact({
    displayName: "Melanny Ortiz",
    notes: "Cabinet specialist recommended for the kitchen.",
    methods: [{ kind: "email", label: "Work", value: "melanny@example.test" }],
  });
  organizer.createContact({
    displayName: "Dina Woods",
    organizationName: "North Design Studio",
    tags: ["Renovation"],
  });
  organizer.createContact({
    displayName: "Inactive Designer",
    status: "inactive",
    notes: "Design consultant",
  });

  const definition = registry.toolDefinitions().find(({ name }) => name === "contact_search");
  assert.deepEqual(definition.inputSchema.required, [
    "queries", "include_inactive", "limit", "result_filter",
  ]);
  assert.match(definition.description, /same case-insensitive substring behavior as the Contacts UI/);

  const result = await registry.execute("contact_search", {
    queries: ["cabinet", "DESIGN"],
    include_inactive: false,
    limit: 20,
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "contact-search",
    channel: "web",
  });
  assert.equal(result.scan_truncated, false);
  assert.equal(result.total_contact_count, 2);
  assert.equal(result.total_match_count, 2);
  assert.equal(result.returned_match_count, 2);
  assert.equal(result.has_more, false);
  assert.deepEqual(result.matches.map(({ display_name: name }) => name), ["Dina Woods", "Melanny Ortiz"]);
  assert.deepEqual(result.matches.map(({ matched_queries: queries }) => queries), [["DESIGN"], ["cabinet"]]);
  assert.equal(
    result.matches.find(({ display_name: name }) => name === "Melanny Ortiz").notes,
    "Cabinet specialist recommended for the kitchen.",
  );

  const methodMatch = await registry.execute("contact_search", {
    queries: ["melanny@example.test"],
    include_inactive: false,
    limit: 1,
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "contact-method-search",
    channel: "web",
  });
  assert.deepEqual(methodMatch.matches.map(({ display_name: name }) => name), ["Melanny Ortiz"]);

  const bounded = await registry.execute("contact_search", {
    queries: ["design"],
    include_inactive: true,
    limit: 1,
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "bounded-contact-search",
    channel: "web",
  });
  assert.equal(bounded.total_match_count, 2);
  assert.equal(bounded.returned_match_count, 1);
  assert.equal(bounded.has_more, true);
});

test("batch contact lookup and tagging handle 1000 contacts in bounded tool calls", async (context) => {
  const { store, registry, request } = harness(context);
  const database = store.requireReady();
  const insert = database.prepare(`
    INSERT INTO contacts (display_name, updated_at_utc)
    VALUES (?, '2026-08-17T12:00:00.000Z') RETURNING contact_id
  `);
  const ids = [];
  database.exec("START TRANSACTION");
  try {
    for (let index = 1; index <= 1000; index += 1) {
      ids.push(Number(insert.get(`Batch Person ${index}`).contact_id));
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const toolContext = {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "batch-contact-lookup",
    channel: "web",
  };
  const lookup = await registry.execute("contact_lookup_batch", {
    names: ["BATCH-PERSON-1", "Batch Person 1000", "Missing Person"],
    include_inactive: true,
    max_matches_per_name: 20,
  }, toolContext);
  assert.deepEqual(lookup.results.map(({ match_count: count }) => count), [1, 1, 0]);
  assert.deepEqual(
    lookup.results.slice(0, 2).map(({ matches }) => matches[0].contact_id),
    [ids[0], ids[999]],
  );

  await assert.rejects(
    registry.execute("contact_tag_add_batch", {
      tag: "Big Batch",
      contact_ids: [ids[0], 999_999],
    }, { ...toolContext, callId: "batch-contact-tag-invalid" }),
    /Contact 999999 was not found/,
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM record_tags").get().count, 0);

  const tagged = await registry.execute("contact_tag_add_batch", {
    tag: "Big Batch",
    contact_ids: ids,
  }, { ...toolContext, callId: "batch-contact-tag" });
  assert.deepEqual(
    [tagged.selected_contact_count, tagged.tagged_contact_count, tagged.already_tagged_contact_count],
    [1000, 1000, 0],
  );
  const replay = await registry.execute("contact_tag_add_batch", {
    tag: "Big Batch",
    contact_ids: ids,
  }, { ...toolContext, callId: "batch-contact-tag-replay" });
  assert.deepEqual(
    [replay.selected_contact_count, replay.tagged_contact_count, replay.already_tagged_contact_count],
    [1000, 0, 1000],
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM record_tags").get().count, 1000);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM activity_events
    WHERE event_type = 'contacts.tag_added_batch'
      AND actor_type = 'tool' AND actor_name = 'contact_tag_add_batch'
  `).get().count, 2);
});

test("contact_import accepts more than 100 rows in one bounded transaction", async (context) => {
  const { store, registry, request } = harness(context);
  const entries = Array.from({ length: 125 }, (_, index) => contact({
    external_id: `row-${index + 1}`,
    display_name: `Contact ${index + 1}`,
    given_name: null,
    family_name: null,
    birth_date: null,
    notes: null,
    methods: [],
    tags: index % 2 === 0 ? ["Wedding Attendee"] : ["Watch Customer"],
  }));
  const result = await registry.execute("contact_import", {
    source: "large-csv", entries,
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "large-contact-import",
  });
  assert.equal(result.imported_count, 125);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM contacts").get().count, 125);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM tags").get().count, 2);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM record_tags").get().count, 125);
});

test("contact_file_import completes a partial import and replays a 1,200-row CSV in one call", async (context) => {
  const { store, registry, request } = harness(context);
  const rowCount = 1200;
  const rowContact = (index) => ({
    external_id: `row-${index}`,
    contact_kind: "person",
    display_name: `Person ${index} Test`,
    given_name: `Person ${index}`,
    family_name: "Test",
    organization_name: null,
    status: "active",
    birth_date: null,
    notes: `Imported, row ${index}`,
    methods: [
      {
        method_kind: "email", label: "Work", value: `person${index}@example.test`,
        is_primary: true, can_receive: true,
      },
      {
        method_kind: "phone", label: "Mobile", value: `+1 555 ${String(index).padStart(7, "0")}`,
        is_primary: false, can_receive: true,
      },
    ],
    tags: ["Bulk", "Friends"],
  });
  const csv = [
    "First Name,Last Name,Email,Phone,Notes,Tags",
    ...Array.from({ length: rowCount }, (_, index) => {
      const number = index + 1;
      return `Person ${number},Test,person${number}@example.test,+1 555 ${String(number).padStart(7, "0")},\"Imported, row ${number}\",Friends`;
    }),
  ].join("\r\n");
  const toolContext = {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "partial-contact-import",
    channel: "web",
  };
  const partial = await registry.execute("contact_import", {
    source: "large-address-book",
    entries: Array.from({ length: 20 }, (_, index) => rowContact(index + 1)),
  }, toolContext);
  assert.equal(partial.imported_count, 20);

  const fileArguments = {
    source: "large-address-book",
    format: "csv",
    default_tags: ["Bulk"],
    csv_mapping: {
      external_id_column: null,
      external_id_strategy: "row_number",
      external_id_prefix: "row-",
      display_name_column: null,
      given_name_column: "First Name",
      family_name_column: "Last Name",
      organization_name_column: null,
      birth_date_column: null,
      notes_columns: ["Notes"],
      tag_columns: ["Tags"],
      tag_separator: ";",
      methods: [
        {
          column: "Email", method_kind: "email", label: "Work",
          is_primary: true, can_receive: true,
        },
        {
          column: "Phone", method_kind: "phone", label: "Mobile",
          is_primary: false, can_receive: true,
        },
      ],
      default_contact_kind: "person",
      default_status: "active",
    },
  };
  const attachment = {
    fileId: 91,
    filename: "large-contacts.csv",
    mimeType: "text/csv",
    byteSize: Buffer.byteLength(csv),
    sha256: "large-csv-sha",
    text: csv,
  };
  const imported = await registry.execute("contact_file_import", fileArguments, {
    ...toolContext, callId: "whole-file-import", attachment,
  });
  assert.deepEqual(
    [imported.total, imported.imported_count, imported.unchanged_count, imported.conflict_count],
    [1200, 1180, 20, 0],
  );
  assert.equal(Object.hasOwn(imported, "items"), false);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM contacts").get().count, 1200);

  const replay = await registry.execute("contact_file_import", fileArguments, {
    ...toolContext, callId: "whole-file-replay", attachment,
  });
  assert.deepEqual(
    [replay.imported_count, replay.unchanged_count, replay.conflict_count],
    [0, 1200, 0],
  );
  assert.equal(
    store.requireReady().prepare("SELECT COUNT(*) AS count FROM contacts").get().count,
    1200,
  );
});

test("contact_import validates the whole batch before writing", async (context) => {
  const { store, registry, request } = harness(context);
  await assert.rejects(
    registry.execute("contact_import", {
      source: "bad-csv",
      entries: [contact(), contact({ external_id: "row-2", birth_date: "2026-02-30" })],
    }, {
      requestId: request.requestId,
      requestEventId: request.eventId,
      callId: "invalid-contact-import",
    }),
    /birth_date/,
  );
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM contacts").get().count, 0);
});

test("contact duplicate tools review and safely merge current candidates", async (context) => {
  const { store, organizer, registry, request } = harness(context);
  const kept = organizer.createContact({
    displayName: "Jordan Lee",
    tags: ["Friend"],
    methods: [{ kind: "email", value: "jordan@example.test", isPrimary: true }],
  });
  const duplicate = organizer.createContact({
    displayName: "Jordan Lee",
    notes: "Met at the library.",
    tags: ["Library"],
    methods: [
      { kind: "email", value: "JORDAN@example.test" },
      { kind: "phone", value: "+1 555 010 0199" },
    ],
  });
  const toolContext = {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "contact-duplicates",
    channel: "web",
  };

  const review = await registry.execute("contact_duplicate_list", {
    limit: 10, offset: 0, detail: "full",
  }, toolContext);
  assert.equal(review.total_duplicate_groups, 1);
  assert.deepEqual(review.groups[0].evidence, ["same name", "same email"]);
  const candidates = new Map(review.groups[0].candidates.map((candidate) => [
    candidate.contact.contact_id,
    candidate,
  ]));
  assert.equal(candidates.get(kept.id).contact.display_name, "Jordan Lee");
  assert.equal(candidates.get(duplicate.id).contact.notes, "Met at the library.");
  assert.ok(candidates.get(kept.id).expected_version);

  await assert.rejects(
    registry.execute("contact_merge", {
      merges: [{
        keep_contact_id: kept.id,
        keep_expected_version: "stale-version",
        merge_contacts: [{
          contact_id: duplicate.id,
          expected_version: candidates.get(duplicate.id).expected_version,
        }],
      }],
    }, { ...toolContext, callId: "stale-contact-merge" }),
    /changed while the merge was being reviewed/,
  );

  const merged = await registry.execute("contact_merge", {
    merges: [{
      keep_contact_id: kept.id,
      keep_expected_version: candidates.get(kept.id).expected_version,
      merge_contacts: [{
        contact_id: duplicate.id,
        expected_version: candidates.get(duplicate.id).expected_version,
      }],
    }],
  }, { ...toolContext, callId: "contact-merge" });
  assert.equal(merged.merged_group_count, 1);
  assert.equal(merged.groups[0].kept_contact_id, kept.id);
  assert.deepEqual(merged.groups[0].merged_contact_ids, [duplicate.id]);
  const retained = organizer.getContact(kept.id);
  assert.deepEqual(retained.methods.map(({ kind }) => kind), ["email", "phone"]);
  assert.deepEqual(retained.tags, ["Friend", "Library"]);
  assert.equal(organizer.getContact(duplicate.id).status, "inactive");
  const event = store.requireReady().prepare(`
    SELECT actor_type, actor_name, source, channel, turn_id, operation_id
    FROM activity_events WHERE event_type = 'contacts.merged'
  `).get();
  assert.deepEqual({ ...event }, {
    actor_type: "tool",
    actor_name: "contact_merge",
    source: "model_tool",
    channel: "web",
    turn_id: request.requestId,
    operation_id: "contact-merge",
  });
});

test("compact duplicate review and atomic batches resolve 240 groups in five tool calls", async (context) => {
  const { store, registry, request } = harness(context);
  const database = store.requireReady();
  const insertContact = database.prepare(`
    INSERT INTO contacts (display_name, notes, updated_at_utc)
    VALUES (?, ?, ?) RETURNING contact_id
  `);
  const insertMethod = database.prepare(`
    INSERT INTO contact_methods (
      contact_id, method_kind, label, value, normalized_value, is_primary, can_receive
    ) VALUES (?, 'email', 'Imported', ?, ?, 1, 1)
  `);
  const version = "2026-08-17T12:00:00.000Z";
  database.exec("START TRANSACTION");
  try {
    for (let group = 1; group <= 240; group += 1) {
      const email = `duplicate-${group}@example.test`;
      for (let copy = 1; copy <= 2; copy += 1) {
        const inserted = insertContact.get(
          `Duplicate ${group}`,
          group === 1 && copy === 1 ? "x".repeat(1500) : `Copy ${copy}`,
          version,
        );
        insertMethod.run(inserted.contact_id, email, email);
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const toolContext = {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "bulk-review-1",
    channel: "web",
  };
  const mergeArguments = (groups) => groups.map((group) => ({
    keep_contact_id: group.candidates[0].contact.contact_id,
    keep_expected_version: group.candidates[0].expected_version,
    merge_contacts: group.candidates.slice(1).map((candidate) => ({
      contact_id: candidate.contact.contact_id,
      expected_version: candidate.expected_version,
    })),
  }));

  const firstReview = await registry.execute("contact_duplicate_list", {
    limit: 200, offset: 0, detail: "compact",
  }, toolContext);
  assert.equal(firstReview.total_duplicate_groups, 240);
  assert.equal(firstReview.groups.length, 200);
  assert.equal(firstReview.groups[0].candidates[0].contact.notes.length, 1000);
  assert.equal(firstReview.groups[0].candidates[0].notes_truncated, true);
  const firstOperations = mergeArguments(firstReview.groups);
  const firstBatch = await registry.execute("contact_merge", {
    merges: firstOperations.slice(0, 100),
  }, { ...toolContext, callId: "bulk-merge-1" });
  const secondBatch = await registry.execute("contact_merge", {
    merges: firstOperations.slice(100),
  }, { ...toolContext, callId: "bulk-merge-2" });
  assert.deepEqual(
    [firstBatch.merged_group_count, secondBatch.merged_group_count],
    [100, 100],
  );

  const secondReview = await registry.execute("contact_duplicate_list", {
    limit: 200, offset: 0, detail: "compact",
  }, { ...toolContext, callId: "bulk-review-2" });
  assert.equal(secondReview.total_duplicate_groups, 40);
  const finalBatch = await registry.execute("contact_merge", {
    merges: mergeArguments(secondReview.groups),
  }, { ...toolContext, callId: "bulk-merge-3" });
  assert.equal(finalBatch.merged_group_count, 40);
  assert.equal(finalBatch.merged_contact_count, 40);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contacts WHERE status = 'active'").get().count, 240);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM activity_events
    WHERE event_type = 'contacts.merged' AND actor_type = 'tool' AND actor_name = 'contact_merge'
  `).get().count, 240);
});

test("source-aware clear dedupe resolves 505 groups in two calls and leaves ambiguous records", async (context) => {
  const { store, registry, request } = harness(context);
  const database = store.requireReady();
  const insertContact = database.prepare(`
    INSERT INTO contacts (display_name, source, external_id, updated_at_utc)
    VALUES (?, ?, ?, '2026-08-17T12:00:00.000Z') RETURNING contact_id
  `);
  const insertMethod = database.prepare(`
    INSERT INTO contact_methods (
      contact_id, method_kind, label, value, normalized_value, is_primary, can_receive
    ) VALUES (?, 'email', 'Imported', ?, ?, 1, 1)
  `);
  const add = ({ name, source, externalId, email = null }) => {
    const contact = insertContact.get(name, source, externalId);
    if (email) insertMethod.run(contact.contact_id, email, email.toLowerCase());
    return Number(contact.contact_id);
  };
  database.exec("START TRANSACTION");
  try {
    for (let group = 1; group <= 505; group += 1) {
      const email = `clear-${group}@example.test`;
      add({ name: `Clear ${group}`, source: "source-a", externalId: `a-${group}`, email });
      add({ name: `Clear ${group}`, source: "source-b", externalId: `b-${group}`, email });
    }
    add({ name: "Name only", source: "source-a", externalId: "a-name-only" });
    add({ name: "Name only", source: "source-b", externalId: "b-name-only" });
    add({ name: "Parent One", source: "source-a", externalId: "a-family", email: "family@example.test" });
    add({ name: "Child Two", source: "source-b", externalId: "b-family", email: "family@example.test" });
    add({ name: "Same source", source: "source-a", externalId: "a-same-1", email: "same-source@example.test" });
    add({ name: "Same source", source: "source-a", externalId: "a-same-2", email: "same-source@example.test" });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  const toolContext = {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "clear-dedupe-1",
    channel: "web",
  };
  const first = await registry.execute("contact_dedupe_clear", {
    max_groups: 500,
    preferred_source: "source-a",
  }, toolContext);
  assert.deepEqual(
    [first.candidate_group_count_before, first.eligible_group_count_before, first.ambiguous_group_count],
    [507, 505, 2],
  );
  assert.equal(first.merged_group_count, 500);
  assert.equal(first.eligible_group_count_remaining, 5);
  assert.equal(first.groups.every(({ kept_source: source }) => source === "source-a"), true);

  const second = await registry.execute("contact_dedupe_clear", {
    max_groups: 500,
    preferred_source: "source-a",
  }, { ...toolContext, callId: "clear-dedupe-2" });
  assert.deepEqual(
    [second.candidate_group_count_before, second.eligible_group_count_before, second.merged_group_count],
    [7, 5, 5],
  );
  assert.equal(second.eligible_group_count_remaining, 0);

  const final = await registry.execute("contact_dedupe_clear", {
    max_groups: 500,
    preferred_source: "source-a",
  }, { ...toolContext, callId: "clear-dedupe-final" });
  assert.deepEqual(
    [final.candidate_group_count_before, final.eligible_group_count_before, final.merged_group_count],
    [2, 0, 0],
  );
  assert.equal(final.ambiguous_group_count, 2);
  assert.equal(final.skipped_by_reason["a contact has no exact email or phone evidence"], 1);
  assert.equal(final.skipped_by_reason["contacts are not from distinct named sources"], 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contacts WHERE status = 'active'").get().count, 511);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM activity_events
    WHERE event_type = 'contacts.merged' AND actor_name = 'contact_dedupe_clear'
  `).get().count, 505);
});
