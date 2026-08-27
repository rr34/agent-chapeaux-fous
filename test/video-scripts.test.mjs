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
    concept: "Show how two separate requests build one reliable workflow.",
    audience: "People evaluating personal AI assistants",
    durationSeconds: 45,
    aspectRatio: "9:16",
    visualStyle: "Warm documentary interface footage with restrained motion graphics.",
    generatorPrompt: "Create a 45-second vertical video following the supplied scenes without inventing any product outcomes.",
    scenes: [
      {
        sceneNumber: 1,
        durationSeconds: 20,
        sourceRequestIds: [sourceRequestIds[0]],
        visualPrompt: "A close view of the first request becoming a completed response.",
        voiceover: "The first interaction established the plan.",
        onScreenText: ["Start with exact context"],
        cameraMotion: "Slow push in",
        audioNotes: "Quiet interface sounds",
        transition: "Match cut",
      },
      {
        sceneNumber: 2,
        durationSeconds: 25,
        sourceRequestIds,
        visualPrompt: "The two interactions align into one chronological production outline.",
        voiceover: "The second interaction turns that context into a reusable result.",
        onScreenText: ["Ground every scene"],
        cameraMotion: null,
        audioNotes: null,
        transition: null,
      },
    ],
    continuityNotes: ["Keep the same interface and typography across both scenes."],
    negativeConstraints: ["Do not invent tool calls, results, people, or quotations."],
  };
}

test("video scripts persist one ordered source join for every selected interaction", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
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

  const registry = registerNativeCapabilities(new ToolRegistry());
  registerVideoScriptTools(registry, videoScripts);
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
  assert.match(stored.scriptText, /## Generator prompt/);
  assert.match(stored.scriptText, new RegExp(first.requestId));
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
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const videoScripts = new VideoScripts({ store, ledger });
  const first = completeInteraction(ledger, "First interaction.", "First response.");
  const unselected = completeInteraction(ledger, "Private unrelated interaction.", "Private response.");
  const generation = ledger.createRequest({
    text: "Create the selected script.",
    metadata: { requestKind: "video_script", sourceRequestIds: [first.requestId] },
  });
  const invalid = plan([first.requestId]);
  invalid.scenes[0].sourceRequestIds = [unselected.requestId];

  assert.throws(
    () => videoScripts.create(invalid, {
      requestId: generation.requestId,
      requestEventId: generation.eventId,
      callId: "invalid-script",
    }),
    /outside the selected source set/,
  );
  assert.equal(videoScripts.list().count, 0);
});

test("video-script selection rejects failed interactions", (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
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
