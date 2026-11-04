import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { registerFileTools } from "../src/tools/file-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

test("the general JSON Lines materializer validates atomically and emits one artifact source", async (context) => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-jsonl-create-"));
  context.after(() => fs.rmSync(mediaRoot, { recursive: true, force: true }));
  const files = [];
  const events = [];
  const ledger = {
    registerFile(file) {
      const created = { ...file, fileId: files.length + 1 };
      files.push(created);
      return created;
    },
    append(event) { events.push(event); },
  };
  const registry = new ToolRegistry();
  registerFileTools(registry, {
    ledger, searchCoordinator: {}, mediaRoot, maximumTextBytes: 4096, maximumGeneratedBytes: 4096,
  });
  const schema = {
    $id: "https://example.test/statement-row.schema.json",
    type: "object",
    additionalProperties: false,
    properties: {
      date: { type: "string", format: "date" },
      change: { type: "string", pattern: "^-?\\d+\\.\\d{2}$" },
    },
    required: ["date", "change"],
  };
  const result = await registry.execute("file_jsonl_create", {
    records: [
      { date: "2026-10-01", change: "12.00" },
      { date: "2026-10-02", change: "-4.25" },
    ],
    target_schema: schema,
    filename: "statement-rows.jsonl",
    title: "Canonical statement rows",
    source_refs: ["accounting://statement-import-jobs/42"],
  }, { requestId: "request-1", callId: "call-1", channel: "test" });

  assert.equal(result.file.objectRole, "artifact_source");
  assert.equal(result.recordCount, 2);
  assert.equal(result.schemaId, schema.$id);
  assert.equal(result.verified, true);
  const storedPath = path.join(mediaRoot, result.file.storagePath.replace(/^media\//, ""));
  assert.deepEqual(fs.readFileSync(storedPath, "utf8").trim().split("\n").map(JSON.parse), [
    { date: "2026-10-01", change: "12.00" },
    { date: "2026-10-02", change: "-4.25" },
  ]);
  assert.equal(events.at(-1).type, "file.jsonl.created");
  assert.equal(events.at(-1).payload.recordCount, 2);

  await assert.rejects(registry.execute("file_jsonl_create", {
    records: [
      { date: "2026-10-03", change: "1.00" },
      { date: "not-a-date", change: "wrong" },
    ],
    target_schema: schema,
    filename: "invalid.jsonl",
    title: "Invalid rows",
  }), /records do not match target_schema/);
  assert.equal(files.length, 1);
});
