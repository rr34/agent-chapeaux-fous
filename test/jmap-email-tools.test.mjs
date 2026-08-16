import assert from "node:assert/strict";
import test from "node:test";
import { registerJmapEmailTools } from "../src/tools/jmap-email-tools.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";

class FakeJmapClient {
  constructor() { this.calls = []; }
  health() { return { ready: true }; }
  resolveAccountId(value) { return value || "account1"; }
  publicSession() { return { selectedAccountId: "account1", accounts: { account1: {} } }; }
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
        list: [{ id: "drafts/one", role: "drafts" }, { id: "sent/one", role: "sent" }],
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
    "email_get", "email_thread_get", "email_changes", "email_update", "email_draft_create",
    "email_send", "email_submission_get", "email_attachment_get",
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
  assert.equal(result.messages[0].subject, "Reality");
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
});
