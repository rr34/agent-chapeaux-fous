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
});

test("external content tools publish compact identified mutation results", async () => {
  const importedContent = {
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
  const videoContent = {
    createGroup() { return { created: true, unchanged: false, group }; },
    importSequence() {
      return {
        group,
        importedCount: 1,
        unchangedCount: 0,
        items: [{ status: "imported", content: importedContent }],
      };
    },
    listGroups() { return []; },
    list() { return null; },
    add() { return null; },
  };
  const registry = registerNativeCapabilities(new ToolRegistry());
  registerVideoScriptTools(registry, {}, { videoContent });

  const created = await registry.execute("video_content_group_create", {
    name: "What to Watch",
  });
  const definitions = new Map(registry.toolDefinitions().map((definition) => [
    definition.name, definition,
  ]));
  const importDefinition = definitions.get("video_content_import");
  assert.match(importDefinition.description, /does not download, render, or publish/);
  assert.ok(importDefinition.inputSchema.properties.items.items.required.includes("sequence"));
  assert.deepEqual(
    importDefinition.inputSchema.properties.items.items.properties.sequence.type,
    ["integer", "null"],
  );
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

  const imported = await registry.execute("video_content_import", {
    groupId: 7,
    items: [{
      sequence: null,
      title: importedContent.title,
      description: null,
      transcript: null,
      publishedAtUtc: importedContent.publishedAtUtc,
      contentHost: importedContent.contentHost,
      contentType: importedContent.contentType,
      contentUrl: importedContent.contentUrl,
    }],
  });
  assert.equal(
    schemaProblem(imported, importDefinition.outputSchema, "result"),
    null,
  );
  assert.deepEqual(imported.items[0], {
    status: "imported",
    content: {
      ...importedContent,
      content_id: 31,
      content_ref: "agent-slayer://content-items/31",
      content_title: "What to Watch Today",
    },
  });
});
