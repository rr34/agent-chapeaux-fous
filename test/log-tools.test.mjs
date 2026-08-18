import assert from "node:assert/strict";
import test from "node:test";
import { ContextBuilder } from "../src/context.mjs";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { registerLogTools } from "../src/tools/log-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { temporaryDatabase } from "./helpers.mjs";

function loggingHarness(context, requestText = "Log my weight") {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  assert.equal(store.status.ready, true);
  const ledger = new Ledger(store);
  const request = ledger.createRequest({ text: requestText });
  const registry = new ToolRegistry();
  registerLogTools(registry, store, ledger);
  return { store, ledger, request, registry };
}

test("log_add exposes one complete content field and no boolean or mandatory value type", (context) => {
  const { registry } = loggingHarness(context);
  const definition = registry.toolDefinitions().find((tool) => tool.name === "log_add");
  assert.deepEqual(Object.keys(definition.inputSchema.properties), [
    "tracker",
    "group",
    "content_text",
    "number_value",
    "unit",
    "occurred_at_utc",
    "create_if_missing",
  ]);
  assert.equal(Object.hasOwn(definition.inputSchema.properties, "note"), false);
  assert.equal(Object.hasOwn(definition.inputSchema.properties, "boolean"), false);
  assert.equal(Object.hasOwn(definition.inputSchema.properties, "valueKind"), false);
});

test("log_add creates and reuses a grouped numeric tracker while preserving complete content", async (context) => {
  const { store, ledger, request, registry } = loggingHarness(context);

  const first = await registry.execute("log_add", {
    tracker: "Weight",
    group: "Health",
    content_text: "72.1 kg after dinner",
    number_value: 72.1,
    unit: "kg",
    occurred_at_utc: "2026-08-15T20:30:00-04:00",
    create_if_missing: true,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "log-first" });

  assert.equal(first.tracker_created, true);
  assert.equal(first.group_resolution.group_created, true);
  assert.equal(first.tracker.log_groups.name, "Health");
  assert.equal(first.tracker.default_unit, "kg");
  assert.equal(first.entry.content_text, "72.1 kg after dinner");
  assert.equal(first.entry.number_value, 72.1);
  assert.equal(first.entry.unit, "kg");
  assert.equal(first.entry.source, "agent-slayer");
  assert.equal(first.entry.external_id, null);
  assert.equal(first.entry.occurred_at_utc, "2026-08-16T00:30:00.000Z");

  const second = await registry.execute("log_add", {
    tracker: "weight",
    group: null,
    content_text: "71.8 kg before breakfast",
    number_value: 71.8,
    unit: null,
    occurred_at_utc: "2026-08-16T08:00:00Z",
    create_if_missing: false,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "log-second" });

  assert.equal(second.tracker_created, false);
  assert.equal(second.entry.tracker_id, first.entry.tracker_id);
  assert.equal(second.entry.log_groups.name, "Health");
  assert.equal(second.entry.unit, "kg");
  assert.equal(
    store.requireReady().prepare("SELECT COUNT(*) AS count FROM log_groups").get().count,
    1,
  );

  const listed = await registry.execute("log_list", {
    tracker: "Weight",
    group: "health",
    source: null,
    from_utc: null,
    through_utc: null,
    limit: 20,
  });
  assert.deepEqual(listed.entries.map((entry) => entry.content_text), [
    "71.8 kg before breakfast",
    "72.1 kg after dinner",
  ]);

  const trackers = await registry.execute("tracker_list", {
    group: "Health",
    include_archived: false,
    limit: 20,
  });
  assert.equal(trackers.count, 1);
  assert.equal(trackers.trackers[0].entry_count, 2);
  assert.equal(trackers.trackers[0].last_logged_at_utc, "2026-08-16T08:00:00.000Z");
  assert.equal(
    ledger.trace(request.requestId).filter((event) => event.type === "personal_log.created").length,
    2,
  );
});

test("log_add records text-only events without a boolean or value kind", async (context) => {
  const { request, registry } = loggingHarness(context, "Log a bowel movement");

  const result = await registry.execute("log_add", {
    tracker: "Bowel movement",
    group: "Health",
    content_text: "Normal bowel movement, Bristol type 4",
    number_value: 4,
    unit: null,
    occurred_at_utc: null,
    create_if_missing: true,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "log-event" });

  assert.equal(result.entry.content_text, "Normal bowel movement, Bristol type 4");
  assert.equal(result.entry.number_value, 4);
  assert.equal(result.entry.unit, null);
  assert.ok(result.entry.occurred_at_utc);

  const medication = await registry.execute("log_add", {
    tracker: "Medication",
    group: "Health",
    content_text: "Took morning medication",
    number_value: null,
    unit: null,
    occurred_at_utc: null,
    create_if_missing: true,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "log-medication" });
  assert.equal(medication.entry.number_value, null);
});

test("tracker_update moves, renames, clears units, and archives a tracker", async (context) => {
  const { request, registry } = loggingHarness(context);
  const created = await registry.execute("log_add", {
    tracker: "Weight",
    group: "Health",
    content_text: "72.1 kg",
    number_value: 72.1,
    unit: "kg",
    occurred_at_utc: null,
    create_if_missing: true,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "log-create" });

  const updated = await registry.execute("tracker_update", {
    tracker_id: created.tracker.tracker_id,
    name: "Body weight",
    group: "Fitness",
    default_unit: "",
    archived: true,
  }, { requestId: request.requestId, callId: "tracker-update" });

  assert.equal(updated.tracker.name, "Body weight");
  assert.equal(updated.tracker.log_groups.name, "Fitness");
  assert.equal(updated.tracker.default_unit, null);
  assert.ok(updated.tracker.archived_at_utc);
  const active = await registry.execute("tracker_list", {
    group: null,
    include_archived: false,
    limit: 20,
  });
  assert.equal(active.count, 0);
  const all = await registry.execute("tracker_list", {
    group: null,
    include_archived: true,
    limit: 20,
  });
  assert.equal(all.count, 1);
});

test("a unit without a number is rejected before creating log records", async (context) => {
  const { store, request, registry } = loggingHarness(context);
  await assert.rejects(
    registry.execute("log_add", {
      tracker: "Mood",
      group: "Health",
      content_text: "Calm",
      number_value: null,
      unit: "points",
      occurred_at_utc: null,
      create_if_missing: true,
    }, { requestId: request.requestId, requestEventId: request.eventId, callId: "bad-log" }),
    /unit requires a numeric value/,
  );
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM trackers").get().count, 0);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM log_entries").get().count, 0);
});

test("log_add reuses an established tracker through a synonymous name", async (context) => {
  const { store, request, registry } = loggingHarness(context, "Log a poop");
  const poop = await registry.execute("log_add", {
    tracker: "Poop",
    group: "Health",
    content_text: "Poop.",
    number_value: null,
    unit: null,
    occurred_at_utc: "2026-08-17T12:00:00Z",
    create_if_missing: true,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "poop-first" });
  await registry.execute("log_add", {
    tracker: "Poop",
    group: "Health",
    content_text: "Another poop.",
    number_value: null,
    unit: null,
    occurred_at_utc: "2026-08-18T12:00:00Z",
    create_if_missing: false,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "poop-second" });

  const alias = await registry.execute("log_add", {
    tracker: "Bowel Movements",
    group: "Health",
    content_text: "Poop.",
    number_value: null,
    unit: null,
    occurred_at_utc: "2026-08-19T12:00:00Z",
    create_if_missing: false,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "poop-alias" });

  assert.equal(alias.tracker_created, false);
  assert.equal(alias.tracker_resolution.match_type, "alias");
  assert.equal(alias.tracker_resolution.actual_name, "Poop");
  assert.equal(alias.entry.tracker_id, poop.entry.tracker_id);
  assert.equal(
    store.requireReady().prepare("SELECT COUNT(*) AS count FROM trackers").get().count,
    1,
  );
});

test("log_add proposes a missing tracker without writing until creation is confirmed", async (context) => {
  const { store, request, registry } = loggingHarness(context, "Log my mood");
  const proposed = await registry.execute("log_add", {
    tracker: "Mood",
    group: "Health",
    content_text: "Calm.",
    number_value: null,
    unit: null,
    occurred_at_utc: "2026-08-18T12:00:00Z",
    create_if_missing: false,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "mood-propose" });

  assert.equal(proposed.created, false);
  assert.equal(proposed.tracker_missing, true);
  assert.equal(proposed.confirmation_required, true);
  assert.equal(proposed.proposed_tracker.name, "Mood");
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM trackers").get().count, 0);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM log_entries").get().count, 0);

  const created = await registry.execute("log_add", {
    tracker: "Mood",
    group: "Health",
    content_text: "Calm.",
    number_value: null,
    unit: null,
    occurred_at_utc: "2026-08-18T12:00:00Z",
    create_if_missing: true,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "mood-confirm" });
  assert.equal(created.created, true);
  assert.equal(created.tracker_created, true);
});

test("log context includes authoritative active tracker names", async (context) => {
  const { store, ledger, request, registry } = loggingHarness(context, "Log a poop");
  await registry.execute("log_add", {
    tracker: "Poop",
    group: "Health",
    content_text: "Poop.",
    number_value: null,
    unit: null,
    occurred_at_utc: "2026-08-18T12:00:00Z",
    create_if_missing: true,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "poop-context" });
  const next = ledger.createRequest({ text: "Log a bowel movement" });
  const built = await new ContextBuilder({
    ledger,
    store,
    profileFacts: { list() { return { facts: [] }; } },
  }).build(next.requestId, "Log a bowel movement", { capabilities: ["logs"] });

  assert.match(built.text, /# Active personal-log trackers/);
  assert.match(built.text, /name: Poop \| group: Health \| entries: 1/);
  assert.deepEqual(built.activeTrackers.map(({ name }) => name), ["Poop"]);
});

test("log_import is source-agnostic, idempotent, and reports conflicting replays", async (context) => {
  const { store, request, registry } = loggingHarness(context, "Import an external history page");
  const batch = {
    source: "external-health-export",
    entries: [
      {
        external_id: "weight-2026-08-14",
        tracker: "Weight",
        group: "Health",
        content_text: "72.4 kg in the morning",
        number_value: 72.4,
        unit: "kg",
        occurred_at_utc: "2026-08-14T08:00:00-04:00",
      },
      {
        external_id: 4182,
        tracker: "Food",
        group: "Health",
        content_text: "Oatmeal with blueberries",
        number_value: null,
        unit: null,
        occurred_at_utc: "2026-08-14T08:30:00-04:00",
      },
    ],
  };

  const imported = await registry.execute("log_import", batch, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "import-first",
  });
  assert.deepEqual(
    [imported.imported_count, imported.unchanged_count, imported.conflict_count],
    [2, 0, 0],
  );
  assert.deepEqual(imported.items.map((item) => item.entry.source), [
    "external-health-export",
    "external-health-export",
  ]);
  assert.deepEqual(imported.items.map((item) => item.entry.external_id), [
    "weight-2026-08-14",
    "4182",
  ]);

  const replayed = await registry.execute("log_import", batch, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "import-replay",
  });
  assert.deepEqual(
    [replayed.imported_count, replayed.unchanged_count, replayed.conflict_count],
    [0, 2, 0],
  );
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM log_entries").get().count, 2);

  const conflict = await registry.execute("log_import", {
    source: batch.source,
    entries: [{ ...batch.entries[0], content_text: "Changed upstream representation" }],
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "import-conflict",
  });
  assert.deepEqual(
    [conflict.imported_count, conflict.unchanged_count, conflict.conflict_count],
    [0, 0, 1],
  );
  assert.equal(conflict.items[0].entry.content_text, "72.4 kg in the morning");

  const anotherSource = await registry.execute("log_import", {
    source: "another-export",
    entries: [batch.entries[0]],
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "import-other-source",
  });
  assert.equal(anotherSource.imported_count, 1);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM log_entries").get().count, 3);
  const sourceEntries = await registry.execute("log_list", {
    tracker: null,
    group: null,
    source: "external-health-export",
    from_utc: null,
    through_utc: null,
    limit: 20,
  });
  assert.equal(sourceEntries.count, 2);
});

test("log_import rejects duplicate IDs within a batch and missing occurrence times", async (context) => {
  const { store, request, registry } = loggingHarness(context, "Import invalid history");
  const entry = {
    external_id: "duplicate",
    tracker: "Mood",
    group: "Health",
    content_text: "Calm",
    number_value: null,
    unit: null,
    occurred_at_utc: "2026-08-14T12:00:00Z",
  };
  await assert.rejects(
    registry.execute("log_import", {
      source: "test-export",
      entries: [entry, entry],
    }, { requestId: request.requestId, requestEventId: request.eventId, callId: "duplicate-batch" }),
    /Duplicate external log ID/,
  );
  await assert.rejects(
    registry.execute("log_import", {
      source: "test-export",
      entries: [{ ...entry, external_id: "missing-time", occurred_at_utc: null }],
    }, { requestId: request.requestId, requestEventId: request.eventId, callId: "missing-time" }),
    /occurred_at_utc must be string/,
  );
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM log_entries").get().count, 0);
});
