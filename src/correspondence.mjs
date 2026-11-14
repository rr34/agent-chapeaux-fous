import { randomUUID } from "node:crypto";
import { currentPersonId, runWithPerson } from "./person-context.mjs";

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

function optionalUtcInstant(value, label) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be an RFC 3339 timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be an RFC 3339 timestamp`);
  return parsed.toISOString();
}

function contactTagSlug(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 200) {
    throw new Error("participant_tag must contain at most 200 characters");
  }
  const slug = value.trim().normalize("NFKD").replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US").replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!slug) throw new Error("participant_tag must contain a letter or number");
  return slug;
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

function sourceMetadata(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
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

function publicItem(row, participants = [], todos = [], calendarEvents = [], mailboxes = [], sourceObservations = []) {
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
    source_metadata: sourceMetadata(row.source_metadata_json),
    source_observations: sourceObservations,
    is_read: row.medium === "email" ? keywords.includes("$seen") : null,
    mailboxes,
    participants,
    linked_todos: todos,
    linked_calendar_events: calendarEvents,
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
  constructor({ store, ledger, jmap, identityStore = null }) {
    this.store = store;
    this.ledger = ledger;
    this.jmap = jmap;
    this.identityStore = identityStore;
    this.emailSyncProgress = { status: "idle", phase: null, processed: 0, total: null };
  }

  get database() { return this.store.requireReady(); }

  timeV3Recipients() {
    return this.database.prepare(`SELECT contact.contact_id, contact.display_name,
        method.contact_method_id, method.normalized_value AS person_id
      FROM contacts AS contact JOIN contact_methods AS method USING (contact_id)
      WHERE contact.status = 'active' AND method.method_kind = 'timev3_person'
        AND method.can_receive = 1
      ORDER BY contact.display_name, contact.contact_id, method.contact_method_id`).all().map((row) => ({
      contact_id: Number(row.contact_id),
      display_name: row.display_name,
      contact_method_id: Number(row.contact_method_id),
      person_id: Number(row.person_id),
    })).filter((recipient) => this.identityStore?.activePerson(recipient.person_id));
  }

  sendTimeV3Text({ contactId, text }, context = {}) {
    if (!this.identityStore) throw Object.assign(new Error("Time v3 identity is required for native messages."), { statusCode: 503 });
    const senderPersonId = currentPersonId();
    const normalizedContactId = positiveId(contactId, "contactId");
    if (typeof text !== "string" || !text.trim() || text.length > 20_000) {
      throw Object.assign(new Error("text must contain 1 through 20,000 characters"), { statusCode: 400 });
    }
    const body = canonicalHtml(text);
    const recipient = this.database.prepare(`SELECT contact.contact_id, contact.display_name,
        method.contact_method_id, method.normalized_value AS person_id
      FROM contacts AS contact JOIN contact_methods AS method USING (contact_id)
      WHERE contact.contact_id = ? AND contact.status = 'active'
        AND method.method_kind = 'timev3_person' AND method.can_receive = 1
      ORDER BY method.is_primary DESC, method.contact_method_id LIMIT 1`).get(normalizedContactId);
    if (!recipient) throw Object.assign(new Error("Choose an active contact with a receivable Time v3 person method."), { statusCode: 404 });
    const recipientPersonId = positiveId(recipient.person_id, "recipient person id");
    if (recipientPersonId === senderPersonId) throw Object.assign(new Error("A Time v3 message recipient must be another person."), { statusCode: 409 });
    const sender = this.identityStore.activePerson(senderPersonId);
    const target = this.identityStore.activePerson(recipientPersonId);
    if (!sender || !target) throw Object.assign(new Error("The Time v3 recipient is unavailable."), { statusCode: 404 });

    const externalId = randomUUID();
    const occurredAt = new Date().toISOString();
    const database = this.database;
    const insertMessage = database.prepare(`INSERT INTO correspondence
      (medium, direction, source_account_key, thread_key, external_id, body,
       delivery_status, occurred_at_utc, sent_at_utc, received_at_utc, source_event_id)
      VALUES ('timev3', ?, 'timev3', ?, ?, ?, 'delivered', ?, ?, ?, ?)`);
    const insertParticipant = database.prepare(`INSERT INTO correspondence_participants_join
      (correspondence_id, participant_role, contact_id, contact_method_id, address_value, display_name)
      VALUES (?, ?, ?, ?, ?, ?)`);

    database.exec("START TRANSACTION");
    try {
      const senderEventId = this.ledger.append({
        type: "correspondence.timev3_sent", status: "complete",
        actorType: context.actorType || "user", actorName: context.actorName || sender.displayName,
        source: context.source || "timev3", channel: context.channel || "web",
        name: "Time v3 message sent", content: text,
        payload: { externalId, recipientPersonId },
      });
      const sent = insertMessage.run("outbound", `timev3:${recipientPersonId}`, externalId,
        body, occurredAt, occurredAt, occurredAt, senderEventId);
      const sentId = Number(sent.lastInsertRowid);
      insertParticipant.run(sentId, "recipient", Number(recipient.contact_id),
        Number(recipient.contact_method_id), `timev3:${recipientPersonId}`, target.displayName);

      const receivedId = runWithPerson(recipientPersonId, () => {
        const knownSenderMethods = database.prepare(`SELECT contact.contact_id, contact.status, method.contact_method_id
          FROM contacts AS contact JOIN contact_methods AS method USING (contact_id)
          WHERE method.method_kind = 'timev3_person'
            AND method.normalized_value = ? ORDER BY method.is_primary DESC, method.contact_method_id`).all(String(senderPersonId));
        if (knownSenderMethods.some(({ status }) => status === "blocked")) {
          throw Object.assign(new Error("The Time v3 recipient is unavailable."), { statusCode: 404 });
        }
        let senderMethod = knownSenderMethods.find(({ status }) => status === "active") ?? null;
        if (!senderMethod && target.contactPolicy === "manager_managed") {
          throw Object.assign(new Error("The Time v3 recipient is unavailable."), { statusCode: 404 });
        }
        if (!senderMethod && knownSenderMethods.length === 0) {
          const contact = database.prepare(`INSERT INTO contacts
            (contact_kind, display_name, status, source, external_id)
            VALUES ('person', ?, 'active', 'timev3', ?)`).run(sender.displayName, `person:${senderPersonId}`);
          const createdContactId = Number(contact.lastInsertRowid);
          const method = database.prepare(`INSERT INTO contact_methods
            (contact_id, method_kind, label, value, normalized_value, is_primary, can_receive)
            VALUES (?, 'timev3_person', 'Time v3', ?, ?, 1, 1)`).run(
            createdContactId, sender.handle || String(senderPersonId), String(senderPersonId),
          );
          senderMethod = { contact_id: createdContactId, contact_method_id: Number(method.lastInsertRowid) };
        }
        const recipientEventId = this.ledger.append({
          type: "correspondence.timev3_received", status: "complete",
          actorType: "external", actorName: sender.displayName, source: "timev3", channel: "timev3",
          name: "Time v3 message received", content: text,
          payload: { externalId, senderPersonId },
        });
        const received = insertMessage.run("inbound", `timev3:${senderPersonId}`, externalId,
          body, occurredAt, occurredAt, occurredAt, recipientEventId);
        const id = Number(received.lastInsertRowid);
        insertParticipant.run(id, "sender", senderMethod?.contact_id == null ? null : Number(senderMethod.contact_id),
          senderMethod?.contact_method_id == null ? null : Number(senderMethod.contact_method_id),
          `timev3:${senderPersonId}`, sender.displayName);
        return id;
      });
      database.exec("COMMIT");
      return {
        external_id: externalId,
        sent_correspondence_id: sentId,
        received_correspondence_id: receivedId,
        recipient: { contact_id: normalizedContactId, person_id: recipientPersonId, display_name: target.displayName },
        occurred_at_utc: occurredAt,
      };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

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

  list({
    q = "", medium = null, direction = null, mailboxId = null,
    occurredFromUtc = null, occurredBeforeUtc = null, participantTag = null,
    groupBy = "none", limit = 100, offset = 0,
  } = {}) {
    limit = Math.min(200, Math.max(1, Number(limit) || 100));
    offset = Math.max(0, Number(offset) || 0);
    occurredFromUtc = optionalUtcInstant(occurredFromUtc, "occurred_from_utc");
    occurredBeforeUtc = optionalUtcInstant(occurredBeforeUtc, "occurred_before_utc");
    if (occurredFromUtc && occurredBeforeUtc && occurredFromUtc >= occurredBeforeUtc) {
      throw new Error("occurred_from_utc must be earlier than occurred_before_utc");
    }
    const participantTagSlug = contactTagSlug(participantTag);
    if (!["none", "contact"].includes(groupBy)) throw new Error("group_by must be none or contact");
    const where = [];
    const values = [];
    if (q.trim()) {
      where.push("(correspondence.subject LIKE ? OR correspondence.body LIKE ?)");
      values.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }
    if (medium) { where.push("correspondence.medium = ?"); values.push(medium); }
    if (direction) { where.push("correspondence.direction = ?"); values.push(direction); }
    if (occurredFromUtc) {
      where.push("correspondence.occurred_at_utc >= ?");
      values.push(occurredFromUtc);
    }
    if (occurredBeforeUtc) {
      where.push("correspondence.occurred_at_utc < ?");
      values.push(occurredBeforeUtc);
    }
    if (mailboxId) {
      where.push(`EXISTS (SELECT 1 FROM correspondence_email_mailboxes_join AS selected_mailbox
        WHERE selected_mailbox.correspondence_id = correspondence.correspondence_id
          AND selected_mailbox.mailbox_id = ?)`);
      values.push(mailboxId);
    }
    if (groupBy === "contact") {
      where.push("contact.status <> 'inactive'");
      if (participantTagSlug) {
        where.push(`EXISTS (SELECT 1 FROM contacts_tags_join AS selected_assignment
          JOIN tags AS selected_tag USING (tag_id)
          WHERE selected_assignment.record_type = 'contact'
            AND selected_assignment.record_id = CAST(contact.contact_id AS CHAR)
            AND selected_tag.is_active = 1 AND selected_tag.slug = ?)`);
        values.push(participantTagSlug);
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const rows = this.database.prepare(`SELECT contact.contact_id, contact.display_name,
          COUNT(DISTINCT correspondence.correspondence_id) AS correspondence_count,
          MIN(correspondence.occurred_at_utc) AS earliest_at_utc,
          MAX(correspondence.occurred_at_utc) AS latest_at_utc,
          GROUP_CONCAT(DISTINCT correspondence.medium ORDER BY correspondence.medium SEPARATOR ',') AS media,
          GROUP_CONCAT(DISTINCT correspondence.direction ORDER BY correspondence.direction SEPARATOR ',') AS directions
        FROM correspondence AS correspondence
        JOIN correspondence_participants_join AS grouped_participant USING (correspondence_id)
        JOIN contacts AS contact USING (contact_id)
        ${clause}
        GROUP BY contact.contact_id, contact.display_name
        ORDER BY latest_at_utc DESC, contact.contact_id DESC LIMIT ? OFFSET ?`)
        .all(...values, limit + 1, offset);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const tagsByContact = new Map();
      if (page.length) {
        const placeholders = page.map(() => "?").join(", ");
        for (const row of this.database.prepare(`SELECT assignment.record_id AS contact_id,
            tag.slug, tag.label
          FROM contacts_tags_join AS assignment JOIN tags AS tag USING (tag_id)
          WHERE assignment.record_type = 'contact' AND tag.is_active = 1
            AND assignment.record_id IN (${placeholders})
          ORDER BY assignment.record_id, tag.label, tag.tag_id`).all(...page.map(({ contact_id: id }) => String(id)))) {
          const id = Number(row.contact_id);
          tagsByContact.set(id, [...(tagsByContact.get(id) || []), { slug: row.slug, label: row.label }]);
        }
      }
      return {
        result_type: "contacts",
        items: [],
        contact_groups: page.map((row) => ({
          contact_id: Number(row.contact_id),
          display_name: row.display_name,
          tags: tagsByContact.get(Number(row.contact_id)) || [],
          correspondence_count: Number(row.correspondence_count),
          earliest_at_utc: row.earliest_at_utc,
          latest_at_utc: row.latest_at_utc,
          media: row.media ? String(row.media).split(",") : [],
          directions: row.directions ? String(row.directions).split(",") : [],
        })),
        mailboxes: this.#mailboxes(),
        contact_tags: this.#contactTags(),
        count: page.length,
        limit,
        offset,
        has_more: hasMore,
      };
    }
    if (participantTagSlug) {
      where.push(`EXISTS (SELECT 1 FROM correspondence_participants_join AS selected_participant
        JOIN contacts AS selected_contact USING (contact_id)
        JOIN contacts_tags_join AS selected_assignment
          ON selected_assignment.record_type = 'contact'
         AND selected_assignment.record_id = CAST(selected_contact.contact_id AS CHAR)
        JOIN tags AS selected_tag USING (tag_id)
        WHERE selected_participant.correspondence_id = correspondence.correspondence_id
          AND selected_contact.status <> 'inactive'
          AND selected_tag.is_active = 1 AND selected_tag.slug = ?)`);
      values.push(participantTagSlug);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const rowsWithSentinel = this.database.prepare(`SELECT correspondence.* FROM correspondence AS correspondence ${clause}
      ORDER BY correspondence.occurred_at_utc DESC, correspondence.correspondence_id DESC LIMIT ? OFFSET ?`)
      .all(...values, limit + 1, offset);
    const hasMore = rowsWithSentinel.length > limit;
    const rows = rowsWithSentinel.slice(0, limit);
    const ids = rows.map((row) => Number(row.correspondence_id));
    const participants = new Map();
    const todos = new Map();
    const calendarEvents = new Map();
    const mailboxes = new Map();
    const sourceObservations = new Map();
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
      for (const row of this.database.prepare(`SELECT link.correspondence_id, event.calendar_event_id,
          event.title, event.starts_at_utc, event.ends_at_utc, event.time_zone, event.is_all_day, event.status
        FROM calendar_events_correspondence_join AS link
        JOIN calendar_events AS event USING (calendar_event_id)
        WHERE link.correspondence_id IN (${placeholders})
        ORDER BY link.correspondence_id, event.starts_at_utc, event.calendar_event_id`).all(...ids)) {
        const id = Number(row.correspondence_id);
        const valuesForItem = calendarEvents.get(id) || [];
        valuesForItem.push({
          calendar_event_id: Number(row.calendar_event_id),
          title: row.title,
          starts_at_utc: row.starts_at_utc,
          ends_at_utc: row.ends_at_utc ?? null,
          time_zone: row.time_zone ?? null,
          is_all_day: Boolean(row.is_all_day),
          status: row.status,
        });
        calendarEvents.set(id, valuesForItem);
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
      for (const row of this.database.prepare(`SELECT correspondence_id, medium, source_account_key,
          thread_key, external_id, provider_status, source_metadata_json,
          first_observed_at_utc, last_observed_at_utc
        FROM correspondence_source_aliases
        WHERE correspondence_id IN (${placeholders})
        ORDER BY correspondence_id, first_observed_at_utc, correspondence_source_alias_id`).all(...ids)) {
        const id = Number(row.correspondence_id);
        const valuesForItem = sourceObservations.get(id) || [];
        valuesForItem.push({
          medium: row.medium,
          source_account_key: row.source_account_key,
          thread_key: row.thread_key ?? null,
          external_id: row.external_id,
          provider_status: row.provider_status ?? null,
          source_metadata: sourceMetadata(row.source_metadata_json),
          first_observed_at_utc: row.first_observed_at_utc,
          last_observed_at_utc: row.last_observed_at_utc,
        });
        sourceObservations.set(id, valuesForItem);
      }
    }
    return {
      result_type: "items",
      items: rows.map((row) => publicItem(row, participants.get(Number(row.correspondence_id)) || [],
        todos.get(Number(row.correspondence_id)) || [], calendarEvents.get(Number(row.correspondence_id)) || [],
        mailboxes.get(Number(row.correspondence_id)) || [],
        sourceObservations.get(Number(row.correspondence_id)) || [])),
      contact_groups: [],
      mailboxes: this.#mailboxes(),
      contact_tags: this.#contactTags(),
      count: rows.length,
      limit,
      offset,
      has_more: hasMore,
    };
  }

  #mailboxes() {
    return this.database.prepare(`SELECT mailbox_id, name, role, parent_mailbox_id
      FROM jmap_email_mailboxes ORDER BY sort_order, name, mailbox_id`).all();
  }

  #contactTags() {
    return this.database.prepare(`SELECT tag.slug, tag.label, COUNT(contact.contact_id) AS contact_count
      FROM tags AS tag
      LEFT JOIN contacts_tags_join AS assignment
        ON assignment.tag_id = tag.tag_id AND assignment.record_type = 'contact'
      LEFT JOIN contacts AS contact
        ON assignment.record_id = CAST(contact.contact_id AS CHAR) AND contact.status <> 'inactive'
      WHERE tag.is_active = 1
      GROUP BY tag.tag_id, tag.slug, tag.label
      ORDER BY tag.label, tag.tag_id`).all().map((row) => ({
      slug: row.slug, label: row.label, contact_count: Number(row.contact_count),
    }));
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

  setCalendarEventLinks({ links }, context = {}) {
    if (!Array.isArray(links) || !links.length || links.length > 500) {
      throw new Error("links must contain 1 through 500 items");
    }
    const normalized = links.map((link) => {
      if (typeof link.linked !== "boolean") throw new Error("linked must be a boolean");
      return {
        correspondenceId: positiveId(link.correspondence_id, "correspondence_id"),
        calendarEventId: positiveId(link.calendar_event_id, "calendar_event_id"),
        linked: link.linked,
      };
    });
    const keys = normalized.map((link) => `${link.correspondenceId}:${link.calendarEventId}`);
    if (new Set(keys).size !== keys.length) {
      throw new Error("links cannot contain the same correspondence and calendar event pair more than once");
    }

    const db = this.database;
    db.exec("START TRANSACTION");
    try {
      for (const link of normalized) {
        if (!db.prepare("SELECT 1 FROM correspondence WHERE correspondence_id = ?").get(link.correspondenceId)) {
          throw new Error(`Correspondence ${link.correspondenceId} not found`);
        }
        if (!db.prepare("SELECT 1 FROM calendar_events WHERE calendar_event_id = ?").get(link.calendarEventId)) {
          throw new Error(`Calendar event ${link.calendarEventId} not found`);
        }
      }
      const results = normalized.map((link) => {
        const write = link.linked
          ? db.prepare(`INSERT INTO calendar_events_correspondence_join (calendar_event_id, correspondence_id)
              VALUES (?, ?) ON DUPLICATE KEY UPDATE created_at_utc = created_at_utc`)
            .run(link.calendarEventId, link.correspondenceId)
          : db.prepare(`DELETE FROM calendar_events_correspondence_join
              WHERE calendar_event_id = ? AND correspondence_id = ?`)
            .run(link.calendarEventId, link.correspondenceId);
        return {
          correspondence_id: link.correspondenceId,
          calendar_event_id: link.calendarEventId,
          linked: link.linked,
          changed: Number(write?.changes || 0) > 0,
        };
      });
      const result = {
        selected_count: results.length,
        changed_count: results.filter(({ changed }) => changed).length,
        unchanged_count: results.filter(({ changed }) => !changed).length,
        results,
      };
      this.ledger.append({
        type: "correspondence.calendar_event_links_updated", status: "complete",
        actorType: context.actorType || "tool",
        actorName: context.actorName || "correspondence_calendar_event_link_set",
        turnId: context.requestId, operationId: context.callId,
        name: "Correspondence calendar-event links updated", payload: result,
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
