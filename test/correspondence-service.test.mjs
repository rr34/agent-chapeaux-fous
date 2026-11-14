import assert from "node:assert/strict";
import test from "node:test";
import { CorrespondenceService } from "../src/correspondence.mjs";
import { currentPersonId, runWithPerson } from "../src/person-context.mjs";

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

test("native Time v3 recipients are approved native contacts with active identities", () => {
  const database = { prepare: () => ({ all: () => [
    { contact_id: 7, display_name: "Alex Rivera", contact_method_id: 31, person_id: "12" },
    { contact_id: 8, display_name: "Unavailable", contact_method_id: 32, person_id: "13" },
  ] }) };
  const service = new CorrespondenceService({
    store: { requireReady: () => database }, ledger: {}, jmap: {},
    identityStore: { activePerson: (personId) => personId === 12 ? { personId, displayName: "Alex Rivera" } : null },
  });
  assert.deepEqual(service.timeV3Recipients(), [{
    contact_id: 7, display_name: "Alex Rivera", contact_method_id: 31, person_id: 12,
  }]);
});

test("native Time v3 delivery writes paired person-owned correspondence in one transaction", () => {
  const messages = [];
  const participants = [];
  const contacts = [];
  const methods = [];
  const events = [];
  const executions = [];
  let nextMessageId = 40;
  const database = {
    exec(sql) { executions.push(sql); },
    prepare(sql) {
      if (sql.includes("method.normalized_value AS person_id")) return { get: () => ({
        contact_id: 7, display_name: "Recipient", contact_method_id: 31, person_id: "2",
      }) };
      if (sql.includes("SELECT contact.contact_id, contact.status")) return { all: () => [] };
      if (sql.includes("INSERT INTO contacts")) return { run: (...args) => {
        contacts.push({ owner: currentPersonId(), args }); return { lastInsertRowid: 8 };
      } };
      if (sql.includes("INSERT INTO contact_methods")) return { run: (...args) => {
        methods.push({ owner: currentPersonId(), args }); return { lastInsertRowid: 32 };
      } };
      if (sql.includes("INSERT INTO correspondence\n")) return { run: (...args) => {
        nextMessageId += 1; messages.push({ owner: currentPersonId(), args, id: nextMessageId });
        return { lastInsertRowid: nextMessageId };
      } };
      if (sql.includes("INSERT INTO correspondence_participants_join")) return { run: (...args) => {
        participants.push({ owner: currentPersonId(), args }); return { changes: 1 };
      } };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const people = new Map([[1, { personId: 1, displayName: "Sender" }], [2, { personId: 2, displayName: "Recipient" }]]);
  const service = new CorrespondenceService({
    store: { requireReady: () => database }, jmap: {},
    identityStore: { activePerson: (id) => people.get(id) || null },
    ledger: { append: (event) => { events.push({ owner: currentPersonId(), event }); return `event-${currentPersonId()}`; } },
  });
  const result = runWithPerson(1, () => service.sendTimeV3Text({ contactId: 7, text: "Hello <node>" }));
  assert.deepEqual(messages.map(({ owner, args }) => ({ owner, direction: args[0], body: args[3] })), [
    { owner: 1, direction: "outbound", body: "Hello &lt;node&gt;" },
    { owner: 2, direction: "inbound", body: "Hello &lt;node&gt;" },
  ]);
  assert.equal(messages[0].args[2], messages[1].args[2]);
  assert.deepEqual(contacts.map(({ owner }) => owner), [2]);
  assert.deepEqual(methods.map(({ owner }) => owner), [2]);
  assert.deepEqual(participants.map(({ owner }) => owner), [1, 2]);
  assert.deepEqual(events.map(({ owner }) => owner), [1, 2]);
  assert.deepEqual(executions, ["START TRANSACTION", "COMMIT"]);
  assert.equal(result.sent_correspondence_id, 41);
  assert.equal(result.received_correspondence_id, 42);
});

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
    if (sql.startsWith("SELECT correspondence.* FROM correspondence")) return { all: (...args) => {
      listQuery = { sql, args };
      return [{ correspondence_id: 9, medium: "email", direction: "inbound", subject: "Update",
        body: "<p>News</p>", occurred_at_utc: "2026-11-01T12:00:00.000Z",
        email_keywords_json: JSON.stringify(["$flagged"]) }];
    } };
    if (sql.includes("FROM correspondence_participants_join")) return { all: () => [] };
    if (sql.includes("FROM todo_correspondence_join")) return { all: () => [] };
    if (sql.includes("FROM calendar_events_correspondence_join")) return { all: () => [{
      correspondence_id: 9, calendar_event_id: 17, title: "Project review",
      starts_at_utc: "2026-11-03T15:00:00.000Z", ends_at_utc: null,
      time_zone: "America/New_York", is_all_day: 0, status: "confirmed",
    }] };
    if (sql.includes("FROM correspondence_email_mailboxes_join")) return { all: () => [{
      correspondence_id: 9, mailbox_id: "inbox-1", name: "Inbox", role: "inbox",
      parent_mailbox_id: null, sort_order: 1,
    }] };
    if (sql.includes("FROM correspondence_source_aliases")) return { all: () => [] };
    if (sql.includes("FROM jmap_email_mailboxes ORDER BY")) return { all: () => [{
      mailbox_id: "inbox-1", name: "Inbox", role: "inbox", parent_mailbox_id: null,
    }] };
    if (sql.includes("FROM tags AS tag")) return { all: () => [] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new CorrespondenceService({ store: { requireReady: () => database }, ledger: {}, jmap: {} });
  const result = service.list({ medium: "email", mailboxId: "inbox-1", limit: 20 });
  assert.match(listQuery.sql, /EXISTS \(SELECT 1 FROM correspondence_email_mailboxes_join/u);
  assert.deepEqual(listQuery.args, ["email", "inbox-1", 21, 0]);
  assert.equal(result.items[0].is_read, false);
  assert.deepEqual(result.items[0].email_keywords, ["$flagged"]);
  assert.deepEqual(result.items[0].mailboxes, [{
    mailbox_id: "inbox-1", name: "Inbox", role: "inbox", parent_mailbox_id: null,
  }]);
  assert.deepEqual(result.items[0].source_observations, []);
  assert.deepEqual(result.items[0].linked_calendar_events, [{
    calendar_event_id: 17, title: "Project review",
    starts_at_utc: "2026-11-03T15:00:00.000Z", ends_at_utc: null,
    time_zone: "America/New_York", is_all_day: false, status: "confirmed",
  }]);
  assert.equal(result.mailboxes[0].name, "Inbox");
  assert.equal(result.result_type, "items");
  assert.equal(result.has_more, false);
});

test("correspondence contact grouping combines time, content, mailbox, and participant-tag filters", () => {
  let groupQuery = null;
  const database = { prepare(sql) {
    if (sql.includes("COUNT(DISTINCT correspondence.correspondence_id)")) return { all: (...args) => {
      groupQuery = { sql, args };
      return [{
        contact_id: 10, display_name: "Avery Watch",
        correspondence_count: 4, earliest_at_utc: "2026-10-26T12:00:00.000Z",
        latest_at_utc: "2026-11-07T18:30:00.000Z", media: "email,sms", directions: "inbound,outbound",
      }];
    } };
    if (sql.includes("assignment.record_id AS contact_id")) return { all: () => [{
      contact_id: "10", slug: "watch-customer", label: "Watch Customer",
    }] };
    if (sql.includes("FROM jmap_email_mailboxes ORDER BY")) return { all: () => [] };
    if (sql.includes("FROM tags AS tag")) return { all: () => [{
      slug: "watch-customer", label: "Watch Customer", contact_count: 12,
    }] };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const service = new CorrespondenceService({ store: { requireReady: () => database }, ledger: {}, jmap: {} });
  const result = service.list({
    q: "repair", medium: "email", direction: "inbound", mailboxId: "inbox-1",
    occurredFromUtc: "2026-10-25T04:00:00.000Z",
    occurredBeforeUtc: "2026-11-09T05:00:00.000Z",
    participantTag: "Watch Customer", groupBy: "contact", limit: 20,
  });
  assert.match(groupQuery.sql, /contact\.status <> 'inactive'/u);
  assert.match(groupQuery.sql, /selected_tag\.slug = \?/u);
  assert.match(groupQuery.sql, /correspondence\.occurred_at_utc >= \?/u);
  assert.match(groupQuery.sql, /correspondence\.occurred_at_utc < \?/u);
  assert.deepEqual(groupQuery.args, [
    "%repair%", "%repair%", "email", "inbound",
    "2026-10-25T04:00:00.000Z", "2026-11-09T05:00:00.000Z",
    "inbox-1", "watch-customer", 21, 0,
  ]);
  assert.deepEqual(result.contact_groups, [{
    contact_id: 10, display_name: "Avery Watch",
    tags: [{ slug: "watch-customer", label: "Watch Customer" }],
    correspondence_count: 4,
    earliest_at_utc: "2026-10-26T12:00:00.000Z",
    latest_at_utc: "2026-11-07T18:30:00.000Z",
    media: ["email", "sms"], directions: ["inbound", "outbound"],
  }]);
  assert.equal(result.result_type, "contacts");
  assert.equal(result.contact_tags[0].contact_count, 12);
  assert.equal(result.has_more, false);
});

test("correspondence reads reject inverted occurrence ranges", () => {
  const service = new CorrespondenceService({
    store: { requireReady: () => ({}) }, ledger: {}, jmap: {},
  });
  assert.throws(() => service.list({
    occurredFromUtc: "2026-11-09T00:00:00.000Z",
    occurredBeforeUtc: "2026-11-08T00:00:00.000Z",
  }), /must be earlier/u);
});

test("correspondence calendar-event links validate the full batch and return literal idempotent receipts", () => {
  const links = new Set();
  const executions = [];
  const ledgerEvents = [];
  const database = {
    exec(sql) { executions.push(sql); },
    prepare(sql) {
      if (sql.startsWith("SELECT 1 FROM correspondence")) return { get: (id) => id === 9 ? { 1: 1 } : undefined };
      if (sql.startsWith("SELECT 1 FROM calendar_events")) return { get: (id) => id === 17 ? { 1: 1 } : undefined };
      if (sql.startsWith("INSERT INTO calendar_events_correspondence_join")) return { run: (eventId, correspondenceId) => {
        const key = `${eventId}:${correspondenceId}`;
        const changed = links.has(key) ? 0 : 1;
        links.add(key);
        return { changes: changed };
      } };
      if (sql.startsWith("DELETE FROM calendar_events_correspondence_join")) return { run: (eventId, correspondenceId) => ({
        changes: links.delete(`${eventId}:${correspondenceId}`) ? 1 : 0,
      }) };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const service = new CorrespondenceService({
    store: { requireReady: () => database }, ledger: { append: (event) => ledgerEvents.push(event) }, jmap: {},
  });
  const added = service.setCalendarEventLinks({
    links: [{ correspondence_id: 9, calendar_event_id: 17, linked: true }],
  }, { requestId: "request-1", callId: "call-1" });
  assert.deepEqual(added, {
    selected_count: 1, changed_count: 1, unchanged_count: 0,
    results: [{ correspondence_id: 9, calendar_event_id: 17, linked: true, changed: true }],
  });
  const replayed = service.setCalendarEventLinks({
    links: [{ correspondence_id: 9, calendar_event_id: 17, linked: true }],
  });
  assert.equal(replayed.changed_count, 0);
  assert.equal(replayed.unchanged_count, 1);
  assert.equal(ledgerEvents[0].type, "correspondence.calendar_event_links_updated");
  assert.equal(ledgerEvents[0].operationId, "call-1");
  assert.equal(executions.filter((sql) => sql === "START TRANSACTION").length, 2);
  assert.equal(executions.filter((sql) => sql === "COMMIT").length, 2);
  assert.throws(() => service.setCalendarEventLinks({ links: [
    { correspondence_id: 9, calendar_event_id: 17, linked: true },
    { correspondence_id: 9, calendar_event_id: 17, linked: false },
  ] }), /cannot contain the same correspondence and calendar event pair/u);
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
