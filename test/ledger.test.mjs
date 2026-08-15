import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { temporaryDatabase } from "./helpers.mjs";

test("active request progress follows the latest unfinished ledger operation", () => {
  const temporary = temporaryDatabase();
  const store = new SlayerDatabase(temporary.filename);
  const ledger = new Ledger(store);
  try {
    const created = ledger.createRequest({ text: "Update the property clock entry" });
    assert.equal(ledger.recentRequests()[0].progress.label, "Queued");

    ledger.append({
      type: "request.processing", phase: "start", status: "processing",
      turnId: created.requestId, operationId: `request:${created.requestId}`,
    });
    assert.equal(ledger.recentRequests()[0].progress.label, "Preparing request");

    ledger.append({
      type: "model.request", phase: "start", status: "processing",
      turnId: created.requestId, operationId: `model:${created.requestId}`,
    });
    assert.equal(ledger.recentRequests()[0].progress.label, "Waiting for model");

    ledger.append({
      type: "tool.call", phase: "start", status: "processing",
      turnId: created.requestId, operationId: "call-1", name: "remote_tlom_update_clock_entry",
    });
    let progress = ledger.recentRequests()[0].progress;
    assert.equal(progress.label, "Running remote_tlom_update_clock_entry");
    assert.equal(progress.modelCalls, 1);
    assert.equal(progress.toolCalls, 1);

    ledger.append({
      type: "tool.result", phase: "end", status: "complete",
      turnId: created.requestId, operationId: "call-1", name: "remote_tlom_update_clock_entry",
    });
    progress = ledger.recentRequests()[0].progress;
    assert.equal(progress.label, "Waiting for model");
    assert.ok(Number.isFinite(progress.startedAtMs));
    assert.ok(Number.isFinite(progress.lastActivityAtMs));
  } finally {
    store.close();
    temporary.cleanup();
  }
});
