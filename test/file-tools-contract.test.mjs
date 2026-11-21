import assert from "node:assert/strict";
import test from "node:test";
import { registerFileTools } from "../src/tools/file-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

function file(fileId) {
  return {
    fileId,
    title: `File ${fileId}`,
    originalFilename: `file-${fileId}.mp3`,
    mediaKind: "audio",
    mimeType: "audio/mpeg",
  };
}

test("file_get reads an exact bounded file batch in requested order", async () => {
  const records = new Map([7, 8, 9].map((fileId) => [fileId, file(fileId)]));
  const registry = new ToolRegistry();
  registerFileTools(registry, {
    ledger: { fileDetails: (fileId) => records.get(fileId) ?? null },
    searchCoordinator: { searchScope: () => ({ hits: [] }) },
    mediaRoot: "/tmp",
    maximumTextBytes: 4096,
  });

  const batch = await registry.execute("file_get", { file_ids: [9, 7, 8] });
  assert.deepEqual(batch.files.map(({ fileId }) => fileId), [9, 7, 8]);
  assert.equal(Object.hasOwn(batch, "file"), false);

  const singleton = await registry.execute("file_get", { file_ids: [8] });
  assert.equal(singleton.file.fileId, 8);

  await assert.rejects(
    registry.execute("file_get", { file_ids: [7, 7] }),
    /unique|duplicates/iu,
  );
  await assert.rejects(
    registry.execute("file_get", { file_ids: [7], file_id: 7 }),
    /does not match any allowed schema|not both/iu,
  );
});

test("PDF assembly tools publish exact file inputs and one-file outcomes", () => {
  const registry = new ToolRegistry();
  registerFileTools(registry, {
    ledger: {},
    searchCoordinator: { searchScope: () => ({ hits: [] }) },
    mediaRoot: "/tmp",
    maximumTextBytes: 4096,
  });
  for (const name of ["file_pdf_merge", "file_images_to_pdf"]) {
    const definition = registry.toolDefinitions().find((tool) => tool.name === name);
    assert.ok(definition);
    assert.deepEqual(definition.inputSchema.properties.file_ids.minItems, 2);
    assert.deepEqual(definition.inputSchema.properties.file_ids.maxItems, 100);
    assert.deepEqual(definition.outputSchema.required, ["file"]);
    assert.deepEqual(Object.keys(definition.outputSchema.properties), ["file"]);
    const binding = definition.metadata["agent-slayer/object-input-bindings"].bindings
      .find(({ path }) => path === "/file_ids/*");
    assert.deepEqual(binding, {
      path: "/file_ids/*", objectType: "files.file", value: "id", role: "source",
    });
  }
});
