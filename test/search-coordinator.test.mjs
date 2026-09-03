import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { createNativeSearchCoordinator } from "../src/search/native-search.mjs";
import { SearchCoordinator } from "../src/search/search-coordinator.mjs";
import { registerCalendarTools } from "../src/tools/calendar-tools.mjs";
import { registerContactTools } from "../src/tools/contact-tools.mjs";
import { registerDatabaseTools } from "../src/tools/database-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerSearchTools } from "../src/tools/search-tools.mjs";
import { temporaryDatabase } from "./helpers.mjs";

function harness(context) {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const organizer = new OrganizerStore(temporary.target);
  context.after(() => organizer.close());
  const ledger = new Ledger(store);
  const coordinator = createNativeSearchCoordinator({ store, organizer, ledger });
  return { store, organizer, ledger, coordinator };
}

test("search coordinator interleaves providers and reports partial failures literally", async () => {
  const coordinator = new SearchCoordinator({ providers: [
    {
      id: "first",
      search() {
        return {
          hits: [{ id: "first-1" }, { id: "first-2" }],
          exhaustive: true, hasMore: false, matchMode: "terms",
        };
      },
    },
    {
      id: "broken",
      search() { throw new Error("provider is offline"); },
    },
    {
      id: "third",
      search() {
        return {
          hits: [{ id: "third-1" }], exhaustive: true, hasMore: false, matchMode: "terms",
        };
      },
    },
  ] });

  const result = await coordinator.search({
    query: "example", scopes: ["first", "broken", "third"], limit: 3,
  });
  assert.deepEqual(result.hits.map(({ id }) => id), ["first-1", "third-1", "first-2"]);
  assert.equal(result.partial, true);
  assert.equal(result.providers.find(({ scope }) => scope === "broken").error, "provider is offline");
});

test("native coordinator searches calendar, contacts, files, and history through one tool", async (context) => {
  const { organizer, ledger, coordinator } = harness(context);
  organizer.createCalendar({
    title: "Planning review",
    description: "Discuss the proposal with Alice",
    startsAtUtc: "2099-08-18T19:00:00.000Z",
  });
  organizer.createContact({ displayName: "Alice Rivera", notes: "Planning collaborator" });
  const storedFile = ledger.registerFile({
    storagePath: "media/alice-plan.csv", originalFilename: "alice-plan.csv",
    title: "Alice planning data", description: "Revised proposal source rows",
    mediaKind: "document", mimeType: "text/csv", sha256: "alice-plan", byteSize: 42,
  });
  ledger.createRequest({ text: "Upload Alice's planning source", primaryFileId: storedFile.fileId });
  const request = ledger.createRequest({ text: "Alice proposed the revised plan" });
  ledger.finish(ledger.trace(request.requestId)[0], "The proposal was recorded.");

  const registry = new ToolRegistry();
  registerSearchTools(registry, coordinator);
  const definition = registry.toolDefinitions().find(({ name }) => name === "global_search");
  assert.deepEqual(definition.inputSchema.properties.scopes.items.enum, ["calendar", "contacts", "files", "history"]);
  assert.deepEqual(definition.inputSchema.properties.match_mode.enum, ["terms", "phrase", "near"]);

  const result = await registry.execute("global_search", {
    query: "Alice",
    scopes: ["calendar", "contacts", "files", "history"],
    match_mode: "terms",
    max_distance: 12,
    context_tokens: 24,
    limit: 10,
  });
  assert.equal(result.partial, false);
  assert.deepEqual(new Set(result.hits.map(({ provider }) => provider)), new Set([
    "calendar", "contacts", "files", "history",
  ]));
  assert.equal(result.hits.find(({ provider }) => provider === "calendar").title, "Planning review");
  assert.equal(result.hits.find(({ provider }) => provider === "contacts").title, "Alice Rivera");
  assert.match(result.hits.find(({ provider }) => provider === "files").title, /File #\d+ — Alice planning data/);
  assert.match(result.hits.find(({ provider }) => provider === "history").snippet, /Alice proposed/);
});

test("existing domain tools preserve their results when routed through search providers", async (context) => {
  const { store, organizer, ledger, coordinator } = harness(context);
  organizer.createCalendar({
    title: "Library planning",
    description: "Discuss autumn events",
    location: "East branch",
    startsAtUtc: "2099-09-10T18:30:00.000Z",
  });
  organizer.createContact({ displayName: "Dina Woods", organizationName: "North Design Studio" });
  const request = ledger.createRequest({ text: "Remember the library design discussion" });
  ledger.finish(ledger.trace(request.requestId)[0], "Noted.");

  const direct = new ToolRegistry();
  registerCalendarTools(direct, store, organizer, ledger);
  registerContactTools(direct, store, organizer, ledger);
  registerDatabaseTools(direct, store, ledger);
  const coordinated = new ToolRegistry();
  registerCalendarTools(coordinated, store, organizer, ledger, null, coordinator);
  registerContactTools(coordinated, store, organizer, ledger, null, coordinator);
  registerDatabaseTools(coordinated, store, ledger, null, coordinator);

  const calls = [
    ["calendar_event_search", { query: "library East", include_archived: false, limit: 20 }],
    ["contact_search", { queries: ["design"], include_inactive: false, limit: 20 }],
    ["history_search", { query: "library design", limit: 20 }],
  ];
  for (const [name, argumentsObject] of calls) {
    assert.deepEqual(
      await coordinated.execute(name, argumentsObject, {}),
      await direct.execute(name, argumentsObject, {}),
      name,
    );
  }
});

test("history provider uses MariaDB full-text search for proximity and contextual snippets", async (context) => {
  const { store, ledger, coordinator } = harness(context);
  assert.equal(store.requireReady().engine, "mariadb");
  const near = ledger.createRequest({ text: "The cabinet design needs one final decision before Friday." });
  ledger.finish(ledger.trace(near.requestId)[0], "Okay.");
  const far = ledger.createRequest({
    text: "The cabinet measurements include many unrelated details about hardware, delivery, paint, hinges, handles, scheduling, and the final design.",
  });
  ledger.finish(ledger.trace(far.requestId)[0], "Okay.");

  assert.deepEqual(coordinator.listProviders().find(({ id }) => id === "history").capabilities, {
    phrase: true, proximity: true, snippets: true,
  });
  const result = await coordinator.search({
    query: "cabinet design",
    scopes: ["history"],
    mode: "near",
    maxDistance: 2,
    contextTokens: 8,
    limit: 10,
  });
  assert.equal(result.providers[0].matchMode, "near");
  assert.deepEqual(result.hits.map(({ actionRef }) => actionRef.request_id), [near.requestId]);
  assert.match(result.hits[0].snippet, /\[\[cabinet\]\]/i);
  assert.match(result.hits[0].snippet, /\[\[design\]\]/i);
});
