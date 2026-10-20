import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalContentSource, VideoContentReconciler,
} from "../src/video-content-reconcile.mjs";

test("canonical source identity treats ordinary, short, and tracking YouTube URLs as one video", () => {
  const urls = [
    "https://www.youtube.com/watch?v=0dqrgcV80TM&utm_source=test",
    "https://youtu.be/0dqrgcV80TM?t=12",
    "https://m.youtube.com/shorts/0dqrgcV80TM",
  ];
  assert.deepEqual(urls.map((url) => canonicalContentSource(url, "youtube").key), [
    "youtube:0dqrgcV80TM", "youtube:0dqrgcV80TM", "youtube:0dqrgcV80TM",
  ]);
});

test("file reconciliation previews and applies a full source-identity projection", async context => {
  const mediaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "content-reconcile-"));
  context.after(() => fsp.rm(mediaRoot, { recursive: true, force: true }));
  const contents = [
    "Content,Video title,Video publish time",
    "https://www.youtube.com/watch?v=0dqrgcV80TM,Aurora,11-May-24",
    "https://youtu.be/AbCdEf12345,New source,2025-02-10",
    "",
  ].join("\n");
  await fsp.writeFile(path.join(mediaRoot, "source.csv"), contents);
  const file = {
    file_id: 51,
    media_kind: "document",
    original_filename: "source.csv",
    mime_type: "text/csv",
    storage_path: "media/source.csv",
    byte_size: Buffer.byteLength(contents),
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
  const existing = {
    id: 136,
    groupId: 6,
    sequence: 12,
    title: "Old Aurora title",
    publishedAtUtc: "2024-05-10T00:00:00.000Z",
    contentHost: "youtube",
    contentUrl: "https://youtu.be/0dqrgcV80TM?feature=share",
    version: "2026-10-19T10:00:00.000Z",
  };
  let mutationInput;
  const videoContent = {
    list() {
      return {
        items: [existing], count: 1, hasMore: false, nextAfterSequence: null,
      };
    },
    reconcileItems(input) {
      mutationInput = input;
      return {
        updatedCount: 1,
        createdCount: 1,
        updatedItems: [{ ...existing, ...input.updates[0] }],
        createdItems: [{
          id: 200, groupId: 6, version: "2026-10-19T12:00:00.000Z",
          ...input.creates[0],
        }],
      };
    },
    getItem() {
      return {
        ...existing,
        sequence: 12,
        title: "Aurora",
        publishedAtUtc: "2024-05-11T00:00:00.000Z",
        contentUrl: "https://www.youtube.com/watch?v=0dqrgcV80TM",
        version: "2026-10-19T12:00:00.000Z",
      };
    },
  };
  const reconciler = new VideoContentReconciler({
    ledger: { file(id) { return id === 51 ? file : null; } },
    mediaRoot,
    maximumBytes: 100_000,
    videoContent,
  });
  const input = {
    file_id: 51,
    groupId: 6,
    delimiter: "comma",
    first_sequence: 12,
    source_url_column: "Content",
    title_column: "Video title",
    published_at_column: "Video publish time",
    content_host: "youtube",
  };
  const preview = await reconciler.preview(input);
  assert.equal(preview.canApply, true);
  assert.equal(preview.updateCount, 1);
  assert.equal(preview.createCount, 1);
  assert.deepEqual(preview.actions.map(({ sourceIdentity, action, contentId }) => ({
    sourceIdentity, action, contentId,
  })), [
    { sourceIdentity: "youtube:0dqrgcV80TM", action: "update", contentId: 136 },
    { sourceIdentity: "youtube:AbCdEf12345", action: "create", contentId: null },
  ]);

  const applied = await reconciler.apply({ ...input, preview_digest: preview.previewDigest }, {
    requestId: "request-reconcile", callId: "call-reconcile",
  });
  assert.equal(mutationInput.updates[0].content_id, 136);
  assert.equal(mutationInput.creates[0].sourceIdentity, "youtube:AbCdEf12345");
  assert.equal(applied.sourceRecordCount, 2);
  assert.equal(applied.verifiedCount, 2);
  assert.deepEqual(applied.items.map(({ sourceIdentity, content_id }) => ({ sourceIdentity, content_id })), [
    { sourceIdentity: "youtube:0dqrgcV80TM", content_id: 136 },
    { sourceIdentity: "youtube:AbCdEf12345", content_id: 200 },
  ]);
});

test("file reconciliation blocks repurposing a sequence occupied by a different source", async context => {
  const mediaRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "content-reconcile-conflict-"));
  context.after(() => fsp.rm(mediaRoot, { recursive: true, force: true }));
  const contents = "Content,Video title,Video publish time\nhttps://youtu.be/0dqrgcV80TM,Aurora,11-May-24\n";
  await fsp.writeFile(path.join(mediaRoot, "source.csv"), contents);
  const file = {
    file_id: 52, media_kind: "document", original_filename: "source.csv",
    mime_type: "text/csv", storage_path: "media/source.csv",
    byte_size: Buffer.byteLength(contents),
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
  const reconciler = new VideoContentReconciler({
    ledger: { file() { return file; } }, mediaRoot, maximumBytes: 100_000,
    videoContent: {
      list() {
        return { items: [{
          id: 136, sequence: 12, title: "Different video", contentHost: "youtube",
          contentUrl: "https://youtu.be/WEJdLbNuRCI", version: "v1",
        }], hasMore: false, nextAfterSequence: null };
      },
    },
  });
  const preview = await reconciler.preview({
    file_id: 52, groupId: 6, delimiter: "comma", first_sequence: 12,
    source_url_column: "Content", title_column: "Video title",
    published_at_column: "Video publish time", content_host: "youtube",
  });
  assert.equal(preview.canApply, false);
  assert.equal(preview.conflicts[0].code, "SEQUENCE_OCCUPIED_BY_DIFFERENT_SOURCE");
  assert.equal(preview.actions[0].action, "create");
  assert.equal(preview.actions[0].contentId, null);
});
