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

test("correspondence reads expose and filter provider mailbox membership and unread state", () => {
  let listQuery = null;
  const database = { prepare(sql) {
    if (sql.startsWith("SELECT * FROM correspondence")) return { all: (...args) => {
      listQuery = { sql, args };
      return [{ correspondence_id: 9, medium: "email", direction: "inbound", subject: "Update",
        body: "<p>News</p>", occurred_at_utc: "2026-11-01T12:00:00.000Z",
        email_keywords_json: JSON.stringify(["$flagged"]) }];
    } };
    if (sql.includes("FROM correspondence_participants_join")) return { all: () => [] };
    if (sql.includes("FROM todo_correspondence_join")) return { all: () => [] };
    if (sql.includes("FROM correspondence_email_mailboxes_join")) return { all: () => [{
      correspondence_id: 9, mailbox_id: "inbox-1", name: "Inbox", role: "inbox",
      parent_mailbox_id: null, sort_order: 1,
    }] };
    if (sql.includes("FROM jmap_email_mailboxes ORDER BY")) return { all: () => [{
      mailbox_id: "inbox-1", name: "Inbox", role: "inbox", parent_mailbox_id: null,
    }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new CorrespondenceService({ store: { requireReady: () => database }, ledger: {}, jmap: {} });
  const result = service.list({ medium: "email", mailboxId: "inbox-1", limit: 20 });
  assert.match(listQuery.sql, /EXISTS \(SELECT 1 FROM correspondence_email_mailboxes_join/u);
  assert.deepEqual(listQuery.args, ["email", "inbox-1", 20, 0]);
  assert.equal(result.items[0].is_read, false);
  assert.deepEqual(result.items[0].email_keywords, ["$flagged"]);
  assert.deepEqual(result.items[0].mailboxes, [{
    mailbox_id: "inbox-1", name: "Inbox", role: "inbox", parent_mailbox_id: null,
  }]);
  assert.equal(result.mailboxes[0].name, "Inbox");
});

test("email synchronization preserves provider HTML and records the Email state", async () => {
  const calls = [];
  const executions = [];
  const correspondenceIds = new Map([["email-parent", 41], ["email-child", 42]]);
  const database = {
    exec(sql) { executions.push(sql); },
    prepare(sql) {
      if (sql.startsWith("SELECT email_state")) return { get: () => undefined };
      if (sql.startsWith("SELECT * FROM jmap_email_sync_work")) return { get: () => undefined };
      if (sql.startsWith("SELECT correspondence_id, internet_message_id")) return { all: () => [
        { correspondence_id: 41, internet_message_id: "message-parent@example.test" },
        { correspondence_id: 42, internet_message_id: "message-child@example.test" },
      ] };
      if (sql.startsWith("SELECT child.correspondence_id")) return { all: () => [{
        correspondence_id: 42, in_reply_to_id: null, in_reply_to_message_id: "message-parent@example.test",
      }] };
      if (sql.startsWith("SELECT stale.correspondence_id")) return { all: () => [] };
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
      if (method === "Mailbox/get") return { list: [
        { id: "inbox-1", name: "Inbox", role: "inbox", parentId: null, sortOrder: 1, isSubscribed: true },
        { id: "project-1", name: "Project One", role: null, parentId: null, sortOrder: 2, isSubscribed: true },
      ] };
      if (method === "Email/query") return { ids: ["email-child", "email-parent"], total: 2, queryState: "query-state" };
      if (method === "Email/get") return {
        state: "email-state",
        list: [{
          id: "email-child", threadId: "thread-1", messageId: ["message-child@example.test"],
          inReplyTo: ["message-parent@example.test"], subject: "Re: Status", sentAt: "2026-10-31T23:43:51-07:00",
          receivedAt: "2026-10-31T23:43:52-07:00", preview: "fallback",
          mailboxIds: { "inbox-1": true, "project-1": true }, keywords: { "$seen": true, "$flagged": false },
          from: [{ email: "me@example.test", name: "M".repeat(501) }], to: [{ email: "alex@example.test", name: "Alex" }],
          textBody: [], htmlBody: [{ partId: "html" }], bodyValues: { html: { value: "<p>Ready</p>" } },
        }, {
          id: "email-parent", threadId: "thread-1", messageId: ["message-parent@example.test"],
          inReplyTo: [], subject: "Status", sentAt: "2026-10-31T22:00:00-07:00",
          receivedAt: "2026-10-31T22:00:01-07:00", preview: "Earlier",
          mailboxIds: { "inbox-1": true }, keywords: {},
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
  assert.equal(correspondenceInsert.args[9], JSON.stringify(["$seen"]));
  assert.equal(correspondenceInsert.args[10], "2026-11-01T06:43:51.000Z");
  assert.equal(correspondenceInsert.args[11], "2026-11-01T06:43:51.000Z");
  assert.equal(correspondenceInsert.args[12], "2026-11-01T06:43:52.000Z");
  const membershipWrites = calls.filter(({ sql }) => sql.includes("INSERT INTO correspondence_email_mailboxes_join"));
  assert.deepEqual(membershipWrites.map(({ args }) => args), [
    [42, "jmap:account-1", "inbox-1"], [42, "jmap:account-1", "project-1"],
    [41, "jmap:account-1", "inbox-1"],
  ]);
  const baselineReplyWrite = calls.find(({ sql }) => sql.startsWith("UPDATE correspondence SET in_reply_to_id = CASE"));
  assert.deepEqual(baselineReplyWrite.args, [42, 41, 42]);
  const participantWrites = calls.filter(({ sql }) => sql.includes("INSERT INTO correspondence_participants_join"));
  assert.equal(participantWrites[0].args[5], "M".repeat(500));
  const stateWrite = calls.find(({ sql }) => sql.includes("INSERT INTO jmap_email_sync_state"));
  assert.equal(stateWrite.args[1], "email-state");
  assert.equal(executions.filter((value) => value === "START TRANSACTION").length,
    executions.filter((value) => value === "COMMIT").length);
  assert.equal(executions.includes("ROLLBACK"), false);
  assert.equal(ledgerEvents[0].type, "correspondence.email_synchronized");
});

test("email synchronization commits bounded pages and continues past the first 100 ids", async () => {
  const queryPositions = [];
  const database = {
    exec() {},
    prepare(sql) {
      if (sql.startsWith("SELECT email_state")) return { get: () => undefined };
      if (sql.startsWith("SELECT * FROM jmap_email_sync_work")) return { get: () => undefined };
      if (sql.startsWith("SELECT correspondence_id, internet_message_id")) return { all: () => [] };
      if (sql.startsWith("SELECT child.correspondence_id")) return { all: () => [] };
      if (sql.startsWith("SELECT stale.correspondence_id")) return { all: () => [] };
      return { run() {} };
    },
  };
  const firstPage = Array.from({ length: 100 }, (_, index) => `email-${index}`);
  const jmap = {
    resolveAccountId: () => "account-1",
    publicSession: () => ({ username: "me@example.test" }),
    async call(method, input) {
      if (method === "Mailbox/get") return { list: [] };
      if (method === "Email/query") {
        queryPositions.push(input.position);
        return input.position === 0
          ? { ids: firstPage, total: 101 }
          : { ids: ["email-100"] };
      }
      if (method === "Email/get") return { state: "email-state", list: [] };
      throw new Error(`Unexpected JMAP method: ${method}`);
    },
  };
  const service = new CorrespondenceService({
    store: { requireReady: () => database }, ledger: { append() {} }, jmap,
  });
  const result = await service.syncEmail();
  assert.deepEqual(queryPositions, [0, 100]);
  assert.equal(result.total, 101);
});

test("an interrupted full email baseline resumes from its durable position", async () => {
  const queryPositions = [];
  const database = {
    exec() {},
    prepare(sql) {
      if (sql.startsWith("SELECT email_state")) return { get: () => undefined };
      if (sql.startsWith("SELECT * FROM jmap_email_sync_work")) return { get: () => ({
        source_account_key: "jmap:account-1", target_email_state: "baseline-state", query_state: "query-state",
        next_position: 2_900, total: 100_001, synchronized_count: 2_900, query_changed: 0,
      }) };
      if (sql.startsWith("SELECT correspondence_id, internet_message_id")) return { all: () => [] };
      if (sql.startsWith("SELECT child.correspondence_id")) return { all: () => [] };
      if (sql.startsWith("SELECT stale.correspondence_id")) return { all: () => [] };
      return { run: () => ({ changes: 0 }) };
    },
  };
  const jmap = {
    resolveAccountId: () => "account-1",
    publicSession: () => ({ username: "me@example.test" }),
    async call(method, input) {
      if (method === "Mailbox/get") return { list: [] };
      if (method === "Email/query") {
        queryPositions.push(input.position);
        return { ids: [], queryState: "query-state" };
      }
      throw new Error(`Unexpected JMAP method: ${method}`);
    },
  };
  const service = new CorrespondenceService({
    store: { requireReady: () => database }, ledger: { append() {} }, jmap,
  });
  const result = await service.syncEmail();
  assert.deepEqual(queryPositions, [2_900]);
  assert.equal(result.synchronized, 2_900);
  assert.equal(result.resumed, true);
});

test("later email synchronization clears completed work and consumes JMAP changes without repeating the full query", async () => {
  const calls = [];
  const writes = [];
  const database = {
    exec() {},
    prepare(sql) {
      if (sql.startsWith("SELECT email_state")) return { get: () => ({ email_state: "state-1" }) };
      if (sql.startsWith("SELECT * FROM jmap_email_sync_work")) return { get: () => ({
        source_account_key: "jmap:account-1", target_email_state: "state-1", next_position: 10,
      }) };
      if (sql.startsWith("SELECT correspondence_id FROM correspondence") && sql.includes("external_id = ?")) return { get: () => ({ correspondence_id: 51 }) };
      if (sql.startsWith("SELECT correspondence_id FROM correspondence") && sql.includes("internet_message_id = ?")) return { all: () => [] };
      if (sql.startsWith("SELECT correspondence_id, external_id")) return { all: () => [{
        correspondence_id: 51, external_id: "changed-1", internet_message_id: "changed@example.test",
      }] };
      if (sql.includes("FROM contact_methods AS method")) return { get: () => undefined };
      return { run: (...args) => writes.push({ sql, args }) };
    },
  };
  const jmap = {
    resolveAccountId: () => "account-1",
    publicSession: () => ({ username: "me@example.test" }),
    async call(method, input) {
      calls.push({ method, input });
      if (method === "Mailbox/get") return { list: [{
        id: "inbox-1", name: "Inbox", role: "inbox", sortOrder: 1, isSubscribed: true,
      }] };
      if (method === "Email/changes") return {
        oldState: "state-1", newState: "state-2", hasMoreChanges: false,
        created: [], updated: ["changed-1"], destroyed: ["deleted-1"],
      };
      if (method === "Email/get") return { state: "state-2", list: [{
        id: "changed-1", threadId: "thread-1", messageId: ["changed@example.test"], inReplyTo: [],
        subject: "Changed", sentAt: null, receivedAt: "2026-11-01T12:00:00Z",
        mailboxIds: { "inbox-1": true }, keywords: { "$seen": true },
        from: [{ email: "alex@example.test", name: "Alex" }], to: [{ email: "me@example.test", name: "Me" }],
        textBody: [], htmlBody: [], bodyValues: {}, preview: "Changed",
      }] };
      throw new Error(`Unexpected JMAP method: ${method}`);
    },
  };
  const service = new CorrespondenceService({
    store: { requireReady: () => database }, ledger: { append() {} }, jmap,
  });
  const result = await service.syncEmail();
  assert.equal(result.mode, "incremental");
  assert.equal(result.synchronized, 1);
  assert.equal(result.deleted, 1);
  assert.equal(result.email_state, "state-2");
  assert.equal(calls.some(({ method }) => method === "Email/query"), false);
  assert.ok(writes.some(({ sql }) => sql.startsWith("DELETE FROM jmap_email_sync_work_items")));
  assert.ok(writes.some(({ sql }) => sql.startsWith("DELETE FROM jmap_email_sync_work WHERE")));
  assert.deepEqual(calls.find(({ method }) => method === "Email/changes").input, {
    accountId: "account-1", sinceState: "state-1", maxChanges: 500,
  });
  assert.ok(writes.some(({ sql, args }) => sql.includes("external_id IN")
    && args[0] === "jmap:account-1" && args[1] === "deleted-1"));
  const stateWrite = writes.find(({ sql }) => sql.includes("INSERT INTO jmap_email_sync_state"));
  assert.equal(stateWrite.args[1], "state-2");
});

test("an expired JMAP changes cursor restarts a full baseline", async () => {
  let cursorRead = 0;
  const writes = [];
  const methods = [];
  const database = {
    exec() {},
    prepare(sql) {
      if (sql.startsWith("SELECT email_state")) return { get: () => (
        cursorRead++ === 0 ? { email_state: "expired-state" } : undefined
      ) };
      if (sql.startsWith("SELECT * FROM jmap_email_sync_work")) return { get: () => undefined };
      if (sql.startsWith("SELECT correspondence_id, internet_message_id")) return { all: () => [] };
      if (sql.startsWith("SELECT child.correspondence_id")) return { all: () => [] };
      if (sql.startsWith("SELECT stale.correspondence_id")) return { all: () => [] };
      return { run: (...args) => writes.push({ sql, args }) };
    },
  };
  const jmap = {
    resolveAccountId: () => "account-1",
    publicSession: () => ({ username: "me@example.test" }),
    async call(method) {
      methods.push(method);
      if (method === "Mailbox/get") return { list: [] };
      if (method === "Email/changes") throw new Error("Email/changes failed (cannotCalculateChanges)");
      if (method === "Email/get") return { state: "baseline-state", list: [] };
      if (method === "Email/query") return { ids: [], total: 0 };
      throw new Error(`Unexpected JMAP method: ${method}`);
    },
  };
  const service = new CorrespondenceService({
    store: { requireReady: () => database }, ledger: { append() {} }, jmap,
  });
  const result = await service.syncEmail();
  assert.equal(result.mode, "full");
  assert.equal(result.email_state, "baseline-state");
  assert.equal(methods.filter((method) => method === "Mailbox/get").length, 2);
  assert.ok(writes.some(({ sql, args }) => sql.startsWith("DELETE FROM jmap_email_sync_state")
    && args[0] === "jmap:account-1"));
});
