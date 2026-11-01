import assert from "node:assert/strict";
import test from "node:test";
import { registerJmapEmailTools } from "../src/tools/jmap-email-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

class FakeJmapClient {
  constructor() { this.calls = []; }
  health() { return { ready: true }; }
  resolveAccountId(value) { return value || "account1"; }
  publicSession() { return { selectedAccountId: "account1", accounts: { account1: { name: "Personal" } } }; }
  async call(method, argumentsObject, options = {}) {
    this.calls.push({ method, argumentsObject, options });
    if (method === "Email/query") {
      return { accountId: "account1", queryState: "query-1", canCalculateChanges: true, position: 0, ids: ["email1"], total: 1 };
    }
    if (method === "Email/get") {
      return { accountId: "account1", state: "email-1", list: [{ id: "email1", subject: "Reality" }], notFound: [] };
    }
    if (method === "Mailbox/get") {
      return {
        accountId: "account1", state: "mailbox-1", notFound: [],
        list: [
          { id: "inbox/one", name: "Inbox", role: "inbox" },
          { id: "archive/one", name: "Archive", role: "archive" },
          { id: "trash/one", name: "Trash", role: "trash" },
          { id: "drafts/one", name: "Drafts", role: "drafts" },
          { id: "sent/one", name: "Sent", role: "sent" },
          { id: "receipts/one", name: "Receipts", role: null },
        ],
      };
    }
    if (method === "Identity/get") {
      return { accountId: "account1", state: "identity-1", list: [{ id: "identity1", name: "Owner", email: "owner@example.test" }], notFound: [] };
    }
    if (method === "Email/set") {
      return { accountId: "account1", oldState: "email-1", newState: "email-2", created: { draft: { id: "draft1" } } };
    }
    if (method === "EmailSubmission/set") {
      return { accountId: "account1", oldState: "submission-1", newState: "submission-2", created: { send: { id: "submission1" } } };
    }
    throw new Error(`Unexpected method ${method}`);
  }
  async downloadBlob() {
    return { bytes: new TextEncoder().encode("attachment text"), type: "text/plain" };
  }
}

function harness() {
  const client = new FakeJmapClient();
  const registry = new ToolRegistry();
  registerJmapEmailTools(registry, client);
  return { client, registry };
}

test("JMAP email tool schemas are exact and cover live read/write mail operations", () => {
  const { registry } = harness();
  const definitions = registry.toolDefinitions();
  assert.deepEqual(definitions.map(({ name }) => name), [
    "email_account_list", "email_mailbox_list", "email_identity_list", "email_search",
    "email_get", "email_thread_get", "email_changes", "email_update", "email_bulk_update",
    "email_cleanup_preview", "email_cleanup_apply", "email_draft_create", "email_send",
    "email_submission_get", "email_attachment_get",
  ]);
  for (const definition of definitions) {
    assert.equal(definition.inputSchema.additionalProperties, false);
    assert.equal(definition.source, "local");
  }
  assert.match(definitions.find(({ name }) => name === "email_send").description, /explicitly asks to send/);
});

test("email_search sends RFC 8621 filter names and returns both query and Email states", async () => {
  const { client, registry } = harness();
  const result = await registry.execute("email_search", {
    account_id: null,
    in_mailbox: "inbox1",
    in_mailbox_role: null,
    in_mailbox_name: null,
    message_id: null,
    header_filters: [],
    text: "quarterly plan",
    from: "person@example.test",
    to: null,
    cc: null,
    bcc: null,
    subject: null,
    body: null,
    after_utc: "2026-08-01T00:00:00Z",
    before_utc: null,
    has_attachment: false,
    has_keyword: "$seen",
    not_keyword: "$draft",
    collapse_threads: true,
    sort_property: "receivedAt",
    sort_ascending: false,
    position: 0,
    limit: 25,
    result_format: "compact",
  });
  assert.deepEqual(client.calls[0].argumentsObject.filter, {
    inMailbox: "inbox1",
    text: "quarterly plan",
    from: "person@example.test",
    after: "2026-08-01T00:00:00Z",
    hasAttachment: false,
    hasKeyword: "$seen",
    notKeyword: "$draft",
  });
  assert.equal(result.queryState, "query-1");
  assert.equal(result.emailState, "email-1");
  assert.equal(result.resultFormat, "compact");
  assert.equal(result.messages[0].subject, "Reality");
  assert.deepEqual({
    id: result.messages[0].email_id,
    ref: result.messages[0].email_ref,
    display: result.messages[0].email_display,
  }, { id: "email1", ref: "agent-slayer://emails/email1", display: "Reality" });
});

test("email_search enforces its visible result limit before calling JMAP", async () => {
  const { client, registry } = harness();
  await assert.rejects(
    registry.execute("email_search", {
      account_id: null,
      in_mailbox: null,
      in_mailbox_role: "inbox",
      in_mailbox_name: null,
      message_id: null,
      header_filters: [],
      text: null,
      from: null,
      to: null,
      cc: null,
      bcc: null,
      subject: null,
      body: null,
      after_utc: null,
      before_utc: null,
      has_attachment: null,
      has_keyword: null,
      not_keyword: null,
      collapse_threads: false,
      sort_property: "receivedAt",
      sort_ascending: false,
      position: 0,
      limit: 160,
      result_format: "compact",
    }),
    /limit must be at most 100/,
  );
  assert.equal(client.calls.length, 0);
});

test("email_search resolves a mailbox name and verifies Message-ID after bounded header search", async () => {
  class HeaderSearchClient extends FakeJmapClient {
    async call(method, argumentsObject, options = {}) {
      if (method === "Email/get") {
        this.calls.push({ method, argumentsObject, options });
        return {
          accountId: "account1", state: "email-1", notFound: [],
          list: [{
            id: "email1", subject: "October invoice",
            messageId: ["invoice-123@example.test"],
          }],
        };
      }
      return super.call(method, argumentsObject, options);
    }
  }
  const client = new HeaderSearchClient();
  const registry = new ToolRegistry();
  registerJmapEmailTools(registry, client);
  const searchInput = {
    account_id: null,
    in_mailbox: null,
    in_mailbox_role: null,
    in_mailbox_name: "receipts",
    message_id: "Message-ID: <invoice-123@example.test>",
    header_filters: [{ name: "List-Id", value: "billing.example.test" }],
    text: null,
    from: "billing@example.test",
    to: null,
    cc: null,
    bcc: null,
    subject: "October invoice",
    body: null,
    after_utc: null,
    before_utc: null,
    has_attachment: null,
    has_keyword: null,
    not_keyword: null,
    collapse_threads: false,
    sort_property: "receivedAt",
    sort_ascending: false,
    position: 0,
    limit: 25,
    result_format: "compact",
  };
  const result = await registry.execute("email_search", searchInput);
  const query = client.calls.find(({ method }) => method === "Email/query");
  assert.deepEqual(query.argumentsObject.filter, {
    operator: "AND",
    conditions: [
      { inMailbox: "receipts/one", from: "billing@example.test", subject: "October invoice" },
      { header: ["Message-ID", "invoice-123@example.test"] },
      { header: ["List-Id", "billing.example.test"] },
    ],
  });
  const get = client.calls.find(({ method }) => method === "Email/get");
  assert.equal(get.argumentsObject.properties.includes("messageId"), true);
  assert.equal(result.resolvedMailboxId, "receipts/one");
  assert.equal(result.resolvedMailboxName, "Receipts");
  assert.equal(result.messages[0].email_id, "email1");
  assert.deepEqual(result.messageIdResolution, {
    requested: "invoice-123@example.test",
    providerCandidateCount: 1,
    inspectedCount: 1,
    exactMatchCount: 1,
    complete: true,
    status: "resolved",
  });

  client.calls.length = 0;
  await assert.rejects(
    registry.execute("email_search", { ...searchInput, collapse_threads: true }),
    /collapse_threads must be false/u,
  );
  await assert.rejects(
    registry.execute("email_search", { ...searchInput, position: 1 }),
    /position must be 0/u,
  );
  assert.equal(client.calls.length, 0);
});

test("email_search reports ambiguous exact Message-ID matches and rejects ambiguous mailbox names", async () => {
  class AmbiguousClient extends FakeJmapClient {
    async call(method, argumentsObject, options = {}) {
      this.calls.push({ method, argumentsObject, options });
      if (method === "Email/query") {
        return {
          accountId: "account1", queryState: "query-1", canCalculateChanges: true,
          position: 0, ids: ["email1", "email2"], total: 2,
        };
      }
      if (method === "Email/get") {
        return {
          accountId: "account1", state: "email-1", notFound: [],
          list: [
            { id: "email1", subject: "First", messageId: ["duplicate@example.test"] },
            { id: "email2", subject: "Second", messageId: ["duplicate@example.test"] },
          ],
        };
      }
      if (method === "Mailbox/get") {
        return {
          accountId: "account1", state: "mailbox-1", notFound: [],
          list: [
            { id: "projects/one", name: "Projects", parentId: null },
            { id: "projects/two", name: "Projects", parentId: "archive/one" },
          ],
        };
      }
      throw new Error(`Unexpected method ${method}`);
    }
  }
  const client = new AmbiguousClient();
  const registry = new ToolRegistry();
  registerJmapEmailTools(registry, client);
  const base = {
    account_id: null,
    in_mailbox: null,
    in_mailbox_role: null,
    in_mailbox_name: null,
    message_id: "duplicate@example.test",
    header_filters: [],
    text: null,
    from: null,
    to: null,
    cc: null,
    bcc: null,
    subject: null,
    body: null,
    after_utc: null,
    before_utc: null,
    has_attachment: null,
    has_keyword: null,
    not_keyword: null,
    collapse_threads: false,
    sort_property: "receivedAt",
    sort_ascending: false,
    position: 0,
    limit: 25,
    result_format: "ids",
  };
  const result = await registry.execute("email_search", base);
  assert.equal(result.messages.length, 2);
  assert.equal(result.messageIdResolution.status, "ambiguous");
  assert.equal(result.messageIdResolution.exactMatchCount, 2);

  await assert.rejects(
    registry.execute("email_search", { ...base, message_id: null, in_mailbox_name: "Projects" }),
    /mailbox name "Projects" is ambiguous/u,
  );
  assert.equal(client.calls.filter(({ method }) => method === "Email/query").length, 1);
});

test("email_search excludes provider header candidates that fail exact Message-ID verification", async () => {
  class InexactHeaderClient extends FakeJmapClient {
    async call(method, argumentsObject, options = {}) {
      this.calls.push({ method, argumentsObject, options });
      if (method === "Email/query") {
        return {
          accountId: "account1", queryState: "query-1", canCalculateChanges: true,
          position: 0, ids: ["email1"], total: 1,
        };
      }
      if (method === "Email/get") {
        return {
          accountId: "account1", state: "email-1", notFound: [],
          list: [{ id: "email1", subject: "Fuzzy candidate", messageId: ["other@example.test"] }],
        };
      }
      throw new Error(`Unexpected method ${method}`);
    }
  }
  const client = new InexactHeaderClient();
  const registry = new ToolRegistry();
  registerJmapEmailTools(registry, client);
  const result = await registry.execute("email_search", {
    account_id: null,
    in_mailbox: null,
    in_mailbox_role: null,
    in_mailbox_name: null,
    message_id: "wanted@example.test",
    header_filters: [],
    text: null,
    from: null,
    to: null,
    cc: null,
    bcc: null,
    subject: null,
    body: null,
    after_utc: null,
    before_utc: null,
    has_attachment: null,
    has_keyword: null,
    not_keyword: null,
    collapse_threads: false,
    sort_property: "receivedAt",
    sort_ascending: false,
    position: 0,
    limit: 25,
    result_format: "compact",
  });
  assert.deepEqual(result.messages, []);
  assert.equal(result.messageIdResolution.status, "not_found");
  assert.equal(result.messageIdResolution.providerCandidateCount, 1);
  assert.equal(result.messageIdResolution.exactMatchCount, 0);
});

test("bulk updates and saved cleanup selections use one recoverable JMAP write", async () => {
  const { client, registry } = harness();
  const preview = await registry.execute("email_cleanup_preview", {
    account_id: null,
    in_mailbox_id: null,
    match_all: false,
    match_any: [{
      from: "facebookmail.com", text: null, subject: null, after_utc: null, before_utc: null,
    }],
    exclude_any: [],
    max_results: 100,
  });
  assert.equal(preview.selectedCount, 1);
  assert.ok(preview.selectionId);

  client.calls.length = 0;
  const applied = await registry.execute("email_cleanup_apply", {
    account_id: null,
    selection_id: null,
    expected_count: 1,
    action: "trash",
  });
  assert.equal(applied.affectedCount, 1);
  const cleanupWrite = client.calls.find(({ method }) => method === "Email/set");
  assert.equal(cleanupWrite.argumentsObject.ifInState, "email-1");
  assert.deepEqual(cleanupWrite.argumentsObject.update, {
    email1: { mailboxIds: { "trash/one": true } },
  });

  client.calls.length = 0;
  const bulk = await registry.execute("email_bulk_update", {
    account_id: null,
    email_ids: ["email1", "email2"],
    if_in_state: "email-2",
    action: "mark_read",
  });
  assert.equal(bulk.affectedCount, 2);
  const bulkWrite = client.calls.find(({ method }) => method === "Email/set");
  assert.deepEqual(bulkWrite.argumentsObject.update, {
    email1: { "keywords/$seen": true },
    email2: { "keywords/$seen": true },
  });

  client.calls.length = 0;
  const restored = await registry.execute("email_bulk_update", {
    account_id: null,
    email_ids: ["email1", "email2"],
    if_in_state: "email-2",
    action: "restore_to_inbox",
  });
  assert.equal(restored.affectedCount, 2);
  const restoreWrite = client.calls.find(({ method }) => method === "Email/set");
  assert.deepEqual(restoreWrite.argumentsObject.update, {
    email1: { "mailboxIds/trash~1one": null, "mailboxIds/inbox~1one": true },
    email2: { "mailboxIds/trash~1one": null, "mailboxIds/inbox~1one": true },
  });

  client.calls.length = 0;
  await registry.execute("email_bulk_update", {
    account_id: null,
    email_ids: ["email1"],
    if_in_state: "email-2",
    action: "archive",
  });
  const archiveWrite = client.calls.find(({ method }) => method === "Email/set");
  assert.deepEqual(archiveWrite.argumentsObject.update, {
    email1: {
      "mailboxIds/inbox~1one": null,
      "mailboxIds/trash~1one": null,
      "mailboxIds/archive~1one": true,
    },
  });
});

test("whole-Inbox cleanup paginates large previews and server-sized writes inside two model tools", async () => {
  class LargeInboxClient extends FakeJmapClient {
    constructor() {
      super();
      this.ids = Array.from({ length: 160 }, (_, index) => `email-${index + 1}`);
      this.setCount = 0;
    }
    publicSession() {
      return { capabilities: { "urn:ietf:params:jmap:core": { maxObjectsInGet: 100, maxObjectsInSet: 100 } } };
    }
    async call(method, argumentsObject, options = {}) {
      this.calls.push({ method, argumentsObject, options });
      if (method === "Mailbox/get") {
        return { accountId: "account1", state: "mailbox-1", notFound: [], list: [
          { id: "inbox/one", role: "inbox" }, { id: "trash/one", role: "trash" },
        ] };
      }
      if (method === "Email/query") {
        return {
          accountId: "account1",
          queryState: "query-1",
          position: argumentsObject.position,
          ids: this.ids.slice(argumentsObject.position, argumentsObject.position + argumentsObject.limit),
          total: this.ids.length,
        };
      }
      if (method === "Email/get") {
        return {
          accountId: "account1",
          state: "email-1",
          list: argumentsObject.ids.map((id) => ({ id, subject: id })),
          notFound: [],
        };
      }
      if (method === "Email/set") {
        this.setCount += 1;
        return {
          accountId: "account1",
          oldState: this.setCount === 1 ? "email-1" : "email-2",
          newState: `email-${this.setCount + 1}`,
        };
      }
      throw new Error(`Unexpected method ${method}`);
    }
  }
  const client = new LargeInboxClient();
  const registry = new ToolRegistry();
  registerJmapEmailTools(registry, client);
  const preview = await registry.execute("email_cleanup_preview", {
    account_id: null,
    in_mailbox_id: null,
    match_all: true,
    match_any: [],
    exclude_any: [],
    max_results: 250,
  });
  assert.equal(preview.selectedCount, 160);
  assert.equal(client.calls.filter(({ method }) => method === "Email/query").length, 2);
  assert.equal(client.calls.filter(({ method }) => method === "Email/get").length, 2);

  client.calls.length = 0;
  const applied = await registry.execute("email_cleanup_apply", {
    account_id: null,
    selection_id: null,
    expected_count: 160,
    action: "trash",
  });
  assert.equal(applied.affectedCount, 160);
  const writes = client.calls.filter(({ method }) => method === "Email/set");
  assert.equal(writes.length, 2);
  assert.equal(Object.keys(writes[0].argumentsObject.update).length, 100);
  assert.equal(Object.keys(writes[1].argumentsObject.update).length, 60);
  assert.equal(writes[1].argumentsObject.ifInState, "email-2");
});

test("draft creation builds MIME alternatives and sending moves Drafts to Sent", async () => {
  const { client, registry } = harness();
  const draft = await registry.execute("email_draft_create", {
    account_id: null,
    if_in_state: "email-1",
    replace_draft_email_id: "old-draft",
    drafts_mailbox_id: null,
    identity_id: "identity1",
    from: null,
    to: [{ name: "Recipient", email: "recipient@example.test" }],
    cc: null,
    bcc: null,
    reply_to: null,
    subject: "A complete draft",
    text_body: "Plain body",
    html_body: "<p>HTML body</p>",
    in_reply_to_message_ids: ["original@example.test"],
    reference_message_ids: ["root@example.test", "original@example.test"],
    attachments: [{ blob_id: "blob1", type: "application/pdf", name: "report.pdf", disposition: "attachment", cid: null }],
  });
  assert.equal(draft.created.draft.id, "draft1");
  assert.deepEqual({
    id: draft.created.draft.email_id,
    ref: draft.created.draft.email_ref,
    display: draft.created.draft.email_display,
  }, { id: "draft1", ref: "agent-slayer://emails/draft1", display: "A complete draft" });
  const createCall = client.calls.find(({ method }) => method === "Email/set");
  const created = createCall.argumentsObject.create.draft;
  assert.deepEqual(created.mailboxIds, { "drafts/one": true });
  assert.deepEqual(createCall.argumentsObject.destroy, ["old-draft"]);
  assert.equal(created.bodyStructure.type, "multipart/mixed");
  assert.equal(created.bodyStructure.subParts[0].type, "multipart/alternative");
  assert.equal(created.bodyStructure.subParts[1].blobId, "blob1");
  assert.equal(created["header:In-Reply-To:asMessageIds"][0], "original@example.test");

  client.calls.length = 0;
  const sent = await registry.execute("email_send", {
    account_id: null,
    email_id: "draft1",
    identity_id: "identity1",
    if_in_state: "submission-1",
    send_at_utc: null,
    drafts_mailbox_id: null,
    sent_mailbox_id: null,
  });
  assert.equal(sent.created.send.id, "submission1");
  const sendCall = client.calls.find(({ method }) => method === "EmailSubmission/set");
  assert.deepEqual(sendCall.argumentsObject.onSuccessUpdateEmail["#send"], {
    "mailboxIds/drafts~1one": null,
    "mailboxIds/sent~1one": true,
    "keywords/$draft": null,
  });
});

test("attachment reads preserve text content within the requested boundary", async () => {
  const { registry } = harness();
  const result = await registry.execute("email_attachment_get", {
    account_id: null,
    blob_id: "blob1",
    name: "note.txt",
    type: "text/plain",
    max_bytes: 100,
  });
  assert.equal(result.encoding, "utf8");
  assert.equal(result.content, "attachment text");
  assert.equal(result.byteSize, 15);
  assert.equal(result.blob_id, "blob1");
  assert.equal(result.blob_ref, "agent-slayer://email-blobs/blob1");
  assert.equal(result.blob_display, "note.txt");
});

test("account, mailbox, and sending-identity reads return complete bindings", async () => {
  const { registry } = harness();
  const accounts = await registry.execute("email_account_list", {});
  assert.deepEqual(Object.values(accounts.accounts).map((item) => ({
    id: item.account_id, ref: item.account_ref, display: item.account_display,
  })), [{ id: "account1", ref: "agent-slayer://email-accounts/account1", display: "Personal" }]);

  const mailboxes = await registry.execute("email_mailbox_list", {
    account_id: null, mailbox_ids: null,
  });
  assert.deepEqual({
    id: mailboxes.list[0].mailbox_id,
    ref: mailboxes.list[0].mailbox_ref,
    display: mailboxes.list[0].mailbox_name,
  }, { id: "inbox/one", ref: "agent-slayer://email-mailboxes/inbox%2Fone", display: "Inbox" });

  const identities = await registry.execute("email_identity_list", {
    account_id: null, identity_ids: null,
  });
  assert.deepEqual({
    id: identities.list[0].identity_id,
    ref: identities.list[0].identity_ref,
    display: identities.list[0].identity_display,
  }, {
    id: "identity1", ref: "agent-slayer://email-identities/identity1",
    display: "Owner <owner@example.test>",
  });
});
