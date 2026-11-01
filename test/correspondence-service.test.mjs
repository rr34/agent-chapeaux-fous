import assert from "node:assert/strict";
import test from "node:test";
import { CorrespondenceService } from "../src/correspondence.mjs";

function smsFixture(methods) {
  const database = {
    prepare(sql) {
      if (sql.includes("FROM contacts")) return { get: () => ({ contact_id: 7, display_name: "Alex Rivera" }) };
      if (sql.includes("contact_method_id = ?")) {
        return { all: (methodId) => methods.filter((method) => method.contact_method_id === methodId) };
      }
      if (sql.includes("FROM contact_methods")) return { all: () => methods };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return new CorrespondenceService({ store: { requireReady: () => database }, ledger: {}, jmap: {} });
}

test("SMS drafts select one exact receivable phone without sending or persisting correspondence", () => {
  const service = smsFixture([
    { contact_method_id: 31, label: "home", value: "+1 555 010 1000", is_primary: 0 },
    { contact_method_id: 32, label: "mobile", value: "+1 555 010 2000", is_primary: 1 },
  ]);
  assert.deepEqual(service.createSmsDraft({ contact_id: 7, contact_method_id: null, body: "On my way" }), {
    status: "ready",
    draft: {
      contact_id: 7,
      contact_method_id: 32,
      contact_name: "Alex Rivera",
      address: "+1 555 010 2000",
      body: "On my way",
    },
  });
});

test("SMS drafts return exact choices when a contact has several non-primary phones", () => {
  const service = smsFixture([
    { contact_method_id: 31, label: "home", value: "+1 555 010 1000", is_primary: 0 },
    { contact_method_id: 32, label: "mobile", value: "+1 555 010 2000", is_primary: 0 },
  ]);
  assert.deepEqual(service.createSmsDraft({ contact_id: 7, contact_method_id: null, body: "Hello" }), {
    status: "needs_selection",
    contact_id: 7,
    contact_name: "Alex Rivera",
    methods: [
      { contact_method_id: 31, label: "home", address: "+1 555 010 1000" },
      { contact_method_id: 32, label: "mobile", address: "+1 555 010 2000" },
    ],
  });
});

test("email synchronization preserves provider HTML and records the Email state", async () => {
  const calls = [];
  const executions = [];
  const database = {
    exec(sql) { executions.push(sql); },
    prepare(sql) {
      if (sql.startsWith("SELECT correspondence_id")) return { get: () => ({ correspondence_id: 41 }) };
      if (sql.includes("FROM contact_methods AS method")) return { get: () => undefined };
      return { run: (...args) => { calls.push({ sql, args }); } };
    },
  };
  const ledgerEvents = [];
  const jmap = {
    resolveAccountId: () => "account-1",
    publicSession: () => ({ username: "me@example.test" }),
    async call(method) {
      if (method === "Email/query") return { ids: ["email-1"], total: 1, queryState: "query-state" };
      if (method === "Email/get") return {
        state: "email-state",
        list: [{
          id: "email-1", threadId: "thread-1", messageId: ["message-1@example.test"],
          inReplyTo: [], subject: "Status", sentAt: "2026-11-01T12:00:00Z",
          receivedAt: "2026-11-01T12:00:01Z", preview: "fallback",
          from: [{ email: "me@example.test", name: "Me" }], to: [{ email: "alex@example.test", name: "Alex" }],
          textBody: [], htmlBody: [{ partId: "html" }], bodyValues: { html: { value: "<p>Ready</p>" } },
        }],
      };
      throw new Error(`Unexpected JMAP method: ${method}`);
    },
  };
  const service = new CorrespondenceService({
    store: { requireReady: () => database },
    ledger: { append: (event) => ledgerEvents.push(event) },
    jmap,
  });
  const result = await service.syncEmail();
  assert.equal(result.email_state, "email-state");
  const correspondenceInsert = calls.find(({ sql }) => sql.includes("INSERT INTO correspondence\n"));
  assert.equal(correspondenceInsert.args[0], "outbound");
  assert.equal(correspondenceInsert.args[7], "<p>Ready</p>");
  const stateWrite = calls.find(({ sql }) => sql.includes("INSERT INTO jmap_email_sync_state"));
  assert.equal(stateWrite.args[1], "email-state");
  assert.deepEqual(executions, ["START TRANSACTION", "COMMIT"]);
  assert.equal(ledgerEvents[0].type, "correspondence.email_synchronized");
});
