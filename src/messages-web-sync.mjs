import { createHash, randomUUID } from "node:crypto";
import { openApplicationDatabase } from "./database-connection.mjs";
import { safeJson } from "./redaction.mjs";

const protocol = "timev3.google-messages-web-sync";
const protocolVersion = 1;
const transports = new Set(["rcs", "sms", "mms", "unknown"]);
const directions = new Set(["inbound", "outbound"]);
const deliveryStatuses = new Set(["sent", "delivered", "failed", "unknown"]);
const timestampPrecisions = new Set(["minute", "second", "millisecond"]);
const participantRoles = new Set(["sender", "recipient"]);
const maximumMessagesPerBatch = 250;

export class MessagesWebSyncInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "MessagesWebSyncInputError";
    this.statusCode = statusCode;
  }
}

function requiredText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MessagesWebSyncInputError(`${label} is required.`);
  }
  const result = value.trim();
  if (result.length > maximum) throw new MessagesWebSyncInputError(`${label} is too long.`);
  return result;
}

function optionalText(value, label, maximum, { trim = true } = {}) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new MessagesWebSyncInputError(`${label} must be text.`);
  const result = trim ? value.trim() : value;
  if (result.length > maximum) throw new MessagesWebSyncInputError(`${label} is too long.`);
  return result || null;
}

function boundedArray(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new MessagesWebSyncInputError(`${label} must be an array of at most ${maximum} items.`);
  }
  return value;
}

function normalizedTextArray(value, label, maximumItems, maximumCharacters) {
  return boundedArray(value ?? [], label, maximumItems).map((item, index) => (
    requiredText(item, `${label}[${index}]`, maximumCharacters)
  ));
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) throw new MessagesWebSyncInputError(`${label} is invalid.`);
  return value;
}

function utcInstant(milliseconds, label) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new MessagesWebSyncInputError(`${label} must be a Unix timestamp in milliseconds.`);
  }
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) throw new MessagesWebSyncInputError(`${label} is invalid.`);
  return date.toISOString();
}

function canonicalHtml(value) {
  if (value == null) return null;
  const escaped = String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replace(/\r\n?|\n/gu, "<br>");
  return escaped || null;
}

function normalizedAddress(value) {
  const source = String(value ?? "").trim();
  if (!source) return null;
  if (source.includes("@")) return source.toLocaleLowerCase("en-US");
  const digits = source.replace(/\D/gu, "");
  return digits || source.toLocaleLowerCase("en-US").replace(/\s+/gu, " ");
}

function displayAddress(displayName) {
  return `display:${createHash("sha256").update(displayName.toLocaleLowerCase("en-US")).digest("hex").slice(0, 32)}`;
}

function normalizedReaction(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MessagesWebSyncInputError(`${label} must be an object.`);
  }
  const emoji = optionalText(value.emoji, `${label}.emoji`, 32);
  const type = optionalText(value.type, `${label}.type`, 100);
  const by = optionalText(value.by, `${label}.by`, 500);
  if (!emoji && !type) throw new MessagesWebSyncInputError(`${label} must identify the reaction.`);
  return { emoji, type, by };
}

function normalizedAttachment(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MessagesWebSyncInputError(`${label} must be an object.`);
  }
  return {
    kind: requiredText(value.kind, `${label}.kind`, 100),
    name: optionalText(value.name, `${label}.name`, 1000),
  };
}

function normalizedParticipant(value, label, direction) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MessagesWebSyncInputError(`${label} must be an object.`);
  }
  const address = optionalText(value.address, `${label}.address`, 512);
  const displayName = optionalText(value.displayName, `${label}.displayName`, 500);
  if (!address && !displayName) {
    throw new MessagesWebSyncInputError(`${label} must contain an address or displayName.`);
  }
  return {
    role: value.role == null
      ? (direction === "inbound" ? "sender" : "recipient")
      : enumValue(value.role, participantRoles, `${label}.role`),
    addressValue: address ?? displayAddress(displayName),
    suppliedAddress: address !== null,
    normalizedAddress: address == null ? null : normalizedAddress(address),
    displayName,
  };
}

function normalizedMessage(value, index, sourceAccountKey) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MessagesWebSyncInputError(`messages[${index}] must be an object.`);
  }
  const direction = enumValue(value.direction, directions, `messages[${index}].direction`);
  const transport = enumValue(value.transport ?? "unknown", transports, `messages[${index}].transport`);
  const occurredAtUtc = utcInstant(value.occurredAtMs, `messages[${index}].occurredAtMs`);
  const timestampPrecision = enumValue(
    value.timestampPrecision ?? "minute",
    timestampPrecisions,
    `messages[${index}].timestampPrecision`,
  );
  const text = optionalText(value.text, `messages[${index}].text`, 2_000_000, { trim: false });
  const attachments = boundedArray(value.attachments ?? [], `messages[${index}].attachments`, 100)
    .map((attachment, attachmentIndex) => normalizedAttachment(
      attachment,
      `messages[${index}].attachments[${attachmentIndex}]`,
    ));
  const reactions = boundedArray(value.reactions ?? [], `messages[${index}].reactions`, 100)
    .map((reaction, reactionIndex) => normalizedReaction(
      reaction,
      `messages[${index}].reactions[${reactionIndex}]`,
    ));
  if (text == null && attachments.length === 0) {
    throw new MessagesWebSyncInputError(`messages[${index}] has no text or attachment metadata.`);
  }
  const participants = boundedArray(value.participants ?? [], `messages[${index}].participants`, 100)
    .map((participant, participantIndex) => normalizedParticipant(
      participant,
      `messages[${index}].participants[${participantIndex}]`,
      direction,
    ));
  const uniqueParticipants = [];
  const participantKeys = new Set();
  for (const participant of participants) {
    const key = `${participant.role}\u0000${participant.addressValue}`;
    if (participantKeys.has(key)) continue;
    participantKeys.add(key);
    uniqueParticipants.push(participant);
  }
  const deliveryStatus = enumValue(
    value.deliveryStatus ?? "unknown",
    deliveryStatuses,
    `messages[${index}].deliveryStatus`,
  );
  const threadKey = requiredText(value.conversationId, `messages[${index}].conversationId`, 255);
  const externalId = requiredText(value.externalId, `messages[${index}].externalId`, 255);
  if (!/^[\x20-\x7E]+$/u.test(threadKey) || !/^[\x20-\x7E]+$/u.test(externalId)) {
    throw new MessagesWebSyncInputError(`messages[${index}] conversation and message identities must be ASCII.`);
  }
  const medium = transport === "unknown" ? "chat" : transport;
  const metadata = {
    protocol,
    transport,
    timestampPrecision,
    threadTitle: optionalText(value.threadTitle, `messages[${index}].threadTitle`, 500),
    senderName: optionalText(value.senderName, `messages[${index}].senderName`, 500),
    group: value.group === true,
    reactions,
    attachments,
    providerLabels: normalizedTextArray(
      value.providerLabels,
      `messages[${index}].providerLabels`,
      20,
      1000,
    ),
  };
  return {
    medium,
    transport,
    direction,
    sourceAccountKey,
    threadKey,
    externalId,
    body: canonicalHtml(text),
    deliveryStatus,
    providerStatus: `messages-web:${transport}:${timestampPrecision}`,
    occurredAtUtc,
    occurredAtMs: value.occurredAtMs,
    sentAtUtc: direction === "outbound" ? occurredAtUtc : null,
    receivedAtUtc: direction === "inbound" ? occurredAtUtc : null,
    timestampPrecision,
    participants: uniqueParticipants,
    sourceMetadataJson: safeJson(metadata),
  };
}

export function normalizeMessagesWebSyncBatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new MessagesWebSyncInputError("The synchronization body must be an object.");
  }
  if (input.protocol !== protocol || input.version !== protocolVersion) {
    throw new MessagesWebSyncInputError(`Expected ${protocol} version ${protocolVersion}.`);
  }
  const accountKey = requiredText(input.accountKey ?? "default", "accountKey", 96);
  if (!/^[A-Za-z0-9._-]+$/u.test(accountKey)) {
    throw new MessagesWebSyncInputError("accountKey must use only ASCII letters, digits, dot, underscore, or hyphen.");
  }
  const syncId = requiredText(input.syncId, "syncId", 128);
  if (!/^[A-Za-z0-9._-]+$/u.test(syncId)) {
    throw new MessagesWebSyncInputError("syncId must be an opaque ASCII identifier.");
  }
  const sourceAccountKey = `google-messages-web:${accountKey}`;
  const messages = boundedArray(input.messages ?? [], "messages", maximumMessagesPerBatch)
    .map((message, index) => normalizedMessage(message, index, sourceAccountKey));
  const identities = new Set();
  for (const message of messages) {
    const identity = `${message.sourceAccountKey}\u0000${message.externalId}`;
    if (identities.has(identity)) {
      throw new MessagesWebSyncInputError("A synchronization batch cannot contain duplicate message identities.");
    }
    identities.add(identity);
  }
  return { protocol, version: protocolVersion, accountKey, syncId, sourceAccountKey, messages };
}

function contactForParticipant(database, participant) {
  if (participant.suppliedAddress && participant.normalizedAddress) {
    const rows = database.prepare(`
      SELECT method.contact_method_id, method.contact_id
      FROM contact_methods AS method
      JOIN contacts AS contact USING (contact_id)
      WHERE method.normalized_value = ? AND contact.status = 'active'
      ORDER BY method.contact_id, method.contact_method_id
    `).all(participant.normalizedAddress);
    const contactIds = new Set(rows.map((row) => Number(row.contact_id)));
    if (contactIds.size === 1) {
      return { contactId: Number(rows[0].contact_id), contactMethodId: Number(rows[0].contact_method_id) };
    }
  }
  if (participant.displayName) {
    const contacts = database.prepare(`
      SELECT contact_id FROM contacts
      WHERE status = 'active' AND display_name = ?
      ORDER BY contact_id
    `).all(participant.displayName);
    if (contacts.length === 1) {
      const contactId = Number(contacts[0].contact_id);
      const methods = database.prepare(`
        SELECT contact_method_id FROM contact_methods
        WHERE contact_id = ? AND method_kind = 'phone'
        ORDER BY is_primary DESC, contact_method_id
      `).all(contactId);
      return {
        contactId,
        contactMethodId: methods.length ? Number(methods[0].contact_method_id) : null,
      };
    }
  }
  return { contactId: null, contactMethodId: null };
}

function resolvedParticipants(database, participants) {
  return participants.map((participant) => ({
    ...participant,
    ...contactForParticipant(database, participant),
  }));
}

function setsEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function candidateMatchesParticipants(database, candidateId, webParticipants) {
  const candidate = database.prepare(`
    SELECT contact_id, address_value FROM correspondence_participants_join
    WHERE correspondence_id = ? ORDER BY participant_role, address_value
  `).all(candidateId);
  if (candidate.length !== webParticipants.length || candidate.length === 0) return false;
  const webContactIds = webParticipants.map(({ contactId }) => contactId).filter((id) => id != null).toSorted((a, b) => a - b);
  const candidateContactIds = candidate.map(({ contact_id: id }) => id == null ? null : Number(id))
    .filter((id) => id != null).toSorted((a, b) => a - b);
  if (webContactIds.length === webParticipants.length && candidateContactIds.length === candidate.length) {
    return setsEqual(webContactIds, candidateContactIds);
  }
  if (!webParticipants.every(({ suppliedAddress, normalizedAddress: address }) => suppliedAddress && address)) {
    return false;
  }
  const webAddresses = webParticipants.map(({ normalizedAddress: address }) => address).toSorted();
  const candidateAddresses = candidate.map(({ address_value: address }) => normalizedAddress(address)).filter(Boolean).toSorted();
  return setsEqual(webAddresses, candidateAddresses);
}

function duplicateWindowMilliseconds(precision) {
  if (precision === "minute") return 59_999;
  if (precision === "second") return 999;
  return 0;
}

function duplicateCandidates(database, item, participants) {
  if (item.transport === "rcs") return [];
  const media = item.transport === "sms"
    ? ["sms"]
    : item.transport === "mms"
      ? ["mms"]
      : ["sms", "mms"];
  const window = duplicateWindowMilliseconds(item.timestampPrecision);
  const earliest = new Date(item.occurredAtMs - window).toISOString();
  const latest = new Date(item.occurredAtMs + window).toISOString();
  const placeholders = media.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT message.correspondence_id, message.medium
    FROM correspondence AS message
    WHERE message.medium IN (${placeholders})
      AND message.direction = ?
      AND message.occurred_at_utc BETWEEN ? AND ?
      AND message.body <=> ?
      AND (
        message.source_account_key LIKE 'android:%'
        OR EXISTS (
          SELECT 1 FROM correspondence_source_aliases AS phone_alias
          WHERE phone_alias.correspondence_id = message.correspondence_id
            AND phone_alias.source_account_key LIKE 'android:%'
        )
      )
    ORDER BY message.correspondence_id
  `).all(...media, item.direction, earliest, latest, item.body);
  return rows.filter((row) => candidateMatchesParticipants(
    database,
    Number(row.correspondence_id),
    participants,
  ));
}

function correspondenceFingerprint(item, participants) {
  const identities = participants.map((participant) => (
    participant.contactId == null
      ? normalizedAddress(participant.addressValue)
      : `contact:${participant.contactId}`
  )).filter(Boolean).toSorted();
  return createHash("sha256").update(JSON.stringify({
    version: 2,
    medium: item.medium,
    direction: item.direction,
    occurredAtUtc: item.occurredAtUtc,
    participants: identities,
    body: item.body,
  })).digest("hex");
}

function upsertMessages(database, batch, sourceEventId, now) {
  const findPrimary = database.prepare(`
    SELECT correspondence_id, medium FROM correspondence
    WHERE source_account_key = ? AND external_id = ?
    ORDER BY correspondence_id
  `);
  const findAlias = database.prepare(`
    SELECT correspondence_id, medium FROM correspondence_source_aliases
    WHERE source_account_key = ? AND external_id = ?
    ORDER BY correspondence_source_alias_id
  `);
  const insert = database.prepare(`
    INSERT INTO correspondence (
      medium, direction, source_account_key, thread_key, external_id, dedupe_fingerprint,
      body, delivery_status, provider_status, source_metadata_json,
      occurred_at_utc, sent_at_utc, received_at_utc, source_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = database.prepare(`
    UPDATE correspondence SET medium = ?, direction = ?, thread_key = ?, body = ?,
      delivery_status = ?, provider_status = ?, source_metadata_json = ?,
      occurred_at_utc = ?, sent_at_utc = ?, received_at_utc = ?, dedupe_fingerprint = ?
    WHERE correspondence_id = ?
  `);
  const insertAlias = database.prepare(`
    INSERT INTO correspondence_source_aliases (
      correspondence_id, medium, source_account_key, thread_key, external_id,
      provider_status, source_metadata_json, source_event_id,
      first_observed_at_utc, last_observed_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateAlias = database.prepare(`
    UPDATE correspondence_source_aliases
    SET thread_key = ?, provider_status = ?, source_metadata_json = ?, last_observed_at_utc = ?
    WHERE source_account_key = ? AND external_id = ?
  `);
  const deleteParticipants = database.prepare(
    "DELETE FROM correspondence_participants_join WHERE correspondence_id = ?",
  );
  const insertParticipant = database.prepare(`
    INSERT INTO correspondence_participants_join (
      correspondence_id, participant_role, contact_id, contact_method_id,
      address_value, display_name
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const counts = {
    created: 0,
    updated: 0,
    deduplicated: 0,
    ambiguous: 0,
    unresolvedParticipants: 0,
  };
  for (const item of batch.messages) {
    const primaries = findPrimary.all(item.sourceAccountKey, item.externalId);
    const aliases = primaries.length ? [] : findAlias.all(item.sourceAccountKey, item.externalId);
    if (primaries.length > 1 || aliases.length > 1) {
      throw new Error(`Google Messages source identity ${item.externalId} is not unique.`);
    }
    const participants = resolvedParticipants(database, item.participants);
    counts.unresolvedParticipants += participants.filter(({ contactId }) => contactId == null).length;
    const fingerprint = correspondenceFingerprint(item, participants);
    let correspondenceId;
    let replaceParticipants = true;
    if (primaries.length === 1) {
      correspondenceId = Number(primaries[0].correspondence_id);
      update.run(
        item.medium, item.direction, item.threadKey, item.body, item.deliveryStatus,
        item.providerStatus, item.sourceMetadataJson, item.occurredAtUtc,
        item.sentAtUtc, item.receivedAtUtc, fingerprint, correspondenceId,
      );
      counts.updated += 1;
    } else if (aliases.length === 1) {
      correspondenceId = Number(aliases[0].correspondence_id);
      replaceParticipants = false;
      updateAlias.run(
        item.threadKey, item.providerStatus, item.sourceMetadataJson, now,
        item.sourceAccountKey, item.externalId,
      );
      counts.updated += 1;
    } else {
      const candidates = duplicateCandidates(database, item, participants);
      if (candidates.length === 1) {
        correspondenceId = Number(candidates[0].correspondence_id);
        replaceParticipants = false;
        insertAlias.run(
          correspondenceId, candidates[0].medium, item.sourceAccountKey,
          item.threadKey, item.externalId, item.providerStatus,
          item.sourceMetadataJson, sourceEventId, now, now,
        );
        counts.deduplicated += 1;
      } else {
        if (candidates.length > 1) counts.ambiguous += 1;
        const created = insert.run(
          item.medium, item.direction, item.sourceAccountKey, item.threadKey,
          item.externalId, fingerprint, item.body, item.deliveryStatus,
          item.providerStatus, item.sourceMetadataJson, item.occurredAtUtc,
          item.sentAtUtc, item.receivedAtUtc, sourceEventId,
        );
        correspondenceId = Number(created.lastInsertRowid);
        counts.created += 1;
      }
    }
    if (!replaceParticipants) continue;
    deleteParticipants.run(correspondenceId);
    for (const participant of participants) {
      insertParticipant.run(
        correspondenceId,
        participant.role,
        participant.contactId,
        participant.contactMethodId,
        participant.addressValue,
        participant.displayName,
      );
    }
  }
  return counts;
}

export class MessagesWebSyncService {
  constructor({ databaseTarget }) {
    this.database = openApplicationDatabase(databaseTarget);
  }

  close() {
    this.database.close();
  }

  synchronize(input) {
    const batch = normalizeMessagesWebSyncBatch(input);
    const eventId = randomUUID();
    const now = new Date().toISOString();
    this.database.exec("START TRANSACTION");
    try {
      this.database.prepare(`
        INSERT INTO activity_events (
          event_id, event_type, event_phase, status, actor_type, actor_name,
          source, channel, name, content_text, payload_json, subject_type, subject_id
        ) VALUES (?, 'correspondence.sync', 'point', 'complete', 'external', ?,
          'google_messages_web', 'browser_extension', 'Google Messages correspondence synchronized', ?, ?,
          'correspondence_sync_batch', ?)
      `).run(
        eventId,
        batch.accountKey,
        `${batch.messages.length} Google Messages communications received`,
        safeJson({
          protocol: batch.protocol,
          version: batch.version,
          accountKey: batch.accountKey,
          syncId: batch.syncId,
          receivedMessages: batch.messages.length,
        }),
        eventId,
      );
      const correspondence = upsertMessages(this.database, batch, eventId, now);
      const result = {
        protocol: batch.protocol,
        version: batch.version,
        status: "complete",
        synchronizedAtUtc: now,
        messages: { received: batch.messages.length, ...correspondence },
      };
      this.database.prepare(`
        UPDATE activity_events SET content_text = ?, payload_json = ? WHERE event_id = ?
      `).run(
        `${correspondence.created} new, ${correspondence.deduplicated} phone duplicates linked, ${correspondence.updated} refreshed, and ${correspondence.ambiguous} ambiguous candidates retained separately`,
        safeJson({ ...result, accountKey: batch.accountKey, syncId: batch.syncId }),
        eventId,
      );
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  status(accountKeyValue = "default") {
    const accountKey = requiredText(accountKeyValue, "accountKey", 96);
    if (!/^[A-Za-z0-9._-]+$/u.test(accountKey)) {
      throw new MessagesWebSyncInputError("accountKey is invalid.");
    }
    const sourceAccountKey = `google-messages-web:${accountKey}`;
    const rows = this.database.prepare(`
      SELECT medium, COUNT(*) AS count, MAX(occurred_at_utc) AS latest_at_utc
      FROM (
        SELECT correspondence_id, medium, occurred_at_utc
        FROM correspondence WHERE source_account_key = ?
        UNION
        SELECT correspondence.correspondence_id, correspondence.medium,
          correspondence.occurred_at_utc
        FROM correspondence_source_aliases AS alias
        JOIN correspondence USING (correspondence_id)
        WHERE alias.source_account_key = ?
      ) AS observed
      GROUP BY medium ORDER BY medium
    `).all(sourceAccountKey, sourceAccountKey);
    return {
      accountKey,
      media: rows.map((row) => ({
        medium: row.medium,
        count: Number(row.count),
        latestAtUtc: row.latest_at_utc ?? null,
      })),
    };
  }
}

export const messagesWebSyncProtocol = Object.freeze({
  name: protocol,
  version: protocolVersion,
  maximumMessagesPerBatch,
});
