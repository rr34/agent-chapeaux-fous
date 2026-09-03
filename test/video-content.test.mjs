import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { OrganizerStore } from "../src/organizer-store.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerVideoScriptTools } from "../src/tools/video-script-tools.mjs";
import { VideoContent } from "../src/video-content.mjs";
import { VideoScripts } from "../src/video-scripts.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("a completed generated video appends once to an exact content sequence", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const organizer = new OrganizerStore(temporary.target);
  context.after(() => organizer.close());
  const ledger = new Ledger(store);
  const videoScripts = new VideoScripts({ store, ledger });
  const videoContent = new VideoContent({ videoScripts, organizer });
  const source = ledger.createRequest({ text: "Show how this works.", channel: "web" });
  ledger.finish(ledger.trace(source.requestId)[0], "Here is the finished result.");
  const generation = ledger.createRequest({
    text: "Create the selected video.",
    metadata: { requestKind: "video_production", sourceRequestIds: [source.requestId] },
  });
  const production = videoScripts.create({
    sourceRequestIds: [source.requestId],
    title: "A useful generated video",
    description: "A user asks an AI agent to demonstrate its finished work.",
  }, {
    requestId: generation.requestId,
    requestEventId: generation.eventId,
    callId: "production-call",
    channel: "web",
    actorName: "video_production_create",
  }, { queueRender: true });
  const group = organizer.createContentGroup({ name: "Agent promotions" });
  organizer.createContent({ groupId: group.id, sequence: 5, title: "Existing sequence item" });

  assert.throws(
    () => videoContent.add({ videoScriptId: production.script.id, groupId: group.id }),
    /must finish rendering/,
  );

  const file = ledger.registerFile({
    storagePath: "media/videos/generated.mp4",
    originalFilename: "generated.mp4",
    mimeType: "video/mp4",
    sha256: "generated-video-content-test",
    byteSize: 500,
    mediaKind: "video",
  });
  store.requireReady().prepare(
    "UPDATE video_jobs SET status = 'rendering' WHERE video_job_id = ?",
  ).run(production.render.id);
  videoScripts.completeRender(production.render.id, file.fileId, { width: 1080, height: 1620 });

  const registry = registerNativeCapabilities(new ToolRegistry());
  registerVideoScriptTools(registry, videoScripts, { videoContent });
  const definition = registry.toolDefinitions().find(({ name }) => name === "video_content_add");
  assert.deepEqual(definition.inputSchema.required, ["videoScriptId", "groupId"]);
  const prepared = await registry.prepareContext(["video.content_groups"]);
  assert.match(prepared[0].text, new RegExp(`Agent promotions \\[content_group_id=${group.id}\\]`));

  const created = await registry.execute("video_content_add", {
    videoScriptId: production.script.id,
    groupId: group.id,
  }, {
    requestId: generation.requestId,
    requestEventId: generation.eventId,
    callId: "content-call",
    channel: "web",
  });
  assert.equal(created.created, true);
  assert.equal(created.content.groupName, "Agent promotions");
  assert.equal(created.content.sequence, 6);
  assert.equal(created.content.primaryFileId, file.fileId);
  const stored = organizer.getContent(created.content.id);
  assert.equal(stored.contentType, "video_ad");
  assert.equal(stored.contentHost, "none");
  assert.equal(stored.transcript, production.script.scriptText);
  assert.equal(videoScripts.get(production.script.id).render.contentId, stored.id);

  const replayed = await registry.execute("video_content_add", {
    videoScriptId: production.script.id,
    groupId: group.id,
  }, {
    requestId: generation.requestId,
    requestEventId: generation.eventId,
    callId: "content-replay",
    channel: "web",
  });
  assert.equal(replayed.created, false);
  assert.equal(replayed.unchanged, true);
  assert.equal(replayed.content.id, stored.id);
  assert.equal(organizer.listContent({ groupId: group.id }).length, 2);
  const anotherGroup = organizer.createContentGroup({ name: "Another destination" });
  await assert.rejects(
    () => registry.execute("video_content_add", {
      videoScriptId: production.script.id,
      groupId: anotherGroup.id,
    }, {
      requestId: generation.requestId,
      requestEventId: generation.eventId,
      callId: "content-move-attempt",
      channel: "web",
    }),
    /already in Agent promotions/,
  );
  assert.equal(store.requireReady().prepare(
    "SELECT content_id FROM video_jobs WHERE video_job_id = ?",
  ).get(production.render.id).content_id, stored.id);
});
