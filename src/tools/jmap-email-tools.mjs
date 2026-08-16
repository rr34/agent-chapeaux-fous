import { randomUUID } from "node:crypto";
import { JMAP_CAPABILITIES } from "../jmap-client.mjs";

const { core: CORE, mail: MAIL, submission: SUBMISSION } = JMAP_CAPABILITIES;
const nullableString = { type: ["string", "null"] };
const nullableBoolean = { type: ["boolean", "null"] };
const nullableInteger = { type: ["integer", "null"] };
const nullableStringArray = { type: ["array", "null"], items: { type: "string" } };
const address = {
  type: "object",
  additionalProperties: false,
  properties: { name: nullableString, email: { type: "string", minLength: 3 } },
  required: ["name", "email"],
};
const nullableAddresses = { type: ["array", "null"], items: address };

const summaryProperties = [
  "id", "blobId", "threadId", "mailboxIds", "keywords", "size", "receivedAt",
  "messageId", "inReplyTo", "references", "sender", "from", "to", "cc", "bcc",
  "replyTo", "subject", "sentAt", "hasAttachment", "preview",
];
const compactSummaryProperties = [
  "id", "threadId", "mailboxIds", "keywords", "size", "receivedAt", "from",
  "subject", "sentAt", "hasAttachment", "preview",
];
const completeProperties = [
  ...summaryProperties, "bodyStructure", "bodyValues", "textBody", "htmlBody", "attachments",
];
const mailboxRoles = ["inbox", "archive", "drafts", "sent", "trash", "spam"];
const cleanupCriterion = {
  type: "object",
  additionalProperties: false,
  properties: {
    from: nullableString,
    text: nullableString,
    subject: nullableString,
    after_utc: nullableString,
    before_utc: nullableString,
  },
  required: ["from", "text", "subject", "after_utc", "before_utc"],
};

function account(client, value, capability = MAIL) {
  return client.resolveAccountId(value, capability);
}

function using(capability = MAIL) {
  return capability === SUBMISSION ? [CORE, MAIL, SUBMISSION] : [CORE, MAIL];
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value != null));
}

function patchSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function boundedInteger(value, fallback, minimum, maximum, name) {
  const result = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return result;
}

function getArguments(accountId, ids, bodyMode = "none", maximumBytes = 100_000, properties = null) {
  return {
    accountId,
    ids,
    properties: properties ?? (bodyMode === "none" ? summaryProperties : completeProperties),
    fetchTextBodyValues: bodyMode === "text" || bodyMode === "all",
    fetchHTMLBodyValues: bodyMode === "html" || bodyMode === "all",
    fetchAllBodyValues: bodyMode === "all",
    maxBodyValueBytes: maximumBytes,
  };
}

async function identities(client, accountId) {
  return client.call("Identity/get", { accountId, ids: null }, { using: using(SUBMISSION) });
}

async function mailboxes(client, accountId) {
  return client.call("Mailbox/get", { accountId, ids: null });
}

async function mailboxForRole(client, accountId, role) {
  const result = await mailboxes(client, accountId);
  const mailbox = result.list.find((item) => item.role === role);
  if (!mailbox) throw new Error(`No JMAP mailbox with the ${role} role exists`);
  return mailbox;
}

function criterionFilter(criterion, inMailbox) {
  const filter = compact({
    inMailbox,
    from: criterion.from,
    text: criterion.text,
    subject: criterion.subject,
    after: criterion.after_utc,
    before: criterion.before_utc,
  });
  if (Object.keys(filter).length === 1) throw new Error("Each cleanup match must include a sender, text, subject, or date boundary");
  return filter;
}

async function queryIds(client, accountId, filter, limit) {
  const ids = [];
  let total = 0;
  while (ids.length < limit) {
    const pageSize = Math.min(100, limit - ids.length);
    const result = await client.call("Email/query", {
      accountId,
      filter,
      sort: [{ property: "receivedAt", isAscending: false }],
      collapseThreads: false,
      position: ids.length,
      limit: pageSize,
      calculateTotal: ids.length === 0,
    });
    if (ids.length === 0) total = result.total;
    ids.push(...result.ids);
    if (result.ids.length < pageSize || ids.length >= total) break;
  }
  return { ids, total };
}

async function compactMessages(client, accountId, ids) {
  const advertisedLimit = Number(client.publicSession()?.capabilities?.[CORE]?.maxObjectsInGet);
  const batchSize = Number.isSafeInteger(advertisedLimit) && advertisedLimit > 0 ? advertisedLimit : 100;
  const list = [];
  const notFound = [];
  let state = null;
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const result = await client.call("Email/get", getArguments(
      accountId, ids.slice(offset, offset + batchSize), "none", 100_000, compactSummaryProperties,
    ));
    if (state && result.state !== state) {
      throw new Error("Email state changed while building the cleanup preview; retry the preview");
    }
    state = result.state;
    list.push(...result.list);
    notFound.push(...result.notFound);
  }
  return { accountId, state, list, notFound };
}

async function emailAction(client, {
  accountId, emailIds, action, ifInState = null, inboxId = null,
}) {
  let patch;
  if (action === "trash") {
    const trash = await mailboxForRole(client, accountId, "trash");
    patch = { mailboxIds: { [trash.id]: true } };
  } else if (action === "archive") {
    const inbox = inboxId ? { id: inboxId } : await mailboxForRole(client, accountId, "inbox");
    const archive = await mailboxForRole(client, accountId, "archive");
    patch = {
      [`mailboxIds/${patchSegment(inbox.id)}`]: null,
      [`mailboxIds/${patchSegment(archive.id)}`]: true,
    };
  } else if (action === "mark_read") {
    patch = { "keywords/$seen": true };
  } else if (action === "mark_unread") {
    patch = { "keywords/$seen": null };
  } else {
    throw new Error(`Unsupported email action: ${action}`);
  }
  const advertisedLimit = Number(client.publicSession()?.capabilities?.[CORE]?.maxObjectsInSet);
  const batchSize = Number.isSafeInteger(advertisedLimit) && advertisedLimit > 0 ? advertisedLimit : 100;
  const batches = [];
  let state = ifInState;
  for (let offset = 0; offset < emailIds.length; offset += batchSize) {
    const ids = emailIds.slice(offset, offset + batchSize);
    const update = Object.fromEntries(ids.map((id) => [id, patch]));
    const result = await client.call("Email/set", compact({ accountId, ifInState: state, update }));
    if (findSetFailures(result)) throw new Error(`Bulk email mutation was rejected: ${JSON.stringify(result)}`);
    batches.push(result);
    state = result.newState ?? state;
  }
  return {
    accountId,
    oldState: ifInState,
    newState: state,
    batchCount: batches.length,
    batches,
  };
}

function addressList(value) {
  return value == null ? null : value.map(({ name, email }) => ({ name, email }));
}

function bodyForDraft(textBody, htmlBody, attachments) {
  const bodyValues = {};
  const alternatives = [];
  if (textBody != null) {
    alternatives.push({ partId: "text", type: "text/plain" });
    bodyValues.text = { value: textBody, isTruncated: false };
  }
  if (htmlBody != null) {
    alternatives.push({ partId: "html", type: "text/html" });
    bodyValues.html = { value: htmlBody, isTruncated: false };
  }
  if (!alternatives.length) throw new Error("A draft requires text_body or html_body");
  const content = alternatives.length === 1
    ? alternatives[0]
    : { type: "multipart/alternative", subParts: alternatives };
  const attachmentParts = (attachments ?? []).map((item) => compact({
    blobId: item.blob_id,
    type: item.type,
    name: item.name,
    disposition: item.disposition,
    cid: item.cid,
  }));
  return {
    bodyStructure: attachmentParts.length
      ? { type: "multipart/mixed", subParts: [content, ...attachmentParts] }
      : content,
    bodyValues,
  };
}

function findSetFailures(result) {
  return Object.keys(result.notCreated ?? {}).length
    || Object.keys(result.notUpdated ?? {}).length
    || Object.keys(result.notDestroyed ?? {}).length;
}

export function registerJmapEmailTools(registry, client) {
  if (!client.health().ready) throw new Error("Cannot register JMAP email tools before the client is ready");
  const cleanupSelections = new Map();
  const cleanupLifetimeMs = 30 * 60 * 1000;

  function pruneCleanupSelections() {
    const now = Date.now();
    for (const [id, selection] of cleanupSelections) {
      if (selection.expiresAtMs <= now) cleanupSelections.delete(id);
    }
    while (cleanupSelections.size > 50) cleanupSelections.delete(cleanupSelections.keys().next().value);
  }

  registry.register({
    name: "email_account_list",
    description: "Inspect the live JMAP session, its mail accounts, selected primary account, and advertised capabilities. Credentials and provider endpoints are never returned.",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { return client.publicSession(); },
  });

  registry.register({
    name: "email_mailbox_list",
    description: "List every live JMAP mailbox with its stable id, role, hierarchy, rights, sort order, subscription state, and current message/thread counts.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { account_id: nullableString, mailbox_ids: nullableStringArray },
      required: ["account_id", "mailbox_ids"],
    },
    async execute({ account_id, mailbox_ids }) {
      const accountId = account(client, account_id);
      return client.call("Mailbox/get", { accountId, ids: mailbox_ids });
    },
  });

  registry.register({
    name: "email_identity_list",
    description: "List the live JMAP sending identities, including addresses, reply-to settings, Bcc settings, signatures, and stable identity ids needed for submission.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { account_id: nullableString, identity_ids: nullableStringArray },
      required: ["account_id", "identity_ids"],
    },
    async execute({ account_id, identity_ids }) {
      const accountId = account(client, account_id, SUBMISSION);
      return client.call("Identity/get", { accountId, ids: identity_ids }, { using: using(SUBMISSION) });
    },
  });

  registry.register({
    name: "email_search",
    description: "Search the live JMAP mail store and return bounded ids, compact summaries, or full metadata plus exact query and Email state tokens. All non-null filters are combined. Prefer compact for inbox triage and full only when complete headers are needed. A mailbox role can be resolved without listing all mailboxes.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        account_id: nullableString,
        in_mailbox: nullableString,
        in_mailbox_role: { type: ["string", "null"], enum: [...mailboxRoles, null] },
        text: nullableString,
        from: nullableString,
        to: nullableString,
        cc: nullableString,
        bcc: nullableString,
        subject: nullableString,
        body: nullableString,
        after_utc: nullableString,
        before_utc: nullableString,
        has_attachment: nullableBoolean,
        has_keyword: nullableString,
        not_keyword: nullableString,
        collapse_threads: { type: "boolean" },
        sort_property: { type: "string", enum: ["receivedAt", "sentAt", "size", "from", "to", "subject"] },
        sort_ascending: { type: "boolean" },
        position: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        result_format: { type: "string", enum: ["ids", "compact", "full"] },
      },
      required: [
        "account_id", "in_mailbox", "in_mailbox_role", "text", "from", "to", "cc", "bcc", "subject", "body",
        "after_utc", "before_utc", "has_attachment", "has_keyword", "not_keyword",
        "collapse_threads", "sort_property", "sort_ascending", "position", "limit", "result_format",
      ],
    },
    async execute(input) {
      const accountId = account(client, input.account_id);
      if (input.in_mailbox && input.in_mailbox_role) {
        throw new Error("Supply in_mailbox or in_mailbox_role, not both");
      }
      const inMailbox = input.in_mailbox_role
        ? (await mailboxForRole(client, accountId, input.in_mailbox_role)).id
        : input.in_mailbox;
      const filter = compact({
        inMailbox,
        text: input.text,
        from: input.from,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        body: input.body,
        after: input.after_utc,
        before: input.before_utc,
        hasAttachment: input.has_attachment,
        hasKeyword: input.has_keyword,
        notKeyword: input.not_keyword,
      });
      const query = await client.call("Email/query", {
        accountId,
        filter,
        sort: [{ property: input.sort_property, isAscending: input.sort_ascending }],
        collapseThreads: input.collapse_threads,
        position: boundedInteger(input.position, 0, 0, Number.MAX_SAFE_INTEGER, "position"),
        limit: boundedInteger(input.limit, 25, 1, 100, "limit"),
        calculateTotal: true,
      });
      const messages = query.ids.length
        ? await client.call("Email/get", getArguments(
          accountId,
          query.ids,
          "none",
          100_000,
          input.result_format === "ids"
            ? ["id"]
            : input.result_format === "compact" ? compactSummaryProperties : summaryProperties,
        ))
        : { accountId, state: null, list: [], notFound: [] };
      return {
        ...query,
        resolvedMailboxId: inMailbox ?? null,
        resultFormat: input.result_format,
        emailState: messages.state,
        messages: messages.list,
        notFound: messages.notFound,
      };
    },
  });

  registry.register({
    name: "email_get",
    description: "Fetch live JMAP messages by stable ids. Body mode none returns metadata and parsed standard headers; text, html, and all also return the full MIME structure, attachment metadata, and selected bounded decoded body values. Use the message blobId with email_attachment_get for the exact raw RFC 5322 message and all raw headers.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        account_id: nullableString,
        email_ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        body_mode: { type: "string", enum: ["none", "text", "html", "all"] },
        max_body_value_bytes: { type: "integer", minimum: 1, maximum: 1_000_000 },
      },
      required: ["account_id", "email_ids", "body_mode", "max_body_value_bytes"],
    },
    async execute({ account_id, email_ids, body_mode, max_body_value_bytes }) {
      const accountId = account(client, account_id);
      return client.call("Email/get", getArguments(
        accountId, email_ids, body_mode,
        boundedInteger(max_body_value_bytes, 100_000, 1, 1_000_000, "max_body_value_bytes"),
      ));
    },
  });

  registry.register({
    name: "email_thread_get",
    description: "Fetch complete live JMAP threads by thread id, then return every message in each thread in chronological server order with bounded decoded bodies.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        account_id: nullableString,
        thread_ids: { type: "array", minItems: 1, maxItems: 50, items: { type: "string" } },
        body_mode: { type: "string", enum: ["none", "text", "html", "all"] },
        max_body_value_bytes: { type: "integer", minimum: 1, maximum: 1_000_000 },
      },
      required: ["account_id", "thread_ids", "body_mode", "max_body_value_bytes"],
    },
    async execute({ account_id, thread_ids, body_mode, max_body_value_bytes }) {
      const accountId = account(client, account_id);
      const threads = await client.call("Thread/get", { accountId, ids: thread_ids });
      const ids = [...new Set(threads.list.flatMap((thread) => thread.emailIds))];
      const messages = ids.length
        ? await client.call("Email/get", getArguments(accountId, ids, body_mode, max_body_value_bytes))
        : { state: null, list: [], notFound: [] };
      const byId = new Map(messages.list.map((message) => [message.id, message]));
      return {
        accountId,
        threadState: threads.state,
        emailState: messages.state,
        threads: threads.list.map((thread) => ({
          ...thread,
          messages: thread.emailIds.map((id) => byId.get(id)).filter(Boolean),
        })),
        notFoundThreads: threads.notFound,
        notFoundEmails: messages.notFound,
      };
    },
  });

  registry.register({
    name: "email_changes",
    description: "Read authoritative JMAP changes since a prior state token for Email, Thread, Mailbox, Identity, or EmailSubmission. Paginate with newState while hasMoreChanges is true.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        account_id: nullableString,
        object_type: { type: "string", enum: ["Email", "Thread", "Mailbox", "Identity", "EmailSubmission"] },
        since_state: { type: "string", minLength: 1 },
        max_changes: nullableInteger,
        fetch_created_and_updated: { type: "boolean" },
      },
      required: ["account_id", "object_type", "since_state", "max_changes", "fetch_created_and_updated"],
    },
    async execute({ account_id, object_type, since_state, max_changes, fetch_created_and_updated }) {
      const capability = ["Identity", "EmailSubmission"].includes(object_type) ? SUBMISSION : MAIL;
      const accountId = account(client, account_id, capability);
      const changes = await client.call(`${object_type}/changes`, compact({
        accountId,
        sinceState: since_state,
        maxChanges: max_changes == null ? null : boundedInteger(max_changes, 100, 1, 10_000, "max_changes"),
      }), { using: using(capability) });
      if (!fetch_created_and_updated) return changes;
      const ids = [...new Set([...(changes.created ?? []), ...(changes.updated ?? [])])];
      if (!ids.length) return { ...changes, current: [] };
      const current = await client.call(`${object_type}/get`, object_type === "Email"
        ? getArguments(accountId, ids)
        : { accountId, ids }, { using: using(capability) });
      return { ...changes, current: current.list, notFound: current.notFound };
    },
  });

  registry.register({
    name: "email_update",
    description: "Mutate one live JMAP message: replace/add/remove mailbox membership or keywords, or permanently destroy it. Supply if_in_state from a recent Email read to reject stale writes; use null only when the user accepts last-write-wins behavior.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        account_id: nullableString,
        email_id: { type: "string", minLength: 1 },
        if_in_state: nullableString,
        replace_mailbox_ids: nullableStringArray,
        add_mailbox_ids: { type: "array", items: { type: "string" } },
        remove_mailbox_ids: { type: "array", items: { type: "string" } },
        replace_keywords: nullableStringArray,
        add_keywords: { type: "array", items: { type: "string" } },
        remove_keywords: { type: "array", items: { type: "string" } },
        destroy: { type: "boolean" },
      },
      required: [
        "account_id", "email_id", "if_in_state", "replace_mailbox_ids", "add_mailbox_ids",
        "remove_mailbox_ids", "replace_keywords", "add_keywords", "remove_keywords", "destroy",
      ],
    },
    async execute(input) {
      const accountId = account(client, input.account_id);
      if (input.destroy && (
        input.replace_mailbox_ids || input.add_mailbox_ids.length || input.remove_mailbox_ids.length
        || input.replace_keywords || input.add_keywords.length || input.remove_keywords.length
      )) throw new Error("A permanent destroy cannot be combined with updates");
      const patch = {};
      if (input.replace_mailbox_ids) patch.mailboxIds = Object.fromEntries(input.replace_mailbox_ids.map((id) => [id, true]));
      else {
        for (const id of input.add_mailbox_ids) patch[`mailboxIds/${patchSegment(id)}`] = true;
        for (const id of input.remove_mailbox_ids) patch[`mailboxIds/${patchSegment(id)}`] = null;
      }
      if (input.replace_keywords) patch.keywords = Object.fromEntries(input.replace_keywords.map((keyword) => [keyword, true]));
      else {
        for (const keyword of input.add_keywords) patch[`keywords/${patchSegment(keyword)}`] = true;
        for (const keyword of input.remove_keywords) patch[`keywords/${patchSegment(keyword)}`] = null;
      }
      if (!input.destroy && !Object.keys(patch).length) throw new Error("No email mutation was requested");
      const result = await client.call("Email/set", compact({
        accountId,
        ifInState: input.if_in_state,
        update: input.destroy ? null : { [input.email_id]: patch },
        destroy: input.destroy ? [input.email_id] : null,
      }));
      if (findSetFailures(result)) throw new Error(`Email mutation was rejected: ${JSON.stringify(result)}`);
      return result;
    },
  });

  registry.register({
    name: "email_bulk_update",
    description: "Apply one recoverable inbox action to as many as 100 explicit live email ids in a single optimistic JMAP write. Use trash instead of permanent destruction for ordinary delete requests. Prefer email_cleanup_preview and email_cleanup_apply when the candidate set comes from several senders or search phrases.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        account_id: nullableString,
        email_ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "string", minLength: 1 } },
        if_in_state: nullableString,
        action: { type: "string", enum: ["trash", "archive", "mark_read", "mark_unread"] },
      },
      required: ["account_id", "email_ids", "if_in_state", "action"],
    },
    async execute({ account_id, email_ids, if_in_state, action }) {
      const accountId = account(client, account_id);
      const uniqueIds = [...new Set(email_ids)];
      const result = await emailAction(client, {
        accountId, emailIds: uniqueIds, action, ifInState: if_in_state,
      });
      return { action, affectedCount: uniqueIds.length, emailIds: uniqueIds, result };
    },
  });

  registry.register({
    name: "email_cleanup_preview",
    description: "Build and temporarily save an exact compact Inbox cleanup selection of up to 250 messages from several OR-matched sender/text/subject/date criteria, with optional OR-matched exclusions. This is read-only. Use one preview instead of repeating many email_search calls. Set match_all=true only when the user explicitly wants every Inbox message considered.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        account_id: nullableString,
        in_mailbox_id: nullableString,
        match_all: { type: "boolean" },
        match_any: { type: "array", maxItems: 25, items: cleanupCriterion },
        exclude_any: { type: "array", maxItems: 25, items: cleanupCriterion },
        max_results: { type: "integer", minimum: 1, maximum: 250 },
      },
      required: ["account_id", "in_mailbox_id", "match_all", "match_any", "exclude_any", "max_results"],
    },
    async execute({ account_id, in_mailbox_id, match_all, match_any, exclude_any, max_results }) {
      const accountId = account(client, account_id);
      const inboxId = in_mailbox_id || (await mailboxForRole(client, accountId, "inbox")).id;
      const maximum = boundedInteger(max_results, 250, 1, 250, "max_results");
      if (!match_all && match_any.length === 0) throw new Error("match_any is required unless match_all is true");
      if (match_all && match_any.length) throw new Error("match_all cannot be combined with match_any");

      const candidateIds = new Set();
      let matchTotalAcrossCriteria = 0;
      const includeFilters = match_all ? [{ inMailbox: inboxId }] : match_any.map((item) => criterionFilter(item, inboxId));
      for (const filter of includeFilters) {
        const query = await queryIds(client, accountId, filter, maximum);
        matchTotalAcrossCriteria += query.total;
        for (const id of query.ids) {
          if (candidateIds.size >= maximum) break;
          candidateIds.add(id);
        }
        if (candidateIds.size >= maximum) break;
      }

      const excludedIds = new Set();
      for (const criterion of exclude_any) {
        const query = await queryIds(client, accountId, criterionFilter(criterion, inboxId), maximum);
        for (const id of query.ids) excludedIds.add(id);
      }
      const selectedIds = [...candidateIds].filter((id) => !excludedIds.has(id)).slice(0, maximum);
      const excludedCount = candidateIds.size - selectedIds.length;
      if (!selectedIds.length) {
        return {
          selectionId: null,
          accountId,
          inboxId,
          candidateCountBeforeExclusions: candidateIds.size,
          matchTotalAcrossCriteria,
          reachedSelectionLimit: candidateIds.size >= maximum,
          excludedCount,
          selectedCount: 0,
          emailState: null,
          messages: [],
        };
      }
      const messages = await compactMessages(client, accountId, selectedIds);
      const foundIds = messages.list.map(({ id }) => id);
      const selectionId = randomUUID();
      const expiresAtMs = Date.now() + cleanupLifetimeMs;
      cleanupSelections.set(selectionId, {
        accountId,
        inboxId,
        emailState: messages.state,
        emailIds: foundIds,
        messages: messages.list,
        expiresAtMs,
      });
      pruneCleanupSelections();
      return {
        selectionId,
        expiresAtUtc: new Date(expiresAtMs).toISOString(),
        accountId,
        inboxId,
        candidateCountBeforeExclusions: candidateIds.size,
        matchTotalAcrossCriteria,
        reachedSelectionLimit: candidateIds.size >= maximum,
        excludedCount,
        notFoundCount: selectedIds.length - foundIds.length,
        selectedCount: foundIds.length,
        emailState: messages.state,
        messages: messages.list,
        notFound: messages.notFound,
      };
    },
  });

  registry.register({
    name: "email_cleanup_apply",
    description: "Apply Trash or Archive to the exact saved selection returned by email_cleanup_preview in one optimistic JMAP write. Call only after the user has authorized that cleanup. selection_id may be null only when this account has exactly one pending cleanup selection. expected_count must match the preview, and any intervening mailbox change rejects the write instead of silently changing the target set.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        account_id: nullableString,
        selection_id: nullableString,
        expected_count: { type: "integer", minimum: 1, maximum: 250 },
        action: { type: "string", enum: ["trash", "archive"] },
      },
      required: ["account_id", "selection_id", "expected_count", "action"],
    },
    async execute({ account_id, selection_id, expected_count, action }) {
      pruneCleanupSelections();
      const accountId = account(client, account_id);
      let selectedId = selection_id;
      if (!selectedId) {
        const candidates = [...cleanupSelections.entries()]
          .filter(([, item]) => item.accountId === accountId);
        if (candidates.length !== 1) {
          throw new Error(`selection_id is required because this account has ${candidates.length} pending cleanup selections`);
        }
        [[selectedId]] = candidates;
      }
      const selection = cleanupSelections.get(selectedId);
      if (!selection) throw new Error("Cleanup selection is missing or expired; create a fresh preview");
      if (selection.accountId !== accountId) throw new Error("Cleanup selection belongs to a different mail account");
      if (selection.emailIds.length !== expected_count) {
        throw new Error(`Cleanup selection contains ${selection.emailIds.length} messages, not ${expected_count}`);
      }
      const result = await emailAction(client, {
        accountId,
        emailIds: selection.emailIds,
        action,
        ifInState: selection.emailState,
        inboxId: selection.inboxId,
      });
      cleanupSelections.delete(selectedId);
      return {
        action,
        affectedCount: selection.emailIds.length,
        messages: selection.messages,
        result,
      };
    },
  });

  registry.register({
    name: "email_draft_create",
    description: "Create a live JMAP draft without sending it. Supports text/HTML alternatives, existing JMAP blobs as attachments, reply headers, an explicit Drafts mailbox, optimistic Email state checking, and atomic replacement of an older immutable draft.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        account_id: nullableString,
        if_in_state: nullableString,
        replace_draft_email_id: nullableString,
        drafts_mailbox_id: nullableString,
        identity_id: nullableString,
        from: { anyOf: [address, { type: "null" }] },
        to: nullableAddresses,
        cc: nullableAddresses,
        bcc: nullableAddresses,
        reply_to: nullableAddresses,
        subject: { type: "string" },
        text_body: nullableString,
        html_body: nullableString,
        in_reply_to_message_ids: nullableStringArray,
        reference_message_ids: nullableStringArray,
        attachments: {
          type: "array",
          items: {
            type: "object", additionalProperties: false,
            properties: {
              blob_id: { type: "string" }, type: { type: "string" }, name: { type: "string" },
              disposition: { type: "string", enum: ["attachment", "inline"] }, cid: nullableString,
            },
            required: ["blob_id", "type", "name", "disposition", "cid"],
          },
        },
      },
      required: [
        "account_id", "if_in_state", "replace_draft_email_id", "drafts_mailbox_id", "identity_id", "from", "to", "cc",
        "bcc", "reply_to", "subject", "text_body", "html_body", "in_reply_to_message_ids",
        "reference_message_ids", "attachments",
      ],
    },
    async execute(input) {
      const accountId = account(client, input.account_id);
      let draftsMailboxId = input.drafts_mailbox_id;
      if (!draftsMailboxId) {
        const result = await mailboxes(client, accountId);
        draftsMailboxId = result.list.find(({ role }) => role === "drafts")?.id;
        if (!draftsMailboxId) throw new Error("No JMAP mailbox with the drafts role exists; supply drafts_mailbox_id");
      }
      let from = input.from;
      if (!from) {
        const result = await identities(client, accountId);
        const selected = input.identity_id
          ? result.list.find(({ id }) => id === input.identity_id)
          : result.list[0];
        if (!selected) throw new Error("No matching JMAP sending identity exists");
        from = { name: selected.name ?? null, email: selected.email };
      }
      const draft = compact({
        mailboxIds: { [draftsMailboxId]: true },
        keywords: { "$draft": true, "$seen": true },
        from: [from],
        to: addressList(input.to),
        cc: addressList(input.cc),
        bcc: addressList(input.bcc),
        replyTo: addressList(input.reply_to),
        subject: input.subject,
        "header:In-Reply-To:asMessageIds": input.in_reply_to_message_ids,
        "header:References:asMessageIds": input.reference_message_ids,
        ...bodyForDraft(input.text_body, input.html_body, input.attachments),
      });
      const result = await client.call("Email/set", compact({
        accountId,
        ifInState: input.if_in_state,
        create: { draft: draft },
        destroy: input.replace_draft_email_id ? [input.replace_draft_email_id] : null,
      }));
      if (findSetFailures(result)) throw new Error(`Draft creation was rejected: ${JSON.stringify(result)}`);
      return result;
    },
  });

  registry.register({
    name: "email_send",
    description: "Send an existing JMAP draft through EmailSubmission. This causes external email delivery. Call only when the user explicitly asks to send; creating or reviewing a draft is not permission to send it.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        account_id: nullableString,
        email_id: { type: "string", minLength: 1 },
        identity_id: { type: "string", minLength: 1 },
        if_in_state: nullableString,
        send_at_utc: nullableString,
        drafts_mailbox_id: nullableString,
        sent_mailbox_id: nullableString,
      },
      required: [
        "account_id", "email_id", "identity_id", "if_in_state", "send_at_utc",
        "drafts_mailbox_id", "sent_mailbox_id",
      ],
    },
    async execute({
      account_id, email_id, identity_id, if_in_state, send_at_utc,
      drafts_mailbox_id, sent_mailbox_id,
    }) {
      const accountId = account(client, account_id, SUBMISSION);
      let draftsMailboxId = drafts_mailbox_id;
      let sentMailboxId = sent_mailbox_id;
      if (!draftsMailboxId || !sentMailboxId) {
        const result = await mailboxes(client, accountId);
        draftsMailboxId ||= result.list.find(({ role }) => role === "drafts")?.id;
        sentMailboxId ||= result.list.find(({ role }) => role === "sent")?.id;
      }
      if (!draftsMailboxId || !sentMailboxId) {
        throw new Error("Sending requires JMAP mailboxes with drafts and sent roles, or explicit mailbox ids");
      }
      const creation = compact({ identityId: identity_id, emailId: email_id, sendAt: send_at_utc });
      const result = await client.call("EmailSubmission/set", compact({
        accountId,
        ifInState: if_in_state,
        create: { send: creation },
        onSuccessUpdateEmail: { "#send": {
          [`mailboxIds/${patchSegment(draftsMailboxId)}`]: null,
          [`mailboxIds/${patchSegment(sentMailboxId)}`]: true,
          "keywords/$draft": null,
        } },
      }), { using: using(SUBMISSION) });
      if (findSetFailures(result)) throw new Error(`Email submission was rejected: ${JSON.stringify(result)}`);
      return result;
    },
  });

  registry.register({
    name: "email_submission_get",
    description: "Read live JMAP submission records and delivery status for known submission ids. A provider may remove completed submission records at any time.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { account_id: nullableString, submission_ids: nullableStringArray },
      required: ["account_id", "submission_ids"],
    },
    async execute({ account_id, submission_ids }) {
      const accountId = account(client, account_id, SUBMISSION);
      return client.call("EmailSubmission/get", { accountId, ids: submission_ids }, { using: using(SUBMISSION) });
    },
  });

  registry.register({
    name: "email_attachment_get",
    description: "Retrieve one live JMAP message or attachment blob with a strict byte limit. Text-like media are returned as UTF-8; other media are returned as base64 for exact binary preservation.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        account_id: nullableString,
        blob_id: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        type: { type: "string", minLength: 1 },
        max_bytes: { type: "integer", minimum: 1, maximum: 1_000_000 },
      },
      required: ["account_id", "blob_id", "name", "type", "max_bytes"],
    },
    async execute({ account_id, blob_id, name, type, max_bytes }) {
      const maximumBytes = boundedInteger(max_bytes, 250_000, 1, 1_000_000, "max_bytes");
      const result = await client.downloadBlob({
        accountId: account_id, blobId: blob_id, name, type, maximumBytes,
      });
      const textual = result.type.startsWith("text/") || /(?:json|xml|javascript|yaml)$/.test(result.type);
      return {
        blobId: blob_id,
        name,
        type: result.type,
        byteSize: result.bytes.byteLength,
        encoding: textual ? "utf8" : "base64",
        content: textual ? new TextDecoder().decode(result.bytes) : Buffer.from(result.bytes).toString("base64"),
      };
    },
  });
}
