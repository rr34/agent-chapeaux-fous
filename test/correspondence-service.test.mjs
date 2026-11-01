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
  const correspondenceIds = new Map([["email-parent", 41], ["email-child", 42]]);
  const database = {
    exec(sql) { executions.push(sql); },
    prepare(sql) {
      if (sql.startsWith("SELECT correspondence_id, external_id")) return { all: () => [
        { correspondence_id: 41, external_id: "email-parent", internet_message_id: "message-parent@example.test" },
        { correspondence_id: 42, external_id: "email-child", internet_message_id: "message-child@example.test" },
      ] };
      if (sql.startsWith("SELECT correspondence_id")) return { get: (_sourceAccountKey, externalId) => ({
        correspondence_id: correspondenceIds.get(externalId),
      }) };
      if (sql.includes("FROM contact_methods AS method")) return { get: () => undefined };
      return { run: (...args) => { calls.push({ sql, args }); } };
    },
  };
  const ledgerEvents = [];
  const jmap = {
    resolveAccountId: () => "account-1",
    publicSession: () => ({ username: "me@example.test" }),
    async call(method) {
      if (method === "Email/query") return { ids: ["email-child", "email-parent"], total: 2, queryState: "query-state" };
      if (method === "Email/get") return {
        state: "email-state",
        list: [{
          id: "email-child", threadId: "thread-1", messageId: ["message-child@example.test"],
          inReplyTo: ["message-parent@example.test"], subject: "Re: Status", sentAt: "2026-10-31T23:43:51-07:00",
          receivedAt: "2026-10-31T23:43:52-07:00", preview: "fallback",
          from: [{ email: "me@example.test", name: "Me" }], to: [{ email: "alex@example.test", name: "Alex" }],
          textBody: [], htmlBody: [{ partId: "html" }], bodyValues: { html: { value: "<p>Ready</p>" } },
        }, {
          id: "email-parent", threadId: "thread-1", messageId: ["message-parent@example.test"],
          inReplyTo: [], subject: "Status", sentAt: "2026-10-31T22:00:00-07:00",
          receivedAt: "2026-10-31T22:00:01-07:00", preview: "Earlier",
          from: [{ email: "alex@example.test", name: "Alex" }], to: [{ email: "me@example.test", name: "Me" }],
          textBody: [{ partId: "text" }], htmlBody: [], bodyValues: { text: { value: "Earlier" } },
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
  assert.equal(correspondenceInsert.args[9], "2026-11-01T06:43:51.000Z");
  assert.equal(correspondenceInsert.args[10], "2026-11-01T06:43:51.000Z");
  assert.equal(correspondenceInsert.args[11], "2026-11-01T06:43:52.000Z");
  const replyWrites = calls.filter(({ sql }) => sql.startsWith("UPDATE correspondence SET in_reply_to_id"));
  assert.deepEqual(replyWrites.map(({ args }) => args), [[41, 42], [null, 41]]);
  const stateWrite = calls.find(({ sql }) => sql.includes("INSERT INTO jmap_email_sync_state"));
  assert.equal(stateWrite.args[1], "email-state");
  assert.deepEqual(executions, ["START TRANSACTION", "COMMIT"]);
  assert.equal(ledgerEvents[0].type, "correspondence.email_synchronized");
});
