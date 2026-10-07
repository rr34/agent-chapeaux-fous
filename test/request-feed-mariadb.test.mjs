import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("incremental request feed returns only requests changed after its cursor", () => {
  const temporary = temporaryDatabase();
  const store = new SlayerDatabase(temporary.target);
  const ledger = new Ledger(store);
  try {
    const created = ledger.createRequest({ text: "Keep the browser responsive." });
    const initial = ledger.recentRequestChanges(25, 0);
    assert.deepEqual(initial.requestIds, [created.requestId]);
    assert.equal(initial.requests[0].request, "Keep the browser responsive.");
    assert.equal(initial.requests[0].status, "queued");
    assert.equal("steps" in initial.requests[0], false);
    assert.equal("objectActivity" in initial.requests[0], false);

    ledger.markProcessing(ledger.nextQueuedRequest());
    const changed = ledger.recentRequestChanges(25, initial.cursor);
    assert.deepEqual(changed.requestIds, [created.requestId]);
    assert.equal(changed.requests.length, 1);
    assert.equal(changed.requests[0].status, "processing");

    const unchanged = ledger.recentRequestChanges(25, changed.cursor);
    assert.deepEqual(unchanged.requests, []);
  } finally {
    store.close();
    temporary.cleanup();
  }
});
