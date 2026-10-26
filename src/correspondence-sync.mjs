import { createHash, randomUUID } from "node:crypto";
import { openApplicationDatabase } from "./database-connection.mjs";
import { safeJson } from "./redaction.mjs";

const protocol = "timev3.android-correspondence-sync";
const protocolVersion = 1;
const correspondenceMedia = new Set(["sms", "mms", "call"]);
const directions = new Set(["inbound", "outbound"]);
const callDispositions = new Set(["answered", "missed"]);
const deliveryStatuses = new Set(["sent", "delivered", "failed", "unknown"]);

export class CorrespondenceSyncInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "CorrespondenceSyncInputError";
    this.statusCode = statusCode;
  }
}

function requiredText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim()) {
    throw new CorrespondenceSyncInputError(`${label} is required.`);
  }
  const result = value.trim();
  if (result.length > maximum) throw new CorrespondenceSyncInputError(`${label} is too long.`);
  return result;
}

function optionalText(value, label, maximum) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new CorrespondenceSyncInputError(`${label} must be text.`);
  const result = value.trim();
  if (result.length > maximum) throw new CorrespondenceSyncInputError(`${label} is too long.`);
  return result || null;
}

function optionalBody(value, label, maximum) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new CorrespondenceSyncInputError(`${label} must be text.`);
  if (value.length > maximum) throw new CorrespondenceSyncInputError(`${label} is too long.`);
  return value;
}

function boundedArray(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new CorrespondenceSyncInputError(`${label} must be an array of at most ${maximum} items.`);
  }
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) throw new CorrespondenceSyncInputError(`${label} is invalid.`);
  return value;
}

function optionalNonnegativeInteger(value, label) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CorrespondenceSyncInputError(`${label} must be a nonnegative integer.`);
  }
  return value;
}

function utcInstant(milliseconds, label) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new CorrespondenceSyncInputError(`${label} must be a Unix timestamp in milliseconds.`);
  }
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    throw new CorrespondenceSyncInputError(`${label} is not a valid timestamp.`);
  }
  return date.toISOString();
}

function normalizePhone(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/gu, "");
  if (!digits) return trimmed.toLocaleLowerCase().replace(/\s+/gu, " ");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

function normalizeEmail(value) {
  const result = String(value ?? "").trim().toLocaleLowerCase();
  return result || null;
}

function canonicalHtml(value) {
  if (value == null) return null;
  const text = String(value);
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replace(/\r\n?|\n/gu, "<br>");
  return escaped || null;
}

function canonicalInstant(value) {
  if (value instanceof Date) return value.toISOString();
  const source = String(value ?? "").trim();
  const parsed = new Date(/Z$|[+-]\d\d:\d\d$/u.test(source)
    ? source
    : `${source.replace(" ", "T")}Z`);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Cannot fingerprint invalid correspondence timestamp: ${source || "empty"}`);
  }
  return parsed.toISOString();
}

function normalizedParticipantAddress(value) {
  const source = String(value ?? "").trim();
  if (!source) return null;
  if (source.includes("@")) return normalizeEmail(source);
  const digits = source.replace(/\D/gu, "");
  return digits || source.toLocaleLowerCase().replace(/\s+/gu, " ");
}

export function androidCorrespondenceDedupeIdentity(item) {
  const participants = [...new Set((item.participants ?? [])
    .map((participant) => normalizedParticipantAddress(
      participant.addressValue ?? participant.address,
    ))
    .filter(Boolean))].sort();
  return JSON.stringify({
    version: 1,
    medium: item.medium,
    direction: item.direction,
    occurredAtUtc: canonicalInstant(item.occurredAtUtc ?? item.occurred_at_utc),
    participants,
    body: item.medium === "call" ? null : (item.body ?? null),
    callDisposition: item.medium === "call"
      ? (item.callDisposition ?? item.call_disposition ?? null)
      : null,
    callDurationSeconds: item.medium === "call" && (item.callDurationSeconds
      ?? item.call_duration_seconds) != null
      ? Number(item.callDurationSeconds ?? item.call_duration_seconds)
      : null,
  });
}

export function androidCorrespondenceDedupeFingerprint(item) {
  return createHash("sha256").update(androidCorrespondenceDedupeIdentity(item)).digest("hex");
}

function normalizedContact(input, index) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CorrespondenceSyncInputError(`contacts[${index}] must be an object.`);
  }
  const methods = boundedArray(input.methods ?? [], `contacts[${index}].methods`, 100).map((method, methodIndex) => {
    if (!method || typeof method !== "object" || Array.isArray(method)) {
      throw new CorrespondenceSyncInputError(`contacts[${index}].methods[${methodIndex}] must be an object.`);
    }
    const kind = enumValue(method.kind, new Set(["phone", "email"]), `contacts[${index}].methods[${methodIndex}].kind`);
    const value = requiredText(method.value, `contacts[${index}].methods[${methodIndex}].value`, 2000);
    return {
      kind,
      label: optionalText(method.label, `contacts[${index}].methods[${methodIndex}].label`, 255),
      value,
      normalizedValue: kind === "phone" ? normalizePhone(value) : normalizeEmail(value),
      isPrimary: method.isPrimary === true,
    };
  });
  const uniqueMethods = [];
  const methodKeys = new Set();
  for (const method of methods) {
    if (method.normalizedValue && method.normalizedValue.length > 512) {
      throw new CorrespondenceSyncInputError(`contacts[${index}] contains a method that is too long to match.`);
    }
    const key = `${method.kind}\u0000${method.normalizedValue}`;
    if (!method.normalizedValue || methodKeys.has(key)) continue;
    methodKeys.add(key);
    uniqueMethods.push(method);
  }
  return {
    externalId: createHash("sha256")
      .update(requiredText(input.externalId, `contacts[${index}].externalId`, 512))
      .digest("hex"),
    providerUpdatedAtUtc: input.updatedAtMs == null
      ? null
      : utcInstant(input.updatedAtMs, `contacts[${index}].updatedAtMs`),
    displayName: requiredText(input.displayName, `contacts[${index}].displayName`, 500),
    givenName: optionalText(input.givenName, `contacts[${index}].givenName`, 255),
    familyName: optionalText(input.familyName, `contacts[${index}].familyName`, 255),
    organizationName: optionalText(input.organizationName, `contacts[${index}].organizationName`, 500),
    methods: uniqueMethods,
  };
}

function normalizedCorrespondence(input, index, deviceId) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CorrespondenceSyncInputError(`correspondence[${index}] must be an object.`);
  }
  const medium = enumValue(input.medium, correspondenceMedia, `correspondence[${index}].medium`);
  const direction = enumValue(input.direction, directions, `correspondence[${index}].direction`);
  const account = optionalText(input.account, `correspondence[${index}].account`, 96) ?? "default";
  if (!/^[A-Za-z0-9._:@+-]+$/u.test(account)) {
    throw new CorrespondenceSyncInputError(`correspondence[${index}].account contains unsupported characters.`);
  }
  const sourceAccountKey = `android:${deviceId}:${account}`;
  const occurredAtUtc = utcInstant(input.occurredAtMs, `correspondence[${index}].occurredAtMs`);
  const fallbackAddress = optionalText(input.address, `correspondence[${index}].address`, 512);
  const suppliedParticipants = boundedArray(input.participants ?? [], `correspondence[${index}].participants`, 100)
    .map((participant, participantIndex) => {
      if (!participant || typeof participant !== "object" || Array.isArray(participant)) {
        throw new CorrespondenceSyncInputError(
          `correspondence[${index}].participants[${participantIndex}] must be an object.`,
        );
      }
      return {
        addressValue: requiredText(
          participant.address,
          `correspondence[${index}].participants[${participantIndex}].address`,
          512,
        ),
        displayName: optionalText(
          participant.displayName,
          `correspondence[${index}].participants[${participantIndex}].displayName`,
          500,
        ),
      };
    });
  const participantKeys = new Set();
  const participants = suppliedParticipants.filter((participant) => {
    const key = participant.addressValue;
    if (participantKeys.has(key)) return false;
    participantKeys.add(key);
    return true;
  });
  if (participants.length === 0 && fallbackAddress) {
    participants.push({
      addressValue: fallbackAddress,
      displayName: optionalText(input.displayName, `correspondence[${index}].displayName`, 500),
    });
  }
  const deliveryStatus = medium === "call"
    ? null
    : enumValue(input.deliveryStatus ?? "unknown", deliveryStatuses, `correspondence[${index}].deliveryStatus`);
  const callDisposition = medium === "call"
    ? enumValue(input.callDisposition, callDispositions, `correspondence[${index}].callDisposition`)
    : null;
  const callDurationSeconds = medium === "call"
    ? optionalNonnegativeInteger(input.callDurationSeconds, `correspondence[${index}].callDurationSeconds`)
    : null;
  const sentAtUtc = direction === "outbound"
    ? (input.sentAtMs == null ? occurredAtUtc : utcInstant(input.sentAtMs, `correspondence[${index}].sentAtMs`))
    : null;
  const receivedAtUtc = direction === "inbound"
    ? (input.receivedAtMs == null ? occurredAtUtc : utcInstant(input.receivedAtMs, `correspondence[${index}].receivedAtMs`))
    : null;
  const threadKey = optionalText(input.threadKey, `correspondence[${index}].threadKey`, 255);
  const externalId = requiredText(input.externalId, `correspondence[${index}].externalId`, 255);
  if (threadKey !== null && !/^[\x20-\x7E]+$/u.test(threadKey)) {
    throw new CorrespondenceSyncInputError(`correspondence[${index}].threadKey must be ASCII.`);
  }
  if (!/^[\x20-\x7E]+$/u.test(externalId)) {
    throw new CorrespondenceSyncInputError(`correspondence[${index}].externalId must be ASCII.`);
  }
  return {
    medium,
    direction,
    sourceAccountKey,
    threadKey,
    externalId,
    body: medium === "call" ? null : canonicalHtml(optionalBody(input.body, `correspondence[${index}].body`, 2_000_000)),
    deliveryStatus,
    callDisposition,
    callDurationSeconds,
    providerStatus: optionalText(input.providerStatus, `correspondence[${index}].providerStatus`, 64),
    occurredAtUtc,
    sentAtUtc,
    receivedAtUtc,
    participants,
    deviceId,
  };
}

export function normalizeAndroidSyncBatch(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CorrespondenceSyncInputError("The synchronization body must be an object.");
  }
  if (input.protocol !== protocol || input.version !== protocolVersion) {
    throw new CorrespondenceSyncInputError(`Expected ${protocol} version ${protocolVersion}.`);
  }
  const deviceId = requiredText(input.deviceId, "deviceId", 128);
  if (!/^[A-Za-z0-9._-]{8,128}$/u.test(deviceId)) {
    throw new CorrespondenceSyncInputError("deviceId must be an opaque ASCII identifier.");
  }
  const contacts = boundedArray(input.contacts ?? [], "contacts", 250)
    .map((contact, index) => normalizedContact(contact, index));
  const correspondence = boundedArray(input.correspondence ?? [], "correspondence", 500)
    .map((item, index) => normalizedCorrespondence(item, index, deviceId));
  const duplicateKeys = new Set();
  for (const item of correspondence) {
    const key = `${item.medium}\u0000${item.sourceAccountKey}\u0000${item.externalId}`;
    if (duplicateKeys.has(key)) {
      throw new CorrespondenceSyncInputError("A synchronization batch cannot contain duplicate correspondence identities.");
    }
    duplicateKeys.add(key);
  }
  return { protocol, version: protocolVersion, deviceId, contacts, correspondence };
}

function contactMethodMatch(database, methods) {
  const find = database.prepare(`
    SELECT DISTINCT method.contact_id
    FROM contact_methods AS method
    JOIN contacts AS contact USING (contact_id)
    WHERE method.method_kind = ? AND method.normalized_value = ? AND contact.status = 'active'
  `);
  const matches = new Set();
  for (const method of methods) {
    for (const row of find.all(method.kind, method.normalizedValue)) matches.add(Number(row.contact_id));
  }
  return matches.size === 1 ? [...matches][0] : null;
}

function appendContactMethods(database, contactId, methods) {
  const existing = database.prepare(`
    SELECT method_kind, normalized_value FROM contact_methods WHERE contact_id = ?
  `).all(contactId);
  const keys = new Set(existing.map((method) => `${method.method_kind}\u0000${method.normalized_value}`));
  const insert = database.prepare(`
    INSERT INTO contact_methods (
      contact_id, method_kind, label, value, normalized_value, is_primary, can_receive
    ) VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  let inserted = 0;
  for (const method of methods) {
    const key = `${method.kind}\u0000${method.normalizedValue}`;
    if (keys.has(key)) continue;
    insert.run(
      contactId, method.kind, method.label, method.value, method.normalizedValue,
      method.isPrimary ? 1 : 0,
    );
    keys.add(key);
    inserted += 1;
  }
  return inserted;
}

function sameContactNames(row, contact) {
  return row.display_name === contact.displayName
    && row.given_name === contact.givenName
    && row.family_name === contact.familyName
    && row.organization_name === contact.organizationName;
}

function instantMilliseconds(value) {
  if (value == null) return null;
  const milliseconds = new Date(canonicalInstant(value)).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function upsertContacts(database, batch, eventId, now) {
  const source = `android:${batch.deviceId}`;
  const findObservation = database.prepare(`
    SELECT contact_id, provider_updated_at_utc
    FROM contact_source_aliases
    WHERE source = ? AND external_id = ?
    LIMIT 1
  `);
  const findImported = database.prepare(`
    SELECT contact_id FROM contacts WHERE source = ? AND external_id = ? ORDER BY contact_id LIMIT 1
  `);
  const findContact = database.prepare(`
    SELECT display_name, given_name, family_name, organization_name, updated_at_utc
    FROM contacts WHERE contact_id = ?
  `);
  const findLatestObservation = database.prepare(`
    SELECT provider_updated_at_utc
    FROM contact_source_aliases
    WHERE contact_id = ? AND provider_updated_at_utc IS NOT NULL
    ORDER BY provider_updated_at_utc DESC, contact_source_alias_id DESC
    LIMIT 1
  `);
  const insert = database.prepare(`
    INSERT INTO contacts (
      contact_kind, display_name, given_name, family_name, organization_name,
      status, source, external_id, updated_at_utc
    ) VALUES ('person', ?, ?, ?, ?, 'active', ?, ?, ?)
  `);
  const updateImported = database.prepare(`
    UPDATE contacts SET display_name = ?, given_name = ?, family_name = ?,
      organization_name = ?, updated_at_utc = ? WHERE contact_id = ?
  `);
  const insertObservation = database.prepare(`
    INSERT INTO contact_source_aliases (
      contact_id, source, external_id, observed_display_name, observed_given_name,
      observed_family_name, observed_organization_name, provider_updated_at_utc,
      source_event_id, first_observed_at_utc, last_observed_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateObservation = database.prepare(`
    UPDATE contact_source_aliases
    SET observed_display_name = ?, observed_given_name = ?, observed_family_name = ?,
      observed_organization_name = ?, provider_updated_at_utc = ?, last_observed_at_utc = ?
    WHERE source = ? AND external_id = ?
  `);
  const touchObservation = database.prepare(`
    UPDATE contact_source_aliases SET last_observed_at_utc = ?
    WHERE source = ? AND external_id = ?
  `);
  const counts = {
    created: 0,
    updated: 0,
    matched: 0,
    observationsCreated: 0,
    methodsCreated: 0,
  };
  for (const contact of batch.contacts) {
    const observation = findObservation.get(source, contact.externalId);
    const imported = observation ? null : findImported.get(source, contact.externalId);
    let contactId = observation
      ? Number(observation.contact_id)
      : imported
        ? Number(imported.contact_id)
        : contactMethodMatch(database, contact.methods);
    const methodMatched = !observation && !imported && contactId !== null;
    let created = false;
    if (contactId === null) {
      const inserted = insert.run(
        contact.displayName, contact.givenName, contact.familyName,
        contact.organizationName, source, contact.externalId, now,
      );
      contactId = Number(inserted.lastInsertRowid);
      counts.created += 1;
      created = true;
    } else if (methodMatched) {
      counts.matched += 1;
    }

    const incomingUpdatedAt = instantMilliseconds(contact.providerUpdatedAtUtc);
    const latest = findLatestObservation.get(contactId);
    const latestUpdatedAt = instantMilliseconds(latest?.provider_updated_at_utc);
    const sourceOwnsCanonical = imported !== undefined && imported !== null;
    const canonical = findContact.get(contactId);
    const canonicalUpdatedAt = instantMilliseconds(canonical.updated_at_utc);
    const incomingIsAuthoritative = incomingUpdatedAt !== null
      ? latestUpdatedAt !== null
        ? incomingUpdatedAt > latestUpdatedAt
        : canonicalUpdatedAt === null || incomingUpdatedAt > canonicalUpdatedAt
      : sourceOwnsCanonical;
    if (!created && incomingIsAuthoritative && !sameContactNames(canonical, contact)) {
      updateImported.run(
        contact.displayName, contact.givenName, contact.familyName,
        contact.organizationName, now, contactId,
      );
      counts.updated += 1;
    }

    if (!observation) {
      insertObservation.run(
        contactId, source, contact.externalId, contact.displayName, contact.givenName,
        contact.familyName, contact.organizationName, contact.providerUpdatedAtUtc,
        eventId, now, now,
      );
      counts.observationsCreated += 1;
    } else {
      const observedUpdatedAt = instantMilliseconds(observation.provider_updated_at_utc);
      if (incomingUpdatedAt !== null
        && (observedUpdatedAt === null || incomingUpdatedAt >= observedUpdatedAt)) {
        updateObservation.run(
          contact.displayName, contact.givenName, contact.familyName,
          contact.organizationName, contact.providerUpdatedAtUtc, now,
          source, contact.externalId,
        );
      } else {
        touchObservation.run(now, source, contact.externalId);
      }
    }
    counts.methodsCreated += appendContactMethods(database, contactId, contact.methods);
  }
  return counts;
}

function resolvedParticipant(database, addressValue) {
  const normalized = normalizePhone(addressValue);
  if (!normalized) return { contactId: null, contactMethodId: null };
  const rows = database.prepare(`
    SELECT method.contact_method_id, method.contact_id
    FROM contact_methods AS method
    JOIN contacts AS contact USING (contact_id)
    WHERE method.method_kind = 'phone' AND method.normalized_value = ? AND contact.status = 'active'
    ORDER BY method.contact_id, method.contact_method_id
  `).all(normalized);
  const contactIds = new Set(rows.map(({ contact_id: id }) => Number(id)));
  return contactIds.size === 1
    ? { contactId: Number(rows[0].contact_id), contactMethodId: Number(rows[0].contact_method_id) }
    : { contactId: null, contactMethodId: null };
}

function backfillPhoneFingerprints(database) {
  const rows = database.prepare(`
    SELECT correspondence.correspondence_id, correspondence.medium,
      correspondence.direction, correspondence.body,
      correspondence.call_disposition, correspondence.call_duration_seconds,
      correspondence.occurred_at_utc, participant.address_value
    FROM correspondence
    LEFT JOIN correspondence_participants_join AS participant
      USING (correspondence_id)
    WHERE correspondence.medium IN ('sms', 'mms', 'call')
      AND correspondence.source_account_key LIKE 'android:%'
      AND correspondence.dedupe_fingerprint IS NULL
    ORDER BY correspondence.correspondence_id, participant.address_value
  `).all();
  const records = new Map();
  for (const row of rows) {
    const id = Number(row.correspondence_id);
    if (!records.has(id)) records.set(id, { ...row, participants: [] });
    if (row.address_value) records.get(id).participants.push({ addressValue: row.address_value });
  }
  const update = database.prepare(`
    UPDATE correspondence SET dedupe_fingerprint = ?
    WHERE correspondence_id = ? AND dedupe_fingerprint IS NULL
  `);
  for (const [id, item] of records) {
    update.run(androidCorrespondenceDedupeFingerprint(item), id);
  }
}

function upsertCorrespondence(database, batch, sourceEventId, now) {
  backfillPhoneFingerprints(database);
  const find = database.prepare(`
    SELECT correspondence_id FROM correspondence
    WHERE medium = ? AND source_account_key = ? AND external_id = ?
  `);
  const findAlias = database.prepare(`
    SELECT correspondence_id FROM correspondence_source_aliases
    WHERE medium = ? AND source_account_key = ? AND external_id = ?
  `);
  const findFingerprintCandidates = database.prepare(`
    SELECT correspondence_id, medium, direction, source_account_key, body,
      call_disposition, call_duration_seconds, occurred_at_utc
    FROM correspondence
    WHERE medium = ? AND dedupe_fingerprint = ?
      AND source_account_key LIKE 'android:%'
    ORDER BY correspondence_id
  `);
  const readParticipants = database.prepare(`
    SELECT address_value FROM correspondence_participants_join
    WHERE correspondence_id = ? ORDER BY address_value
  `);
  const insert = database.prepare(`
    INSERT INTO correspondence (
      medium, direction, source_account_key, thread_key, external_id, body,
      delivery_status, call_disposition, call_duration_seconds, provider_status,
      occurred_at_utc, sent_at_utc, received_at_utc, source_event_id,
      dedupe_fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = database.prepare(`
    UPDATE correspondence SET direction = ?, thread_key = ?, body = ?,
      delivery_status = ?, call_disposition = ?, call_duration_seconds = ?,
      provider_status = ?, occurred_at_utc = ?, sent_at_utc = ?, received_at_utc = ?
    WHERE correspondence_id = ?
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
  const insertAlias = database.prepare(`
    INSERT INTO correspondence_source_aliases (
      correspondence_id, medium, source_account_key, thread_key, external_id,
      provider_status, source_event_id, first_observed_at_utc, last_observed_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateAlias = database.prepare(`
    UPDATE correspondence_source_aliases
    SET thread_key = ?, provider_status = ?, last_observed_at_utc = ?
    WHERE medium = ? AND source_account_key = ? AND external_id = ?
  `);
  const counts = { created: 0, updated: 0, deduplicated: 0 };
  for (const item of batch.correspondence) {
    const existing = find.get(item.medium, item.sourceAccountKey, item.externalId);
    const alias = existing ? null : findAlias.get(item.medium, item.sourceAccountKey, item.externalId);
    let correspondenceId;
    let replaceParticipants = true;
    if (existing) {
      correspondenceId = Number(existing.correspondence_id);
      update.run(
        item.direction, item.threadKey, item.body, item.deliveryStatus,
        item.callDisposition, item.callDurationSeconds, item.providerStatus,
        item.occurredAtUtc, item.sentAtUtc, item.receivedAtUtc, correspondenceId,
      );
      counts.updated += 1;
    } else if (alias) {
      correspondenceId = Number(alias.correspondence_id);
      replaceParticipants = false;
      updateAlias.run(
        item.threadKey, item.providerStatus, now,
        item.medium, item.sourceAccountKey, item.externalId,
      );
      counts.updated += 1;
    } else {
      const identity = androidCorrespondenceDedupeIdentity(item);
      const fingerprint = androidCorrespondenceDedupeFingerprint(item);
      const devicePrefix = `android:${item.deviceId}:`;
      const candidates = findFingerprintCandidates.all(item.medium, fingerprint)
        .filter((candidate) => !String(candidate.source_account_key ?? "").startsWith(devicePrefix))
        .filter((candidate) => androidCorrespondenceDedupeIdentity({
          ...candidate,
          participants: readParticipants.all(candidate.correspondence_id)
            .map(({ address_value: addressValue }) => ({ addressValue })),
        }) === identity);
      if (candidates.length === 1) {
        correspondenceId = Number(candidates[0].correspondence_id);
        replaceParticipants = false;
        insertAlias.run(
          correspondenceId, item.medium, item.sourceAccountKey, item.threadKey,
          item.externalId, item.providerStatus, sourceEventId, now, now,
        );
        counts.deduplicated += 1;
      } else {
        const created = insert.run(
          item.medium, item.direction, item.sourceAccountKey, item.threadKey,
          item.externalId, item.body, item.deliveryStatus, item.callDisposition,
          item.callDurationSeconds, item.providerStatus, item.occurredAtUtc,
          item.sentAtUtc, item.receivedAtUtc, sourceEventId, fingerprint,
        );
        correspondenceId = Number(created.lastInsertRowid);
        counts.created += 1;
      }
    }
    if (!replaceParticipants) continue;
    deleteParticipants.run(correspondenceId);
    for (const itemParticipant of item.participants) {
      const participant = resolvedParticipant(database, itemParticipant.addressValue);
      insertParticipant.run(
        correspondenceId,
        item.direction === "inbound" ? "sender" : "recipient",
        participant.contactId,
        participant.contactMethodId,
        itemParticipant.addressValue,
        itemParticipant.displayName,
      );
    }
  }
  return counts;
}

export class CorrespondenceSyncService {
  constructor({ databaseTarget }) {
    this.database = openApplicationDatabase(databaseTarget);
  }

  close() {
    this.database.close();
  }

  synchronize(input) {
    const batch = normalizeAndroidSyncBatch(input);
    const eventId = randomUUID();
    const now = new Date().toISOString();
    this.database.exec("START TRANSACTION");
    try {
      this.database.prepare(`
        INSERT INTO activity_events (
          event_id, event_type, event_phase, status, actor_type, actor_name,
          source, channel, name, content_text, payload_json, subject_type, subject_id
        ) VALUES (?, 'correspondence.sync', 'point', 'complete', 'external', ?,
          'android_phone', 'mobile', 'Phone correspondence synchronized', ?, ?,
          'correspondence_sync_batch', ?)
      `).run(
        eventId,
        batch.deviceId,
        `${batch.contacts.length} contacts and ${batch.correspondence.length} communications received`,
        safeJson({
          protocol: batch.protocol,
          version: batch.version,
          deviceId: batch.deviceId,
          receivedContacts: batch.contacts.length,
          receivedCorrespondence: batch.correspondence.length,
        }),
        eventId,
      );
      const contacts = upsertContacts(this.database, batch, eventId, now);
      const correspondence = upsertCorrespondence(this.database, batch, eventId, now);
      const result = {
        protocol: batch.protocol,
        version: batch.version,
        status: "complete",
        synchronizedAtUtc: now,
        contacts: { received: batch.contacts.length, ...contacts },
        correspondence: { received: batch.correspondence.length, ...correspondence },
      };
      this.database.prepare(`
        UPDATE activity_events SET content_text = ?, payload_json = ? WHERE event_id = ?
      `).run(
        `${correspondence.created} new, ${correspondence.deduplicated} cross-device duplicates linked, and ${correspondence.updated} refreshed communications; ${contacts.created} new, ${contacts.matched} matched, and ${contacts.updated} renamed contacts`,
        safeJson({ ...result, deviceId: batch.deviceId }),
        eventId,
      );
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  status(deviceIdValue = null) {
    const deviceId = deviceIdValue == null ? null : requiredText(deviceIdValue, "deviceId", 128);
    if (deviceId !== null && !/^[A-Za-z0-9._-]{8,128}$/u.test(deviceId)) {
      throw new CorrespondenceSyncInputError("deviceId must be an opaque ASCII identifier.");
    }
    const prefix = deviceId ? `android:${deviceId}:%` : "android:%";
    const rows = this.database.prepare(`
      SELECT medium, COUNT(*) AS count, MAX(occurred_at_utc) AS latest_at_utc
      FROM (
        SELECT correspondence_id, medium, occurred_at_utc
        FROM correspondence WHERE source_account_key LIKE ?
        UNION
        SELECT correspondence.correspondence_id, correspondence.medium,
          correspondence.occurred_at_utc
        FROM correspondence_source_aliases AS alias
        JOIN correspondence USING (correspondence_id)
        WHERE alias.source_account_key LIKE ?
      ) AS observed
      GROUP BY medium ORDER BY medium
    `).all(prefix, prefix);
    return {
      deviceId,
      media: rows.map((row) => ({
        medium: row.medium,
        count: Number(row.count),
        latestAtUtc: row.latest_at_utc ?? null,
      })),
    };
  }
}

export const androidCorrespondenceSyncProtocol = Object.freeze({
  name: protocol,
  version: protocolVersion,
  maximumContactsPerBatch: 250,
  maximumCorrespondencePerBatch: 500,
});
