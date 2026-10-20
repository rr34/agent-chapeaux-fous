import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeSearchCoordinator, nativeObjectSearchDomains, registerEmailSearchProvider,
} from "../src/search/native-search.mjs";
import { nativeObjectTypes } from "../src/native-object-search.mjs";

function objectFor(domainType) {
  const definitions = {
    "todos.personal_task": ["todo", "native:todos", "agent-slayer://todos/7", "Call Alice"],
    "things.physical_item": ["physical_item", "native:things", "agent-slayer://physical-items/7", "Blue cabinet"],
    "journal.entry": ["journal_entry", "native:journal", "agent-slayer://journal-entries/7", "Slept well"],
    "video.content_item": ["content_item", "native:video", "agent-slayer://content-items/7", "Search notes"],
    "video.script": ["video_script", "native:video", "agent-slayer://video-scripts/7", "Search demo"],
    "profile.fact": ["profile_fact", "native:profile", "agent-slayer://profile-facts/7", "Prefers tea"],
    "catch_up.question": ["catch_up_question", "native:catch-up", "agent-slayer://catch-up-questions/7", "How was sleep?"],
    "payments.invoice": ["payments.invoice", "native:payments", "agent-slayer://payment-invoices/7", "Alice — Invoice 7"],
  };
  const definition = definitions[domainType];
  if (!definition) return null;
  const [type, source, ref, title] = definition;
  return {
    type, domainType, source, table: "test", id: 7, ref,
    label: domainType, title, detail: "matched detail", matchedOn: ["title"], related: [],
  };
}

function organizer() {
  return {
    searchNativeObjects({ domainTypes = ["todos.personal_task"] }) {
      return {
        query: "test", source: "native_mariadb_object_tables", capturedAtUtc: "2026-10-20T12:00:00.000Z",
        objects: domainTypes.map(objectFor).filter(Boolean),
      };
    },
  };
}

test("global discovery advertises every consolidated native domain while keeping object picker search internal", async () => {
  const coordinator = createNativeSearchCoordinator({ store: {}, organizer: organizer(), ledger: {} });
  assert.deepEqual(coordinator.listProviders().map(({ id }) => id), [
    "calendar", "contacts", "files", "history", "todos", "things", "journal", "content",
    "video", "profile", "catch_up", "payments",
  ]);
  assert.equal(coordinator.listProviders().some(({ id }) => id === "objects"), false);
  assert.equal(coordinator.listProviders({ includeInternal: true }).some(({ id }) => id === "objects"), true);

  const result = await coordinator.search({ query: "Alice", scopes: ["todos"], limit: 10 });
  assert.equal(result.partial, false);
  assert.deepEqual(result.hits[0], {
    provider: "todos",
    kind: "todo",
    id: "7",
    ref: "agent-slayer://todos/7",
    objectType: "todos.personal_task",
    source: "native:todos",
    title: "Call Alice",
    snippet: "matched detail",
    matchedFields: ["title"],
    occurredAtUtc: null,
    actionRef: {
      type: "todos.personal_task", source: "native:todos", id: 7, ref: "agent-slayer://todos/7",
    },
    object: objectFor("todos.personal_task"),
  });

  const objects = await coordinator.searchNativeObjects({
    query: "Alice", limit: 10, domainTypes: ["todos.personal_task"],
  });
  assert.equal(objects.objects[0].domainType, "todos.personal_task");
});

test("every searchable first-class native object type has a global provider owner", () => {
  const dedicatedProviderTypes = [
    "calendar.event", "calendar.routine", "contacts.contact", "files.file",
  ];
  const globallyOwnedTypes = new Set([
    ...dedicatedProviderTypes,
    ...nativeObjectSearchDomains.flatMap(([, , domainTypes]) => domainTypes),
  ]);
  assert.deepEqual(
    [...globallyOwnedTypes].sort(),
    nativeObjectTypes.map(({ domainType }) => domainType).sort(),
  );
});

test("live email joins the same coordinator and returns the normalized global hit shape", async () => {
  const coordinator = createNativeSearchCoordinator({ store: {}, organizer: organizer(), ledger: {} });
  const client = {
    resolveAccountId: () => "account-1",
    async call(method) {
      if (method === "Email/query") {
        return { accountId: "account-1", queryState: "query-1", position: 0, ids: ["mail-1"], total: 1 };
      }
      if (method === "Email/get") {
        return {
          accountId: "account-1", state: "state-1", notFound: [],
          list: [{ id: "mail-1", subject: "Quarterly plan", preview: "Alice sent the plan" }],
        };
      }
      throw new Error(`Unexpected ${method}`);
    },
  };
  registerEmailSearchProvider(coordinator, client);
  const result = await coordinator.search({ query: "Alice", scopes: ["email"], limit: 10 });
  assert.equal(result.hits[0].ref, "agent-slayer://emails/mail-1");
  assert.equal(result.hits[0].objectType, "email.message");
  assert.equal(result.hits[0].source, "native:email");
});

