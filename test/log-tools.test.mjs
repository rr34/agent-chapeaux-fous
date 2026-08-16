import assert from "node:assert/strict";
import test from "node:test";
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
    "content",
    "number",
    "unit",
    "occurredAtUtc",
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
    content: "72.1 kg after dinner",
    number: 72.1,
    unit: "kg",
    occurredAtUtc: "2026-08-15T20:30:00-04:00",
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "log-first" });

  assert.equal(first.trackerCreated, true);
  assert.equal(first.groupResolution.groupCreated, true);
  assert.equal(first.tracker.groupName, "Health");
  assert.equal(first.tracker.defaultUnit, "kg");
  assert.equal(first.entry.content, "72.1 kg after dinner");
  assert.equal(first.entry.number, 72.1);
  assert.equal(first.entry.unit, "kg");
  assert.equal(first.entry.source, "agent-slayer");
  assert.equal(first.entry.externalId, null);
  assert.equal(first.entry.occurredAtUtc, "2026-08-16T00:30:00.000Z");

  const second = await registry.execute("log_add", {
    tracker: "weight",
    group: null,
    content: "71.8 kg before breakfast",
    number: 71.8,
    unit: null,
    occurredAtUtc: "2026-08-16T08:00:00Z",
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "log-second" });

  assert.equal(second.trackerCreated, false);
  assert.equal(second.entry.trackerId, first.entry.trackerId);
  assert.equal(second.entry.groupName, "Health");
  assert.equal(second.entry.unit, "kg");
  assert.equal(
    store.requireReady().prepare("SELECT COUNT(*) AS count FROM log_groups").get().count,
    1,
  );

  const listed = await registry.execute("log_list", {
    tracker: "Weight",
    group: "health",
    source: null,
    fromUtc: null,
    throughUtc: null,
    limit: 20,
  });
  assert.deepEqual(listed.entries.map((entry) => entry.content), [
    "71.8 kg before breakfast",
    "72.1 kg after dinner",
  ]);

  const trackers = await registry.execute("tracker_list", {
    group: "Health",
    includeArchived: false,
    limit: 20,
  });
  assert.equal(trackers.count, 1);
  assert.equal(trackers.trackers[0].entryCount, 2);
  assert.equal(trackers.trackers[0].lastLoggedAtUtc, "2026-08-16T08:00:00.000Z");
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
    content: "Normal bowel movement, Bristol type 4",
    number: 4,
    unit: null,
    occurredAtUtc: null,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "log-event" });

  assert.equal(result.entry.content, "Normal bowel movement, Bristol type 4");
  assert.equal(result.entry.number, 4);
  assert.equal(result.entry.unit, null);
  assert.ok(result.entry.occurredAtUtc);

  const medication = await registry.execute("log_add", {
    tracker: "Medication",
    group: "Health",
    content: "Took morning medication",
    number: null,
    unit: null,
    occurredAtUtc: null,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "log-medication" });
  assert.equal(medication.entry.number, null);
});

test("tracker_update moves, renames, clears units, and archives a tracker", async (context) => {
  const { request, registry } = loggingHarness(context);
  const created = await registry.execute("log_add", {
    tracker: "Weight",
    group: "Health",
    content: "72.1 kg",
    number: 72.1,
    unit: "kg",
    occurredAtUtc: null,
  }, { requestId: request.requestId, requestEventId: request.eventId, callId: "log-create" });

  const updated = await registry.execute("tracker_update", {
    trackerId: created.tracker.id,
    name: "Body weight",
    group: "Fitness",
    defaultUnit: "",
    archived: true,
  }, { requestId: request.requestId, callId: "tracker-update" });

  assert.equal(updated.tracker.name, "Body weight");
  assert.equal(updated.tracker.groupName, "Fitness");
  assert.equal(updated.tracker.defaultUnit, null);
  assert.ok(updated.tracker.archivedAtUtc);
  const active = await registry.execute("tracker_list", {
    group: null,
    includeArchived: false,
    limit: 20,
  });
  assert.equal(active.count, 0);
  const all = await registry.execute("tracker_list", {
    group: null,
    includeArchived: true,
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
      content: "Calm",
      number: null,
      unit: "points",
      occurredAtUtc: null,
    }, { requestId: request.requestId, requestEventId: request.eventId, callId: "bad-log" }),
    /unit requires a numeric value/,
  );
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM trackers").get().count, 0);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM log_entries").get().count, 0);
});

test("log_import is source-agnostic, idempotent, and reports conflicting replays", async (context) => {
  const { store, request, registry } = loggingHarness(context, "Import an external history page");
  const batch = {
    source: "external-health-export",
    entries: [
      {
        externalId: "weight-2026-08-14",
        tracker: "Weight",
        group: "Health",
        content: "72.4 kg in the morning",
        number: 72.4,
        unit: "kg",
        occurredAtUtc: "2026-08-14T08:00:00-04:00",
      },
      {
        externalId: 4182,
        tracker: "Food",
        group: "Health",
        content: "Oatmeal with blueberries",
        number: null,
        unit: null,
        occurredAtUtc: "2026-08-14T08:30:00-04:00",
      },
    ],
  };

  const imported = await registry.execute("log_import", batch, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "import-first",
  });
  assert.deepEqual(
    [imported.importedCount, imported.unchangedCount, imported.conflictCount],
    [2, 0, 0],
  );
  assert.deepEqual(imported.items.map((item) => item.entry.source), [
    "external-health-export",
    "external-health-export",
  ]);
  assert.deepEqual(imported.items.map((item) => item.entry.externalId), [
    "weight-2026-08-14",
    "4182",
  ]);

  const replayed = await registry.execute("log_import", batch, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "import-replay",
  });
  assert.deepEqual(
    [replayed.importedCount, replayed.unchangedCount, replayed.conflictCount],
    [0, 2, 0],
  );
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM log_entries").get().count, 2);

  const conflict = await registry.execute("log_import", {
    source: batch.source,
    entries: [{ ...batch.entries[0], content: "Changed upstream representation" }],
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "import-conflict",
  });
  assert.deepEqual(
    [conflict.importedCount, conflict.unchangedCount, conflict.conflictCount],
    [0, 0, 1],
  );
  assert.equal(conflict.items[0].entry.content, "72.4 kg in the morning");

  const anotherSource = await registry.execute("log_import", {
    source: "another-export",
    entries: [batch.entries[0]],
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "import-other-source",
  });
  assert.equal(anotherSource.importedCount, 1);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM log_entries").get().count, 3);
  const sourceEntries = await registry.execute("log_list", {
    tracker: null,
    group: null,
    source: "external-health-export",
    fromUtc: null,
    throughUtc: null,
    limit: 20,
  });
  assert.equal(sourceEntries.count, 2);
});

test("log_import rejects duplicate IDs within a batch and missing occurrence times", async (context) => {
  const { store, request, registry } = loggingHarness(context, "Import invalid history");
  const entry = {
    externalId: "duplicate",
    tracker: "Mood",
    group: "Health",
    content: "Calm",
    number: null,
    unit: null,
    occurredAtUtc: "2026-08-14T12:00:00Z",
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
      entries: [{ ...entry, externalId: "missing-time", occurredAtUtc: null }],
    }, { requestId: request.requestId, requestEventId: request.eventId, callId: "missing-time" }),
    /require an occurrence time/,
  );
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM log_entries").get().count, 0);
});
