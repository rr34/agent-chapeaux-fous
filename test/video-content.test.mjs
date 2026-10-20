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
    {
      sequence: 33,
      title: "Job 6 - Patek Philippe Display Case",
      description: null,
      transcript: null,
      contentHost: "youtube",
      contentType: "unknown",
      contentStatus: "active",
      contentUrl: "https://example.com/patek-display-case",
    },
    {
      sequence: 34,
      title: "Explicit null publication time",
      description: null,
      transcript: null,
      publishedAtUtc: null,
      contentHost: "youtube",
      contentType: "unknown",
      contentStatus: "active",
      contentUrl: "https://example.com/null-publication-time",
    },
  ];
  const creationStartedAt = Date.now();
  const createdItems = await registry.execute("video_content_create", {
    groupId: Number(createdGroup.group.id), items,
  }, {
    requestId: "external-content-request", callId: "external-content-call", channel: "web",
  });
  const creationFinishedAt = Date.now();
  assert.equal(createdItems.createdCount, 4);
  assert.deepEqual(createdItems.items.map(({ sequence }) => sequence), [null, 1, 33, 34]);
  assert.deepEqual(createdItems.items.map(({ title }) => title), [
    "What to Watch Today", "What to Watch 1",
    "Job 6 - Patek Philippe Display Case", "Explicit null publication time",
  ]);
  const defaultedPublicationTimes = createdItems.items.slice(2)
    .map(({ publishedAtUtc }) => Date.parse(publishedAtUtc));
  assert.ok(defaultedPublicationTimes.every((value) => (
    value >= creationStartedAt && value <= creationFinishedAt
  )));
  assert.equal(defaultedPublicationTimes[0], defaultedPublicationTimes[1]);
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
  assert.equal(organizer.listContent({ groupId: createdGroup.group.id }).length, 4);
  assert.equal(organizer.database.prepare(`
    SELECT COUNT(*) AS count FROM activity_events
    WHERE event_type = 'content.batch_created'
  `).get().count, 1);

  const renameDefinition = registry.toolDefinitions()
    .find(({ name }) => name === "video_content_group_rename");
  assert.deepEqual(renameDefinition.inputSchema.required, ["groupId", "name"]);
  const renamedGroup = await registry.execute("video_content_group_rename", {
    groupId: Number(createdGroup.group.id),
    name: "Time v3",
  }, {
    requestId: "rename-content-group-request",
    callId: "rename-content-group-call",
    channel: "web",
  });
  assert.equal(renamedGroup.renamed, true);
  assert.equal(renamedGroup.previousName, "What to Watch");
  assert.equal(renamedGroup.group.content_group_id, createdGroup.group.content_group_id);
  assert.equal(renamedGroup.group.content_group_name, "Time v3");
  assert.deepEqual(
    organizer.listContent({ groupId: createdGroup.group.id })
      .map(({ groupId, groupName, sequence, title }) => ({ groupId, groupName, sequence, title })),
    items.map(({ sequence, title }) => ({
      groupId: createdGroup.group.id,
      groupName: "Time v3",
      sequence,
      title,
    })),
  );
  assert.deepEqual({ ...organizer.database.prepare(`
    SELECT actor_type, actor_name, turn_id, operation_id
    FROM activity_events WHERE event_type = 'content_group.renamed'
  `).get() }, {
    actor_type: "tool",
    actor_name: "video_content_group_rename",
    turn_id: "rename-content-group-request",
    operation_id: "rename-content-group-call",
  });
});

test("the Agent can atomically update exact content items, including sequence swaps", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const organizer = new OrganizerStore(temporary.target);
  context.after(() => organizer.close());
  const ledger = new Ledger(store);
  const videoScripts = new VideoScripts({ store, ledger });
  const videoContent = new VideoContent({ videoScripts, organizer });
  const group = organizer.createContentGroup({ name: "Sequence corrections" });
  const first = organizer.createContent({
    groupId: group.id, sequence: 1, title: "First old title",
    publishedAtUtc: "2026-10-01", contentHost: "youtube", contentType: "unknown",
    contentStatus: "active", contentUrl: "https://example.test/first",
  });
  const second = organizer.createContent({
    groupId: group.id, sequence: 2, title: "Second old title",
    publishedAtUtc: "2026-10-02", contentHost: "youtube", contentType: "unknown",
    contentStatus: "active", contentUrl: "https://example.test/second",
  });
  const third = organizer.createContent({
    groupId: group.id, sequence: 3, title: "Third unchanged",
    publishedAtUtc: "2026-10-03", contentHost: "youtube", contentType: "unknown",
    contentStatus: "active", contentUrl: "https://example.test/third",
  });
  const registry = registerNativeCapabilities(new ToolRegistry());
  registerVideoScriptTools(registry, videoScripts, { videoContent });
  const read = await registry.execute("video_content_list", {
    groupId: Number(group.id), afterSequence: 0, limit: 20,
  });
  assert.deepEqual(read.items.map(({ content_id }) => content_id), [first.id, second.id, third.id]);
  assert.equal(read.items[0].version, first.version);
  assert.equal(read.items[0].contentUrl, "https://example.test/first");

  const definition = registry.toolDefinitions()
    .find(({ name }) => name === "video_content_update");
  const updated = await registry.execute("video_content_update", {
    updates: [
      {
        content_id: first.id, version: read.items[0].version,
        sequence: 2, title: "Second corrected title",
        contentUrl: "https://example.test/second-corrected",
      },
      {
        content_id: second.id, version: read.items[1].version,
        sequence: 1, title: "First corrected title",
        clearContentUrl: true,
      },
    ],
  }, {
    requestId: "update-content-request", callId: "update-content-call", channel: "web",
  });
  assert.equal(schemaProblem(updated, definition.outputSchema, "result"), null);
  assert.equal(updated.updatedCount, 2);
  assert.equal(updated.unchangedCount, 0);
  assert.deepEqual(updated.items.map(({ id, sequence, title, contentUrl }) => ({
    id, sequence, title, contentUrl,
  })), [
    {
      id: first.id, sequence: 2, title: "Second corrected title",
      contentUrl: "https://example.test/second-corrected",
    },
    { id: second.id, sequence: 1, title: "First corrected title", contentUrl: null },
  ]);
  assert.deepEqual(
    organizer.listSequencedContent({ groupId: group.id }).items
      .map(({ id, sequence, title }) => ({ id, sequence, title })),
    [
      { id: second.id, sequence: 1, title: "First corrected title" },
      { id: first.id, sequence: 2, title: "Second corrected title" },
      { id: third.id, sequence: 3, title: "Third unchanged" },
    ],
  );

  await assert.rejects(
    () => registry.execute("video_content_update", {
      updates: [
        { content_id: first.id, version: "2000-01-01T00:00:00.000Z", title: "Stale change" },
        { content_id: third.id, version: third.version, title: "Must roll back" },
      ],
    }),
    /changed while you were preparing the update/,
  );
  assert.equal(organizer.getContent(third.id).title, "Third unchanged");

  await assert.rejects(
    () => registry.execute("video_content_update", {
      updates: [{
        content_id: first.id,
        version: organizer.getContent(first.id).version,
        sequence: 3,
      }],
    }),
    /Sequence 3 is already used/,
  );
  assert.equal(organizer.getContent(first.id).sequence, 2);
  assert.deepEqual({ ...organizer.database.prepare(`
    SELECT actor_type, actor_name, turn_id, operation_id
    FROM activity_events WHERE event_type = 'content.batch_updated'
  `).get() }, {
    actor_type: "tool",
    actor_name: "video_content_update",
    turn_id: "update-content-request",
    operation_id: "update-content-call",
  });
});

test("verified source reconciliation updates and creates in one transaction", async context => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.target);
  context.after(() => store.close());
  const organizer = new OrganizerStore(temporary.target);
  context.after(() => organizer.close());
  const ledger = new Ledger(store);
  const videoContent = new VideoContent({ videoScripts: {}, organizer });
  const group = videoContent.createGroup({ name: "Reconciled source" }).group;
  const original = videoContent.createItems({
    groupId: group.id,
    items: [{
      sequence: 1,
      title: "Original title",
      description: null,
      transcript: null,
      publishedAtUtc: "2024-05-10T00:00:00.000Z",
      contentHost: "youtube",
      contentType: "unknown",
      contentStatus: "active",
      contentUrl: "https://www.youtube.com/watch?v=0dqrgcV80TM",
    }],
  }).items[0];

  const reconciled = videoContent.reconcileItems({
    groupId: group.id,
    sourceFileId: 51,
    sourceSha256: "a".repeat(64),
    previewDigest: "b".repeat(64),
    updates: [{
      content_id: original.id,
      version: original.version,
      sequence: 2,
      title: "Aurora",
      publishedAtUtc: "2024-05-11T00:00:00.000Z",
      contentHost: "youtube",
      contentUrl: "https://www.youtube.com/watch?v=0dqrgcV80TM",
    }],
    creates: [{
      sourceIdentity: "youtube:AbCdEf12345",
      sequence: 1,
      title: "New source",
      publishedAtUtc: "2025-02-10T00:00:00.000Z",
      contentHost: "youtube",
      contentUrl: "https://www.youtube.com/watch?v=AbCdEf12345",
    }],
  }, {
    requestId: "request-reconcile", callId: "call-reconcile", channel: "web",
    actorName: "video_content_file_reconcile_apply",
  });
  assert.equal(reconciled.updatedCount, 1);
  assert.equal(reconciled.createdCount, 1);
  assert.deepEqual(
    organizer.listSequencedContent({ groupId: group.id }).items
      .map(({ sequence, title }) => ({ sequence, title })),
    [{ sequence: 1, title: "New source" }, { sequence: 2, title: "Aurora" }],
  );
  assert.deepEqual({ ...organizer.database.prepare(`
    SELECT actor_name, turn_id, operation_id
    FROM activity_events WHERE event_type = 'content.file_reconciled'
  `).get() }, {
    actor_name: "video_content_file_reconcile_apply",
    turn_id: "request-reconcile",
    operation_id: "call-reconcile",
  });

  await assert.rejects(
    () => videoContent.reconcileItems({
      groupId: group.id,
      sourceFileId: 51,
      sourceSha256: "a".repeat(64),
      previewDigest: "c".repeat(64),
      updates: [{
        content_id: original.id,
        version: original.version,
        sequence: 3,
        title: "Stale",
        publishedAtUtc: "2024-05-12T00:00:00.000Z",
        contentHost: "youtube",
        contentUrl: "https://www.youtube.com/watch?v=0dqrgcV80TM",
      }],
      creates: [{
        sourceIdentity: "youtube:ZyXwVu98765",
        sequence: 4,
        title: "Must not be created",
        publishedAtUtc: "2025-02-11T00:00:00.000Z",
        contentHost: "youtube",
        contentUrl: "https://www.youtube.com/watch?v=ZyXwVu98765",
      }],
    }),
    /changed after preview/u,
  );
  assert.equal(organizer.listContent({ query: "Must not be created" }).length, 0);
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
