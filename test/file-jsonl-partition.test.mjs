import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFileArtifactSource } from "../src/artifact-source.mjs";
import { registerFileTools } from "../src/tools/file-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

function harness(context, source) {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), "file-jsonl-partition-"));
  context.after(() => fs.rmSync(mediaRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(mediaRoot, "source.jsonl"), source);
  const files = new Map();
  const events = [];
  let nextId = 1;
  const ledger = {
    file(fileId) { return files.get(fileId) ?? null; },
    fileDetails(fileId) {
      const file = files.get(fileId);
      return file ? {
        fileId: file.file_id, originalFilename: file.original_filename,
        sha256: file.sha256, byteSize: file.byte_size,
      } : null;
    },
    registerFile({ storagePath, originalFilename, mimeType, sha256, byteSize }) {
      const duplicate = [...files.values()].find((file) => file.sha256 === sha256 && file.byte_size === byteSize);
      if (duplicate) return { fileId: duplicate.file_id, storagePath: duplicate.storage_path, duplicate: true };
      const fileId = nextId++;
      files.set(fileId, {
        file_id: fileId, storage_path: storagePath, original_filename: originalFilename,
        media_kind: "document", mime_type: mimeType, sha256, byte_size: byteSize,
      });
      return { fileId, storagePath, duplicate: false };
    },
    append(event) { events.push(event); },
  };
  const sourceFile = ledger.registerFile({
    storagePath: "media/source.jsonl", originalFilename: "source.jsonl",
    mimeType: "application/x-ndjson",
    sha256: createHash("sha256").update(source).digest("hex"),
    byteSize: Buffer.byteLength(source),
  });
  const registry = new ToolRegistry();
  registerFileTools(registry, {
    ledger, searchCoordinator: {}, mediaRoot,
    maximumTextBytes: 1024, maximumGeneratedBytes: 10 * 1024 * 1024,
  });
  return { mediaRoot, files, events, ledger, sourceFile, registry };
}

test("verified JSON Lines partition makes eight durable, ordered batches for 72,895 records", async (context) => {
  const records = Array.from({ length: 72895 }, (_, index) => JSON.stringify({ n: index + 1 }));
  const fixture = harness(context, `${records.join("\n")}\n`);
  const parameters = { file_id: fixture.sourceFile.fileId, records_per_file: 10000 };
  const result = await fixture.registry.execute("file_jsonl_partition", parameters,
    { requestId: "partition-turn", callId: "partition-call", channel: "test" });
  assert.equal(result.verified, true);
  assert.equal(result.sourceRecordCount, 72895);
  assert.equal(result.totalPartCount, 8);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextPart, null);
  assert.deepEqual(result.parts.map((part) => part.recordCount), [10000, 10000, 10000, 10000, 10000, 10000, 10000, 2895]);
  assert.deepEqual(result.parts.map((part) => [part.firstRecord, part.lastRecord]), [
    [1, 10000], [10001, 20000], [20001, 30000], [30001, 40000],
    [40001, 50000], [50001, 60000], [60001, 70000], [70001, 72895],
  ]);
  const artifactSource = createFileArtifactSource({ ledger: fixture.ledger, mediaRoot: fixture.mediaRoot });
  const restored = [];
  for (const part of result.parts) {
    const file = fixture.files.get(part.file.fileId);
    const contents = fs.readFileSync(path.join(fixture.mediaRoot, file.storage_path.slice(6)), "utf8");
    restored.push(...contents.trimEnd().split("\n"));
    const artifact = await artifactSource.open(part.file.fileId);
    assert.equal(artifact.descriptor.jsonLineRecordCount, part.recordCount);
    await artifact.close();
  }
  assert.deepEqual(restored, records);
  assert.equal(fixture.events[0].type, "file.jsonl.partitioned");
  assert.equal(fixture.events[0].payload.totalPartCount, 8);

  const priorFileCount = fixture.files.size;
  const replay = await fixture.registry.execute("file_jsonl_partition", parameters);
  assert.deepEqual(replay.parts.map((part) => part.file.fileId), result.parts.map((part) => part.file.fileId));
  assert.equal(fixture.files.size, priorFileCount);
  const page = await fixture.registry.execute("file_jsonl_partition", { ...parameters, start_part: 7, max_parts: 1 });
  assert.deepEqual(page.parts.map((part) => part.partNumber), [7]);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextPart, 8);
});

test("partition rejects changed or invalid source before creating parts", async (context) => {
  const fixture = harness(context, '{"n":1}\n{"n":2}\n');
  fs.writeFileSync(path.join(fixture.mediaRoot, "source.jsonl"), '{"n":3}\n{"n":4}\n');
  await assert.rejects(
    fixture.registry.execute("file_jsonl_partition", { file_id: 1, records_per_file: 1 }),
    /checksum does not match/,
  );
  assert.equal(fixture.files.size, 1);
  fs.writeFileSync(path.join(fixture.mediaRoot, "source.jsonl"), '{"n":1}\n{"n":2}\n');
  const file = fixture.files.get(1);
  file.sha256 = createHash("sha256").update('{"n":1}\nnot json\n').digest("hex");
  fs.writeFileSync(path.join(fixture.mediaRoot, "source.jsonl"), '{"n":1}\nnot json\n');
  file.byte_size = Buffer.byteLength('{"n":1}\nnot json\n');
  await assert.rejects(
    fixture.registry.execute("file_jsonl_partition", { file_id: 1, records_per_file: 1 }),
    /invalid JSON/,
  );
  assert.equal(fixture.files.size, 1);
});

test("an uploaded .jsonl document can be partitioned even when sent as text/plain", async (context) => {
  const fixture = harness(context, '{"n":1}\n{"n":2}\n{"n":3}\n');
  fixture.files.get(1).mime_type = "text/plain";
  const result = await fixture.registry.execute("file_jsonl_partition", {
    file_id: 1, records_per_file: 2,
  });
  assert.deepEqual(result.parts.map((part) => part.recordCount), [2, 1]);
});

test("file text search scans complete verified contents with literal and RE2 queries", async (context) => {
  const source = [
    '{"text":"BTC.Price=141.96"}',
    '{"text":"ETH.Price=12.00"}',
    '{"text":"BTC.Price=142.10"}',
    "",
  ].join("\n");
  const fixture = harness(context, source);
  const literal = await fixture.registry.execute("file_text_search", {
    file_id: 1, query: "BTC.Price", match_mode: "literal", case_sensitive: true,
    start_line: 1, limit: 1,
  });
  assert.equal(literal.verified, true);
  assert.equal(literal.matchingLineCount, 2);
  assert.deepEqual(literal.matches.map((match) => match.lineNumber), [1]);
  assert.equal(literal.hasMore, true);
  assert.equal(literal.nextLine, 2);
  const next = await fixture.registry.execute("file_text_search", {
    file_id: 1, query: "BTC.Price", match_mode: "literal", case_sensitive: true,
    start_line: literal.nextLine, limit: 1,
  });
  assert.deepEqual(next.matches.map((match) => match.lineNumber), [3]);
  assert.equal(next.hasMore, false);
  const regex = await fixture.registry.execute("file_text_search", {
    file_id: 1, query: "(?:btc|eth)\\.price=", match_mode: "regex", case_sensitive: false,
    limit: 10,
  });
  assert.equal(regex.matchingLineCount, 3);
  assert.deepEqual(regex.matches.map((match) => match.column), [10, 10, 10]);
  fs.appendFileSync(path.join(fixture.mediaRoot, "source.jsonl"), "tampered");
  await assert.rejects(
    fixture.registry.execute("file_text_search", {
      file_id: 1, query: "BTC", match_mode: "literal", case_sensitive: true, limit: 10,
    }),
    /size does not match/,
  );
});
