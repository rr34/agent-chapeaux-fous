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
  }, { actorType: "user", actorName: "structured_interactions_page" });
  guides.addStep({
    guideId: created.guide.id,
    expectedVersion: created.guide.version,
    stepNumber: 1,
    openingText: "1. What outcome should this produce?",
    instructionsText: "Record one concrete outcome.",
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

test("the page atomically edits an exchange and appends it to its new briefing", (context) => {
  const { store, guides } = harness(context);
  const source = guides.create({ name: "Source briefing" });
  const target = guides.create({ name: "Target briefing" });
  const targetFirst = guides.addStep({
    guideId: target.guide.id,
    expectedVersion: target.guide.version,
    stepNumber: 2,
    openingText: "Already in the destination.",
    instructionsText: null,
    completionMode: "response_valid",
    enabled: true,
  });
  const added = guides.addStep({
    guideId: source.guide.id,
    expectedVersion: source.guide.version,
    stepNumber: 2,
    openingText: "What should move?",
    instructionsText: "Old instructions.",
    completionMode: "response_valid",
    enabled: true,
  });
  const run = guides.begin({ guideId: source.guide.id, restart: false });
  guides.answerStep({
    runId: run.run.id,
    stepNumber: 2,
    answers: { prior: "answer" },
    stepComplete: true,
  });

  const result = guides.updateStep({
    stepId: added.step.id,
    expectedVersion: added.guide.version,
    targetGuideId: target.guide.id,
    expectedTargetVersion: targetFirst.guide.version,
    stepNumber: 2,
    openingText: "What should move now?",
    instructionsText: "Revised instructions.",
    completionMode: "user_advances",
    enabled: false,
  }, { actorType: "user", actorName: "structured_interactions_page" });

  assert.equal(result.updated, true);
  assert.equal(result.moved, true);
  assert.equal(result.sourceGuide.version, 3);
  assert.equal(result.targetGuide.version, 3);
  assert.equal(result.guide.id, target.guide.id);
  assert.equal(result.step.guideId, target.guide.id);
  assert.equal(result.step.stepNumber, 3);
  assert.equal(result.step.openingText, "What should move now?");
  assert.equal(result.step.instructionsText, "Revised instructions.");
  assert.deepEqual(result.step.answers, {});
  assert.equal(result.step.progressState, "pending");
  assert.equal(result.step.completionMode, "user_advances");
  assert.equal(result.step.enabled, false);
  assert.deepEqual(guides.get({ guideId: source.guide.id }).steps, []);
  assert.deepEqual(
    guides.get({ guideId: target.guide.id }).steps.map(({ id, stepNumber }) => ({ id, stepNumber })),
    [
      { id: targetFirst.step.id, stepNumber: 2 },
      { id: added.step.id, stepNumber: 3 },
    ],
  );
  const event = store.requireReady().prepare(`
    SELECT event_type, actor_type, actor_name
    FROM activity_events
    WHERE event_type = 'interaction_guide.step_moved'
    ORDER BY event_seq DESC LIMIT 1
  `).get();
  assert.deepEqual({ ...event }, {
    event_type: "interaction_guide.step_moved",
    actor_type: "user",
    actor_name: "structured_interactions_page",
  });
});

test("the page deletes one exact exchange with version protection and a literal receipt", (context) => {
  const { store, guides } = harness(context);
  const created = guides.create({ name: "Editable briefing" });
  const added = guides.addStep({
    guideId: created.guide.id,
    expectedVersion: created.guide.version,
    stepNumber: 3,
    openingText: "Delete this opening?",
    instructionsText: "This entire exchange should be removable.",
    completionMode: "response_valid",
    enabled: true,
  });

  const result = guides.deleteStep({
    stepId: added.step.id,
    expectedVersion: added.guide.version,
  }, { actorType: "user", actorName: "structured_interactions_page" });

  assert.equal(result.deleted, true);
  assert.equal(result.guide.version, 3);
  assert.equal(result.step.id, added.step.id);
  assert.deepEqual(guides.get({ guideId: created.guide.id }).steps, []);
  const event = store.requireReady().prepare(`
    SELECT event_type, actor_type, actor_name, subject_id
    FROM activity_events
    WHERE event_type = 'interaction_guide.step_deleted'
    ORDER BY event_seq DESC LIMIT 1
  `).get();
  assert.deepEqual({ ...event }, {
    event_type: "interaction_guide.step_deleted",
    actor_type: "user",
    actor_name: "structured_interactions_page",
    subject_id: String(created.guide.id),
  });
  assert.throws(() => guides.deleteStep({
    stepId: added.step.id,
    expectedVersion: added.guide.version,
  }), /does not exist/);
});

test("unspecified briefing additions reuse the generic Exchange Inbox and append atomically", async (context) => {
  const { registry } = harness(context);
  const exchange = (opening_text) => ({
    interaction_guide_id: null,
    expected_version: null,
    step_number: null,
    opening_text,
    instructions_text: null,
    completion_mode: "response_valid",
    enabled: true,
  });

  const first = await registry.execute(
    "interaction_guide_step_add",
    exchange("What should this repeatable exchange collect?"),
  );
  const second = await registry.execute(
    "interaction_guide_step_add",
    exchange("What should the next repeatable exchange collect?"),
  );

  assert.equal(first.default_briefing, true);
  assert.equal(first.default_briefing_created, true);
  assert.equal(first.guide.name, "Exchange Inbox");
  assert.equal(first.step.step_number, 1);
  assert.equal(second.default_briefing, true);
  assert.equal(second.default_briefing_created, false);
  assert.equal(second.guide.interaction_guide_id, first.guide.interaction_guide_id);
  assert.equal(second.step.step_number, 2);
  const fetched = await registry.execute("interaction_guide_get", {
    interaction_guide_id: first.guide.interaction_guide_id,
    name: null,
  });
  assert.deepEqual(fetched.guide.steps.map(({ step_number }) => step_number), [1, 2]);
});

test("interaction guides keep list results metadata-only and use versioned updates", async (context) => {
  const { registry } = harness(context);
  const created = await registry.execute("interaction_guide_create", {
    name: "Morning Check-in",
  }, { requestId: "guide-request", callId: "create-guide" });
  assert.equal(created.guide.version, 1);

  const listed = await registry.execute("interaction_guide_list", { status: "active", limit: 20 });
  assert.equal(listed.count, 1);
  assert.equal(Object.hasOwn(listed.guides[0], "guide_text"), false);

  const fetched = await registry.execute("interaction_guide_get", {
    interaction_guide_id: null,
    name: "morning check-in",
  });
  assert.deepEqual(fetched.guide.steps, []);

  const updated = await registry.execute("interaction_guide_update", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: created.guide.version,
    name: "Morning Review",
  }, { requestId: "guide-request", callId: "update-guide" });
  assert.equal(updated.guide.version, 2);
  assert.equal(updated.guide.name, "Morning Review");
  await assert.rejects(
    registry.execute("interaction_guide_update", {
      interaction_guide_id: created.guide.interaction_guide_id,
      expected_version: 1,
      name: "Stale name",
    }),
    /changed after it was read/,
  );
});

test("one exchange moves between briefings without a schema change or shared ownership", async (context) => {
  const { registry } = harness(context);
  const source = await registry.execute("interaction_guide_create", { name: "Source Briefing" });
  const target = await registry.execute("interaction_guide_create", { name: "Target Briefing" });
  const targetFirst = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: target.guide.interaction_guide_id,
    expected_version: 1,
    step_number: 1,
    opening_text: "What is already here?",
    instructions_text: null,
    completion_mode: "response_valid",
    enabled: true,
  });
  const sourceStep = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: source.guide.interaction_guide_id,
    expected_version: 1,
    step_number: 4,
    opening_text: "What should move?",
    instructions_text: "Collect the answer before moving this reusable exchange.",
    completion_mode: "response_valid",
    enabled: true,
  });
  const started = await registry.execute("interaction_guide_start", {
    interaction_guide_id: source.guide.interaction_guide_id,
    name: null,
    restart: false,
  });
  await registry.execute("interaction_guide_step_answer", {
    run_id: started.run.run_id,
    step_number: 4,
    answers: { answer: "Prior run state" },
    step_complete: true,
    user_confirmed_advance: false,
    completion_receipt_event_seq: null,
  });

  const moved = await registry.execute("interaction_guide_step_move", {
    interaction_guide_step_id: sourceStep.step.interaction_guide_step_id,
    expected_source_version: sourceStep.guide.version,
    target_interaction_guide_id: target.guide.interaction_guide_id,
    expected_target_version: targetFirst.guide.version,
  }, { requestId: "move-exchange", callId: "move-exchange-call" });

  assert.equal(moved.moved, true);
  assert.equal(moved.source_guide.version, 3);
  assert.equal(moved.target_guide.version, 3);
  assert.equal(moved.step.interaction_guide_id, target.guide.interaction_guide_id);
  assert.equal(moved.step.step_number, 2);
  assert.deepEqual(moved.step.answers_json, {});
  assert.equal(moved.step.progress_state, "pending");
  const fetchedSource = await registry.execute("interaction_guide_get", {
    interaction_guide_id: source.guide.interaction_guide_id, name: null,
  });
  const fetchedTarget = await registry.execute("interaction_guide_get", {
    interaction_guide_id: target.guide.interaction_guide_id, name: null,
  });
  assert.deepEqual(fetchedSource.guide.steps, []);
  assert.deepEqual(fetchedTarget.guide.steps.map(({ step_number }) => step_number), [1, 2]);

  const extraSourceStep = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: source.guide.interaction_guide_id,
    expected_version: moved.source_guide.version,
    step_number: 1,
    opening_text: "This exchange must stay put while the destination is running.",
    instructions_text: null,
    completion_mode: "response_valid",
    enabled: true,
  });
  await registry.execute("interaction_guide_start", {
    interaction_guide_id: target.guide.interaction_guide_id,
    name: null,
    restart: false,
  });
  await assert.rejects(
    registry.execute("interaction_guide_step_move", {
      interaction_guide_step_id: extraSourceStep.step.interaction_guide_step_id,
      expected_source_version: extraSourceStep.guide.version,
      target_interaction_guide_id: target.guide.interaction_guide_id,
      expected_target_version: moved.target_guide.version,
    }),
    /active briefing/,
  );
});

test("numbered interaction steps persist answers and resume at the exact active step", async (context) => {
  const { registry } = harness(context);
  const created = await registry.execute("interaction_guide_create", {
    name: "Evening Brief",
  }, { requestId: "brief-build", callId: "create-brief" });
  const first = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: 1,
    step_number: 1,
    opening_text: "1. What must be accomplished tonight?",
    instructions_text: "Capture one concrete outcome and how success will be recognized. Remain on step 1 until it is concrete.",
    completion_mode: "response_valid",
    enabled: true,
  }, { requestId: "brief-build", callId: "add-step-1" });
  assert.equal(first.guide.version, 2);
  const second = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: 2,
    step_number: 3,
    opening_text: "3. What information and decisions are already available?",
    instructions_text: "Collect the bounded inputs needed to execute the brief.",
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
  assert.deepEqual(fetched.guide.steps.map(({ progress_state }) => progress_state), ["pending", "pending"]);

  const started = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
  }, { requestId: "brief-run-1", callId: "start-brief" });
  assert.equal(started.started, true);
  assert.equal(started.current_step.step_number, 1);
  assert.equal(started.current_step.progress_state, "active");
  assert.deepEqual(started.guide.steps.map(({ progress_state }) => progress_state), ["active", "pending"]);
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
  assert.equal(partial.current_step.progress_state, "active");
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
      opening_text: "Changed",
      instructions_text: null,
      completion_mode: "response_valid",
      enabled: true,
    }),
    /active briefing/,
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
  assert.equal(advanced.step.progress_state, "completed");
  assert.equal(advanced.current_step.progress_state, "active");
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
  assert.equal(completed.step.progress_state, "completed");
  assert.equal(completed.current_step, null);

  const nextRun = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
  }, { requestId: "brief-run-6", callId: "start-next-brief" });
  assert.notEqual(nextRun.run.run_id, runId);
  assert.deepEqual(nextRun.current_step.answers_json, {});
  assert.deepEqual(nextRun.guide.steps.map(({ progress_state }) => progress_state), ["active", "pending"]);
});

test("an explicitly cancelled run resets current state and releases its guide for editing", async (context) => {
  const { registry } = harness(context);
  const created = await registry.execute("interaction_guide_create", {
    name: "Cancelable Brief",
  });
  const added = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: 1,
    step_number: 1,
    opening_text: "1. What is the answer?",
    instructions_text: "Record one answer.",
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
    opening_text: "1. What is the revised answer?",
    instructions_text: "Record one revised answer.",
    completion_mode: "response_valid",
    enabled: true,
  });
  assert.equal(updated.guide.version, 3);
  assert.deepEqual(updated.step.answers_json, {});
  assert.equal(updated.step.progress_state, "pending");
});

test("a repeating to-do links to a guide and generated occurrences preserve the link", async (context) => {
  const { store, registry } = harness(context);
  const firstOccurrence = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const createdGuide = await registry.execute("interaction_guide_create", {
    name: "Evening Reflection",
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
    updates: [{
      personal_task_id: createdTodo.task.personal_task_id,
      text: null,
      group: null,
      status: "complete",
      scheduled_at_utc: null,
      due_at_utc: null,
    }],
  }, { requestId: "guide-todo", callId: "complete-todo" });
  assert.equal(completed.items[0].generated_task.todo_routines.interaction_guide_id, guideId);
  assert.equal(completed.items[0].generated_task.interaction_guides.name, "Evening Reflection");
  assert.equal(store.requireReady().prepare(`
    SELECT interaction_guide_id FROM todo_routines WHERE todo_routine_id = ?
  `).get(createdTodo.task.todo_routine_id).interaction_guide_id, guideId);
});

test("one-time to-dos cannot link an interaction guide", async (context) => {
  const { registry } = harness(context);
  const createdGuide = await registry.execute("interaction_guide_create", {
    name: "Weekly Review",
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
  const guide = guides.create({ name: "Planning" }).guide;
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
