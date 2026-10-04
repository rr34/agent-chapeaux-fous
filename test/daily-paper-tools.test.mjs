import assert from "node:assert/strict";
import test from "node:test";
import { objectReferenceGroupsFromToolResult } from "../src/object-references.mjs";
import {
  nativeCapabilityManifest,
  registerNativeCapabilities,
  validateNativeCapabilityPackages,
} from "../src/native-capabilities.mjs";
import { requestCapabilityCatalog, RequestCompiler } from "../src/request-compiler.mjs";
import { toolDescriptionMetadataKey } from "../src/tool-description.mjs";
import { registerDailyPaperTools } from "../src/tools/daily-paper-tools.mjs";
import { schemaProblem, ToolRegistry } from "../src/tools/registry.mjs";

const generated = {
  model: {
    date: "2026-10-04",
    timeZone: "America/New_York",
    paperSize: "letter",
    todayEvents: [{ id: 1 }],
    scheduledTodos: [{ todoId: 2 }],
  },
  file: {
    fileId: 42,
    ref: "agent-slayer://files/42",
    title: "Daily paper — Sunday, October 4, 2026",
    originalFilename: "daily-paper-2026-10-04.pdf",
    mimeType: "application/pdf",
    byteSize: 1234,
    sourceEventSeqs: [91],
    downloadUrl: "/api/files/42/download",
  },
};

function registryWithDailyPaper() {
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registerDailyPaperTools(registry, { async generate() { return generated; } });
  return registry;
}

test("native capability guidance has exactly one manifest-owned source", async () => {
  assert.doesNotThrow(() => validateNativeCapabilityPackages());
  assert.equal(nativeCapabilityManifest("daily-paper").guidanceFile, "guidance.md");
  assert.match(nativeCapabilityManifest("daily-paper").guidance, /daily_paper_generate/);
  assert.equal(nativeCapabilityManifest("daily-paper").dependentTools, undefined);
});

test("daily paper publishes all deferred Tool Description layers from its owning registration", async () => {
  const registry = registryWithDailyPaper();
  const definition = registry.toolDefinitions()[0];
  const selection = definition.metadata[toolDescriptionMetadataKey];
  assert.equal(definition.name, "daily_paper_generate");
  assert.equal(definition.title, "Generate daily paper");
  assert.deepEqual(selection.actionClasses, ["CREATE"]);
  assert.deepEqual(selection.effectClassifications, ["MUTATING"]);
  assert.equal(definition.annotations.readOnlyHint, false);
  assert.equal(definition.annotations.destructiveHint, false);
  assert.equal(definition.annotations.idempotentHint, false);
  assert.match(definition.description, /what its result proves|status is complete/i);
  assert.equal(definition.inputSchema.additionalProperties, false);
  assert.equal(definition.outputSchema.additionalProperties, false);
  assert.equal(definition.outputSchema.properties.file.additionalProperties, false);

  const catalog = requestCapabilityCatalog(registry.toolDefinitions());
  const catalogTool = catalog[0].tools[0];
  assert.match(catalogTool.summary, /Actions: CREATE\. Effects: MUTATING\./);
  assert.equal(catalogTool.inputSchema, undefined);
  assert.equal(catalogTool.description, undefined);

  const result = await registry.execute("daily_paper_generate", {
    date: "2026-10-04",
    timeZone: "America/New_York",
    paperSize: "letter",
    includeCompletedTodos: false,
  });
  assert.equal(schemaProblem(result, definition.outputSchema, "result"), null);
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: definition,
    toolDefinitions: registry.toolDefinitions(),
    result,
    sourceEventSeq: 100,
  }), [{
    mention: "File returned by daily_paper_generate",
    role: "subject",
    type: "files.file",
    source: "native:files",
    objects: [{ id: 42, ref: "agent-slayer://files/42", display: generated.file.title }],
    sourceEventSeqs: [100],
  }]);
});

test("daily paper guidance is selected from its capability manifest", async () => {
  const registry = registryWithDailyPaper();
  const compiler = new RequestCompiler({
    capabilityManifest: (id) => registry.capabilityManifest(id),
  });
  const compiled = await compiler.compile({
    tools: registry.toolDefinitions(),
    text: "Print my daily paper for today.",
  });
  assert.deepEqual(compiled.capabilities, ["daily-paper"]);
  assert.deepEqual(compiled.tools.map(({ name }) => name), ["daily_paper_generate"]);
  assert.match(compiled.instructions, /## daily-paper/);
  assert.match(compiled.instructions, /owning capabilities first/);
});
