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

test("page-managed guide definitions are recorded as user actions rather than tool calls", (context) => {
  const { store, guides } = harness(context);
  const created = guides.create({
    name: "Page Brief",
    guideText: "Build this brief from the dedicated management page.",
  }, { actorType: "user", actorName: "structured_interactions_page" });
  guides.addStep({
    guideId: created.guide.id,
    expectedVersion: created.guide.version,
    stepNumber: 1,
    name: "Outcome",
    openingText: "1. What outcome should this produce?",
    objectiveText: "Record one concrete outcome.",
    instructionsText: null,
    completionMode: "response_valid",
    enabled: true,
  }, { actorType: "user", actorName: "structured_interactions_page" });

  const actors = store.requireReady().prepare(`
    SELECT event_type, actor_type, actor_name
    FROM activity_events
    WHERE event_type IN ('interaction_guide.created', 'interaction_guide.step_added')
    ORDER BY event_seq
  `).all().map((row) => ({ ...row }));
  assert.deepEqual(actors, [
    { event_type: "interaction_guide.created", actor_type: "user", actor_name: "structured_interactions_page" },
    { event_type: "interaction_guide.step_added", actor_type: "user", actor_name: "structured_interactions_page" },
  ]);
});

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

test("numbered interaction steps persist answers and resume at the exact active step", async (context) => {
  const { registry } = harness(context);
  const created = await registry.execute("interaction_guide_create", {
    name: "Evening Brief",
    guide_text: "Build a complete, efficient brief for tonight.",
  }, { requestId: "brief-build", callId: "create-brief" });
  const first = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: 1,
    step_number: 1,
    name: "Outcome",
    opening_text: "1. What must be accomplished tonight?",
    objective_text: "Capture one concrete outcome and how success will be recognized.",
    instructions_text: "Remain on step 1 until the outcome is concrete.",
    completion_mode: "response_valid",
    enabled: true,
  }, { requestId: "brief-build", callId: "add-step-1" });
  assert.equal(first.guide.version, 2);
  const second = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: 2,
    step_number: 3,
    name: "Inputs",
    opening_text: "3. What information and decisions are already available?",
    objective_text: "Collect the bounded inputs needed to execute the brief.",
    instructions_text: null,
    completion_mode: "response_valid",
    enabled: true,
  }, { requestId: "brief-build", callId: "add-step-3" });
  assert.equal(second.guide.version, 3);

  const fetched = await registry.execute("interaction_guide_get", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
  });
  assert.deepEqual(fetched.guide.steps.map(({ step_number }) => step_number), [1, 3]);
  assert.deepEqual(fetched.guide.steps[0].answers_json, {});

  const started = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
  }, { requestId: "brief-run-1", callId: "start-brief" });
  assert.equal(started.started, true);
  assert.equal(started.current_step.step_number, 1);
  const runId = started.run.run_id;

  const partial = await registry.execute("interaction_guide_step_answer", {
    run_id: runId,
    step_number: 1,
    answers: { outcome: "Prepare tomorrow's customer proposal" },
    step_complete: false,
    user_confirmed_advance: false,
    completion_receipt_event_seq: null,
  }, { requestId: "brief-run-2", callId: "answer-step-1-partial" });
  assert.equal(partial.current_step.step_number, 1);
  assert.equal(partial.step.answers_json.outcome, "Prepare tomorrow's customer proposal");

  const resumed = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
  }, { requestId: "brief-run-3", callId: "resume-brief" });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.run.run_id, runId);
  assert.equal(resumed.current_step.answers_json.outcome, "Prepare tomorrow's customer proposal");
  const activeList = await registry.execute("interaction_guide_list", {
    status: "active", limit: 20,
  });
  assert.equal(activeList.guides[0].active_run.run_id, runId);
  assert.equal(activeList.guides[0].active_run.current_step_number, 1);

  await assert.rejects(
    registry.execute("interaction_guide_step_update", {
      interaction_guide_step_id: first.step.interaction_guide_step_id,
      expected_version: 3,
      step_number: 1,
      name: "Changed during run",
      opening_text: "Changed",
      objective_text: "Changed",
      instructions_text: null,
      completion_mode: "response_valid",
      enabled: true,
    }),
    /active structured-interaction run/,
  );

  const advanced = await registry.execute("interaction_guide_step_answer", {
    run_id: runId,
    step_number: 1,
    answers: { success: "Proposal is ready for review" },
    step_complete: true,
    user_confirmed_advance: false,
    completion_receipt_event_seq: null,
  }, { requestId: "brief-run-4", callId: "complete-step-1" });
  assert.equal(advanced.run.current_step_number, 3);
  assert.equal(advanced.current_step.opening_text, "3. What information and decisions are already available?");

  const completed = await registry.execute("interaction_guide_step_answer", {
    run_id: runId,
    step_number: 3,
    answers: { inputs: "Customer notes and the existing estimate" },
    step_complete: true,
    user_confirmed_advance: false,
    completion_receipt_event_seq: null,
  }, { requestId: "brief-run-5", callId: "complete-step-3" });
  assert.equal(completed.run_complete, true);
  assert.equal(completed.current_step, null);

  const nextRun = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
  }, { requestId: "brief-run-6", callId: "start-next-brief" });
  assert.notEqual(nextRun.run.run_id, runId);
  assert.deepEqual(nextRun.current_step.answers_json, {});
});

test("an explicitly cancelled run preserves answers and releases its guide for editing", async (context) => {
  const { registry } = harness(context);
  const created = await registry.execute("interaction_guide_create", {
    name: "Cancelable Brief", guide_text: "Collect one answer.",
  });
  const added = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: 1,
    step_number: 1,
    name: "Question",
    opening_text: "1. What is the answer?",
    objective_text: "Record one answer.",
    instructions_text: null,
    completion_mode: "response_valid",
    enabled: true,
  });
  const started = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id, name: null, restart: false,
  });
  await registry.execute("interaction_guide_step_answer", {
    run_id: started.run.run_id,
    step_number: 1,
    answers: { answer: "Keep this" },
    step_complete: false,
    user_confirmed_advance: false,
    completion_receipt_event_seq: null,
  });
  const cancelled = await registry.execute("interaction_guide_run_cancel", {
    run_id: started.run.run_id,
    reason: "The user wants to revise the question.",
  });
  assert.equal(cancelled.run.status, "cancelled");
  const updated = await registry.execute("interaction_guide_step_update", {
    interaction_guide_step_id: added.step.interaction_guide_step_id,
    expected_version: 2,
    step_number: 1,
    name: "Revised question",
    opening_text: "1. What is the revised answer?",
    objective_text: "Record one revised answer.",
    instructions_text: null,
    completion_mode: "response_valid",
    enabled: true,
  });
  assert.equal(updated.guide.version, 3);
  assert.equal(updated.step.answers_json.answer, "Keep this");
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
