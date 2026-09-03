import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { requestCapabilityCatalog } from "../src/request-compiler.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerVideoScriptTools } from "../src/tools/video-script-tools.mjs";
import { VideoScripts } from "../src/video-scripts.mjs";
import { temporaryDatabase } from "./helpers.mjs";

function completeInteraction(ledger, requestText, responseText) {
  const request = ledger.createRequest({ text: requestText, channel: "web" });
  const received = ledger.trace(request.requestId)[0];
  ledger.finish(received, responseText);
  return request;
}

function plan(sourceRequestIds) {
  return {
    sourceRequestIds,
    title: "A grounded multi-interaction story",
    description: "A user asks an AI agent to create a release plan and turn it into a checklist.",
  };
}

function productionPlan(sourceRequestIds) {
  return plan(sourceRequestIds);
}

test("video scripts persist one ordered source join for every selected interaction", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const videoScripts = new VideoScripts({ store, ledger });
  const first = completeInteraction(ledger, "Plan the release.", "The release plan is ready.");
  const second = completeInteraction(ledger, "Turn the plan into a checklist.", "The checklist is ready.");
  const generation = ledger.createRequest({
    text: "Create a video script from the selected interactions.",
    metadata: { requestKind: "video_script", sourceRequestIds: [first.requestId, second.requestId] },
  });

  const prepared = videoScripts.selectedInteractionContext(generation.requestId);
  assert.deepEqual(prepared.data.sources.map(({ requestId }) => requestId), [first.requestId, second.requestId]);
  assert.match(prepared.text, /Plan the release/);
  assert.match(prepared.text, /The checklist is ready/);
  assert.deepEqual(Object.keys(prepared.data.sources[0]), ["sourceOrder", "requestId", "request", "response"]);
  assert.doesNotMatch(prepared.text, /activity|tool\.call|model\.request|context\.prepared/iu);

  const registry = registerNativeCapabilities(new ToolRegistry());
  registerVideoScriptTools(registry, videoScripts);
  for (const toolName of ["video_script_create", "video_production_create"]) {
    const definition = registry.toolDefinitions().find(({ name }) => name === toolName);
    assert.deepEqual(Object.keys(definition.inputSchema.properties), ["sourceRequestIds", "title", "description"]);
    assert.deepEqual(definition.inputSchema.required, ["sourceRequestIds", "title", "description"]);
    assert.equal(definition.inputSchema.additionalProperties, false);
  }
  assert.deepEqual(
    requestCapabilityCatalog(registry.toolDefinitions())
      .find(({ capability }) => capability === "video").contextViews.map(({ id }) => id),
    ["video.selected_interactions"],
  );
  const created = await registry.execute(
    "video_script_create",
    plan([first.requestId, second.requestId]),
    {
      requestId: generation.requestId,
      requestEventId: generation.eventId,
      callId: "script-call",
      channel: "web",
    },
  );

  assert.equal(created.created, true);
  const stored = videoScripts.get(created.videoScript.id);
  assert.equal(stored.sources.length, 2);
  assert.deepEqual(
    stored.sources.map(({ requestId, order }) => ({ requestId, order })),
    [
      { requestId: first.requestId, order: 1 },
      { requestId: second.requestId, order: 2 },
    ],
  );
  assert.match(stored.scriptText, /## Video description/);
  assert.match(stored.scriptText, /## Conversation/);
  assert.match(stored.scriptText, /\*\*User request\*\*[\s\S]+Plan the release\./);
  assert.match(stored.scriptText, /\*\*Chapeaux Fous · AI response\*\*[\s\S]+The checklist is ready\./);
  assert.doesNotMatch(stored.scriptText, /Production brief|Generator prompt|Scene plan|Camera and motion|Continuity requirements/);
  assert.doesNotMatch(stored.scriptText, new RegExp(first.requestId));
  assert.match(stored.plan.generatorPrompt, /supplied conversation below between a user and Chapeaux Fous, an AI agent/);
  assert.match(stored.plan.generatorPrompt, /Do not restore, read, or invent omitted codes/);
  assert.match(stored.plan.generatorPrompt, /USER REQUEST:[\s\S]+Plan the release\./);
  assert.doesNotMatch(stored.plan.generatorPrompt, /reasoning|processing|tool activity|trace activity|tutorial|scene plan/iu);
  assert.deepEqual(stored.plan.scenes.map(({ renderSceneType }) => renderSceneType), ["request", "response", "request", "response"]);
  assert.deepEqual(
    stored.plan.scenes.map(({ voiceover }) => voiceover),
    ["Plan the release.", "The release plan is ready.", "Turn the plan into a checklist.", "The checklist is ready."],
  );
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM video_script_sources").get().count, 2);
  assert.deepEqual(
    ledger.trace(generation.requestId).filter(({ type }) => type === "video_script.created").map(({ subjectId }) => subjectId),
    [String(stored.id)],
  );

  const replayed = await registry.execute(
    "video_script_create",
    plan([first.requestId, second.requestId]),
    {
      requestId: generation.requestId,
      requestEventId: generation.eventId,
      callId: "script-replay",
      channel: "web",
    },
  );
  assert.equal(replayed.created, false);
  assert.equal(replayed.unchanged, true);
  assert.equal(replayed.videoScript.id, stored.id);

  const archived = videoScripts.archive(stored.id, stored.version, {
    actorType: "user", actorName: "test", channel: "web",
  });
  assert.equal(archived.archived, true);
  assert.equal(videoScripts.list({ status: "draft" }).count, 0);
  assert.equal(videoScripts.list({ status: "archived" }).scripts[0].id, stored.id);
});

test("video-script creation rejects sources outside the request-bound selection", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const videoScripts = new VideoScripts({ store, ledger });
  const first = completeInteraction(ledger, "First interaction.", "First response.");
  const unselected = completeInteraction(ledger, "Private unrelated interaction.", "Private response.");
  const generation = ledger.createRequest({
    text: "Create the selected script.",
    metadata: { requestKind: "video_script", sourceRequestIds: [first.requestId] },
  });
  const invalid = plan([unselected.requestId]);

  assert.throws(
    () => videoScripts.create(invalid, {
      requestId: generation.requestId,
      requestEventId: generation.eventId,
      callId: "invalid-script",
    }),
    /must exactly match the selected interactions/,
  );
  assert.equal(videoScripts.list().count, 0);
});

test("video scripts project machine references out without changing stored interactions", (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const videoScripts = new VideoScripts({ store, ledger });
  const originalRequest = [
    "In reference to:",
    "Task: Call financial assistance at 614-566-1456 on 2026-08-31.",
    "Reference code: personal_task_id=418; request_id=123e4567-e89b-42d3-a456-426614174000",
    "",
    "Help me prepare.",
  ].join("\n");
  const source = completeInteraction(
    ledger,
    originalRequest,
    "I can help with task #418. Reference code: personal_task_id=418",
  );
  const generation = ledger.createRequest({
    text: "Create the selected video script.",
    metadata: { requestKind: "video_script", sourceRequestIds: [source.requestId] },
  });

  const created = videoScripts.create(plan([source.requestId]), {
    requestId: generation.requestId,
    requestEventId: generation.eventId,
    callId: "filtered-script",
    channel: "web",
  });

  assert.equal(ledger.interactionReplaySource(source.requestId).rawTranscript, originalRequest);
  assert.doesNotMatch(created.script.scriptText, /Reference code|123e4567|personal_task_id/u);
  assert.match(created.script.scriptText, /614-566-1456/u);
  assert.match(created.script.scriptText, /2026-08-31/u);
  assert.match(created.script.scriptText, /task #418/u);
  assert.doesNotMatch(created.script.plan.generatorPrompt, /Reference code|123e4567/u);
  assert.deepEqual(
    created.script.plan.scenes.map(({ voiceover }) => voiceover),
    [
      "In reference to: Task: Call financial assistance at 614-566-1456 on 2026-08-31. Help me prepare.",
      "I can help with task #418.",
    ],
  );
});

test("one production tool call persists its script and queues one linked background render", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const videoScripts = new VideoScripts({ store, ledger });
  const first = completeInteraction(ledger, "Plan the release.", "The release plan is ready.");
  const second = completeInteraction(ledger, "Make the checklist.", "The checklist is ready.");
  const generation = ledger.createRequest({
    text: "Create the selected video production.",
    metadata: { requestKind: "video_production", sourceRequestIds: [first.requestId, second.requestId] },
  });
  let notifications = 0;
  const registry = registerNativeCapabilities(new ToolRegistry());
  registerVideoScriptTools(registry, videoScripts, { onRenderQueued: () => { notifications += 1; } });
  const production = productionPlan([first.requestId, second.requestId]);

  await assert.rejects(
    () => registry.execute("video_script_create", production, {
      requestId: generation.requestId,
      requestEventId: generation.eventId,
      callId: "wrong-production-tool",
      channel: "web",
    }),
    /must use video_production_create/,
  );

  const created = await registry.execute(
    "video_production_create",
    production,
    {
      requestId: generation.requestId,
      requestEventId: generation.eventId,
      callId: "production-call",
      channel: "web",
    },
  );

  assert.equal(created.created, true);
  assert.equal(created.renderQueued, true);
  assert.equal(created.render.status, "queued");
  assert.equal(notifications, 1);
  assert.equal(videoScripts.get(created.videoScript.id).plan.aspectRatio, "2:3");
  const row = store.requireReady().prepare(
    "SELECT video_script_id, status, template FROM video_jobs WHERE video_job_id = ?",
  ).get(created.render.id);
  assert.deepEqual(
    { videoScriptId: Number(row.video_script_id), status: row.status, template: row.template },
    { videoScriptId: created.videoScript.id, status: "queued", template: "agent-ui-story" },
  );

  const replayed = await registry.execute(
    "video_production_create",
    production,
    {
      requestId: generation.requestId,
      requestEventId: generation.eventId,
      callId: "production-replay",
      channel: "web",
    },
  );
  assert.equal(replayed.unchanged, true);
  assert.equal(replayed.render.id, created.render.id);
  assert.equal(notifications, 1);
  assert.equal(store.requireReady().prepare("SELECT COUNT(*) AS count FROM video_jobs").get().count, 1);
});

test("video-script selection rejects failed interactions", (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const videoScripts = new VideoScripts({ store, ledger });
  const failed = ledger.createRequest({ text: "This interaction will fail.", channel: "web" });
  const received = ledger.trace(failed.requestId)[0];
  ledger.fail(received, new Error("Expected test failure"));

  assert.throws(
    () => videoScripts.validateSelection([failed.requestId]),
    /did not complete successfully/,
  );
});
