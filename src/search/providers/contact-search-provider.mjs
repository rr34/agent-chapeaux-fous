function matchedFields(contact, matchedQueries) {
  const queries = matchedQueries.map((query) => query.toLocaleLowerCase());
  const fields = [
    ["display_name", contact.displayName],
    ["given_name", contact.givenName],
    ["family_name", contact.familyName],
    ["organization_name", contact.organizationName],
    ["notes", contact.notes],
    ["tags", contact.tags?.join(" ")],
    ["methods", contact.methods?.flatMap((method) => [method.label, method.value]).join(" ")],
  ];
  return fields.filter(([, value]) => {
    const normalized = String(value ?? "").toLocaleLowerCase();
    return queries.some((query) => normalized.includes(query));
  }).map(([field]) => field);
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
    return {
      native,
      matchMode: mode === "phrase" ? "phrase" : "terms",
      exhaustive: !native.scanTruncated,
      hasMore: native.hasMore,
      warnings: [
        ...(mode === "near" ? ["Contact search does not support proximity matching; native substring matching was used."] : []),
        ...(native.scanTruncated ? ["The contact scan was truncated."] : []),
      ],
      hits: native.matches.map(({ contact, matchedQueries }) => ({
        provider: this.id,
        kind: "contact",
        id: String(contact.id),
        title: contact.displayName,
        snippet: contact.notes || contact.organizationName || null,
        matchedFields: matchedFields(contact, matchedQueries),
        occurredAtUtc: null,
        actionRef: { contact_id: contact.id, expected_version: contact.version },
      })),
    };
  }
}
