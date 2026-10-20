export function nativeObjectHit(provider, object) {
  return {
    provider,
    kind: object.type,
    id: String(object.id),
    ref: object.ref,
    objectType: object.domainType,
    source: object.source,
    title: object.title,
    snippet: object.detail || null,
    matchedFields: object.matchedOn ?? [],
    occurredAtUtc: object.row?.occurred_at_utc ?? null,
    actionRef: {
      type: object.domainType,
      source: object.source,
      id: object.id,
      ref: object.ref,
    },
    object,
  };
}

export class NativeObjectDomainSearchProvider {
  constructor({ id, description, organizer, domainTypes = null, global = true }) {
    this.id = id;
    this.description = description;
    this.organizer = organizer;
    this.domainTypes = domainTypes;
    this.global = global;
    this.capabilities = { phrase: false, proximity: false, snippets: false };
  }

  search({ query, mode, limit, options = {} }) {
    const requestedDomainTypes = options.domainTypes ?? this.domainTypes;
    const boundedLimit = Math.min(48, limit);
    const native = this.organizer.searchNativeObjects({
      query,
      limit: boundedLimit,
      ...(requestedDomainTypes ? { domainTypes: requestedDomainTypes } : {}),
    });
    const hasMore = native.objects.length === boundedLimit;
    return {
      native,
      matchMode: "terms",
      exhaustive: !hasMore,
      hasMore,
      warnings: [
        ...(mode === "terms" ? [] : [
          `${this.description} does not support ${mode} matching; deterministic lexical matching was used.`,
        ]),
        ...(limit > 48 ? ["Native object discovery is bounded to 48 results per source."] : []),
      ],
      hits: native.objects.map((object) => nativeObjectHit(this.id, object)),
    };
  }
}

