import { searchJmapEmail } from "../../tools/jmap-email-tools.mjs";

function addressText(addresses) {
  return (addresses ?? []).map(({ name, email }) => name || email).filter(Boolean).join(", ");
}

export class EmailSearchProvider {
  constructor({ client }) {
    this.id = "email";
    this.description = "Live provider-owned email messages and drafts.";
    this.client = client;
    this.capabilities = { phrase: false, proximity: false, snippets: true };
  }

  async search({ query, mode, limit }) {
    const native = await searchJmapEmail(this.client, {
      account_id: null,
      in_mailbox: null,
      in_mailbox_role: null,
      text: query,
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
      limit: Math.min(100, limit),
      result_format: "compact",
    });
    const hasMore = Number(native.total ?? native.messages.length) > native.messages.length;
    return {
      native,
      matchMode: "provider",
      exhaustive: !hasMore,
      hasMore,
      warnings: mode === "terms" ? [] : [
        `Email search uses the provider's native text matching rather than ${mode} matching.`,
      ],
      hits: native.messages.map((message) => ({
        provider: this.id,
        kind: "email_message",
        id: String(message.email_id),
        ref: message.email_ref,
        objectType: "email.message",
        source: "native:email",
        title: message.email_display || "Email message",
        snippet: message.preview || addressText(message.from) || null,
        matchedFields: ["provider_text"],
        occurredAtUtc: message.receivedAt || message.sentAt || null,
        actionRef: { email_id: message.email_id, ref: message.email_ref },
      })),
    };
  }
}
