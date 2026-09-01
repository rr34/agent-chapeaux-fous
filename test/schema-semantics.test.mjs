import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { InteractionGuides } from "../src/interaction-guides.mjs";
import { ProfileFacts } from "../src/profile-facts.mjs";
import { SchemaSemantics } from "../src/schema-semantics.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerDatabaseTools } from "../src/tools/database-tools.mjs";
import { registerCalendarTools } from "../src/tools/calendar-tools.mjs";
import { registerContactTools } from "../src/tools/contact-tools.mjs";
import { registerLogTools } from "../src/tools/log-tools.mjs";
import { registerInteractionGuideTools } from "../src/tools/interaction-guide-tools.mjs";
import { registerProfileFactTools } from "../src/tools/profile-fact-tools.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { temporaryDatabase } from "./helpers.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("structured database reads expose bounded offset pagination", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  ledger.append({ type: "test.page", name: "first pagination marker" });
  ledger.append({ type: "test.page", name: "second pagination marker" });

  const registry = new ToolRegistry();
  registerDatabaseTools(registry, store, ledger, null);
  const definition = registry.toolDefinitions().find(({ name }) => name === "database_read");
  assert.deepEqual(definition.inputSchema.properties.offset, {
    type: "integer", minimum: 0, maximum: 1000000,
  });

  const first = await registry.execute("database_read", {
    objectName: "activity_events",
    columns: ["event_seq", "name"],
    where: { event_type: "test.page" },
    orderBy: "event_seq",
    orderDirection: "asc",
    limit: 1,
    offset: 0,
  });
  assert.equal(first.count, 1);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 1);

  const second = await registry.execute("database_read", {
    objectName: "activity_events",
    columns: ["event_seq", "name"],
    where: { event_type: "test.page" },
    orderBy: "event_seq",
    orderDirection: "asc",
    limit: 1,
    offset: first.nextOffset,
  });
  assert.equal(second.rows[0].name, "second pagination marker");
  assert.notEqual(second.rows[0].event_seq, first.rows[0].event_seq);
  assert.equal(second.hasMore, false);
  assert.equal(second.nextOffset, null);
});

test("structured database reads return an exact schema-semantic projection", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const schemaSemantics = new SchemaSemantics({
    filename: path.join(repositoryRoot, "db", "schema-semantics.json"),
    ledger,
  });
  const registry = new ToolRegistry();
  registerDatabaseTools(registry, store, ledger, schemaSemantics);
  const request = ledger.createRequest({ text: "Read active profile facts" });

  const result = await registry.execute("database_read", {
    objectName: "profile_facts",
    columns: ["fact_type", "fact_text"],
    where: { fact_status: "active" },
    orderBy: "fact_type",
    orderDirection: "asc",
    limit: 20,
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "database-read",
  });

  assert.equal(result.schemaProjection.product, "schema-semantic-compiler/schema-semantic-projection");
  assert.deepEqual(
    Object.keys(result.schemaProjection.schemaProjection.schemaObjects),
    ["profile_facts"],
  );
  assert.equal(
    result.schemaProjection.schemaProjection.schemaObjects.profile_facts.fields.fact_text.meaning,
    "Self-contained natural-language statement identifying the fact's person or item.",
  );
  assert.equal(
    ledger.trace(request.requestId).some((event) => event.type === "schema.semantics.compiled"),
    true,
  );

  const logResult = await registry.execute("database_read", {
    objectName: "log_entries",
    columns: ["content_text", "number_value", "source", "external_id"],
    where: {},
    orderBy: "occurred_at_utc",
    orderDirection: "desc",
    limit: 20,
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "log-schema-read",
  });
  const logFields = logResult.schemaProjection.schemaProjection.schemaObjects.log_entries.fields;
  assert.match(logFields.content_text.meaning, /Complete self-contained natural-language content/);
  assert.match(logFields.number_value.meaning, /Optional numeric projection/);
  assert.match(logFields.external_id.meaning, /make imports idempotent/);

  await assert.rejects(
    registry.execute("database_read", {
      objectName: "contacts",
      columns: ["display_name"],
      where: { status: "active" },
      orderBy: "display_name",
      orderDirection: "asc",
      limit: 10_000,
    }, {
      requestId: request.requestId,
      requestEventId: request.eventId,
      callId: "invalid-database-limit",
    }),
    /limit must be an integer from 1 to 200/,
  );
  await assert.rejects(
    registry.execute("database_read", {
      objectName: "interaction_guides",
      columns: ["name"],
      where: {},
      orderBy: "name",
      orderDirection: "asc",
      limit: 20,
      offset: 0,
    }),
    /generic database reads do not load private briefing or answer rows/,
  );
  await assert.rejects(
    registry.execute("database_read", {
      objectName: "interaction_guide_steps",
      columns: ["step_number", "answers_json"],
      where: {},
      orderBy: "step_number",
      orderDirection: "asc",
      limit: 20,
      offset: 0,
    }),
    /generic database reads do not load private briefing or answer rows/,
  );
});

test("native database-backed tools return stored field names with semantic projections", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const schemaSemantics = new SchemaSemantics({
    filename: path.join(repositoryRoot, "db", "schema-semantics.json"),
    ledger,
  });
  const profileFacts = new ProfileFacts({ store, ledger });
  const organizer = new OrganizerStore(temporary.filename);
  context.after(() => organizer.close());
  const registry = new ToolRegistry();
  registerCalendarTools(registry, store, organizer, ledger, schemaSemantics);
  registerContactTools(registry, store, organizer, ledger, schemaSemantics);
  registerTodoTools(registry, store, ledger, schemaSemantics);
  registerLogTools(registry, store, ledger, schemaSemantics);
  registerInteractionGuideTools(
    registry,
    new InteractionGuides({ store, ledger }),
    schemaSemantics,
  );
  registerProfileFactTools(registry, profileFacts, schemaSemantics);
  const definitions = Object.fromEntries(
    registry.toolDefinitions().map((definition) => [definition.name, definition.inputSchema.properties]),
  );
  assert.equal(Object.hasOwn(definitions.todo_add, "scheduled_at_utc"), true);
  assert.equal(Object.hasOwn(definitions.todo_add, "scheduledAtUtc"), false);
  assert.equal(Object.hasOwn(definitions.routine_add, "recurrence"), true);
  assert.equal(Object.hasOwn(definitions.routine_add, "group"), false);
  assert.equal(Object.hasOwn(definitions.log_add, "content_text"), true);
  assert.equal(Object.hasOwn(definitions.log_add, "tracker_unit"), true);
  assert.equal(Object.hasOwn(definitions.log_add, "unit"), false);
  assert.equal(Object.hasOwn(definitions.log_add, "content"), false);
  assert.equal(Object.hasOwn(definitions.log_update, "log_entry_id"), true);
  assert.equal(Object.hasOwn(definitions.profile_fact_set, "fact_type"), true);
  assert.equal(Object.hasOwn(definitions.profile_fact_set, "factType"), false);
  assert.equal(Object.hasOwn(definitions.interaction_guide_update, "guide_text"), false);
  assert.equal(Object.hasOwn(definitions.interaction_guide_step_add, "opening_text"), true);
  assert.equal(Object.hasOwn(definitions.interaction_guide_step_answer, "answers"), true);
  assert.equal(Object.hasOwn(definitions.calendar_event_add, "starts_at_utc"), true);
  assert.equal(Object.hasOwn(definitions.calendar_event_add, "startsAtUtc"), false);
  assert.equal(Object.hasOwn(definitions.todo_update, "updates"), true);
  assert.equal(Object.hasOwn(definitions.todo_update, "personal_task_id"), false);
  assert.equal(Object.hasOwn(definitions.contact_import, "entries"), true);
  assert.equal(Object.hasOwn(definitions.contact_file_import, "csv_mapping"), true);
  assert.equal(Object.hasOwn(definitions.contact_tag_rename, "current_tag"), true);
  assert.equal(Object.hasOwn(definitions.contact_tag_rename, "new_tag"), true);
  assert.equal(Object.hasOwn(definitions.contact_search, "queries"), true);
  assert.equal(Object.hasOwn(definitions.contact_lookup_batch, "names"), true);
  assert.equal(Object.hasOwn(definitions.contact_tag_add_batch, "contact_ids"), true);
  assert.equal(Object.hasOwn(definitions.contact_duplicate_list, "limit"), true);
  assert.equal(Object.hasOwn(definitions.contact_dedupe_clear, "max_groups"), true);
  assert.equal(Object.hasOwn(definitions.contact_merge, "merges"), true);
  assert.equal(Object.hasOwn(definitions, "contact_merge_batch"), false);
  const request = ledger.createRequest({ text: "Inspect native semantic results" });
  const toolContext = {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "native-semantics",
  };

  const groups = await registry.execute("todo_group_list", {}, toolContext);
  assert.equal(groups.groups[0].todo_group_id, 2);
  assert.equal(Object.hasOwn(groups.groups[0], "id"), false);
  assert.match(
    groups.schemaProjection.schemaProjection.schemaObjects.todo_groups.fields.name.meaning,
    /Complete human-facing name/,
  );

  const logged = await registry.execute("log_add", {
    tracker: "Weight", group: "Health", content_text: "72.1 kg", number_value: 72.1,
    tracker_unit: "kg", occurred_at_utc: "2026-08-16T12:00:00Z", create_if_missing: true,
  }, toolContext);
  assert.equal(logged.entry.content_text, "72.1 kg");
  assert.equal(Object.hasOwn(logged.entry, "content"), false);
  assert.match(
    logged.schemaProjection.schemaProjection.schemaObjects.log_entries.fields.content_text.meaning,
    /Complete self-contained natural-language content/,
  );
  assert.match(
    logged.schemaProjection.schemaProjection.schemaObjects.trackers.fields.unit.meaning,
    /Canonical unit shared by every numeric entry/,
  );

  const fact = await registry.execute("profile_fact_set", {
    fact_type: "preferred_name", fact_text: "My preferred name is Nate.", replaces_profile_fact_id: null,
  }, toolContext);
  assert.equal(fact.fact.fact_text, "My preferred name is Nate.");
  assert.equal(Object.hasOwn(fact.fact, "text"), false);
  assert.match(
    fact.schemaProjection.schemaProjection.schemaObjects.profile_facts.fields.fact_text.meaning,
    /Self-contained natural-language statement/,
  );

  const guide = await registry.execute("interaction_guide_create", {
    name: "Morning Check-in",
  }, toolContext);
  assert.equal(guide.guide.name, "Morning Check-in");
  assert.match(
    guide.schemaProjection.schemaProjection.schemaObjects.interaction_guides.fields.name.meaning,
    /User-facing unique name/,
  );
  const step = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: guide.guide.interaction_guide_id,
    expected_version: guide.guide.version,
    step_number: 1,
    opening_text: "1. What outcome do you need?",
    instructions_text: "Capture the exact desired outcome.",
    completion_mode: "response_valid",
    enabled: true,
  }, toolContext);
  assert.equal(step.step.opening_text, "1. What outcome do you need?");
  assert.deepEqual(step.step.answers_json, {});
  assert.equal(step.step.progress_state, "pending");
  assert.match(
    step.schemaProjection.schemaProjection.schemaObjects.interaction_guide_steps.fields.answers_json.meaning,
    /answers the user has actually supplied/,
  );
  assert.match(
    step.schemaProjection.schemaProjection.schemaObjects.interaction_guide_steps.fields.progress_state.meaning,
    /resume an interrupted structured interaction/,
  );
});
