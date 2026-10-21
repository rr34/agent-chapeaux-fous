function matchedFields(contact, matchedQueries) {
  const queries = matchedQueries.map((query) => query.toLocaleLowerCase());
  const fields = [
    ["display_name", contact.displayName],
    ["given_name", contact.givenName],
    ["family_name", contact.familyName],
    ["organization_name", contact.organizationName],
    ["notes", contact.notes],
    ["tags", contact.tags?.join(" ")],
    ["methods", contact.methods?.flatMap((method) => [method.kind, method.label, method.value]).join(" ")],
  ];
  return fields.filter(([, value]) => {
    const normalized = String(value ?? "").toLocaleLowerCase();
    return queries.some((query) => normalized.includes(query));
  }).map(([field]) => field);
}

function matchingMethods(contact, matchedQueries) {
  const queries = matchedQueries.map((query) => query.toLocaleLowerCase());
  return (contact.methods ?? []).flatMap((method) => {
    const fields = [
      ["method_kind", method.kind],
      ["method_label", method.label],
      ["method_value", method.value],
      ["contact_display_name", contact.displayName],
    ].filter(([, value]) => {
      const normalized = String(value ?? "").toLocaleLowerCase();
      return queries.some((query) => normalized.includes(query));
    }).map(([field]) => field);
    return fields.length ? [{ method, fields }] : [];
  });
}

function contactHit(contact, matchedQueries) {
  return {
    provider: "contacts",
    kind: "contact",
    id: String(contact.id),
    ref: `agent-slayer://contacts/${contact.id}`,
    objectType: "contacts.contact",
    source: "native:contacts",
    title: contact.displayName,
    snippet: contact.notes || contact.organizationName || null,
    matchedFields: matchedFields(contact, matchedQueries),
    occurredAtUtc: null,
    actionRef: { contact_id: contact.id, expected_version: contact.version },
  };
}

function methodHit(contact, method, fields) {
  const title = [method.label, method.value].filter(Boolean).join(": ")
    || `${method.kind} for ${contact.displayName}`;
  return {
    provider: "contacts",
    kind: "contact_method",
    id: String(method.id),
    ref: `agent-slayer://contact-methods/${method.id}`,
    objectType: "contacts.method",
    source: "native:contacts",
    title,
    snippet: `Contact: ${contact.displayName}`,
    matchedFields: fields,
    occurredAtUtc: null,
    actionRef: {
      contact_id: contact.id,
      contact_method_id: method.id,
      expected_version: contact.version,
    },
  };
}

export class ContactSearchProvider {
  constructor({ organizer }) {
    this.id = "contacts";
    this.description = "Native contacts, notes, tags, and contact methods.";
    this.organizer = organizer;
    this.capabilities = { phrase: true, proximity: false, snippets: false };
  }

  search({ query, queries = null, mode, limit, options = {} }) {
    const native = this.organizer.searchContacts({
      queries: queries ?? [query],
      includeInactive: options.includeInactive ?? false,
      limit,
    });
    const hits = native.matches.flatMap(({ contact, matchedQueries }) => [
      contactHit(contact, matchedQueries),
      ...matchingMethods(contact, matchedQueries)
        .map(({ method, fields }) => methodHit(contact, method, fields)),
    ]);
    const hasMore = native.hasMore || hits.length > limit;
    return {
      native,
      matchMode: mode === "phrase" ? "phrase" : "terms",
      exhaustive: !native.scanTruncated && !hasMore,
      hasMore,
      warnings: [
        ...(mode === "near" ? ["Contact search does not support proximity matching; native substring matching was used."] : []),
        ...(native.scanTruncated ? ["The contact scan was truncated."] : []),
      ],
      hits: hits.slice(0, limit),
    };
  }
}
