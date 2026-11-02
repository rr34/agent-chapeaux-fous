import assert from "node:assert/strict";
import test from "node:test";
import { MessagesWebSyncRequests } from "../src/messages-web-sync-requests.mjs";

test("Google Messages web requests move from the UI to extension progress and completion", () => {
  let now = 1_800_000_000_000;
  const requests = new MessagesWebSyncRequests({ now: () => now });
  const created = requests.create({ accountKey: "default" });
  assert.equal(created.status, "pending");
  assert.equal(created.phase, "Waiting for the Brave extension");
  assert.deepEqual(requests.next("default"), {
    requestId: created.requestId,
    accountKey: "default",
    historyMode: "incremental",
    fullHistory: false,
  });

  const reused = requests.create({ accountKey: "default" });
  assert.equal(reused.requestId, created.requestId);
  assert.equal(reused.reused, true);

  now += 1000;
  const running = requests.update(created.requestId, {
    status: "running",
    phase: "Loading history",
    conversationIndex: 2,
    conversationCount: 10,
    messagesRead: 150,
  });
  assert.equal(running.messagesRead, 150);
  assert.equal(requests.next("default"), null);

  now += 1000;
  const complete = requests.update(created.requestId, {
    status: "complete",
    phase: "Complete",
    messagesAccepted: 150,
    messagesCreated: 120,
    messagesDeduplicated: 30,
  });
  assert.equal(complete.completedAtMs, now);
  assert.equal(requests.get(created.requestId).messagesDeduplicated, 30);

  const next = requests.create({ accountKey: "default" });
  assert.notEqual(next.requestId, created.requestId);
});

test("Google Messages web requests reject invalid identities and progress counts", () => {
  const requests = new MessagesWebSyncRequests();
  assert.throws(() => requests.create({ accountKey: "contains spaces" }), /accountKey is invalid/u);
  assert.throws(() => requests.create({ accountKey: "default", historyMode: "forever" }), /historyMode is invalid/u);
  const created = requests.create({ accountKey: "default" });
  assert.throws(
    () => requests.update(created.requestId, { messagesRead: -1 }),
    /messagesRead must be a nonnegative integer/u,
  );
  assert.throws(() => requests.get("not-a-request"), /not found/u);
});
