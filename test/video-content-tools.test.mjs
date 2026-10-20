import assert from "node:assert/strict";
import test from "node:test";
import { registerNativeCapabilities } from "../src/native-capabilities.mjs";
import { schemaProblem, ToolRegistry } from "../src/tools/registry.mjs";
import { registerVideoScriptTools } from "../src/tools/video-script-tools.mjs";
import { VideoContent } from "../src/video-content.mjs";

const group = {
  id: 7,
  name: "What to Watch",
  sortPosition: 20,
  usesSequence: false,
  archivedAtUtc: null,
  createdAtUtc: "2026-10-05T12:00:00.000Z",
  updatedAtUtc: null,
};

test("video content service creates, reuses, and rejects archived named groups", () => {
  const created = [];
  const organizer = {
    groups: [],
    listContentGroups() { return this.groups; },
    createContentGroup({ name }) {
      created.push(name);
      return { ...group, name };
    },
    renameContentGroup(groupId, { name }, context) {
      assert.equal(groupId, group.id);
      assert.equal(context.actorName, "video_content_group_rename");
      return { group: { ...group, name, previousName: group.name } };
    },
    setContentGroupSequenceMode(groupId, { usesSequence }, context) {
      assert.equal(groupId, group.id);
      assert.equal(context.actorName, "video_content_group_sequence_set");
      return { changed: true, assignedItemCount: 0, group: { ...group, usesSequence } };
    },
  };
  const content = new VideoContent({ videoScripts: {}, organizer });
  assert.deepEqual(content.createGroup({ name: " What to Watch " }), {
    created: true,
    unchanged: false,
    group,
  });
  assert.deepEqual(created, ["What to Watch"]);

  organizer.groups = [group];
  assert.deepEqual(content.createGroup({ name: "What to Watch" }), {
    created: false,
    unchanged: true,
    group,
  });

  organizer.groups = [{ ...group, archivedAtUtc: "2026-10-05T13:00:00.000Z" }];
  assert.throws(
    () => content.createGroup({ name: "What to Watch" }),
    /is archived/,
  );

  assert.deepEqual(content.renameGroup({ groupId: 7, name: "Time v3" }, {
    actorName: "video_content_group_rename",
  }), {
    renamed: true,
    previousName: "What to Watch",
    group: { ...group, name: "Time v3" },
  });
  assert.equal(content.setGroupSequenceMode({ groupId: 7, usesSequence: true }, {
    actorName: "video_content_group_sequence_set",
  }).group.usesSequence, true);
});

test("content creation tools publish compact identified mutation results", async () => {
  const createdContent = {
    id: 31,
    groupId: 7,
    sequence: null,
    contentType: "unknown",
    title: "What to Watch Today",
    publishedAtUtc: "2020-01-01T12:00:00.000Z",
    contentHost: "none",
    contentStatus: "active",
    contentUrl: "https://example.com/what-to-watch-today/",
  };
  const updatedContent = {
    ...createdContent,
    title: "What to Watch Next",
    version: "2026-10-19T12:00:00.000Z",
  };
  const videoContent = {
    createGroup() { return { created: true, unchanged: false, group }; },
    renameGroup({ groupId, name }) {
      assert.equal(groupId, group.id);
      return { renamed: true, previousName: group.name, group: { ...group, name } };
    },
    setGroupSequenceMode({ groupId, usesSequence }) {
      assert.equal(groupId, group.id);
      return { changed: true, assignedItemCount: 1, group: { ...group, usesSequence } };
    },
    createItems() {
      return {
        group,
        createdCount: 1,
        items: [createdContent],
      };
    },
    updateItems({ updates }, context) {
      assert.equal(context.actorName, "video_content_update");
      assert.deepEqual(updates, [{
        content_id: 31,
        version: "2026-10-19T11:00:00.000Z",
        title: "What to Watch Next",
      }]);
      return { updatedCount: 1, unchangedCount: 0, items: [updatedContent] };
    },
    listGroups() { return []; },
    list() { return null; },
    add() { return null; },
  };
  const registry = registerNativeCapabilities(new ToolRegistry());
  registerVideoScriptTools(registry, {}, {
    videoContent,
    videoContentReconciler: { preview() { return {}; }, apply() { return {}; } },
  });

  const created = await registry.execute("video_content_group_create", {
    name: "What to Watch",
  });
  const definitions = new Map(registry.toolDefinitions().map((definition) => [
    definition.name, definition,
  ]));
  const createDefinition = definitions.get("video_content_create");
  assert.match(createDefinition.description, /does not download, render, or publish/);
  assert.equal(createDefinition.annotations.idempotentHint, false);
  assert.ok(createDefinition.inputSchema.properties.items.items.required.includes("sequence"));
  assert.deepEqual(
    createDefinition.inputSchema.properties.items.items.properties.sequence.type,
    ["integer", "null"],
  );
  assert.deepEqual(
    definitions.get("video_content_list").inputSchema.properties.result_filter
      .properties.collection_path.enum,
    ["/items"],
  );
  const reconcilePreview = definitions.get("video_content_file_reconcile_preview");
  const reconcileApply = definitions.get("video_content_file_reconcile_apply");
  assert.deepEqual(
    reconcilePreview.inputSchema.properties.result_filter.properties.collection_path.enum,
    ["/actions", "/conflicts"],
  );
  for (const definition of [reconcilePreview, reconcileApply]) {
    assert.deepEqual(
      definition.metadata["agent-slayer/object-input-bindings"].bindings
        .map(({ path, objectType, allowUnbound }) => ({ path, objectType, allowUnbound })),
      [
        { path: "/file_id", objectType: "files.file", allowUnbound: undefined },
        { path: "/groupId", objectType: "video.content_group", allowUnbound: undefined },
      ],
    );
  }
  assert.equal(
    createDefinition.inputSchema.properties.items.items.required.includes("publishedAtUtc"),
    false,
  );
  assert.deepEqual(
    createDefinition.inputSchema.properties.items.items.properties.publishedAtUtc.type,
    ["string", "null"],
  );
  const itemWithoutPublicationTime = {
    sequence: 33,
    title: "Job 6 - Patek Philippe Display Case",
    description: null,
    transcript: null,
    contentHost: "youtube",
    contentType: "unknown",
    contentStatus: "active",
    contentUrl: null,
  };
  assert.equal(schemaProblem({
    groupId: 7,
    items: [itemWithoutPublicationTime],
  }, createDefinition.inputSchema, "arguments"), null);
  assert.equal(schemaProblem({
    groupId: 7,
    items: [{ ...itemWithoutPublicationTime, publishedAtUtc: null }],
  }, createDefinition.inputSchema, "arguments"), null);
  assert.equal(
    schemaProblem(created, definitions.get("video_content_group_create").outputSchema, "result"),
    null,
  );
  assert.deepEqual(created.group, {
    ...group,
    content_group_id: 7,
    content_group_ref: "agent-slayer://content-groups/7",
    content_group_name: "What to Watch",
  });

  const renamed = await registry.execute("video_content_group_rename", {
    groupId: 7,
    name: "Time v3",
  });
  const renameDefinition = definitions.get("video_content_group_rename");
  assert.equal(schemaProblem(renamed, renameDefinition.outputSchema, "result"), null);
  assert.deepEqual(renameDefinition.inputSchema.required, ["groupId", "name"]);
  assert.equal(
    renameDefinition.metadata["agent-slayer/object-input-bindings"].bindings[0].objectType,
    "video.content_group",
  );
  assert.equal(renamed.previousName, "What to Watch");
  assert.equal(renamed.group.content_group_id, 7);
  assert.equal(renamed.group.content_group_name, "Time v3");

  const sequenceResult = await registry.execute("video_content_group_sequence_set", {
    groupId: 7,
    usesSequence: true,
  });
  const sequenceDefinition = definitions.get("video_content_group_sequence_set");
  assert.equal(schemaProblem(sequenceResult, sequenceDefinition.outputSchema, "result"), null);
  assert.equal(sequenceDefinition.annotations.idempotentHint, true);
  assert.equal(sequenceResult.assignedItemCount, 1);
  assert.equal(sequenceResult.group.usesSequence, true);

  const createdItems = await registry.execute("video_content_create", {
    groupId: 7,
    items: [{
      sequence: null,
      title: createdContent.title,
      description: null,
      transcript: null,
      publishedAtUtc: createdContent.publishedAtUtc,
      contentHost: createdContent.contentHost,
      contentType: createdContent.contentType,
      contentStatus: createdContent.contentStatus,
      contentUrl: createdContent.contentUrl,
    }],
  });
  assert.equal(
    schemaProblem(createdItems, createDefinition.outputSchema, "result"),
    null,
  );
  assert.equal(createdItems.createdCount, 1);
  assert.deepEqual(createdItems.items[0], {
    ...createdContent,
    content_id: 31,
    content_ref: "agent-slayer://content-items/31",
    content_title: "What to Watch Today",
  });

  const updateDefinition = definitions.get("video_content_update");
  assert.equal(updateDefinition.annotations.idempotentHint, false);
  assert.deepEqual(updateDefinition.inputSchema.required, ["updates"]);
  assert.deepEqual(
    updateDefinition.metadata["agent-slayer/object-input-bindings"].bindings,
    [
      { path: "/updates/*/content_id", objectType: "video.content_item", value: "id", role: "subject" },
      { path: "/updates/*/groupId", objectType: "video.content_group", value: "id", role: "subject" },
    ],
  );
  const updatedItems = await registry.execute("video_content_update", {
    updates: [{
      content_id: 31,
      version: "2026-10-19T11:00:00.000Z",
      title: "What to Watch Next",
    }],
  });
  assert.equal(schemaProblem(updatedItems, updateDefinition.outputSchema, "result"), null);
  assert.equal(updatedItems.updatedCount, 1);
  assert.equal(updatedItems.items[0].content_ref, "agent-slayer://content-items/31");
  assert.equal(updatedItems.items[0].content_title, "What to Watch Next");
  assert.equal(updatedItems.items[0].version, updatedContent.version);
  assert.equal(
    schemaProblem({
      updates: [{
        content_id: 31,
        version: "2026-10-19T11:00:00.000Z",
        contentUrl: null,
      }],
    }, updateDefinition.inputSchema, "arguments"),
    "arguments.updates[0].contentUrl must be string",
  );
});
