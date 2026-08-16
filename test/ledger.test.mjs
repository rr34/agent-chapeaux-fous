import assert from "node:assert/strict";
import test from "node:test";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerDatabaseTools } from "../src/tools/database-tools.mjs";
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

test("conversation history can be retrieved as paired exchanges within a date range", () => {
  const temporary = temporaryDatabase();
  const store = new SlayerDatabase(temporary.filename);
  const ledger = new Ledger(store);
  try {
    const addExchange = (requestText, responseText, occurredAtUtc) => {
      const created = ledger.createRequest({ text: requestText });
      ledger.finish(ledger.trace(created.requestId)[0], responseText);
      store.requireReady().prepare(`
        UPDATE activity_events
        SET occurred_at_ms = ?, occurred_at_utc = ?
        WHERE turn_id = ?
      `).run(new Date(occurredAtUtc).getTime(), occurredAtUtc, created.requestId);
      return created.requestId;
    };
    addExchange("Yesterday's topic", "Yesterday's answer", "2026-08-15T15:00:00.000Z");
    const firstToday = addExchange("Morning topic", "Morning answer", "2026-08-16T12:00:00.000Z");
    const secondToday = addExchange("Afternoon topic", "Afternoon answer", "2026-08-16T18:00:00.000Z");

    const firstPage = ledger.conversationRange({
      startAtUtc: "2026-08-16T00:00:00.000Z",
      endAtUtc: "2026-08-17T00:00:00.000Z",
      limit: 1,
    });
    assert.equal(firstPage.count, 1);
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.nextAfterRequestId, firstToday);
    assert.deepEqual(firstPage.entries.map(({ request, response }) => ({ request, response })), [{
      request: "Morning topic", response: "Morning answer",
    }]);

    const secondPage = ledger.conversationRange({
      startAtUtc: "2026-08-16T00:00:00.000Z",
      endAtUtc: "2026-08-17T00:00:00.000Z",
      afterRequestId: firstPage.nextAfterRequestId,
      limit: 10,
    });
    assert.equal(secondPage.hasMore, false);
    assert.deepEqual(secondPage.entries.map(({ requestId }) => requestId), [secondToday]);
    assert.equal(secondPage.entries[0].submittedAtUtc, "2026-08-16T18:00:00.000Z");

    const topical = ledger.conversationRange({
      startAtUtc: "2026-08-16T00:00:00.000Z",
      endAtUtc: "2026-08-17T00:00:00.000Z",
      query: "morning answer",
      limit: 10,
    });
    assert.deepEqual(topical.topic, { query: "morning answer", terms: ["morning", "answer"] });
    assert.deepEqual(topical.entries.map(({ requestId }) => requestId), [firstToday]);

    const withoutCurrentRequest = ledger.conversationRange({
      startAtUtc: "2026-08-16T00:00:00.000Z",
      endAtUtc: "2026-08-17T00:00:00.000Z",
      excludeRequestId: secondToday,
      limit: 10,
    });
    assert.deepEqual(withoutCurrentRequest.entries.map(({ requestId }) => requestId), [firstToday]);
  } finally {
    store.close();
    temporary.cleanup();
  }
});

test("history_range exposes paired history without returning its current request", async () => {
  const temporary = temporaryDatabase();
  const store = new SlayerDatabase(temporary.filename);
  const ledger = new Ledger(store);
  try {
    const prior = ledger.createRequest({ text: "Prior request" });
    ledger.finish(ledger.trace(prior.requestId)[0], "Prior response");
    const current = ledger.createRequest({ text: "What did we discuss today?" });
    const registry = new ToolRegistry();
    registerDatabaseTools(registry, store, ledger);
    const result = await registry.execute("history_range", {
      startAtUtc: "2020-01-01T00:00:00.000Z",
      endAtUtc: "2030-01-01T00:00:00.000Z",
      query: "prior response",
      afterRequestId: null,
      limit: 100,
    }, { requestId: current.requestId });
    assert.deepEqual(result.entries.map(({ request, response }) => ({ request, response })), [{
      request: "Prior request", response: "Prior response",
    }]);
  } finally {
    store.close();
    temporary.cleanup();
  }
});

test("email cleanup receipts recover exact messages from successful prior tool operations", async () => {
  const temporary = temporaryDatabase();
  const store = new SlayerDatabase(temporary.filename);
  const ledger = new Ledger(store);
  try {
    const cleanup = ledger.createRequest({ text: "Trash the social notifications" });
    ledger.append({
      type: "tool.result",
      phase: "end",
      status: "complete",
      actorType: "tool",
      actorName: "email_search",
      turnId: cleanup.requestId,
      operationId: "search-1",
      name: "email_search",
      payload: {
        callId: "search-1",
        name: "email_search",
        result: {
          messages: [
            { id: "mail-1", threadId: "thread-1", receivedAt: "2026-08-16T12:00:00Z", from: [{ name: "Facebook", email: "notify@facebookmail.com" }], subject: "A new post" },
            { id: "mail-2", threadId: "thread-2", receivedAt: "2026-08-16T13:00:00Z", from: [{ name: "Instagram", email: "notify@instagram.com" }], subject: "Your recap" },
          ],
        },
      },
    });
    ledger.append({
      type: "tool.call",
      phase: "start",
      status: "processing",
      actorType: "model",
      actorName: "test-model",
      turnId: cleanup.requestId,
      operationId: "bulk-1",
      name: "email_bulk_update",
      payload: {
        callId: "bulk-1",
        name: "email_bulk_update",
        arguments: { account_id: null, email_ids: ["mail-1", "mail-2"], if_in_state: "state-1", action: "trash" },
      },
    });
    ledger.append({
      type: "tool.result",
      phase: "end",
      status: "complete",
      actorType: "tool",
      actorName: "email_bulk_update",
      turnId: cleanup.requestId,
      operationId: "bulk-1",
      name: "email_bulk_update",
      payload: {
        callId: "bulk-1",
        name: "email_bulk_update",
        result: { action: "trash", affectedCount: 2, emailIds: ["mail-1", "mail-2"] },
      },
    });
    ledger.finish(ledger.trace(cleanup.requestId)[0], "Cleanup complete.");

    const later = ledger.createRequest({ text: "What was just deleted?" });
    ledger.finish(ledger.trace(later.requestId)[0], "I looked at the oldest Trash messages.");
    const registry = new ToolRegistry();
    registerDatabaseTools(registry, store, ledger);
    const result = await registry.execute("email_cleanup_receipt_list", { limit: 5 });
    assert.equal(result.count, 1);
    assert.equal(result.receipts[0].requestId, cleanup.requestId);
    assert.equal(result.receipts[0].affectedCount, 2);
    assert.deepEqual(result.receipts[0].messages.map(({ id, subject }) => ({ id, subject })), [
      { id: "mail-1", subject: "A new post" },
      { id: "mail-2", subject: "Your recap" },
    ]);
  } finally {
    store.close();
    temporary.cleanup();
  }
});
