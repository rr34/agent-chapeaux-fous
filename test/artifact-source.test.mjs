import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileArtifactSource } from "../src/artifact-source.mjs";

test("persisted artifact sources verify identity and support bounded positional reads", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-artifact-source-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('{"n":1}\n{"n":2}\n{"n":3}\n', "utf8");
  const filename = path.join(directory, "artifact.jsonl");
  fs.writeFileSync(filename, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const stored = {
    file_id: 42,
    storage_path: "media/artifact.jsonl",
    original_filename: "records.jsonl",
    mime_type: "application/x-ndjson",
    byte_size: bytes.length,
    sha256,
  };
  const source = createFileArtifactSource({
    mediaRoot: directory,
    ledger: {
      file(fileId) { return fileId === 42 ? stored : null; },
    },
  });

  const opened = await source.open(42);
  context.after(() => opened.close());
  assert.deepEqual(opened.descriptor, {
    file: { file_id: 42 },
    fileId: 42,
    filename: "records.jsonl",
    mimeType: "application/x-ndjson",
    byteSize: bytes.length,
    sha256,
    jsonLineRecordCount: 3,
  });
  assert.deepEqual(await opened.read(0, 7), Buffer.from('{"n":1}'));
  assert.deepEqual(await opened.read(bytes.length, 10), Buffer.alloc(0));
  await assert.rejects(opened.read(bytes.length + 1, 1), /offset is invalid/);
});

test("persisted artifact sources reject files whose recorded checksum is stale", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-artifact-checksum-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "artifact.jsonl"), "changed\n");
  const source = createFileArtifactSource({
    mediaRoot: directory,
    ledger: {
      file() {
        return {
          file_id: 7, storage_path: "media/artifact.jsonl", original_filename: "artifact.jsonl",
          mime_type: "application/x-ndjson", byte_size: 8, sha256: "0".repeat(64),
        };
      },
    },
  });
  await assert.rejects(source.open(7), /checksum does not match/);
});

test("persisted JSON Lines artifacts must be UTF-8 with one object per nonblank line", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-slayer-artifact-jsonl-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('{"valid":true}\n["not-an-object"]\n', "utf8");
  fs.writeFileSync(path.join(directory, "artifact.jsonl"), bytes);
  const source = createFileArtifactSource({
    mediaRoot: directory,
    ledger: {
      file() {
        return {
          file_id: 8, storage_path: "media/artifact.jsonl", original_filename: "artifact.jsonl",
          mime_type: "application/x-ndjson", byte_size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      },
    },
  });
  await assert.rejects(source.open(8), /line 2 is not one JSON object/);
});
