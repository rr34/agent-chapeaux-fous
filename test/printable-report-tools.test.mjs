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
import { registerPrintableReportTools } from "../src/tools/printable-report-tools.mjs";
import { schemaProblem, ToolRegistry } from "../src/tools/registry.mjs";

const generated = {
  model: {
    paperSize: "letter",
    orientation: "landscape",
    sectionCount: 1,
    rowCount: 28,
    sourcedRowCount: 28,
    unsourcedRowCount: 0,
    sourceObjectCount: 51,
    sourceEventSeqs: [42691, 42745],
  },
  pageCount: 3,
  file: {
    fileId: 93,
    ref: "agent-slayer://files/93",
    title: "Unfinished Watch Jobs",
    originalFilename: "printable-unfinished-watch-jobs-2026-10-19.pdf",
    mimeType: "application/pdf",
    byteSize: 4321,
    sourceEventSeqs: [42820],
    downloadUrl: "/api/files/93/download",
  },
};

function input() {
  return {
    title: "Unfinished Watch Jobs",
    subtitle: "Alongside connected contacts",
    description: null,
    paper_size: "letter",
    orientation: "landscape",
    show_source_appendix: false,
    sections: [{
      heading: "Current jobs",
      description: null,
      presentation: "table",
      columns: [
        { label: "Job", align: "left" },
        { label: "Contact", align: "left" },
      ],
      rows: [{
        cells: ["Replace battery", "Alice Watch Owner"],
        note: null,
        source_refs: [],
      }],
    }],
  };
}

function registryWithPrintableReport() {
  const registry = new ToolRegistry();
  registerNativeCapabilities(registry);
  registerPrintableReportTools(registry, { async generate() { return generated; } });
  return registry;
}

test("printable report capability and guidance are schema-valid and domain-independent", () => {
  assert.doesNotThrow(() => validateNativeCapabilityPackages());
  const manifest = nativeCapabilityManifest("printable-report");
  assert.equal(manifest.guidanceFile, "guidance.md");
  assert.match(manifest.guidance, /printable_report_generate/);
  assert.match(manifest.guidance, /owning\s+capabilities first/);
  assert.match(manifest.guidance, /both a to-do and its connected contact/);
});

test("printable report publishes a bounded mutation contract and typed file receipt", async () => {
  const registry = registryWithPrintableReport();
  const definition = registry.toolDefinitions().find(({ name }) => name === "printable_report_generate");
  const selection = definition.metadata[toolDescriptionMetadataKey];
  assert.equal(definition.title, "Generate printable report");
  assert.deepEqual(selection.actionClasses, ["CREATE"]);
  assert.deepEqual(selection.effectClassifications, ["MUTATING"]);
  assert.equal(definition.annotations.readOnlyHint, false);
  assert.equal(definition.annotations.destructiveHint, false);
  assert.equal(definition.inputSchema.additionalProperties, false);
  assert.equal(definition.inputSchema.properties.sections.items.additionalProperties, false);
  assert.equal(definition.outputSchema.additionalProperties, false);
  assert.equal(definition.outputSchema.properties.file.additionalProperties, false);

  const catalogTool = requestCapabilityCatalog(registry.toolDefinitions())
    .find(({ capability }) => capability === "printable-report").tools[0];
  assert.match(catalogTool.summary, /Actions: CREATE\. Effects: MUTATING\./);
  assert.equal(catalogTool.inputSchema, undefined);
  assert.equal(catalogTool.description, undefined);

  const result = await registry.execute("printable_report_generate", input());
  assert.equal(schemaProblem(result, definition.outputSchema, "result"), null);
  assert.equal(result.rowCount, 28);
  assert.equal(result.pageCount, 3);
  assert.deepEqual(objectReferenceGroupsFromToolResult({
    toolDefinition: definition,
    toolDefinitions: registry.toolDefinitions(),
    result,
    sourceEventSeq: 500,
  }), [{
    mention: "File returned by printable_report_generate",
    role: "subject",
    type: "files.file",
    source: "native:files",
    objects: [{ id: 93, ref: "agent-slayer://files/93", display: "Unfinished Watch Jobs" }],
    sourceEventSeqs: [500],
  }]);
});

test("a custom cross-domain PDF request selects printable report guidance", async () => {
  const registry = registryWithPrintableReport();
  const compiler = new RequestCompiler({
    capabilityManifest: (id) => registry.capabilityManifest(id),
  });
  const compiled = await compiler.compile({
    tools: registry.toolDefinitions(),
    text: "Make a printable PDF of the unfinished Watch Jobs alongside their connected contacts.",
  });
  assert.deepEqual(compiled.capabilities, ["printable-report"]);
  assert.deepEqual(compiled.tools.map(({ name }) => name), ["printable_report_generate"]);
  assert.match(compiled.instructions, /## printable-report/);
  assert.match(compiled.instructions, /complete requested\s+batch/);
});
