import { parseContactAttachment } from "../contact-file-import.mjs";
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

function importNormalizedContacts({
  selectedSource, inputs, store, ledger, context, actorName = "contact_import", includeItems = true,
}) {
  const database = store.requireReady();
  const now = new Date().toISOString();
  database.exec("START TRANSACTION");
  try {
    const items = [];
    const conflicts = [];
    let importedCount = 0;
    let unchangedCount = 0;
    let conflictCount = 0;
    for (const input of inputs) {
      const matches = database.prepare(`
        SELECT contact_id FROM contacts WHERE source = ? AND external_id = ?
        ORDER BY contact_id
      `).all(selectedSource, input.external_id);
      if (matches.length > 0) {
        const existing = contactFromDatabase(database, matches[0].contact_id);
        const unchanged = matches.length === 1 && sameImportedContact(existing, input);
        const reason = matches.length > 1
          ? "More than one stored contact has this source and external ID"
          : "The source and external ID already identify a different stored contact";
        if (unchanged) unchangedCount += 1;
        else {
          conflictCount += 1;
          if (conflicts.length < 100) conflicts.push({
            external_id: input.external_id,
            stored_contact_id: existing.contact_id,
            reason,
          });
        }
        if (includeItems) {
          items.push({
            status: unchanged ? "unchanged" : "conflict",
            contact: existing,
            ...(unchanged ? {} : { reason }),
          });
        }
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
        INSERT IGNORE INTO record_tags (tag_id, record_type, record_id)
        VALUES (?, 'contact', ?)
      `);
      for (const tag of input.tags) {
        const storedTag = ensureTag(database, tag);
        assignTag.run(storedTag.tag_id, String(contactId));
      }
      importedCount += 1;
      if (includeItems) items.push({ status: "imported", contact: contactFromDatabase(database, contactId) });
    }
    const result = {
      source: selectedSource,
      total: inputs.length,
      imported_count: importedCount,
      unchanged_count: unchangedCount,
      conflict_count: conflictCount,
      ...(includeItems ? { items } : {
        conflicts,
        conflicts_truncated: conflictCount > conflicts.length,
      }),
    };
    ledger.append({
      type: "contacts.imported", status: "complete", actorType: "tool",
      actorName, channel: context.channel, turnId: context.requestId, operationId: context.callId,
      name: "Contact import processed",
      content: `${importedCount} imported, ${unchangedCount} unchanged, ${conflictCount} conflicting from ${selectedSource}`,
      payload: {
        source: selectedSource, total: inputs.length,
        importedCount, unchangedCount, conflictCount,
      },
      subjectType: "contact_import", subjectId: selectedSource,
    });
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function organizerMergeInput({
  keep_contact_id: keepContactId,
  keep_expected_version: keepVersion,
  merge_contacts: mergeContacts,
}) {
  const versions = { [String(keepContactId)]: keepVersion };
  const mergeContactIds = [];
  for (const candidate of mergeContacts) {
    if (Object.hasOwn(versions, String(candidate.contact_id))) {
      throw new Error("Contact merge candidates must be unique and cannot include the retained contact");
    }
    versions[String(candidate.contact_id)] = candidate.expected_version;
    mergeContactIds.push(candidate.contact_id);
  }
  return { keepContactId, mergeContactIds, versions };
}

function contactToolActivity(context, actorName) {
  return {
    actorType: "tool",
    actorName,
    source: "model_tool",
    channel: context.channel ?? "agent",
    turnId: context.requestId ?? null,
    operationId: context.callId ?? null,
  };
}

const mergeContactCandidateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    contact_id: { type: "integer", minimum: 1 },
    expected_version: { type: "string", minLength: 1, maxLength: 100 },
  },
  required: ["contact_id", "expected_version"],
};

const mergeOperationProperties = {
  keep_contact_id: { type: "integer", minimum: 1 },
  keep_expected_version: { type: "string", minLength: 1, maxLength: 100 },
  merge_contacts: {
    type: "array", minItems: 1, maxItems: 20,
    items: mergeContactCandidateSchema,
  },
};

function compactDuplicateCandidate(contact) {
  const notes = contact.notes ?? null;
  return {
    expected_version: contact.updated_at_utc ?? contact.created_at_utc,
    notes_truncated: Boolean(notes && notes.length > 1000),
    contact: {
      ...selectedFields(contact, [
        "contact_id", "contact_kind", "display_name", "given_name", "family_name",
        "organization_name", "is_self", "status", "birth_date", "source", "external_id",
      ]),
      notes: notes?.slice(0, 1000) ?? null,
      contact_methods: contact.contact_methods,
      tags: contact.tags,
    },
  };
}

export function contactTagContext(store, limit = 200) {
  const database = store.requireReady();
  const totalCount = Number(database.prepare(`
    SELECT COUNT(*) AS count FROM tags WHERE is_active = 1
  `).get().count);
  const tags = database.prepare(`
    SELECT tag.tag_id, tag.slug, tag.label,
           COUNT(assignment.record_id) AS contact_count
    FROM tags AS tag
    LEFT JOIN record_tags AS assignment
      ON assignment.tag_id = tag.tag_id
     AND assignment.record_type = 'contact'
    WHERE tag.is_active = 1
    GROUP BY tag.tag_id
    ORDER BY tag.label, tag.slug
    LIMIT ?
  `).all(limit).map((row) => ({
    slug: row.slug,
    label: row.label,
    contactCount: Number(row.contact_count),
  }));
  return {
    heading: "Active contact tags",
    text: tags.length
      ? [
          "Use these exact active labels and stable slugs to resolve approximate tag wording. Counts describe tag assignments; no contacts are included.",
          ...tags.map((tag) => `- ${tag.label} [${tag.slug}] | contacts: ${tag.contactCount}`),
          ...(totalCount > tags.length ? [`[${totalCount - tags.length} additional active tag(s) omitted]`] : []),
        ].join("\n")
      : "No active contact tags exist.",
    data: { tags, totalCount, omittedCount: totalCount - tags.length },
  };
}

export function registerContactTools(
  registry, store, organizer, ledger, schemaSemantics = null, searchCoordinator = null,
) {
  const rootRegistry = registry;
  registry = registry.withCapability?.("contacts") ?? registry;
  rootRegistry.registerContextView?.("contacts", {
    id: "contacts.active_tags",
    title: "Active contact tags",
    description: "Active contact tag labels and stable slugs with assignment counts; no contact records.",
    maximumItems: 200,
    execute: () => contactTagContext(store),
  });
  registry.register({
    name: "contact_import",
    description: "Import a bounded batch of 1 through 200 already-normalized contacts supplied as structured data without a file. Use contact_file_import for an attached CSV or vCard/VCF so the application processes the complete file directly. Supply a stable source name and one stable external_id per source record. Contacts may include multiple methods and overlapping tags. The source and external_id pair is idempotent: exact replays are unchanged, conflicting replays are reported without overwriting, and all new contacts, methods, tags, and tag assignments are written in one transaction.",
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
      const result = importNormalizedContacts({ selectedSource, inputs, store, ledger, context });
      return contactResult(schemaSemantics, context, result);
    },
  });

  registry.register({
    name: "contact_file_import",
    description: "Import an entire attached UTF-8 CSV or vCard/VCF directly in one application transaction, up to 10,000 contacts. The verified full stored attachment is parsed by this function; the model must not copy rows into arguments. For CSV, map exact header names from the attachment preview. Use row_number IDs with the same prefix and source as a prior partial row-based import, or row_hash for stable replay across reordered files. For vCard, pass csv_mapping as null; UID is used when present. Exact replays are unchanged and differing stored source IDs are reported as conflicts without overwriting.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        source: { type: "string", minLength: 1, maxLength: 200 },
        format: { type: "string", enum: ["auto", "csv", "vcard"] },
        default_tags: {
          type: "array", maxItems: 50,
          items: { type: "string", minLength: 1, maxLength: 200 },
        },
        csv_mapping: {
          type: ["object", "null"],
          additionalProperties: false,
          properties: {
            external_id_column: { ...nullableString, maxLength: 500 },
            external_id_strategy: { type: "string", enum: ["row_number", "row_hash"] },
            external_id_prefix: { type: "string", maxLength: 200 },
            display_name_column: { ...nullableString, maxLength: 500 },
            given_name_column: { ...nullableString, maxLength: 500 },
            family_name_column: { ...nullableString, maxLength: 500 },
            organization_name_column: { ...nullableString, maxLength: 500 },
            birth_date_column: { ...nullableString, maxLength: 500 },
            notes_columns: {
              type: "array", maxItems: 20,
              items: { type: "string", minLength: 1, maxLength: 500 },
            },
            tag_columns: {
              type: "array", maxItems: 20,
              items: { type: "string", minLength: 1, maxLength: 500 },
            },
            tag_separator: { ...nullableString, maxLength: 10 },
            methods: {
              type: "array", maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  column: { type: "string", minLength: 1, maxLength: 500 },
                  method_kind: { type: "string", enum: ["email", "phone", "postal_address", "handle", "url", "other"] },
                  label: { ...nullableString, maxLength: 100 },
                  is_primary: { type: "boolean" },
                  can_receive: { type: "boolean" },
                },
                required: ["column", "method_kind", "label", "is_primary", "can_receive"],
              },
            },
            default_contact_kind: { type: "string", enum: ["person", "organization", "service"] },
            default_status: { type: "string", enum: ["active", "inactive", "blocked", "deceased"] },
          },
          required: [
            "external_id_column", "external_id_strategy", "external_id_prefix",
            "display_name_column", "given_name_column", "family_name_column",
            "organization_name_column", "birth_date_column", "notes_columns",
            "tag_columns", "tag_separator", "methods", "default_contact_kind",
            "default_status",
          ],
        },
      },
      required: ["source", "format", "default_tags", "csv_mapping"],
    },
    async execute({ source, format, default_tags: defaultTags, csv_mapping: csvMapping }, context) {
      if (!context.attachment?.text) throw new Error("contact_file_import requires a CSV or vCard attached to this request");
      const selectedSource = requiredText(source, "Import source", 200);
      const parsed = parseContactAttachment(context.attachment, { format, csvMapping, defaultTags });
      const seenExternalIds = new Set();
      const inputs = parsed.entries.map((entry, index) => {
        let contact;
        try {
          contact = normalizedContact(entry);
        } catch (error) {
          throw new Error(`Contact file record ${index + 1}: ${error.message}`);
        }
        if (seenExternalIds.has(contact.external_id)) {
          throw new Error(`Duplicate external contact ID in contact file: ${contact.external_id}`);
        }
        seenExternalIds.add(contact.external_id);
        return contact;
      });
      const imported = importNormalizedContacts({
        selectedSource,
        inputs,
        store,
        ledger,
        context,
        actorName: "contact_file_import",
        includeItems: false,
      });
      return contactResult(schemaSemantics, context, {
        ...imported,
        format: parsed.format,
        filename: context.attachment.filename,
        sha256: context.attachment.sha256,
        blank_rows_skipped: parsed.blankRows,
        ...(parsed.headers ? { csv_headers: parsed.headers } : {}),
      }, {
        name: "contact_file_import",
        purpose: "Return a bounded summary of a whole-file contact import performed directly by the application.",
      });
    },
  });

  registry.register({
    name: "contact_search",
    description: "Search contacts with the same case-insensitive substring behavior as the Contacts UI. Use this for descriptive keywords or partial details rather than exact known display names. The supplied queries are OR alternatives searched across display, given, and family names, organization, notes, tags, contact-method labels, email addresses, phone numbers, and other method values. Results include the matching contacts and completeness metadata; do not claim no contacts match when scan_truncated is true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        queries: {
          type: "array", minItems: 1, maxItems: 20, uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 200 },
        },
        include_inactive: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["queries", "include_inactive", "limit"],
    },
    async execute({ queries, include_inactive: includeInactive, limit }, context) {
      const search = searchCoordinator
        ? (await searchCoordinator.searchScope("contacts", {
            query: queries[0], queries, limit, options: { includeInactive },
          })).native
        : organizer.searchContacts({ queries, includeInactive, limit });
      return contactResult(schemaSemantics, context, {
        queries: search.queries,
        scanned_contact_count: search.scannedContactCount,
        scan_truncated: search.scanTruncated,
        total_contact_count: search.totalContactCount,
        total_match_count: search.totalMatchCount,
        returned_match_count: search.matches.length,
        has_more: search.hasMore,
        matches: search.matches.map(({ contact, matchedQueries }) => ({
          matched_queries: matchedQueries,
          contact_id: contact.id,
          expected_version: contact.version,
          display_name: contact.displayName,
          given_name: contact.givenName,
          family_name: contact.familyName,
          organization_name: contact.organizationName,
          contact_kind: contact.kind,
          status: contact.status,
          birth_date: contact.birthDate,
          notes: contact.notes,
          source: contact.source,
          external_id: contact.externalId,
          methods: contact.methods,
          tags: contact.tags,
        })),
      }, {
        name: "contact_search",
        purpose: "Return contacts matching UI-equivalent substring searches across identity, notes, tags, and contact methods.",
      });
    },
  });

  registry.register({
    name: "contact_lookup_batch",
    description: "Look up 1 through 500 contact display names in one call using exact normalized-name matching across up to 10,000 stored contacts. Use this instead of repeated database reads when resolving a large user-supplied list. Each result reports all bounded matches with current IDs, versions, methods, tags, source, and status so a later bulk action can be precise.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        names: {
          type: "array", minItems: 1, maxItems: 500,
          items: { type: "string", minLength: 1, maxLength: 500 },
        },
        include_inactive: { type: "boolean" },
        max_matches_per_name: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["names", "include_inactive", "max_matches_per_name"],
    },
    async execute({ names, include_inactive: includeInactive, max_matches_per_name: maxMatchesPerName }, context) {
      const lookup = organizer.lookupContactsByNames({ names, includeInactive, maxMatchesPerName });
      const result = {
        scanned_contact_count: lookup.scannedContactCount,
        query_count: lookup.results.length,
        results: lookup.results.map((item) => ({
          query: item.query,
          normalized_name: item.normalizedName,
          match_count: item.matchCount,
          matches_truncated: item.matchesTruncated,
          matches: item.matches.map((contact) => ({
            contact_id: contact.id,
            expected_version: contact.version,
            display_name: contact.displayName,
            contact_kind: contact.kind,
            status: contact.status,
            source: contact.source,
            external_id: contact.externalId,
            birth_date: contact.birthDate,
            methods: contact.methods,
            tags: contact.tags,
          })),
        })),
      };
      return contactResult(schemaSemantics, context, result, {
        name: "contact_lookup_batch",
        purpose: "Resolve many exact normalized contact names in one bounded read for subsequent bulk operations.",
      });
    },
  });

  registry.register({
    name: "contact_tag_add_batch",
    description: "Atomically add one tag to 1 through 10,000 existing contacts by ID in a single tool call. The operation validates every contact before writing, preserves all existing tags, is safe to replay, and reports newly tagged versus already-tagged counts. Use this after one contact_lookup_batch call; never insert record_tags one row at a time.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        tag: { type: "string", minLength: 1, maxLength: 100 },
        contact_ids: {
          type: "array", minItems: 1, maxItems: 10000, uniqueItems: true,
          items: { type: "integer", minimum: 1 },
        },
      },
      required: ["tag", "contact_ids"],
    },
    async execute({ tag, contact_ids: contactIds }, context) {
      const tagged = organizer.addTagToContacts(
        { tag, contactIds },
        contactToolActivity(context, "contact_tag_add_batch"),
      );
      return contactResult(schemaSemantics, context, {
        tag: tagged.tag,
        selected_contact_count: tagged.selectedContactCount,
        tagged_contact_count: tagged.taggedContactCount,
        already_tagged_contact_count: tagged.alreadyTaggedContactCount,
      }, {
        name: "contact_tag_add_batch",
        purpose: "Return a bounded receipt for one atomic, replay-safe tag assignment across many contacts.",
      });
    },
  });

  registry.register({
    name: "contact_tag_rename",
    description: "Rename one tag across every contact currently assigned to it. Tag matching uses the same normalized form as contact imports. If the destination tag already exists, assignments are merged without duplicates. This operation is atomic and returns the number of affected contacts.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        current_tag: { type: "string", minLength: 1, maxLength: 100 },
        new_tag: { type: "string", minLength: 1, maxLength: 100 },
      },
      required: ["current_tag", "new_tag"],
    },
    async execute({ current_tag: currentTag, new_tag: newTag }, context) {
      const renamed = organizer.renameContactTag(
        { currentTag, newTag },
        contactToolActivity(context, "contact_tag_rename"),
      );
      return contactResult(schemaSemantics, context, {
        previous_tag: renamed.previousTag,
        tag: renamed.tag,
        affected_contact_count: renamed.affectedContactCount,
        merged_with_existing_tag: renamed.mergedWithExistingTag,
      }, {
        name: "contact_tag_rename",
        purpose: "Return the result of an atomic contact tag rename, including collision merging and the number of affected contacts.",
      });
    },
  });

  registry.register({
    name: "contact_dedupe_clear",
    description: "Recompute and atomically merge up to 500 conservative, source-aware duplicate groups without sending every candidate through model arguments. Repeat while eligible_group_count_remaining is positive. A group is eligible only when all active contacts have the same normalized display name and kind, come from distinct named import sources, have no conflicting birthdays, and every contact is connected by an exact email or phone match. Same-name-only, family-email with different names, same-source, malformed, oversized, and otherwise ambiguous groups are skipped for AI review. The richest record is retained unless preferred_source names a source present in the group.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        max_groups: { type: "integer", minimum: 1, maximum: 500 },
        preferred_source: { ...nullableString, maxLength: 200 },
      },
      required: ["max_groups", "preferred_source"],
    },
    async execute({ max_groups: maxGroups, preferred_source: preferredSource }, context) {
      const deduped = organizer.dedupeClearContacts(
        { maxGroups, preferredSource },
        contactToolActivity(context, "contact_dedupe_clear"),
      );
      const result = {
        active_contact_count_before: deduped.activeContactCount,
        scanned_contact_count: deduped.scannedContactCount,
        scan_truncated: deduped.scanTruncated,
        candidate_group_count_before: deduped.candidateGroupCount,
        eligible_group_count_before: deduped.eligibleGroupCount,
        eligible_group_count_remaining: deduped.eligibleGroupCountRemaining,
        ambiguous_group_count: deduped.ambiguousGroupCount,
        skipped_by_reason: deduped.skippedByReason,
        merged_group_count: deduped.mergedGroupCount,
        merged_contact_count: deduped.mergedContactCount,
        groups: deduped.results.map((item) => ({
          kept_contact_id: item.contact.id,
          kept_source: item.contact.source,
          merged_contact_ids: item.mergedContactIds,
        })),
      };
      return contactResult(schemaSemantics, context, result, {
        name: "contact_dedupe_clear",
        purpose: "Return a bounded receipt for conservative source-aware duplicate merges and summarize ambiguous groups left for AI review.",
      });
    },
  });

  registry.register({
    name: "contact_duplicate_list",
    description: "List paginated groups of active contacts that may be duplicates. Candidates either share an exact normalized display name, or each different-name match shares both a normalized name word and an exact email address or phone number. Partial-name matches are review-only and are never handled by contact_dedupe_clear. Use compact detail and pages of about 50 groups for bulk work; use full only when complete notes and timestamps are necessary. Each candidate includes the expected_version required by contact_merge. Same-name evidence alone can be ambiguous. Continue with next_offset while has_more is true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 200 },
        offset: { type: "integer", minimum: 0, maximum: 10000 },
        detail: { type: "string", enum: ["compact", "full"] },
      },
      required: ["limit", "offset", "detail"],
    },
    async execute({ limit, offset, detail }, context) {
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
            return detail === "compact" ? compactDuplicateCandidate(contact) : {
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
    description: "Atomically apply 1 through 100 independently reviewed contact merge groups. A one-group request uses the same merges array. Build every group from current contact_duplicate_list candidates and exact expected_version values. One stale version, missing contact, repeated contact across groups, or invalid merge rolls back the complete call. Successful groups combine unique methods, tags, notes, and missing identity fields while retaining source records as inactive history. Never merge merely because names match when the remaining details are ambiguous.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        merges: {
          type: "array", minItems: 1, maxItems: 100,
          items: {
            type: "object",
            additionalProperties: false,
            properties: mergeOperationProperties,
            required: ["keep_contact_id", "keep_expected_version", "merge_contacts"],
          },
        },
      },
      required: ["merges"],
    },
    async execute({ merges }, context) {
      const batch = organizer.mergeContactBatch(
        merges.map(organizerMergeInput),
        contactToolActivity(context, "contact_merge"),
      );
      const result = {
        merged_group_count: batch.mergedGroupCount,
        merged_contact_count: batch.mergedContactCount,
        groups: batch.results.map((item) => ({
          kept_contact_id: item.contact.id,
          merged_contact_ids: item.mergedContactIds,
        })),
      };
      return contactResult(schemaSemantics, context, result, {
        name: "contact_merge",
        purpose: "Return compact retained and source contact IDs after an atomic batch of reviewed merges.",
      });
    },
  });
}
