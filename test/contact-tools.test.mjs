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
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const organizer = new OrganizerStore(temporary.filename);
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
    displayName: "Jordan A. Lee",
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

  const review = await registry.execute("contact_duplicate_list", { limit: 10, offset: 0 }, toolContext);
  assert.equal(review.total_duplicate_groups, 1);
  assert.deepEqual(review.groups[0].evidence, ["same email"]);
  const candidates = new Map(review.groups[0].candidates.map((candidate) => [
    candidate.contact.contact_id,
    candidate,
  ]));
  assert.equal(candidates.get(kept.id).contact.display_name, "Jordan Lee");
  assert.equal(candidates.get(duplicate.id).contact.notes, "Met at the library.");
  assert.ok(candidates.get(kept.id).expected_version);

  await assert.rejects(
    registry.execute("contact_merge", {
      keep_contact_id: kept.id,
      keep_expected_version: "stale-version",
      merge_contacts: [{
        contact_id: duplicate.id,
        expected_version: candidates.get(duplicate.id).expected_version,
      }],
    }, { ...toolContext, callId: "stale-contact-merge" }),
    /changed while the merge was being reviewed/,
  );

  const merged = await registry.execute("contact_merge", {
    keep_contact_id: kept.id,
    keep_expected_version: candidates.get(kept.id).expected_version,
    merge_contacts: [{
      contact_id: duplicate.id,
      expected_version: candidates.get(duplicate.id).expected_version,
    }],
  }, { ...toolContext, callId: "contact-merge" });
  assert.equal(merged.kept_contact.contact_id, kept.id);
  assert.deepEqual(merged.merged_contact_ids, [duplicate.id]);
  assert.deepEqual(merged.kept_contact.contact_methods.map(({ method_kind: kind }) => kind), ["email", "phone"]);
  assert.deepEqual(merged.kept_contact.tags.map(({ label }) => label), ["Friend", "Library"]);
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
