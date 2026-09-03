import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { InteractionGuides } from "../src/interaction-guides.mjs";
import { Ledger } from "../src/ledger.mjs";
import { OrganizerStore } from "../src/organizer-store.mjs";
import {
  activeBriefingRunContext,
  registerInteractionGuideTools,
} from "../src/tools/interaction-guide-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerTodoTools } from "../src/tools/todo-tools.mjs";
import { temporaryDatabase } from "./helpers.mjs";

function exchangeContract(instructions = null, mode = "response_valid", overrides = {}) {
  return {
    version: 1,
    instructions,
    inputs: [],
    operations: [],
    recoveryReads: [],
    completion: { mode },
    ...overrides,
  };
}

function harness(context, { clock, timeZone } = {}) {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const guides = new InteractionGuides({
    store,
    ledger,
    ...(clock ? { clock } : {}),
    ...(timeZone ? { timeZone } : {}),
  });
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
    contract: exchangeContract("Record one concrete outcome.", "response_valid"),
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
    contract: exchangeContract(null, "response_valid"),
    enabled: true,
  });
  const added = guides.addStep({
    guideId: source.guide.id,
    expectedVersion: source.guide.version,
    stepNumber: 2,
    openingText: "What should move?",
    contract: exchangeContract("Old instructions.", "response_valid"),
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
    contract: exchangeContract("Revised instructions.", "user_advances"),
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
  assert.equal(result.step.contract.instructions, "Revised instructions.");
  assert.deepEqual(result.step.answers, {});
  assert.equal(result.step.progressState, "pending");
  assert.equal(result.step.contract.completion.mode, "user_advances");
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
    contract: exchangeContract("This entire exchange should be removable.", "response_valid"),
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

test("the page atomically reorders every exchange and records one literal receipt", (context) => {
  const { store, guides } = harness(context);
  const created = guides.create({ name: "Sortable briefing" });
  const first = guides.addStep({
    guideId: created.guide.id, expectedVersion: created.guide.version, stepNumber: 2,
    openingText: "First opening", contract: exchangeContract(), enabled: true,
  });
  const second = guides.addStep({
    guideId: created.guide.id, expectedVersion: first.guide.version, stepNumber: 5,
    openingText: "Second opening", contract: exchangeContract(), enabled: true,
  });
  const third = guides.addStep({
    guideId: created.guide.id, expectedVersion: second.guide.version, stepNumber: 9,
    openingText: "Third opening", contract: exchangeContract(), enabled: false,
  });

  const result = guides.reorderSteps({
    guideId: created.guide.id,
    expectedVersion: third.guide.version,
    orderedStepIds: [third.step.id, first.step.id, second.step.id],
  }, { actorType: "user", actorName: "structured_interactions_page" });

  assert.equal(result.reordered, true);
  assert.equal(result.guide.version, 5);
  assert.deepEqual(
    result.steps.map(({ id, stepNumber, openingText, enabled }) => ({
      id, stepNumber, openingText, enabled,
    })),
    [
      { id: third.step.id, stepNumber: 1, openingText: "Third opening", enabled: false },
      { id: first.step.id, stepNumber: 2, openingText: "First opening", enabled: true },
      { id: second.step.id, stepNumber: 3, openingText: "Second opening", enabled: true },
    ],
  );
  const event = store.requireReady().prepare(`
    SELECT event_type, actor_type, actor_name, payload_json
    FROM activity_events
    WHERE event_type = 'interaction_guide.steps_reordered'
    ORDER BY event_seq DESC LIMIT 1
  `).get();
  assert.deepEqual({
    eventType: event.event_type,
    actorType: event.actor_type,
    actorName: event.actor_name,
  }, {
    eventType: "interaction_guide.steps_reordered",
    actorType: "user",
    actorName: "structured_interactions_page",
  });
  assert.deepEqual(
    JSON.parse(event.payload_json).afterOrder,
    [
      { stepId: third.step.id, stepNumber: 1 },
      { stepId: first.step.id, stepNumber: 2 },
      { stepId: second.step.id, stepNumber: 3 },
    ],
  );
  assert.throws(() => guides.reorderSteps({
    guideId: created.guide.id,
    expectedVersion: result.guide.version,
    orderedStepIds: [third.step.id, first.step.id],
  }), /every exchange/);
  assert.throws(() => guides.reorderSteps({
    guideId: created.guide.id,
    expectedVersion: third.guide.version,
    orderedStepIds: [third.step.id, first.step.id, second.step.id],
  }), /changed after it was read/);
});

test("unspecified briefing additions reuse the generic Exchange Inbox and append atomically", async (context) => {
  const { registry } = harness(context);
  const exchange = (opening_text) => ({
    interaction_guide_id: null,
    expected_version: null,
    step_number: null,
    opening_text,
    contract: exchangeContract(null, "response_valid"),
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
    contract: exchangeContract(null, "response_valid"),
    enabled: true,
  });
  const sourceStep = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: source.guide.interaction_guide_id,
    expected_version: 1,
    step_number: 4,
    opening_text: "What should move?",
    contract: exchangeContract("Collect the answer before moving this reusable exchange.", "response_valid"),
    enabled: true,
  });
  const started = await registry.execute("interaction_guide_start", {
    interaction_guide_id: source.guide.interaction_guide_id,
    name: null,
    restart: false,
    stale_run_action: "ask",
  });
  await registry.execute("interaction_guide_step_answer", {
    run_id: started.run.run_id,
    step_number: 4,
    answers: { answer: "Prior run state" },
    step_complete: true,
    user_confirmed_advance: false,
    completion_receipt_event_seqs: [],
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
    contract: exchangeContract(null, "response_valid"),
    enabled: true,
  });
  await registry.execute("interaction_guide_start", {
    interaction_guide_id: target.guide.interaction_guide_id,
    name: null,
    restart: false,
    stale_run_action: "ask",
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
  const { store, registry } = harness(context);
  const created = await registry.execute("interaction_guide_create", {
    name: "Evening Brief",
  }, { requestId: "brief-build", callId: "create-brief" });
  const first = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: 1,
    step_number: 1,
    opening_text: "1. What must be accomplished tonight?",
    contract: exchangeContract("Capture one concrete outcome and how success will be recognized. Remain on step 1 until it is concrete.", "response_valid"),
    enabled: true,
  }, { requestId: "brief-build", callId: "add-step-1" });
  assert.equal(first.guide.version, 2);
  const second = await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: 2,
    step_number: 3,
    opening_text: "3. What information and decisions are already available?",
    contract: exchangeContract("Collect the bounded inputs needed to execute the brief.", "response_valid"),
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
    stale_run_action: "ask",
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
    completion_receipt_event_seqs: [],
  }, { requestId: "brief-run-2", callId: "answer-step-1-partial" });
  assert.equal(partial.current_step.step_number, 1);
  assert.equal(partial.current_step.progress_state, "active");
  assert.equal(partial.step.answers_json.outcome, "Prepare tomorrow's customer proposal");

  const resumed = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
    stale_run_action: "ask",
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
      contract: exchangeContract(null, "response_valid"),
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
    completion_receipt_event_seqs: [],
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
    completion_receipt_event_seqs: [],
  }, { requestId: "brief-run-5", callId: "complete-step-3" });
  assert.equal(completed.run_complete, true);
  assert.equal(completed.step.progress_state, "completed");
  assert.equal(completed.current_step, null);

  const readyAgain = await registry.execute("interaction_guide_get", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
  });
  assert.equal(Object.hasOwn(readyAgain.guide, "active_run"), false);
  assert.deepEqual(
    readyAgain.guide.steps.map(({ answers_json, progress_state }) => ({
      answers_json, progress_state,
    })),
    [
      { answers_json: {}, progress_state: "pending" },
      { answers_json: {}, progress_state: "pending" },
    ],
  );
  const completedEvent = store.requireReady().prepare(`
    SELECT payload_json
    FROM activity_events
    WHERE event_type = 'interaction_guide.step_completed' AND subject_id = ?
    ORDER BY event_seq DESC
    LIMIT 1
  `).get(runId);
  assert.deepEqual(JSON.parse(completedEvent.payload_json).answers, {
    inputs: "Customer notes and the existing estimate",
  });

  const nextRun = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
    stale_run_action: "ask",
  }, { requestId: "brief-run-6", callId: "start-next-brief" });
  assert.notEqual(nextRun.run.run_id, runId);
  assert.deepEqual(nextRun.current_step.answers_json, {});
  assert.deepEqual(nextRun.guide.steps.map(({ progress_state }) => progress_state), ["active", "pending"]);
});

test("the active briefing context view exposes only bounded current-run state", async (context) => {
  const { guides, registry } = harness(context);
  const created = await registry.execute("interaction_guide_create", {
    name: "Evening Briefing",
  }, { requestId: "context-build", callId: "create" });
  await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: created.guide.version,
    step_number: 1,
    opening_text: "What is your current weight?",
    contract: exchangeContract("Call log_add to record the supplied numeric value exactly without inferring a unit.", "response_valid"),
    enabled: true,
  }, { requestId: "context-build", callId: "add" });
  const started = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
    stale_run_action: "ask",
  }, { requestId: "context-start", callId: "start" });

  const prepared = await registry.prepareContext(["interaction-guides.active_runs"], {
    requestId: "context-answer", requestText: "74.8",
  });
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].view, "interaction-guides.active_runs");
  assert.equal(prepared[0].data.totalCount, 1);
  assert.equal(prepared[0].data.runs[0].runId, started.run.run_id);
  assert.equal(prepared[0].data.runs[0].currentExchange.stepNumber, 1);
  assert.equal(prepared[0].data.runs[0].currentExchange.openingText, "What is your current weight?");
  assert.match(prepared[0].text, new RegExp(started.run.run_id));
  assert.match(prepared[0].text, /do not infer omitted units/i);
  const legacyContext = activeBriefingRunContext(guides, 8, ["log_add", "log_list"]);
  assert.deepEqual(
    legacyContext.data.runs[0].currentExchange.contractSummary.legacyInstructionTools,
    ["log_add"],
  );
});

test("receipt completion covers every destination operation declared by the contract", async (context) => {
  const { store, guides } = harness(context);
  const created = guides.create({ name: "Exercise log" });
  const contract = exchangeContract("Record both values in their exact trackers.", "tool_receipt", {
    inputs: [
      { key: "abs_reps", type: "integer", required: true, description: null },
      { key: "stretch_minutes", type: "number", required: true, description: null },
    ],
    operations: [
      { id: "log_abs", tool: "log_add", arguments: { tracker: "Abs", number_value: { $answer: "abs_reps" } } },
      { id: "log_stretch", tool: "log_add", arguments: { tracker: "Stretching", number_value: { $answer: "stretch_minutes" } } },
    ],
  });
  guides.addStep({
    guideId: created.guide.id,
    expectedVersion: created.guide.version,
    stepNumber: 1,
    openingText: "How many abs reps and stretching minutes?",
    contract,
    enabled: true,
  });
  const started = guides.begin({ guideId: created.guide.id });
  const requestId = "exercise-answer";
  const receiptSeqs = [
    ["log-abs", { tracker: "Abs", number_value: 100 }],
    ["log-stretch", { tracker: "Stretching", number_value: 10 }],
  ].map(([operationId, argumentsObject]) => {
    guides.ledger.append({
      type: "tool.call", phase: "start", status: "processing", actorType: "model",
      actorName: "test", turnId: requestId, operationId, name: "log_add",
      payload: { arguments: argumentsObject },
    });
    guides.ledger.append({
      type: "tool.result", phase: "end", status: "complete", actorType: "tool",
      actorName: "log_add", turnId: requestId, operationId, name: "log_add",
      payload: { result: { created: true } },
    });
    return Number(store.requireReady().prepare(`
      SELECT event_seq FROM activity_events WHERE operation_id = ? AND event_type = 'tool.result'
    `).get(operationId).event_seq);
  });

  assert.throws(() => guides.answerStep({
    runId: started.run.id,
    stepNumber: 1,
    answers: { abs_reps: 100, stretch_minutes: 10 },
    stepComplete: true,
    completionReceiptEventSeqs: [receiptSeqs[0]],
  }, { requestId }), /missing for contract operations: log_stretch/);

  const completed = guides.answerStep({
    runId: started.run.id,
    stepNumber: 1,
    answers: { abs_reps: 100, stretch_minutes: 10 },
    stepComplete: true,
    completionReceiptEventSeqs: receiptSeqs,
  }, { requestId });
  assert.equal(completed.runCompleted, true);
});

test("an unfinished briefing crossing a local day requires resume or start-over choice", async (context) => {
  let now = new Date("2026-09-03T03:30:00.000Z");
  const { store, registry } = harness(context, {
    clock: () => now,
    timeZone: () => "America/New_York",
  });
  const created = await registry.execute("interaction_guide_create", {
    name: "Daily Check-in",
  });
  await registry.execute("interaction_guide_step_add", {
    interaction_guide_id: created.guide.interaction_guide_id,
    expected_version: created.guide.version,
    step_number: 1,
    opening_text: "What should be recorded today?",
    contract: exchangeContract("Keep partial answers until the user decides whether to resume.", "response_valid"),
    enabled: true,
  });
  const started = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
    stale_run_action: "ask",
  });
  await registry.execute("interaction_guide_step_answer", {
    run_id: started.run.run_id,
    step_number: 1,
    answers: { partial: "keep me" },
    step_complete: false,
    user_confirmed_advance: false,
    completion_receipt_event_seqs: [],
  });

  now = new Date("2026-09-03T04:15:00.000Z");
  const staleContext = await registry.prepareContext(["interaction-guides.active_runs"], {
    requestId: "next-day-answer",
    requestText: "another answer",
  });
  assert.equal(staleContext[0].data.runs[0].requiresDailyChoice, true);
  assert.match(staleContext[0].text, /requires_daily_choice=true/);
  const offered = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
    stale_run_action: "ask",
  });
  assert.equal(offered.choice_required, true);
  assert.equal(offered.resumed, false);
  assert.deepEqual(offered.available_choices, ["resume", "start_over"]);
  assert.equal(offered.run.started_local_date, "2026-09-02");
  assert.equal(offered.run.current_local_date, "2026-09-03");
  assert.equal(offered.run.time_zone, "America/New_York");
  assert.equal(offered.run.requires_daily_choice, true);
  assert.equal(offered.current_step, null);
  assert.equal(offered.guide.steps[0].progress_state, "active");
  assert.deepEqual(offered.guide.steps[0].answers_json, { partial: "keep me" });

  await assert.rejects(
    registry.execute("interaction_guide_step_answer", {
      run_id: started.run.run_id,
      step_number: 1,
      answers: { another: "answer" },
      step_complete: false,
      user_confirmed_advance: false,
      completion_receipt_event_seqs: [],
    }),
    /Choose whether to resume it or start over/,
  );

  const resumed = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
    stale_run_action: "resume",
  }, { requestId: "resume-next-day", callId: "resume" });
  assert.equal(resumed.choice_required, false);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.run.run_id, started.run.run_id);
  assert.equal(resumed.run.requires_daily_choice, false);
  assert.deepEqual(resumed.current_step.answers_json, { partial: "keep me" });
  assert.equal(resumed.guide.active_run.requires_daily_choice, false);
  const resumeEvent = store.requireReady().prepare(`
    SELECT payload_json
    FROM activity_events
    WHERE event_type = 'interaction_guide.run_resumed' AND subject_id = ?
  `).get(started.run.run_id);
  assert.equal(JSON.parse(resumeEvent.payload_json).localDate, "2026-09-03");

  now = new Date("2026-09-04T04:15:00.000Z");
  const restarted = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: true,
    stale_run_action: "ask",
  });
  assert.equal(restarted.started, true);
  assert.notEqual(restarted.run.run_id, started.run.run_id);
  assert.equal(restarted.run.started_local_date, "2026-09-04");
  assert.deepEqual(restarted.current_step.answers_json, {});
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
    contract: exchangeContract("Record one answer.", "response_valid"),
    enabled: true,
  });
  const started = await registry.execute("interaction_guide_start", {
    interaction_guide_id: created.guide.interaction_guide_id,
    name: null,
    restart: false,
    stale_run_action: "ask",
  });
  await registry.execute("interaction_guide_step_answer", {
    run_id: started.run.run_id,
    step_number: 1,
    answers: { answer: "Keep this" },
    step_complete: false,
    user_confirmed_advance: false,
    completion_receipt_event_seqs: [],
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
    contract: exchangeContract("Record one revised answer.", "response_valid"),
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
