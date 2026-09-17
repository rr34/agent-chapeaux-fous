import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectTextStructure } from "../src/file-structure-inspect.mjs";
import { registerFileTools } from "../src/tools/file-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

test("structure inspection diagnoses supported text formats without discarding useful records", () => {
  const table = inspectTextStructure("Date,Amount,,Amount\n2026-09-16,1,note,2\n", "statement.csv");
  assert.equal(table.format, "delimited_table");
  assert.equal(table.status, "parsed");
  assert.equal(table.structure.sourceRecordCount, 1);
  assert.deepEqual(table.structure.headers, ["Date", "Amount", "column_3", "column_4"]);
  assert.deepEqual(table.issues.map(({ code }) => code), ["BLANK_HEADER", "DUPLICATE_HEADER"]);

  const json = inspectTextStructure('[{"id":1},{"id":2,"memo":"x"}]', "records.json");
  assert.equal(json.status, "parsed");
  assert.equal(json.structure.recordCount, 2);
  assert.deepEqual(json.structure.sampleFieldNames, ["id", "memo"]);

  const jsonLines = inspectTextStructure('{"id":1}\nnot-json\n{"id":2}\n', "records.jsonl");
  assert.equal(jsonLines.status, "needs_review");
  assert.equal(jsonLines.structure.validObjectCount, 2);
  assert.deepEqual(jsonLines.issues[0].lineNumbers, [2]);

  assert.equal(inspectTextStructure("BEGIN:VCARD\nEND:VCARD\n", "person.vcf").structure.cardCount, 1);
  assert.equal(inspectTextStructure("plain text", "notes.txt").format, "text");
  assert.equal(inspectTextStructure("a,b\n1,2\n3,4\n", "export.txt").format, "delimited_table");
  assert.equal(inspectTextStructure('{"id":1}\n{"id":2}\n', "export.txt").format, "json_lines");
});

test("the structure tool reads a verified upload and reports repairable table issues", async (context) => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "structure-inspect-"));
  context.after(() => fs.rmSync(mediaRoot, { recursive: true, force: true }));
  const source = "Date,Amount,\n2026-09-16,1,note\n";
  fs.writeFileSync(path.join(mediaRoot, "statement.csv"), source);
  const stored = {
    file_id: 9, storage_path: "media/statement.csv", original_filename: "statement.csv",
    media_kind: "document", mime_type: "text/csv", byte_size: Buffer.byteLength(source),
    sha256: createHash("sha256").update(source).digest("hex"),
  };
  const registry = new ToolRegistry();
  registerFileTools(registry, {
    ledger: {
      file: () => stored,
      fileDetails: () => ({ fileId: 9, originalFilename: "statement.csv" }),
    },
    searchCoordinator: {}, mediaRoot, maximumTextBytes: 4096,
  });
  const result = await registry.execute("file_structure_inspect", { file_id: 9 });
  assert.equal(registry.get("file_structure_inspect").annotations.readOnlyHint, true);
  assert.equal(result.verified, true);
  assert.equal(result.status, "parsed");
  assert.equal(result.issues[0].code, "BLANK_HEADER");
  assert.equal(result.structure.sourceRecordCount, 1);
});
