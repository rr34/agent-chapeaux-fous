import { selectedFields, withSchemaProjection } from "./schema-result.mjs";

const nullableString = { type: ["string", "null"] };
const contactKinds = new Set(["person", "organization", "service"]);
const contactStatuses = new Set(["active", "inactive", "blocked", "deceased"]);
const methodKinds = new Set(["email", "phone", "postal_address", "handle", "url", "other"]);
const contactFields = [
  "contact_id", "contact_kind", "display_name", "given_name", "family_name",
  "organization_name", "is_self", "status", "birth_date", "notes", "source",
  "external_id", "created_at_utc", "updated_at_utc",
];
const methodFields = [
  "contact_method_id", "contact_id", "method_kind", "label", "value",
  "normalized_value", "is_primary", "can_receive", "created_at_utc",
];
const tagFields = ["tag_id", "slug", "label", "is_active", "created_at_utc"];

function requiredText(value, label, maximumLength) {
  if ((typeof value !== "string" && typeof value !== "number") || !String(value).trim()) {
    throw new Error(`${label} cannot be empty`);
  }
  const selected = String(value).trim();
  if (selected.length > maximumLength) throw new Error(`${label} cannot exceed ${maximumLength} characters`);
  return selected;
}

function optionalText(value, label, maximumLength) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error(`${label} must be text or null`);
  const selected = value.trim();
  if (!selected) return null;
  if (selected.length > maximumLength) throw new Error(`${label} cannot exceed ${maximumLength} characters`);
  return selected;
}

function birthDate(value) {
  const selected = optionalText(value, "birth_date", 10);
  if (selected === null) return null;
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(selected);
  const partial = /^--(\d{2})-(\d{2})$/.exec(selected);
  const comparable = full ? selected : partial ? `2000-${partial[1]}-${partial[2]}` : null;
  const date = comparable ? new Date(`${comparable}T00:00:00.000Z`) : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== comparable) {
    throw new Error("birth_date must be YYYY-MM-DD, --MM-DD, or null");
  }
  return selected;
}

function booleanValue(value, label) {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function normalizedMethodValue(kind, value) {
  if (kind === "email") return value.toLowerCase();
  if (kind === "phone") {
    const digits = value.replace(/\D/g, "");
    return value.startsWith("+") ? `+${digits}` : digits;
  }
  return value.toLowerCase().replace(/\s+/g, " ");
}

function normalizedMethod(method, index) {
  if (!methodKinds.has(method.method_kind)) {
    throw new Error(`methods[${index}].method_kind is invalid`);
  }
  const value = requiredText(method.value, `methods[${index}].value`, 2000);
  return {
    method_kind: method.method_kind,
    label: optionalText(method.label, `methods[${index}].label`, 100),
    value,
    normalized_value: normalizedMethodValue(method.method_kind, value),
    is_primary: booleanValue(method.is_primary, `methods[${index}].is_primary`) ? 1 : 0,
    can_receive: booleanValue(method.can_receive, `methods[${index}].can_receive`) ? 1 : 0,
  };
}

function tagSlug(label) {
  const slug = label.normalize("NFKC").toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`Tag must contain a letter or number: ${label}`);
  if (slug.length > 200) throw new Error(`Tag slug cannot exceed 200 characters: ${label}`);
  return slug;
}

function normalizedContact(entry) {
  if (!contactKinds.has(entry.contact_kind)) throw new Error("contact_kind is invalid");
  if (!contactStatuses.has(entry.status)) throw new Error("status is invalid");
  if (!Array.isArray(entry.methods) || entry.methods.length > 100) {
    throw new Error("methods must contain at most 100 contact methods");
  }
  if (!Array.isArray(entry.tags) || entry.tags.length > 50) {
    throw new Error("tags must contain at most 50 labels");
  }
  const methods = entry.methods.map(normalizedMethod);
  const seenMethods = new Set();
  for (const method of methods) {
    const key = `${method.method_kind}\u0000${method.normalized_value}`;
    if (seenMethods.has(key)) throw new Error("Duplicate contact methods are not allowed within one contact");
    seenMethods.add(key);
  }
  const tagsBySlug = new Map();
  for (const value of entry.tags) {
    const label = requiredText(value, "Tag", 200);
    const slug = tagSlug(label);
    if (!tagsBySlug.has(slug)) tagsBySlug.set(slug, { slug, label });
  }
  return {
    external_id: requiredText(entry.external_id, "external_id", 1000),
    contact_kind: entry.contact_kind,
    display_name: requiredText(entry.display_name, "display_name", 500),
    given_name: optionalText(entry.given_name, "given_name", 500),
    family_name: optionalText(entry.family_name, "family_name", 500),
    organization_name: optionalText(entry.organization_name, "organization_name", 500),
    status: entry.status,
    birth_date: birthDate(entry.birth_date),
    notes: optionalText(entry.notes, "notes", 10_000),
    methods,
    tags: [...tagsBySlug.values()],
  };
}

function contactFromDatabase(database, contactId) {
  const row = database.prepare("SELECT * FROM contacts WHERE contact_id = ?").get(contactId);
  if (!row) return null;
  const methods = database.prepare(`
    SELECT * FROM contact_methods
    WHERE contact_id = ?
    ORDER BY method_kind, normalized_value, contact_method_id
  `).all(contactId).map((method) => selectedFields(method, methodFields));
  const tags = database.prepare(`
    SELECT tag.* FROM tags AS tag
    JOIN record_tags AS assignment USING (tag_id)
    WHERE assignment.record_type = 'contact' AND assignment.record_id = ?
    ORDER BY tag.slug, tag.tag_id
  `).all(String(contactId)).map((tag) => selectedFields(tag, tagFields));
  return {
    ...selectedFields(row, contactFields),
    contact_methods: methods,
    tags,
  };
}

function canonicalMethods(methods) {
  return methods.map((method) => ({
    method_kind: method.method_kind,
    label: method.label ?? null,
    value: method.value,
    normalized_value: method.normalized_value,
    is_primary: Number(method.is_primary),
    can_receive: Number(method.can_receive),
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function sameImportedContact(existing, input) {
  const coreFields = [
    "contact_kind", "display_name", "given_name", "family_name",
    "organization_name", "status", "birth_date", "notes",
  ];
  if (coreFields.some((field) => (existing[field] ?? null) !== (input[field] ?? null))) return false;
  if (JSON.stringify(canonicalMethods(existing.contact_methods)) !== JSON.stringify(canonicalMethods(input.methods))) {
    return false;
  }
  const existingTags = existing.tags.map(({ slug }) => slug).sort();
  const inputTags = input.tags.map(({ slug }) => slug).sort();
  return JSON.stringify(existingTags) === JSON.stringify(inputTags);
}

function ensureTag(database, tag) {
  let row = database.prepare("SELECT * FROM tags WHERE slug = ?").get(tag.slug);
  if (!row) {
    row = database.prepare("INSERT INTO tags (slug, label) VALUES (?, ?) RETURNING *").get(tag.slug, tag.label);
  } else if (!row.is_active) {
    row = database.prepare("UPDATE tags SET is_active = 1 WHERE tag_id = ? RETURNING *").get(row.tag_id);
  }
  return row;
}

function contactResult(schemaSemantics, context, result, {
  name = "contact_import",
  purpose = "Return imported, unchanged, or conflicting contacts with their methods, tags, and stored database field semantics.",
} = {}) {
  return withSchemaProjection(schemaSemantics, context, result, {
    name,
    purpose,
    schemaObjects: ["contacts", "contact_methods", "tags", "record_tags"],
    fields: {
      contacts: contactFields,
      contact_methods: methodFields,
      tags: tagFields,
      record_tags: ["tag_id", "record_type", "record_id", "created_at_utc"],
    },
  });
}

export function registerContactTools(registry, store, organizer, ledger, schemaSemantics = null) {
  registry.register({
    name: "contact_import",
    description: "Import a bounded batch of 1 through 200 contacts from an attached CSV, vCard/VCF, or other external source. Supply a stable source name and one stable external_id per source record (use a vCard UID when present, or a deterministic ID if the source has none). Contacts may include multiple methods and overlapping tags. The source and external_id pair is idempotent: exact replays are unchanged, conflicting replays are reported without overwriting, and all new contacts, methods, tags, and tag assignments are written in one transaction.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: { type: "string", minLength: 1, maxLength: 200 },
        entries: {
          type: "array", minItems: 1, maxItems: 200,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              external_id: { type: ["string", "integer"] },
              contact_kind: { type: "string", enum: ["person", "organization", "service"] },
              display_name: { type: "string", minLength: 1, maxLength: 500 },
              given_name: { ...nullableString, maxLength: 500 },
              family_name: { ...nullableString, maxLength: 500 },
              organization_name: { ...nullableString, maxLength: 500 },
              status: { type: "string", enum: ["active", "inactive", "blocked", "deceased"] },
              birth_date: { ...nullableString, maxLength: 10 },
              notes: { ...nullableString, maxLength: 10000 },
              methods: {
                type: "array", maxItems: 100,
                items: {
                  type: "object", additionalProperties: false,
                  properties: {
                    method_kind: { type: "string", enum: ["email", "phone", "postal_address", "handle", "url", "other"] },
                    label: { ...nullableString, maxLength: 100 },
                    value: { type: "string", minLength: 1, maxLength: 2000 },
                    is_primary: { type: "boolean" },
                    can_receive: { type: "boolean" },
                  },
                  required: ["method_kind", "label", "value", "is_primary", "can_receive"],
                },
              },
              tags: { type: "array", maxItems: 50, items: { type: "string", minLength: 1, maxLength: 200 } },
            },
            required: [
              "external_id", "contact_kind", "display_name", "given_name", "family_name",
              "organization_name", "status", "birth_date", "notes", "methods", "tags",
            ],
          },
        },
      },
      required: ["source", "entries"],
    },
    async execute({ source, entries }, context) {
      const selectedSource = requiredText(source, "Import source", 200);
      if (!Array.isArray(entries) || entries.length < 1 || entries.length > 200) {
        throw new Error("Contact imports require between 1 and 200 entries");
      }
      const seenExternalIds = new Set();
      const inputs = entries.map((entry) => {
        const contact = normalizedContact(entry);
        if (seenExternalIds.has(contact.external_id)) {
          throw new Error(`Duplicate external contact ID in import batch: ${contact.external_id}`);
        }
        seenExternalIds.add(contact.external_id);
        return contact;
      });
      const database = store.requireReady();
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const items = [];
        for (const input of inputs) {
          const matches = database.prepare(`
            SELECT contact_id FROM contacts WHERE source = ? AND external_id = ?
            ORDER BY contact_id
          `).all(selectedSource, input.external_id);
          if (matches.length > 0) {
            const existing = contactFromDatabase(database, matches[0].contact_id);
            const unchanged = matches.length === 1 && sameImportedContact(existing, input);
            items.push({
              status: unchanged ? "unchanged" : "conflict",
              contact: existing,
              ...(unchanged ? {} : {
                reason: matches.length > 1
                  ? "More than one stored contact has this source and external ID"
                  : "The source and external ID already identify a different stored contact",
              }),
            });
            continue;
          }
          const inserted = database.prepare(`
            INSERT INTO contacts (
              contact_kind, display_name, given_name, family_name, organization_name,
              status, birth_date, notes, source, external_id, updated_at_utc
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING contact_id
          `).get(
            input.contact_kind, input.display_name, input.given_name, input.family_name,
            input.organization_name, input.status, input.birth_date, input.notes,
            selectedSource, input.external_id, now,
          );
          const contactId = Number(inserted.contact_id);
          const insertMethod = database.prepare(`
            INSERT INTO contact_methods (
              contact_id, method_kind, label, value, normalized_value, is_primary, can_receive
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `);
          for (const method of input.methods) {
            insertMethod.run(
              contactId, method.method_kind, method.label, method.value,
              method.normalized_value, method.is_primary, method.can_receive,
            );
          }
          const assignTag = database.prepare(`
            INSERT OR IGNORE INTO record_tags (tag_id, record_type, record_id)
            VALUES (?, 'contact', ?)
          `);
          for (const tag of input.tags) {
            const storedTag = ensureTag(database, tag);
            assignTag.run(storedTag.tag_id, String(contactId));
          }
          items.push({ status: "imported", contact: contactFromDatabase(database, contactId) });
        }
        const importedCount = items.filter(({ status }) => status === "imported").length;
        const unchangedCount = items.filter(({ status }) => status === "unchanged").length;
        const conflictCount = items.filter(({ status }) => status === "conflict").length;
        const result = {
          source: selectedSource, total: items.length,
          imported_count: importedCount, unchanged_count: unchangedCount,
          conflict_count: conflictCount, items,
        };
        ledger.append({
          type: "contacts.imported", status: "complete", actorType: "tool",
          actorName: "contact_import", turnId: context.requestId, operationId: context.callId,
          name: "Contact import processed",
          content: `${importedCount} imported, ${unchangedCount} unchanged, ${conflictCount} conflicting from ${selectedSource}`,
          payload: { source: selectedSource, total: items.length, importedCount, unchangedCount, conflictCount },
          subjectType: "contact_import", subjectId: selectedSource,
        });
        const semanticResult = contactResult(schemaSemantics, context, result);
        database.exec("COMMIT");
        return semanticResult;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "contact_duplicate_list",
    description: "List paginated groups of active contacts that may be duplicates because they share an exact normalized display name, email address, or phone number. This is a read-only review operation. Each candidate includes its complete stored contact data and expected_version for a later contact_merge call. Same-name evidence alone can be ambiguous, so inspect all available details before merging. Continue with next_offset while has_more is true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200 },
        offset: { type: "integer", minimum: 0, maximum: 10000 },
      },
      required: ["limit", "offset"],
    },
    async execute({ limit, offset }, context) {
      const database = store.requireReady();
      const review = organizer.listContactDuplicates({ limit, offset });
      const result = {
        active_contact_count: review.activeContactCount,
        scanned_contact_count: review.scannedContactCount,
        scan_truncated: review.scanTruncated,
        total_duplicate_groups: review.totalDuplicateGroups,
        has_more: review.hasMore,
        offset: review.offset,
        next_offset: review.hasMore ? review.offset + review.groups.length : null,
        groups: review.groups.map((group) => ({
          evidence: group.evidence,
          candidates: group.contactIds.map((contactId) => {
            const contact = contactFromDatabase(database, contactId);
            return {
              expected_version: contact.updated_at_utc ?? contact.created_at_utc,
              contact,
            };
          }),
        })),
      };
      return contactResult(schemaSemantics, context, result, {
        name: "contact_duplicate_list",
        purpose: "Review possible duplicate contacts with exact matching evidence and the current versions required for a safe merge.",
      });
    },
  });

  registry.register({
    name: "contact_merge",
    description: "Merge 1 through 20 reviewed source contacts into one retained contact. Use contact_duplicate_list first and pass its exact expected_version values. The operation atomically combines unique methods and tags, preserves useful notes and missing identity fields, retains source records as inactive history, records the merge, and rejects stale or invalid candidates. Never merge merely because names match when the remaining details are ambiguous.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        keep_contact_id: { type: "integer", minimum: 1 },
        keep_expected_version: { type: "string", minLength: 1, maxLength: 100 },
        merge_contacts: {
          type: "array", minItems: 1, maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              contact_id: { type: "integer", minimum: 1 },
              expected_version: { type: "string", minLength: 1, maxLength: 100 },
            },
            required: ["contact_id", "expected_version"],
          },
        },
      },
      required: ["keep_contact_id", "keep_expected_version", "merge_contacts"],
    },
    async execute({ keep_contact_id: keepContactId, keep_expected_version: keepVersion, merge_contacts: mergeContacts }, context) {
      const versions = { [String(keepContactId)]: keepVersion };
      const mergeContactIds = [];
      for (const candidate of mergeContacts) {
        if (Object.hasOwn(versions, String(candidate.contact_id))) {
          throw new Error("Contact merge candidates must be unique and cannot include the retained contact");
        }
        versions[String(candidate.contact_id)] = candidate.expected_version;
        mergeContactIds.push(candidate.contact_id);
      }
      const merged = organizer.mergeContacts({
        keepContactId,
        mergeContactIds,
        versions,
      }, {
        actorType: "tool",
        actorName: "contact_merge",
        source: "model_tool",
        channel: context.channel ?? "agent",
        turnId: context.requestId ?? null,
        operationId: context.callId ?? null,
      });
      const result = {
        kept_contact: contactFromDatabase(store.requireReady(), merged.contact.id),
        merged_contact_ids: merged.mergedContactIds,
      };
      return contactResult(schemaSemantics, context, result, {
        name: "contact_merge",
        purpose: "Return the retained contact after an atomic reviewed merge and identify the source contacts retained as inactive history.",
      });
    },
  });
}
