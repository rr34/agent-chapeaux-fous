function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`${label} must be a positive integer`);
  return id;
}

function emailAddress(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
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

function publicItem(row, participants = [], todos = []) {
  const correspondenceId = Number(row.correspondence_id);
  return {
    correspondence_id: correspondenceId,
    ref: `agent-slayer://correspondence/${correspondenceId}`,
    display: row.subject || `${row.medium} ${row.direction}`,
    medium: row.medium,
    direction: row.direction,
    subject: row.subject ?? null,
    body: row.body ?? null,
    delivery_status: row.delivery_status ?? null,
    occurred_at_utc: row.occurred_at_utc,
    sent_at_utc: row.sent_at_utc ?? null,
    received_at_utc: row.received_at_utc ?? null,
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
    displayName: participant.name || null,
  })).filter(({ role, address }) => {
    const key = `${role}\u0000${emailAddress(address)}`;
    if (!address || seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

export class CorrespondenceService {
  constructor({ store, ledger, jmap }) {
    this.store = store;
    this.ledger = ledger;
    this.jmap = jmap;
  }

  get database() { return this.store.requireReady(); }

  list({ q = "", medium = null, direction = null, limit = 100, offset = 0 } = {}) {
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
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.database.prepare(`SELECT * FROM correspondence ${clause}
      ORDER BY occurred_at_utc DESC, correspondence_id DESC LIMIT ? OFFSET ?`)
      .all(...values, limit, offset);
    const ids = rows.map((row) => Number(row.correspondence_id));
    const participants = new Map();
    const todos = new Map();
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
    }
    return {
      items: rows.map((row) => publicItem(row, participants.get(Number(row.correspondence_id)) || [], todos.get(Number(row.correspondence_id)) || [])),
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

  async syncEmail(context = {}) {
    const accountId = this.jmap.resolveAccountId();
    const sourceAccountKey = `jmap:${accountId}`;
    const ids = [];
    let position = 0;
    while (true) {
      const page = await this.jmap.call("Email/query", { accountId, position, limit: 500, sort: [{ property: "receivedAt", isAscending: false }] });
      ids.push(...page.ids);
      if (ids.length > 10_000) throw new Error("Email sync exceeds 10000 messages; narrow or archive the provider account before syncing");
      position += page.ids.length;
      if (!page.ids.length || position >= Number(page.total || position)) break;
    }
    const messages = [];
    let emailState = null;
    const properties = ["id", "threadId", "mailboxIds", "keywords", "receivedAt", "messageId", "inReplyTo", "from", "to", "cc", "bcc", "replyTo", "sender", "subject", "sentAt", "preview", "textBody", "htmlBody", "bodyValues"];
    for (let index = 0; index < ids.length; index += 100) {
      const result = await this.jmap.call("Email/get", { accountId, ids: ids.slice(index, index + 100), properties, fetchTextBodyValues: true, fetchHTMLBodyValues: true, maxBodyValueBytes: 1_000_000 });
      messages.push(...result.list);
      emailState = result.state;
    }
    if (!emailState) emailState = (await this.jmap.call("Email/get", { accountId, ids: [], properties: ["id"] })).state;
    const selfAddress = emailAddress(this.jmap.publicSession().username);
    const db = this.database;
    db.exec("START TRANSACTION");
    try {
      for (const message of messages) {
        const participants = participantRows(message);
        const outbound = participants.some(({ role, address }) => ["from", "sender"].includes(role) && emailAddress(address) === selfAddress);
        const occurredAt = message.sentAt || message.receivedAt || new Date().toISOString();
        db.prepare(`INSERT INTO correspondence
          (medium, direction, source_account_key, thread_key, external_id, internet_message_id,
           in_reply_to_id, subject, body, delivery_status, occurred_at_utc, sent_at_utc, received_at_utc)
          VALUES ('email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE thread_key = VALUES(thread_key), internet_message_id = VALUES(internet_message_id),
            in_reply_to_id = VALUES(in_reply_to_id), subject = VALUES(subject), body = VALUES(body),
            delivery_status = VALUES(delivery_status), occurred_at_utc = VALUES(occurred_at_utc),
            sent_at_utc = VALUES(sent_at_utc), received_at_utc = VALUES(received_at_utc)`).run(
          outbound ? "outbound" : "inbound", sourceAccountKey, message.threadId || null, message.id,
          message.messageId?.[0] || null, message.inReplyTo?.[0] || null, message.subject || null,
          partBody(message), outbound ? "sent" : "delivered", occurredAt, message.sentAt || null, message.receivedAt || null,
        );
        const item = db.prepare("SELECT correspondence_id FROM correspondence WHERE medium = 'email' AND source_account_key = ? AND external_id = ?").get(sourceAccountKey, message.id);
        db.prepare("DELETE FROM correspondence_participants_join WHERE correspondence_id = ?").run(item.correspondence_id);
        for (const participant of participants) {
          const normalized = emailAddress(participant.address);
          const method = db.prepare(`SELECT method.contact_method_id, method.contact_id FROM contact_methods AS method
            JOIN contacts AS contact USING (contact_id) WHERE method.method_kind = 'email'
              AND LOWER(method.normalized_value) = ? AND contact.status <> 'inactive'
            ORDER BY method.is_primary DESC, method.contact_method_id LIMIT 1`).get(normalized);
          db.prepare(`INSERT INTO correspondence_participants_join
            (correspondence_id, participant_role, contact_id, contact_method_id, address_value, display_name)
            VALUES (?, ?, ?, ?, ?, ?)`).run(item.correspondence_id, participant.role, method?.contact_id || null,
            method?.contact_method_id || null, participant.address, participant.displayName);
        }
      }
      if (ids.length) {
        const placeholders = ids.map(() => "?").join(", ");
        db.prepare(`DELETE FROM correspondence WHERE medium = 'email' AND source_account_key = ?
          AND external_id NOT IN (${placeholders})`).run(sourceAccountKey, ...ids);
      } else db.prepare("DELETE FROM correspondence WHERE medium = 'email' AND source_account_key = ?").run(sourceAccountKey);
      db.prepare(`INSERT INTO jmap_email_sync_state (source_account_key, email_state, synchronized_at_utc)
        VALUES (?, ?, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE email_state = VALUES(email_state),
        synchronized_at_utc = VALUES(synchronized_at_utc)`).run(sourceAccountKey, emailState);
      const result = { account_id: accountId, synchronized: messages.length, email_state: emailState };
      this.ledger.append({ type: "correspondence.email_synchronized", status: "complete", actorType: context.actorType || "user",
        actorName: context.actorName || "Nate", name: "Email synchronized into correspondence", payload: result });
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
