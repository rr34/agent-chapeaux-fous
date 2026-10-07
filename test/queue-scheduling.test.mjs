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
