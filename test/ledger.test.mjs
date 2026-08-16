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

test("request IDs resolve from an unambiguous visible prefix", () => {
  const temporary = temporaryDatabase();
  const store = new SlayerDatabase(temporary.filename);
  const ledger = new Ledger(store);
  try {
    ledger.append({
      type: "request.received", actorType: "user", turnId: "6bce8f9c-1111-4111-8111-111111111111",
    });
    assert.deepEqual(ledger.resolveRequestId("6bce8f9c"), {
      status: "resolved",
      requestId: "6bce8f9c-1111-4111-8111-111111111111",
    });
    assert.deepEqual(ledger.resolveRequestId("aaaaaaaa"), { status: "missing", requestId: null });
    assert.deepEqual(ledger.resolveRequestId("not-an-id"), { status: "invalid", requestId: null });

    ledger.append({
      type: "request.received", actorType: "user", turnId: "6bce8f9c-2222-4222-8222-222222222222",
    });
    assert.deepEqual(ledger.resolveRequestId("6bce8f9c"), { status: "ambiguous", requestId: null });
  } finally {
    store.close();
    temporary.cleanup();
  }
});

test("completed requests report elapsed time from receipt through the terminal event", () => {
  const temporary = temporaryDatabase();
  const store = new SlayerDatabase(temporary.filename);
  const ledger = new Ledger(store);
  try {
    const created = ledger.createRequest({ text: "Time this request" });
    const received = ledger.trace(created.requestId)[0];
    ledger.finish(received, "Done");

    const events = ledger.trace(created.requestId);
    const request = ledger.recentRequests()[0];
    assert.equal(request.elapsedMs, events.at(-1).occurredAtMs - events[0].occurredAtMs);
    assert.equal(request.progress, undefined);
  } finally {
    store.close();
    temporary.cleanup();
  }
});
