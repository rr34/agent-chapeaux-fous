import assert from "node:assert/strict";
import test from "node:test";
import { RequestQueue } from "../src/queue.mjs";

test("queue notification defers agent work until the request handler can return", async () => {
  const pending = [{
    turnId: "request-1",
    eventId: "event-1",
    content: "Do the work",
    channel: "web",
    primaryFileId: null,
    payload: {},
  }];
  const calls = [];
  const ledger = {
    nextQueuedRequest() {
      calls.push("next");
      return pending.shift() ?? null;
    },
    markProcessing() { calls.push("processing"); },
    finish(_request, response) { calls.push(`finished:${response}`); },
    fail(_request, error) { calls.push(`failed:${error.message}`); },
    file() { return null; },
  };
  const queue = new RequestQueue({
    ledger,
    runtime: { run: async () => "Complete" },
    transcriber: null,
    mediaRoot: "/tmp",
  });

  queue.notify();
  queue.notify();
  assert.deepEqual(calls, []);

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["next", "processing", "finished:Complete", "next"]);
});

test("queue exposes a homogeneous image upload group as exact PDF assembly inputs", async () => {
  const files = new Map([1, 2].map((fileId) => [fileId, {
    file_id: fileId,
    storage_path: `media/scan-${fileId}.png`,
    original_filename: `scan-${fileId}.png`,
    title: `Scan ${fileId}`,
    description: null,
    title_source: "original_filename",
    media_kind: "image",
    mime_type: "image/png",
    sha256: String(fileId).repeat(64),
    byte_size: 100 + fileId,
    created_at_utc: `2026-11-21T00:00:0${fileId}.000Z`,
  }]));
  const appended = [];
  let runtimeInput = null;
  const ledger = {
    markProcessing() {},
    file: (fileId) => files.get(fileId) ?? null,
    append(event) { appended.push(event); },
    finish() {},
    fail(_request, error) { throw error; },
  };
  const queue = new RequestQueue({
    ledger,
    runtime: { run: async (input) => { runtimeInput = input; return "Complete"; } },
    transcriber: null,
    mediaRoot: "/tmp",
  });
  await queue.process({
    turnId: "images-request",
    eventId: "images-event",
    content: "Put these images into one PDF in this order.",
    channel: "web",
    primaryFileId: 1,
    payload: { attachmentFileIds: [1, 2] },
  });

  assert.equal(runtimeInput.attachment.mediaKind, "file_group");
  assert.deepEqual(runtimeInput.attachment.files.map(({ fileId }) => fileId), [1, 2]);
  assert.match(runtimeInput.attachment.text, /file_images_to_pdf/u);
  assert.equal(appended[0].payload.bytesRead, 0);
});
