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

test("the Agent can create a library and atomically create ordinary content items", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const organizer = new OrganizerStore(temporary.target);
  context.after(() => organizer.close());
  const ledger = new Ledger(store);
  const videoScripts = new VideoScripts({ store, ledger });
  const videoContent = new VideoContent({ videoScripts, organizer });
  const registry = registerNativeCapabilities(new ToolRegistry());
  registerVideoScriptTools(registry, videoScripts, { videoContent });

  const createDefinition = registry.toolDefinitions()
    .find(({ name }) => name === "video_content_group_create");
  assert.deepEqual(createDefinition.inputSchema.required, ["name"]);
  assert.equal(createDefinition.annotations.idempotentHint, true);
  const createdGroup = await registry.execute("video_content_group_create", {
    name: "What to Watch",
  });
  assert.equal(createdGroup.created, true);
  assert.equal(createdGroup.group.content_group_name, "What to Watch");
  assert.equal(
    createdGroup.group.content_group_ref,
    `agent-slayer://content-groups/${createdGroup.group.id}`,
  );
  const replayedGroup = await registry.execute("video_content_group_create", {
    name: "What to Watch",
  });
  assert.equal(replayedGroup.created, false);
  assert.equal(replayedGroup.unchanged, true);
  assert.equal(replayedGroup.group.id, createdGroup.group.id);

  const contentCreateDefinition = registry.toolDefinitions()
    .find(({ name }) => name === "video_content_create");
  assert.deepEqual(contentCreateDefinition.inputSchema.required, ["groupId", "items"]);
  assert.equal(contentCreateDefinition.inputSchema.properties.items.maxItems, 50);
  assert.equal(contentCreateDefinition.annotations.idempotentHint, false);
  const items = [
    {
      sequence: null,
      title: "What to Watch Today",
      description: "The introduction to the series.",
      transcript: null,
      publishedAtUtc: "2020-01-01",
      contentHost: "none",
      contentType: "unknown",
      contentStatus: "active",
      contentUrl: "https://example.com/what-to-watch-today/",
    },
    {
      sequence: 1,
      title: "What to Watch 1",
      description: "The first numbered installment.",
      transcript: null,
      publishedAtUtc: "2020-01-02T12:00:00.000Z",
      contentHost: "youtube",
      contentType: "unknown",
      contentStatus: "active",
      contentUrl: "https://youtu.be/example-one",
    },
  ];
  const createdItems = await registry.execute("video_content_create", {
    groupId: Number(createdGroup.group.id), items,
  }, {
    requestId: "external-content-request", callId: "external-content-call", channel: "web",
  });
  assert.equal(createdItems.createdCount, 2);
  assert.deepEqual(createdItems.items.map(({ sequence }) => sequence), [null, 1]);
  assert.deepEqual(createdItems.items.map(({ title }) => title), [
    "What to Watch Today", "What to Watch 1",
  ]);
  assert.ok(createdItems.items.every((content) => (
    content.content_ref === `agent-slayer://content-items/${content.id}`
  )));

  await assert.rejects(
    () => registry.execute("video_content_create", {
      groupId: Number(createdGroup.group.id),
      items: [
        {
          ...items[1],
          sequence: 2,
          title: "A new third item",
          contentUrl: "https://example.com/what-to-watch-2/",
          publishedAtUtc: "2020-01-03T12:00:00.000Z",
        },
        {
          ...items[1],
          title: "A conflicting sequence",
          contentUrl: "https://example.com/conflicting-sequence/",
        },
      ],
    }),
    /sequence is already used/,
  );
  assert.equal(organizer.listContent({ groupId: createdGroup.group.id }).length, 2);
  assert.equal(organizer.database.prepare(`
    SELECT COUNT(*) AS count FROM activity_events
    WHERE event_type = 'content.batch_created'
  `).get().count, 1);
});

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

test("the Agent can read a bounded content sequence in ascending order", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const organizer = new OrganizerStore(temporary.target);
  context.after(() => organizer.close());
  const ledger = new Ledger(store);
  const videoScripts = new VideoScripts({ store, ledger });
  const videoContent = new VideoContent({ videoScripts, organizer });
  const group = organizer.createContentGroup({ name: "Chapeaux Fous Promo" });
  organizer.createContent({
    groupId: group.id,
    sequence: 2,
    title: "Second promo",
    description: "A compact second description.",
    transcript: "Second transcript.",
  });
  organizer.createContent({
    groupId: group.id,
    sequence: 1,
    title: "First promo",
    description: "D".repeat(300),
    transcript: "T".repeat(300),
  });
  organizer.createContent({
    groupId: group.id,
    sequence: 3,
    title: "Third promo",
    transcript: "Third transcript.",
  });
  const autoNumbered = organizer.createContent({ groupId: group.id, title: "Auto-numbered draft" });
  assert.equal(autoNumbered.sequence, 4);

  const registry = registerNativeCapabilities(new ToolRegistry());
  registerVideoScriptTools(registry, videoScripts, { videoContent });
  const definition = registry.toolDefinitions().find(({ name }) => name === "video_content_list");
  assert.equal(definition.annotations.readOnlyHint, true);
  assert.deepEqual(definition.inputSchema.required, ["groupId", "result_filter"]);

  const firstPage = await registry.execute("video_content_list", {
    groupId: Number(group.id), afterSequence: 0, limit: 2, textCharactersPerField: 250,
  });
  assert.equal(firstPage.group.name, "Chapeaux Fous Promo");
  assert.deepEqual({
    id: firstPage.group.content_group_id,
    ref: firstPage.group.content_group_ref,
    display: firstPage.group.content_group_name,
  }, {
    id: group.id,
    ref: `agent-slayer://content-groups/${group.id}`,
    display: "Chapeaux Fous Promo",
  });
  assert.deepEqual(firstPage.items.map(({ sequence }) => sequence), [1, 2]);
  assert.deepEqual(firstPage.items.map(({ title }) => title), ["First promo", "Second promo"]);
  assert.equal(firstPage.items[0].content_id, firstPage.items[0].id);
  assert.equal(firstPage.items[0].content_ref, `agent-slayer://content-items/${firstPage.items[0].id}`);
  assert.equal(firstPage.items[0].content_title, "First promo");
  assert.equal(firstPage.items[0].descriptionExcerpt.length, 250);
  assert.equal(firstPage.items[0].descriptionCharacters, 300);
  assert.equal(firstPage.items[0].descriptionTruncated, true);
  assert.equal(firstPage.items[0].transcriptTruncated, true);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.nextAfterSequence, 2);

  const descriptionsOnly = await registry.execute("video_content_list", {
    groupId: Number(group.id), limit: 1, textCharactersPerField: 250,
    textFields: ["description"],
  });
  assert.deepEqual(descriptionsOnly.textFields, ["description"]);
  assert.equal(descriptionsOnly.items[0].descriptionCharacters, 300);
  assert.equal(descriptionsOnly.items[0].transcriptExcerpt, null);
  assert.equal(descriptionsOnly.items[0].transcriptCharacters, 0);
  assert.equal(descriptionsOnly.items[0].transcriptTruncated, false);

  const transcriptsOnly = await registry.execute("video_content_list", {
    groupId: Number(group.id), limit: 1, textCharactersPerField: 250,
    textFields: ["transcript"],
  });
  assert.deepEqual(transcriptsOnly.textFields, ["transcript"]);
  assert.equal(transcriptsOnly.items[0].descriptionExcerpt, null);
  assert.equal(transcriptsOnly.items[0].descriptionCharacters, 0);
  assert.equal(transcriptsOnly.items[0].descriptionTruncated, false);
  assert.equal(transcriptsOnly.items[0].transcriptCharacters, 300);

  const secondPage = await registry.execute("video_content_list", {
    groupId: Number(group.id), afterSequence: firstPage.nextAfterSequence,
    limit: 2, textCharactersPerField: 250,
  });
  assert.deepEqual(secondPage.items.map(({ sequence }) => sequence), [3, 4]);
  assert.equal(secondPage.hasMore, false);
  assert.equal(secondPage.nextAfterSequence, null);
  assert.equal(secondPage.items.some(({ title }) => title === "Auto-numbered draft"), true);
});
