import assert from "node:assert/strict";
import test from "node:test";
import { nativeObjectTypes, normalizeSelectedObjectCandidates, objectSearchTerms, registerNativeObjectContextView, resolveNativeObjectCandidates, searchNativeObjects, selectedObjectMentionsAreVisible } from "../src/native-object-search.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

test("native object candidates come from selected authoritative tables and rank direct names above relationships", () => {
  const statements = [];
  const database = { prepare(sql) {
    return { all(...parameters) {
      statements.push({ sql, parameters });
      if (sql.includes("FROM contacts AS c")) return [
        { id: 7, title: "Lucas Ruffing", given_name: "Lucas", family_name: "Ruffing", contact_kind: "person", tag_labels: "family" },
      ];
      if (sql.includes("FROM todo_groups AS g")) return [{ id: 8, title: "Watches" }];
      if (sql.includes("FROM todo_personal AS task")) return [
        { id: 9, title: "Call Lucas", parent_id: 8, parent_title: "Watches", status: "todo", contact_id: 7, contact_title: "Lucas Ruffing" },
      ];
      if (sql.includes("FROM journal1_groups AS journal_group")) return [{ id: 10, title: "Exercise" }];
      if (sql.includes("FROM journal2_trackers AS tracker")) return [
        { id: 11, title: "Push-ups", unit: "reps", parent_id: 10, parent_title: "Exercise" },
      ];
      if (sql.includes("FROM journal3_entries AS entry")) return [
        { id: 12, title: "Did 30 push-ups", parent_id: 11, parent_title: "Push-ups", grandparent_id: 10, grandparent_title: "Exercise" },
      ];
      if (sql.includes("FROM todo_personal\n")) return [{ id: 9, title: "Call Lucas" }];
      if (sql.includes("FROM journal2_trackers\n")) return [{ id: 11, title: "Push-ups" }];
      return [];
    } };
  } };

  assert.deepEqual(objectSearchTerms("Do you see Lucas and Lindsey Ruffing?"), ["lucas", "lindsey", "ruffing"]);
  assert.deepEqual(objectSearchTerms("Do you see the contacts?"), []);
  assert.equal(searchNativeObjects(database, { query: "Do you see the contacts?" }).objects.length, 0);
  assert.equal(statements.length, 0);

  const contacts = searchNativeObjects(database, { query: "Lucas Ruffing" }).objects;
  assert.equal(contacts[0].ref, "agent-slayer://contacts/7");
  assert.equal(contacts[0].title, "Lucas Ruffing");
  assert.deepEqual(contacts[0].related.map(({ ref }) => ref), ["agent-slayer://todos/9"]);
  assert.ok(contacts[0].matchedOn.includes("title"));
  assert.ok(statements.some(({ parameters }) => parameters.includes("%lucas%")));
  assert.ok(statements.every(({ sql }) => !/SELECT\s+\*/iu.test(sql)));

  const exercise = searchNativeObjects(database, { query: "Exercise log items" }).objects;
  assert.equal(exercise[0].ref, "agent-slayer://journal-groups/10");
  assert.deepEqual(exercise[0].related.map(({ ref }) => ref), ["agent-slayer://journal-trackers/11"]);
  assert.ok(exercise.find(({ ref }) => ref === "agent-slayer://journal-trackers/11")?.matchedOn.includes("parent"));
  assert.equal(searchNativeObjects(database, { query: "Push ups" }).objects[0].ref,
    "agent-slayer://journal-trackers/11");
  assert.equal(searchNativeObjects(database, { query: "family" }).objects[0].ref, "agent-slayer://contacts/7");
  assert.deepEqual(nativeObjectTypes.map(({ table }) => table), [
    "contacts", "todo_groups", "todo_personal", "journal1_groups", "journal2_trackers", "journal3_entries",
    "calendar_events", "calendar_routines", "files", "profile_facts",
    "catch_up_questions", "video_scripts", "content_groups", "content_items",
  ]);
  assert.equal(contacts[0].domainType, "contacts.contact");
  assert.equal(contacts[0].source, "native:contacts");
});

test("object search bounds text and result count before database work", () => {
  assert.throws(() => objectSearchTerms("x".repeat(401)), /at most 400 characters/u);
  assert.throws(() => objectSearchTerms(null), /at most 400 characters/u);
  assert.throws(() => searchNativeObjects({ prepare() { throw new Error("unexpected read"); } }, {
    query: "Exercise", limit: 49,
  }), /limit must be from 1 to 48/u);
});

test("the selector keeps only recent-or-future events and open to-dos", () => {
  const searchSql = [];
  const exactSql = [];
  const database = { prepare(sql) {
    return {
      all() {
        searchSql.push(sql);
        return [];
      },
      get() {
        exactSql.push(sql);
        if (sql.includes("calendar_events")) return { title: "Future meeting" };
        if (sql.includes("todo_personal")) return { title: "Open task" };
        return undefined;
      },
    };
  } };

  searchNativeObjects(database, { query: "meeting task" });
  const todoSearch = searchSql.find((sql) => sql.includes("FROM todo_personal AS task"));
  const eventSearch = searchSql.find((sql) => sql.includes("FROM calendar_events AS event"));
  assert.match(todoSearch, /task\.status IN \('todo', 'ai_suggested'\)/u);
  assert.doesNotMatch(todoSearch, /status NOT IN/u);
  assert.match(eventSearch, /COALESCE\(event\.ends_at_utc, event\.starts_at_utc\) >= DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 1 MONTH\)/u);

  const selected = [{
    mention: "@Open task", type: "todos.personal_task", source: "native:todos",
    id: 9, ref: "agent-slayer://todos/9", display: "Open task",
  }, {
    mention: "@Future meeting", type: "calendar.event", source: "native:calendar",
    id: 14, ref: "agent-slayer://calendar-events/14", display: "Future meeting",
  }];
  assert.equal(resolveNativeObjectCandidates(database, selected).length, 2);
  const todoExact = exactSql.find((sql) => sql.includes("FROM todo_personal"));
  const eventExact = exactSql.find((sql) => sql.includes("FROM calendar_events"));
  assert.match(todoExact, /status IN \('todo', 'ai_suggested'\)/u);
  assert.match(eventExact, /COALESCE\(ends_at_utc, starts_at_utc\) >= DATE_SUB\(UTC_TIMESTAMP\(3\), INTERVAL 1 MONTH\)/u);
});

test("native object context is advertised and read only after strict view selection", async () => {
  const registry = new ToolRegistry();
  registry.registerCapability({ id: "search", title: "Global search" });
  const calls = [];
  registerNativeObjectContextView(registry, {
    searchNativeObjects(input) {
      calls.push(input);
      return { source: "native_mariadb_object_tables", capturedAtUtc: "2026-09-15T12:00:00.000Z",
        objects: [{ ref: "agent-slayer://contacts/7", title: "Lucas Ruffing" }] };
    },
  });
  const advertised = registry.capabilityManifest("search").contextViews[0];
  assert.equal(advertised.id, "search.native_object_candidates");
  assert.equal(advertised.maximumItems, 12);
  assert.deepEqual(calls, []);
  const prepared = await registry.prepareContext(["search.native_object_candidates"], {
    requestText: "Do you see Lucas Ruffing?",
  });
  assert.deepEqual(calls, [{ query: "Do you see Lucas Ruffing?", limit: 6 }]);
  assert.equal(prepared[0].source, "native_mariadb_object_tables");
  assert.match(prepared[0].text, /agent-slayer:\/\/contacts\/7/u);
});


test("composer object selections retain exact searchable identity fields", () => {
  const selected = normalizeSelectedObjectCandidates([{
    mention: "@Lucas Ruffing",
    type: "contacts.contact",
    source: "native:contacts",
    id: 7,
    ref: "agent-slayer://contacts/7",
    display: "Lucas Ruffing",
  }]);
  assert.deepEqual(selected, [{
    mention: "@Lucas Ruffing", type: "contacts.contact", source: "native:contacts",
    id: 7, ref: "agent-slayer://contacts/7", display: "Lucas Ruffing",
  }]);
  assert.throws(() => normalizeSelectedObjectCandidates([{
    ...selected[0], ref: "agent-slayer://contacts/8",
  }]), /not a valid Contact identity/u);
  assert.throws(() => normalizeSelectedObjectCandidates([{
    ...selected[0], mention: "@Someone else",
  }]), /not a valid Contact identity/u);
});

test("every structured selection must have its own exact visible mention", () => {
  const lucas = {
    mention: "@Lucas", type: "contacts.contact", source: "native:contacts",
    id: 7, ref: "agent-slayer://contacts/7", display: "Lucas",
  };
  const otherLucas = {
    ...lucas, id: 8, ref: "agent-slayer://contacts/8",
  };
  assert.equal(selectedObjectMentionsAreVisible("Ask @Lucas about this.", [lucas]), true);
  assert.equal(selectedObjectMentionsAreVisible("Ask @Lucas about this.", [lucas, otherLucas]), false);
  assert.equal(selectedObjectMentionsAreVisible("Compare @Lucas and @Lucas.", [lucas, otherLucas]), true);
  assert.equal(selectedObjectMentionsAreVisible("Ask @Lucasette about this.", [lucas]), false);
  assert.equal(selectedObjectMentionsAreVisible("Ask Lucas about this.", [lucas]), false);
});

test("composer selections are verified by stable ID without ranked-search truncation", () => {
  const statements = [];
  const database = { prepare(sql) {
    return { get(id) {
      statements.push({ sql, id });
      return id === 7 ? { title: "Lucas Ruffing" } : undefined;
    } };
  } };
  const input = [{
    mention: "@Lucas Ruffing",
    type: "contacts.contact",
    source: "native:contacts",
    id: 7,
    ref: "agent-slayer://contacts/7",
    display: "Lucas Ruffing",
  }];

  assert.deepEqual(resolveNativeObjectCandidates(database, input), [{
    type: "contact", domainType: "contacts.contact", source: "native:contacts",
    table: "contacts", id: 7, ref: "agent-slayer://contacts/7", label: "Contact",
    title: "Lucas Ruffing", detail: "", matchedOn: ["selected stable reference"], related: [],
  }]);
  assert.equal(statements.length, 1);
  assert.match(statements[0].sql, /WHERE contact_id = \? AND status = 'active' LIMIT 1/u);
  assert.equal(statements[0].id, 7);

  assert.deepEqual(resolveNativeObjectCandidates(database, [{
    ...input[0], display: "Lucas R.", mention: "@Lucas R.",
  }]), []);
});
