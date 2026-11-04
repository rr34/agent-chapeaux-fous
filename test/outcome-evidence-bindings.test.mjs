import assert from "node:assert/strict";
import test from "node:test";
import {
  defineOutcomeEvidenceBindings,
  outcomeEvidenceBindingsMetadataKey,
  outcomeEvidenceReferences,
  validateOutcomeEvidenceBindings,
} from "../src/outcome-evidence-bindings.mjs";

const fileTool = {
  name: "file_transform",
  source: "local",
  metadata: {
    [outcomeEvidenceBindingsMetadataKey]: defineOutcomeEvidenceBindings([{
      path: "/outputFile",
      objectType: "files.file",
      effect: "created",
      countsTowardOutcome: true,
      role: "artifact_source",
    }, {
      path: "/exceptionFile",
      objectType: "files.file",
      effect: "supporting",
      countsTowardOutcome: false,
      role: "transformation_exceptions",
    }, {
      path: "/sourceFile",
      objectType: "files.file",
      effect: "supporting",
      countsTowardOutcome: false,
      role: "source",
    }]),
  },
};

function file(fileId, title) {
  return { file_id: fileId, title, ref: `agent-slayer://files/${fileId}` };
}

test("outcome evidence includes only provider-declared result objects", () => {
  const result = outcomeEvidenceReferences({
    toolDefinition: fileTool,
    toolDefinitions: [fileTool],
    sourceEventSeq: 401,
    result: {
      sourceFile: file(10, "source.csv"),
      outputFile: {
        ...file(11, "canonical.jsonl"),
        provenance: file(99, "nested-source.csv"),
      },
      exceptionFile: file(12, "exceptions.jsonl"),
    },
  });

  assert.deepEqual(result.groups.flatMap(({ objects }) => objects.map(({ ref }) => ref)), [
    "agent-slayer://files/11",
  ]);
  assert.deepEqual(result.evidence.map(({ role, countsTowardOutcome, objectRefs }) => ({
    role, countsTowardOutcome, objectRefs,
  })), [{
    role: "artifact_source",
    countsTowardOutcome: true,
    objectRefs: ["agent-slayer://files/11"],
  }, {
    role: "transformation_exceptions",
    countsTowardOutcome: false,
    objectRefs: ["agent-slayer://files/12"],
  }, {
    role: "source",
    countsTowardOutcome: false,
    objectRefs: ["agent-slayer://files/10"],
  }]);
});

test("outcome evidence paths must be unique", () => {
  const duplicate = defineOutcomeEvidenceBindings([{
    path: "/result",
    objectType: "files.file",
    effect: "created",
    countsTowardOutcome: true,
  }, {
    path: "/result",
    objectType: "files.file",
    effect: "supporting",
    countsTowardOutcome: false,
  }]);
  assert.throws(
    () => validateOutcomeEvidenceBindings(duplicate, { label: "duplicate_tool" }),
    /paths must be unique/u,
  );
});

test("supporting evidence cannot claim to be the requested outcome", () => {
  assert.throws(() => validateOutcomeEvidenceBindings(defineOutcomeEvidenceBindings([{
    path: "/source",
    objectType: "files.file",
    effect: "supporting",
    countsTowardOutcome: true,
  }]), { label: "contradictory_tool" }), /invalid .*outcome-evidence-bindings/u);
});
