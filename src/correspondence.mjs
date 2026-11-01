function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${label} must be a positive integer`);
  return id;
}

function emailAddress(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

function emailInstant(value, label) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be an RFC 3339 timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be an RFC 3339 timestamp`);
  return parsed.toISOString();
}

function emailKeywords(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String).toSorted();
  if (typeof value === "object") return Object.entries(value)
    .filter(([, active]) => active === true)
    .map(([keyword]) => keyword)
    .toSorted();
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String).toSorted() : [];
  } catch {
    return [];
  }
}

function boundedProviderText(value, maximumCharacters) {
  if (value == null) return null;
  let result = "";
  let count = 0;
  for (const character of String(value)) {
    if (count >= maximumCharacters) break;
    result += character;
    count += 1;
  }
  return result || null;
}

function mailboxSnapshot(value) {
  const mailboxId = String(value?.id ?? "");
  const name = String(value?.name ?? "").trim();
  if (!mailboxId || mailboxId.length > 255) throw new Error("JMAP mailbox id must contain 1 through 255 characters");
  if (!name || name.length > 500) throw new Error(`JMAP mailbox ${mailboxId} name must contain 1 through 500 characters`);
  const role = value.role == null ? null : String(value.role);
  const parentMailboxId = value.parentId == null ? null : String(value.parentId);
  if (role != null && role.length > 100) throw new Error(`JMAP mailbox ${mailboxId} role exceeds 100 characters`);
  if (parentMailboxId != null && parentMailboxId.length > 255) throw new Error(`JMAP mailbox ${mailboxId} parent id exceeds 255 characters`);
  const sortOrder = Number(value.sortOrder ?? 0);
  if (!Number.isSafeInteger(sortOrder)) throw new Error(`JMAP mailbox ${mailboxId} sortOrder must be an integer`);
  return { mailboxId, name, role, parentMailboxId, sortOrder, isSubscribed: value.isSubscribed === false ? 0 : 1 };
}

function canonicalHtml(value) {
  if (value == null) return null;
  const text = String(value);
  return text ? text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replace(/\r\n?|\n/gu, "<br>") : null;
}

function publicItem(row, participants = [], todos = [], mailboxes = []) {
  const correspondenceId = Number(row.correspondence_id);
  const keywords = emailKeywords(row.email_keywords_json);
  return {
    correspondence_id: correspondenceId,
    ref: `agent-slayer://correspondence/${correspondenceId}`,
    display: row.subject || `${row.medium} ${row.direction}`,
    medium: row.medium,
    direction: row.direction,
    subject: row.subject ?? null,
    body: row.body ?? null,
    delivery_status: row.delivery_status ?? null,
    call_disposition: row.call_disposition ?? null,
    occurred_at_utc: row.occurred_at_utc,
    sent_at_utc: row.sent_at_utc ?? null,
    received_at_utc: row.received_at_utc ?? null,
    email_keywords: keywords,
    is_read: row.medium === "email" ? keywords.includes("$seen") : null,
    mailboxes,
    participants,
    linked_todos: todos,
  };
}

function partBody(message) {
  for (const part of message.htmlBody || []) {
    const value = message.bodyValues?.[part.partId]?.value;
    if (typeof value === "string" && value) return value;
  }
  for (const part of message.textBody || []) {
    const value = message.bodyValues?.[part.partId]?.value;
    if (typeof value === "string" && value) return canonicalHtml(value);
  }
  return canonicalHtml(message.preview);
}

function participantRows(message) {
  const roles = ["from", "to", "cc", "bcc", "replyTo", "sender"];
  const seen = new Set();
  return roles.flatMap((role) => (message[role] || []).map((participant) => ({
    role: role === "replyTo" ? "reply_to" : role,
    address: String(participant.email || "").trim(),
    displayName: boundedProviderText(participant.name, 500),
  })).filter(({ role, address }) => {
    const key = `${role}\u0000${emailAddress(address)}`;
    if (!address || seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

const emailSyncBatchSize = 100;

export class CorrespondenceService {
  constructor({ store, ledger, jmap }) {
    this.store = store;
    this.ledger = ledger;
    this.jmap = jmap;
    this.emailSyncProgress = { status: "idle", phase: null, processed: 0, total: null };
  }

  get database() { return this.store.requireReady(); }

  emailSyncStatus() {
    if (this.emailSyncProgress.status !== "idle") return structuredClone(this.emailSyncProgress);
    try {
      const sourceAccountKey = `jmap:${this.jmap.resolveAccountId()}`;
      const baseline = this.database.prepare(`SELECT next_position, total, synchronized_count, started_at_utc,
        updated_at_utc FROM jmap_email_sync_work WHERE source_account_key = ?`).get(sourceAccountKey);
      if (baseline) return {
        status: "paused", phase: "Full email baseline ready to resume",
        processed: Number(baseline.synchronized_count || 0),
        total: baseline.total == null ? null : Number(baseline.total),
        started_at_utc: baseline.started_at_utc,
        updated_at_utc: baseline.updated_at_utc,
      };
    } catch { /* The normal request path reports configuration or database failures. */ }
    return structuredClone(this.emailSyncProgress);
  }

  async syncEmail(context = {}) {
    if (this.emailSyncProgress.status === "running") throw new Error("Email synchronization is already running");
    this.emailSyncProgress = {
      status: "running", phase: "Reading provider state", processed: 0, total: null,
      started_at_utc: new Date().toISOString(),
    };
    try {
      const result = await this.performEmailSync(context);
      this.emailSyncProgress = {
        status: "complete", phase: "Complete", processed: result.synchronized,
        total: result.total, completed_at_utc: new Date().toISOString(), result,
      };
      return result;
    } catch (error) {
      this.emailSyncProgress = {
        status: "error", phase: "Failed", processed: this.emailSyncProgress.processed,
        total: this.emailSyncProgress.total, completed_at_utc: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  list({ q = "", medium = null, direction = null, mailboxId = null, limit = 100, offset = 0 } = {}) {
    limit = Math.min(200, Math.max(1, Number(limit) || 100));
    offset = Math.max(0, Number(offset) || 0);
    const where = [];
    const values = [];
    if (q.trim()) {
      where.push("(subject LIKE ? OR body LIKE ?)");
      values.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }
    if (medium) { where.push("medium = ?"); values.push(medium); }
    if (direction) { where.push("direction = ?"); values.push(direction); }
    if (mailboxId) {
      where.push(`EXISTS (SELECT 1 FROM correspondence_email_mailboxes_join AS selected_mailbox
        WHERE selected_mailbox.correspondence_id = correspondence.correspondence_id
          AND selected_mailbox.mailbox_id = ?)`);
      values.push(mailboxId);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.database.prepare(`SELECT * FROM correspondence ${clause}
      ORDER BY occurred_at_utc DESC, correspondence_id DESC LIMIT ? OFFSET ?`)
      .all(...values, limit, offset);
    const ids = rows.map((row) => Number(row.correspondence_id));
    const participants = new Map();
    const todos = new Map();
    const mailboxes = new Map();
    if (ids.length) {
      const placeholders = ids.map(() => "?").join(", ");
      for (const row of this.database.prepare(`SELECT participant.*, contact.display_name AS contact_name
        FROM correspondence_participants_join AS participant
        LEFT JOIN contacts AS contact USING (contact_id)
        WHERE participant.correspondence_id IN (${placeholders})
        ORDER BY participant.correspondence_id, participant.participant_role, participant.address_value`).all(...ids)) {
        const id = Number(row.correspondence_id);
        const valuesForItem = participants.get(id) || [];
        valuesForItem.push({
          role: row.participant_role,
          address: row.address_value,
          display_name: row.contact_name || row.display_name || null,
          contact_id: row.contact_id == null ? null : Number(row.contact_id),
        });
        participants.set(id, valuesForItem);
      }
      for (const row of this.database.prepare(`SELECT link.correspondence_id, task.personal_task_id,
          task.text, task.status FROM todo_correspondence_join AS link
        JOIN todo_personal AS task USING (personal_task_id)
        WHERE link.correspondence_id IN (${placeholders})
        ORDER BY task.personal_task_id`).all(...ids)) {
        const id = Number(row.correspondence_id);
        const valuesForItem = todos.get(id) || [];
        valuesForItem.push({ todo_id: Number(row.personal_task_id), text: row.text, status: row.status });
        todos.set(id, valuesForItem);
      }
      for (const row of this.database.prepare(`SELECT link.correspondence_id, mailbox.mailbox_id,
          mailbox.name, mailbox.role, mailbox.parent_mailbox_id, mailbox.sort_order
        FROM correspondence_email_mailboxes_join AS link
        JOIN jmap_email_mailboxes AS mailbox
          ON mailbox.source_account_key = link.source_account_key AND mailbox.mailbox_id = link.mailbox_id
        WHERE link.correspondence_id IN (${placeholders})
        ORDER BY link.correspondence_id, mailbox.sort_order, mailbox.name, mailbox.mailbox_id`).all(...ids)) {
        const id = Number(row.correspondence_id);
        const valuesForItem = mailboxes.get(id) || [];
        valuesForItem.push({
          mailbox_id: row.mailbox_id, name: row.name, role: row.role ?? null,
          parent_mailbox_id: row.parent_mailbox_id ?? null,
        });
        mailboxes.set(id, valuesForItem);
      }
    }
    return {
      items: rows.map((row) => publicItem(row, participants.get(Number(row.correspondence_id)) || [],
        todos.get(Number(row.correspondence_id)) || [], mailboxes.get(Number(row.correspondence_id)) || [])),
      mailboxes: this.database.prepare(`SELECT mailbox_id, name, role, parent_mailbox_id
        FROM jmap_email_mailboxes ORDER BY sort_order, name, mailbox_id`).all(),
      count: rows.length,
      limit,
      offset,
    };
  }

  setTodoLinks({ links }, context = {}) {
    if (!Array.isArray(links) || !links.length || links.length > 500) throw new Error("links must contain 1 through 500 items");
    const normalized = links.map((link) => ({
      correspondenceId: positiveId(link.correspondence_id, "correspondence_id"),
      todoId: positiveId(link.todo_id, "todo_id"),
      linked: Boolean(link.linked),
    }));
    const db = this.database;
    db.exec("START TRANSACTION");
    try {
      for (const link of normalized) {
        if (!db.prepare("SELECT 1 FROM correspondence WHERE correspondence_id = ?").get(link.correspondenceId)) throw new Error(`Correspondence ${link.correspondenceId} not found`);
        if (!db.prepare("SELECT 1 FROM todo_personal WHERE personal_task_id = ?").get(link.todoId)) throw new Error(`To-do ${link.todoId} not found`);
        if (link.linked) db.prepare(`INSERT INTO todo_correspondence_join (personal_task_id, correspondence_id)
          VALUES (?, ?) ON DUPLICATE KEY UPDATE created_at_utc = created_at_utc`).run(link.todoId, link.correspondenceId);
        else db.prepare("DELETE FROM todo_correspondence_join WHERE personal_task_id = ? AND correspondence_id = ?")
          .run(link.todoId, link.correspondenceId);
      }
      const result = { updated: normalized.length, links: normalized.map((link) => ({
        correspondence_id: link.correspondenceId, todo_id: link.todoId, linked: link.linked,
      })) };
      this.ledger.append({
        type: "correspondence.todo_links_updated", status: "complete", actorType: context.actorType || "tool",
        actorName: context.actorName || "correspondence_todo_link_set", turnId: context.requestId,
        operationId: context.callId, name: "Correspondence to-do links updated", payload: result,
      });
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  createSmsDraft({ contact_id, contact_method_id = null, body }) {
    const contactId = positiveId(contact_id, "contact_id");
    if (typeof body !== "string" || !body.trim() || body.length > 10_000) throw new Error("body must contain 1 through 10000 characters");
    const contact = this.database.prepare("SELECT contact_id, display_name FROM contacts WHERE contact_id = ? AND status <> 'inactive'").get(contactId);
    if (!contact) throw new Error("Active contact not found");
    let methods;
    if (contact_method_id != null) {
      methods = this.database.prepare(`SELECT * FROM contact_methods WHERE contact_method_id = ?
        AND contact_id = ? AND method_kind = 'phone' AND can_receive = 1`).all(positiveId(contact_method_id, "contact_method_id"), contactId);
      if (!methods.length) throw new Error("The selected receivable phone method was not found on this contact");
    } else {
      methods = this.database.prepare(`SELECT * FROM contact_methods WHERE contact_id = ?
        AND method_kind = 'phone' AND can_receive = 1 ORDER BY is_primary DESC, contact_method_id`).all(contactId);
      if (!methods.length) throw new Error("The contact has no receivable phone method");
      const primary = methods.filter((method) => Boolean(method.is_primary));
      if (primary.length === 1) methods = primary;
      else if (methods.length !== 1) return {
        status: "needs_selection",
        contact_id: contactId,
        contact_name: contact.display_name,
        methods: methods.map((method) => ({ contact_method_id: Number(method.contact_method_id), label: method.label, address: method.value })),
      };
    }
    const method = methods[0];
    return {
      status: "ready",
      draft: {
        contact_id: contactId,
        contact_method_id: Number(method.contact_method_id),
        contact_name: contact.display_name,
        address: method.value,
        body,
      },
    };
  }

  saveMailboxSnapshot(db, sourceAccountKey, mailboxRows) {
    db.exec("START TRANSACTION");
    try {
      const upsert = db.prepare(`INSERT INTO jmap_email_mailboxes
        (source_account_key, mailbox_id, name, role, parent_mailbox_id, sort_order, is_subscribed, updated_at_utc)
        VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role),
          parent_mailbox_id = VALUES(parent_mailbox_id), sort_order = VALUES(sort_order),
          is_subscribed = VALUES(is_subscribed), updated_at_utc = VALUES(updated_at_utc)`);
      for (const mailbox of mailboxRows) upsert.run(sourceAccountKey, mailbox.mailboxId, mailbox.name,
        mailbox.role, mailbox.parentMailboxId, mailbox.sortOrder, mailbox.isSubscribed);
      if (mailboxRows.length) {
        const placeholders = mailboxRows.map(() => "?").join(", ");
        db.prepare(`DELETE FROM jmap_email_mailboxes WHERE source_account_key = ?
          AND mailbox_id NOT IN (${placeholders})`).run(sourceAccountKey, ...mailboxRows.map(({ mailboxId }) => mailboxId));
      } else db.prepare("DELETE FROM jmap_email_mailboxes WHERE source_account_key = ?").run(sourceAccountKey);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  saveEmailMessages(db, { sourceAccountKey, messages, mailboxIds, selfAddress }) {
    const references = [];
    for (const message of messages) {
      const participants = participantRows(message);
      const outbound = participants.some(({ role, address }) => ["from", "sender"].includes(role)
        && emailAddress(address) === selfAddress);
      const sentAt = emailInstant(message.sentAt, `Email ${message.id} sentAt`);
      const receivedAt = emailInstant(message.receivedAt, `Email ${message.id} receivedAt`);
      const occurredAt = sentAt || receivedAt || new Date().toISOString();
      const keywords = emailKeywords(message.keywords);
      db.prepare(`INSERT INTO correspondence
        (medium, direction, source_account_key, thread_key, external_id, internet_message_id,
         in_reply_to_id, subject, body, delivery_status, email_keywords_json,
         occurred_at_utc, sent_at_utc, received_at_utc)
        VALUES ('email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE thread_key = VALUES(thread_key), internet_message_id = VALUES(internet_message_id),
          subject = VALUES(subject), body = VALUES(body), delivery_status = VALUES(delivery_status),
          email_keywords_json = VALUES(email_keywords_json), occurred_at_utc = VALUES(occurred_at_utc),
          sent_at_utc = VALUES(sent_at_utc), received_at_utc = VALUES(received_at_utc)`).run(
        outbound ? "outbound" : "inbound", sourceAccountKey, message.threadId || null, message.id,
        message.messageId?.[0] || null, null, message.subject || null, partBody(message),
        outbound ? "sent" : "delivered", JSON.stringify(keywords), occurredAt, sentAt, receivedAt,
      );
      const item = db.prepare(`SELECT correspondence_id FROM correspondence
        WHERE medium = 'email' AND source_account_key = ? AND external_id = ?`).get(sourceAccountKey, message.id);
      db.prepare("DELETE FROM correspondence_participants_join WHERE correspondence_id = ?").run(item.correspondence_id);
      for (const participant of participants) {
        const method = db.prepare(`SELECT method.contact_method_id, method.contact_id FROM contact_methods AS method
          JOIN contacts AS contact USING (contact_id) WHERE method.method_kind = 'email'
            AND LOWER(method.normalized_value) = ? AND contact.status <> 'inactive'
          ORDER BY method.is_primary DESC, method.contact_method_id LIMIT 1`).get(emailAddress(participant.address));
        db.prepare(`INSERT INTO correspondence_participants_join
          (correspondence_id, participant_role, contact_id, contact_method_id, address_value, display_name)
          VALUES (?, ?, ?, ?, ?, ?)`).run(item.correspondence_id, participant.role, method?.contact_id || null,
          method?.contact_method_id || null, participant.address, participant.displayName);
      }
      db.prepare("DELETE FROM correspondence_email_mailboxes_join WHERE correspondence_id = ?").run(item.correspondence_id);
      for (const mailboxId of Object.entries(message.mailboxIds || {})
        .filter(([, member]) => member === true).map(([id]) => id)) {
        if (!mailboxIds.has(mailboxId)) throw new Error(`Email ${message.id} references unknown JMAP mailbox ${mailboxId}`);
        db.prepare(`INSERT INTO correspondence_email_mailboxes_join
          (correspondence_id, source_account_key, mailbox_id) VALUES (?, ?, ?)`)
          .run(item.correspondence_id, sourceAccountKey, mailboxId);
      }
      references.push({ id: message.id, inReplyTo: message.inReplyTo?.[0] || null });
    }
    return references;
  }

  repairReplyLinks(db, sourceAccountKey, references) {
    const findChild = db.prepare(`SELECT correspondence_id FROM correspondence
      WHERE medium = 'email' AND source_account_key = ? AND external_id = ?`);
    const findParent = db.prepare(`SELECT correspondence_id FROM correspondence
      WHERE medium = 'email' AND source_account_key = ? AND internet_message_id = ?
      ORDER BY correspondence_id LIMIT 2`);
    const update = db.prepare("UPDATE correspondence SET in_reply_to_id = ? WHERE correspondence_id = ?");
    for (const reference of references) {
      const child = findChild.get(sourceAccountKey, reference.id);
      if (!child) continue;
      const parents = reference.inReplyTo ? findParent.all(sourceAccountKey, reference.inReplyTo) : [];
      const parentId = parents.length === 1 && Number(parents[0].correspondence_id) !== Number(child.correspondence_id)
        ? parents[0].correspondence_id
        : null;
      update.run(parentId, child.correspondence_id);
    }
  }

  repairBaselineReplyLinks(db, sourceAccountKey) {
    const parentIds = new Map();
    let parentPosition = 0;
    let parentCount = 0;
    while (true) {
      const parentRows = db.prepare(`SELECT correspondence_id, internet_message_id FROM correspondence
        WHERE medium = 'email' AND source_account_key = ? AND internet_message_id IS NOT NULL
          AND correspondence_id > ? ORDER BY correspondence_id LIMIT 5000`)
        .all(sourceAccountKey, parentPosition);
      for (const row of parentRows) {
        const matches = parentIds.get(row.internet_message_id) || [];
        matches.push(Number(row.correspondence_id));
        parentIds.set(row.internet_message_id, matches);
      }
      parentCount += parentRows.length;
      this.emailSyncProgress = {
        ...this.emailSyncProgress, phase: "Indexing email reply IDs", processed: parentCount, total: null,
      };
      if (parentRows.length < 5000) break;
      parentPosition = Number(parentRows.at(-1).correspondence_id);
    }
    let referencePosition = 0;
    let repaired = 0;
    while (true) {
      const references = db.prepare(`SELECT child.correspondence_id, child.in_reply_to_id,
          staged.in_reply_to_message_id
        FROM jmap_email_sync_work_items AS staged JOIN correspondence AS child
          ON child.medium = 'email' AND child.source_account_key = staged.source_account_key
            AND child.external_id = staged.email_id
        WHERE staged.source_account_key = ? AND child.correspondence_id > ?
          AND (staged.in_reply_to_message_id IS NOT NULL OR child.in_reply_to_id IS NOT NULL)
        ORDER BY child.correspondence_id LIMIT 5000`).all(sourceAccountKey, referencePosition);
      const repairs = references.map((reference) => {
        const childId = Number(reference.correspondence_id);
        const matches = parentIds.get(reference.in_reply_to_message_id) || [];
        return { childId, parentId: matches.length === 1 && matches[0] !== childId ? matches[0] : null };
      });
      for (let index = 0; index < repairs.length; index += 500) {
        const batch = repairs.slice(index, index + 500);
        const cases = batch.map(() => "WHEN ? THEN ?").join(" ");
        const placeholders = batch.map(() => "?").join(", ");
        db.exec("START TRANSACTION");
        try {
          db.prepare(`UPDATE correspondence SET in_reply_to_id = CASE correspondence_id ${cases}
            ELSE in_reply_to_id END WHERE correspondence_id IN (${placeholders})`).run(
            ...batch.flatMap(({ childId, parentId }) => [childId, parentId]),
            ...batch.map(({ childId }) => childId),
          );
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        repaired += batch.length;
        this.emailSyncProgress = {
          ...this.emailSyncProgress, phase: "Linking email replies", processed: repaired, total: null,
        };
      }
      if (references.length < 5000) break;
      referencePosition = Number(references.at(-1).correspondence_id);
    }
  }

  deleteStaleBaselineEmails(db, sourceAccountKey) {
    let deleted = 0;
    while (true) {
      const rows = db.prepare(`SELECT stale.correspondence_id FROM correspondence AS stale
        LEFT JOIN jmap_email_sync_work_items AS staged
          ON staged.source_account_key = ? AND staged.email_id = stale.external_id
        WHERE stale.medium = 'email' AND stale.source_account_key = ? AND staged.email_id IS NULL
        ORDER BY stale.correspondence_id LIMIT 500`).all(sourceAccountKey, sourceAccountKey);
      if (!rows.length) break;
      const ids = rows.map(({ correspondence_id: id }) => Number(id));
      db.exec("START TRANSACTION");
      try {
        const placeholders = ids.map(() => "?").join(", ");
        deleted += Number(db.prepare(`DELETE FROM correspondence WHERE correspondence_id IN (${placeholders})`)
          .run(...ids)?.changes || 0);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      this.emailSyncProgress = {
        ...this.emailSyncProgress, phase: "Removing stale email rows", processed: deleted, total: null,
      };
    }
    return deleted;
  }

  clearCompletedEmailSyncWork(db, sourceAccountKey) {
    let removed = 0;
    while (true) {
      const result = db.prepare(`DELETE FROM jmap_email_sync_work_items
        WHERE source_account_key = ? LIMIT 5000`).run(sourceAccountKey);
      const changes = Number(result?.changes || 0);
      removed += changes;
      if (changes < 5000) break;
      this.emailSyncProgress = {
        ...this.emailSyncProgress, phase: "Clearing completed email sync work", processed: removed, total: null,
      };
    }
    db.prepare("DELETE FROM jmap_email_sync_work WHERE source_account_key = ?").run(sourceAccountKey);
  }

  async performEmailSync(context = {}) {
    const accountId = this.jmap.resolveAccountId();
    const sourceAccountKey = `jmap:${accountId}`;
    const db = this.database;
    const previousSync = db.prepare("SELECT email_state FROM jmap_email_sync_state WHERE source_account_key = ?")
      .get(sourceAccountKey);
    let baseline = db.prepare("SELECT * FROM jmap_email_sync_work WHERE source_account_key = ?")
      .get(sourceAccountKey);
    if (previousSync?.email_state && baseline) {
      this.clearCompletedEmailSyncWork(db, sourceAccountKey);
      baseline = null;
    }
    const mailboxRows = ((await this.jmap.call("Mailbox/get", { accountId, ids: null })).list || []).map(mailboxSnapshot);
    const mailboxIds = new Set(mailboxRows.map(({ mailboxId }) => mailboxId));
    this.saveMailboxSnapshot(db, sourceAccountKey, mailboxRows);
    const properties = ["id", "threadId", "mailboxIds", "keywords", "receivedAt", "messageId", "inReplyTo", "from", "to", "cc", "bcc", "replyTo", "sender", "subject", "sentAt", "preview", "textBody", "htmlBody", "bodyValues"];
    const selfAddress = emailAddress(this.jmap.publicSession().username);
    if (previousSync?.email_state && !baseline) {
      this.emailSyncProgress = { ...this.emailSyncProgress, phase: "Reading email changes" };
      const changed = new Set();
      const destroyed = new Set();
      let targetEmailState = previousSync.email_state;
      while (true) {
        let changes;
        try {
          changes = await this.jmap.call("Email/changes", {
            accountId, sinceState: targetEmailState, maxChanges: 500,
          });
        } catch (error) {
          if (!/cannotCalculateChanges/iu.test(error instanceof Error ? error.message : String(error))) throw error;
          db.prepare("DELETE FROM jmap_email_sync_state WHERE source_account_key = ?").run(sourceAccountKey);
          this.emailSyncProgress = { ...this.emailSyncProgress, phase: "Restarting full email baseline", processed: 0, total: null };
          return this.performEmailSync(context);
        }
        for (const id of [...(changes.created || []), ...(changes.updated || [])]) {
          changed.add(id);
          destroyed.delete(id);
        }
        for (const id of changes.destroyed || []) {
          destroyed.add(id);
          changed.delete(id);
        }
        targetEmailState = changes.newState;
        if (!changes.hasMoreChanges) break;
      }
      const ids = [...changed];
      const references = [];
      let synchronized = 0;
      this.emailSyncProgress = { ...this.emailSyncProgress, phase: "Updating emails", processed: 0, total: ids.length + destroyed.size };
      for (let index = 0; index < ids.length; index += emailSyncBatchSize) {
        const batchIds = ids.slice(index, index + emailSyncBatchSize);
        const result = await this.jmap.call("Email/get", { accountId, ids: batchIds, properties,
          fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 1_000_000 });
        db.exec("START TRANSACTION");
        try {
          references.push(...this.saveEmailMessages(db, { sourceAccountKey, messages: result.list || [], mailboxIds, selfAddress }));
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        synchronized += (result.list || []).length;
        this.emailSyncProgress = { ...this.emailSyncProgress, processed: Math.min(index + batchIds.length, ids.length), total: ids.length + destroyed.size };
      }
      db.exec("START TRANSACTION");
      try {
        if (destroyed.size) {
          const placeholders = [...destroyed].map(() => "?").join(", ");
          db.prepare(`DELETE FROM correspondence WHERE medium = 'email' AND source_account_key = ?
            AND external_id IN (${placeholders})`).run(sourceAccountKey, ...destroyed);
        }
        this.repairReplyLinks(db, sourceAccountKey, references);
        db.prepare(`INSERT INTO jmap_email_sync_state (source_account_key, email_state, synchronized_at_utc)
          VALUES (?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE email_state = VALUES(email_state),
          synchronized_at_utc = VALUES(synchronized_at_utc)`).run(sourceAccountKey, targetEmailState);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      const result = { account_id: accountId, mode: "incremental", synchronized, deleted: destroyed.size,
        total: ids.length + destroyed.size, mailboxes: mailboxRows.length, email_state: targetEmailState };
      this.ledger.append({ type: "correspondence.email_synchronized", status: "complete", actorType: context.actorType || "user",
        actorName: context.actorName || "Nate", name: "Email synchronized into correspondence", payload: result });
      return result;
    }

    if (!baseline) {
      const targetEmailState = (await this.jmap.call("Email/get", { accountId, ids: [], properties: ["id"] })).state;
      db.prepare(`INSERT INTO jmap_email_sync_work
        (source_account_key, target_email_state, next_position, synchronized_count)
        VALUES (?, ?, 0, 0)`).run(sourceAccountKey, targetEmailState);
      baseline = { source_account_key: sourceAccountKey, target_email_state: targetEmailState,
        query_state: null, next_position: 0, total: null, synchronized_count: 0, query_changed: 0 };
    }
    let position = Number(baseline.next_position || 0);
    let synchronized = Number(baseline.synchronized_count || 0);
    let total = baseline.total == null ? null : Number(baseline.total);
    let queryState = baseline.query_state || null;
    let queryChanged = Boolean(baseline.query_changed);
    this.emailSyncProgress = { ...this.emailSyncProgress, phase: position ? "Resuming full email baseline" : "Importing full email baseline",
      processed: synchronized, total };
    while (true) {
      const page = await this.jmap.call("Email/query", {
        accountId, position, limit: emailSyncBatchSize, calculateTotal: position === 0,
        sort: [{ property: "receivedAt", isAscending: false }],
      });
      const ids = page.ids || [];
      if (position === 0 && Number.isSafeInteger(Number(page.total))) total = Number(page.total);
      if (!queryState && page.queryState) queryState = page.queryState;
      else if (queryState && page.queryState && queryState !== page.queryState) queryChanged = true;
      if (!ids.length) break;
      const fetched = await this.jmap.call("Email/get", { accountId, ids, properties,
        fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 1_000_000 });
      db.exec("START TRANSACTION");
      try {
        const messages = fetched.list || [];
        this.saveEmailMessages(db, { sourceAccountKey, messages, mailboxIds, selfAddress });
        const messageById = new Map(messages.map((message) => [message.id, message]));
        const stage = db.prepare(`INSERT INTO jmap_email_sync_work_items
          (source_account_key, email_id, internet_message_id, in_reply_to_message_id)
          VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE internet_message_id = VALUES(internet_message_id),
          in_reply_to_message_id = VALUES(in_reply_to_message_id), observed_at_utc = UTC_TIMESTAMP(3)`);
        for (const id of ids) {
          const message = messageById.get(id);
          stage.run(sourceAccountKey, id, message?.messageId?.[0] || null, message?.inReplyTo?.[0] || null);
        }
        position += ids.length;
        synchronized += ids.length;
        db.prepare(`UPDATE jmap_email_sync_work SET query_state = ?, next_position = ?, total = ?,
          synchronized_count = ?, query_changed = ?, updated_at_utc = UTC_TIMESTAMP(3)
          WHERE source_account_key = ?`).run(queryState, position, total, synchronized, queryChanged ? 1 : 0, sourceAccountKey);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      this.emailSyncProgress = { ...this.emailSyncProgress, phase: "Importing full email baseline", processed: synchronized, total };
      if (ids.length < emailSyncBatchSize) break;
    }
    this.emailSyncProgress = { ...this.emailSyncProgress, phase: "Finalizing full email baseline", processed: synchronized, total };
    this.repairBaselineReplyLinks(db, sourceAccountKey);
    const deleted = queryChanged ? 0 : this.deleteStaleBaselineEmails(db, sourceAccountKey);
    db.exec("START TRANSACTION");
    try {
      db.prepare(`INSERT INTO jmap_email_sync_state (source_account_key, email_state, synchronized_at_utc)
        VALUES (?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE email_state = VALUES(email_state),
        synchronized_at_utc = VALUES(synchronized_at_utc)`).run(sourceAccountKey, baseline.target_email_state);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    this.clearCompletedEmailSyncWork(db, sourceAccountKey);
    const result = { account_id: accountId, mode: "full", synchronized, deleted, total: total ?? synchronized,
      mailboxes: mailboxRows.length, email_state: baseline.target_email_state, resumed: Number(baseline.next_position || 0) > 0 };
    this.ledger.append({ type: "correspondence.email_synchronized", status: "complete", actorType: context.actorType || "user",
      actorName: context.actorName || "Nate", name: "Email synchronized into correspondence", payload: result });
    return result;
  }
}
