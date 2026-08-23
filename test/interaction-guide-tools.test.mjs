import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { InteractionGuides } from "../src/interaction-guides.mjs";
import { Ledger } from "../src/ledger.mjs";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { registerInteractionGuideTools } from "../src/tools/interaction-guide-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { temporaryDatabase } from "./helpers.mjs";

function harness(context) {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const guides = new InteractionGuides({ store, ledger });
  const registry = new ToolRegistry();
  registerInteractionGuideTools(registry, guides);
  registerTodoTools(registry, store, ledger);
  return { store, guides, registry };
}

test("interaction guides keep list results metadata-only and use versioned updates", async (context) => {
  const { registry } = harness(context);
  const created = await registry.execute("interaction_guide_create", {
    name: "Morning Check-in",
    guide_text: "# Ask\n\n1. What matters most today?",
  }, { requestId: "guide-request", callId: "create-guide" });
  assert.equal(created.guide.version, 1);

  const listed = await registry.execute("interaction_guide_list", { status: "active", limit: 20 });
  assert.equal(listed.count, 1);
  assert.equal(Object.hasOwn(listed.guides[0], "guide_text"), false);

  const fetched = await registry.execute("interaction_guide_get", {
    interaction_guide_id: null,
    name: "morning check-in",
  });
  assert.match(fetched.guide.guide_text, /What matters most/);

  const updated = await registry.execute("interaction_guide_update", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: created.guide.version,
    name: null,
    guide_text: "# Ask\n\n1. How did you sleep?\n2. What matters most today?",
  }, { requestId: "guide-request", callId: "update-guide" });
  assert.equal(updated.guide.version, 2);
  await assert.rejects(
    registry.execute("interaction_guide_update", {
      interaction_guide_id: created.guide.interaction_guide_id,
      expected_version: 1,
      name: "Stale name",
      guide_text: null,
    }),
    /changed after it was read/,
  );
});

test("a repeating to-do links to a guide and generated occurrences preserve the link", async (context) => {
  const { store, registry } = harness(context);
  const firstOccurrence = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const createdGuide = await registry.execute("interaction_guide_create", {
    name: "Evening Reflection",
    guide_text: "Ask what went well, then summarize the day.",
  });
  const guideId = createdGuide.guide.interaction_guide_id;
  const createdTodo = await registry.execute("todo_add", {
    text: "Evening reflection",
    group: "Inbox",
    interaction_guide_id: guideId,
    scheduled_at_utc: firstOccurrence,
    due_at_utc: null,
    recurrence: {
      frequency: "DAILY", interval: 1, weekdays: [], count: 3,
      until_date: null, time_zone: "America/New_York",
    },
  }, { requestId: "guide-todo", callId: "create-todo" });
  assert.equal(createdTodo.task.todo_routines.interaction_guide_id, guideId);
  assert.equal(createdTodo.task.interaction_guides.name, "Evening Reflection");

  const unlinked = await registry.execute("todo_interaction_guide_set", {
    personal_task_id: createdTodo.task.personal_task_id,
    interaction_guide_id: null,
  });
  assert.equal(unlinked.task.interaction_guides, null);
  const relinked = await registry.execute("todo_interaction_guide_set", {
    personal_task_id: createdTodo.task.personal_task_id,
    interaction_guide_id: guideId,
  });
  assert.equal(relinked.task.interaction_guides.name, "Evening Reflection");

  await assert.rejects(
    registry.execute("interaction_guide_archive", {
      interaction_guide_id: guideId,
      expected_version: 1,
    }),
    /repeating to-dos/,
  );

  const completed = await registry.execute("todo_update", {
    personal_task_id: createdTodo.task.personal_task_id,
    text: null,
    group: null,
    status: "complete",
    scheduled_at_utc: null,
    due_at_utc: null,
  }, { requestId: "guide-todo", callId: "complete-todo" });
  assert.equal(completed.generated_task.todo_routines.interaction_guide_id, guideId);
  assert.equal(completed.generated_task.interaction_guides.name, "Evening Reflection");
  assert.equal(store.requireReady().prepare(`
    SELECT interaction_guide_id FROM todo_routines WHERE todo_routine_id = ?
  `).get(createdTodo.task.todo_routine_id).interaction_guide_id, guideId);
});

test("one-time to-dos cannot link an interaction guide", async (context) => {
  const { registry } = harness(context);
  const createdGuide = await registry.execute("interaction_guide_create", {
    name: "Weekly Review",
    guide_text: "Review the week.",
  });
  await assert.rejects(
    registry.execute("todo_add", {
      text: "Weekly review",
      group: "Inbox",
      interaction_guide_id: createdGuide.guide.interaction_guide_id,
      scheduled_at_utc: "2026-08-21T13:00:00.000Z",
      due_at_utc: null,
    }),
    /only to a recurring to-do/,
  );
});

test("the organizer API exposes a linked guide and clears it when recurrence is removed", (context) => {
  const { store, guides } = harness(context);
  const guide = guides.create({ name: "Planning", guideText: "Ask for the top priority." }).guide;
  const organizer = new OrganizerStore(store.filename);
  context.after(() => organizer.close());
  const created = organizer.createTodo({
    text: "Plan the day",
    groupId: 1,
    scheduledAtUtc: "2026-08-21T12:00:00.000Z",
    recurrenceRule: "FREQ=DAILY;COUNT=3",
    recurrenceTimeZone: "America/New_York",
    interactionGuideId: guide.id,
  });
  assert.equal(created.interactionGuideId, guide.id);
  assert.equal(created.interactionGuideName, "Planning");

  const oneTime = organizer.updateTodo(created.id, {
    version: created.version,
    recurrenceRule: null,
    recurrenceTimeZone: null,
  });
  assert.equal(oneTime.routineId, null);
  assert.equal(oneTime.interactionGuideId, null);
});
