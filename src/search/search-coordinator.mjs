const searchModes = new Set(["terms", "phrase", "near"]);

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function boundedInteger(value, label, { minimum, maximum, fallback }) {
  const selected = value == null ? fallback : Number(value);
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) {
    throw inputError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return selected;
}

function normalizedQuery(value) {
  if (typeof value !== "string" || !value.trim()) throw inputError("query is required.");
  const query = value.trim();
  if (query.length > 500) throw inputError("query must be at most 500 characters.");
  return query;
}

function interleavedHits(results) {
  const hits = [];
  for (let index = 0; ; index += 1) {
    let added = false;
    for (const result of results) {
      const hit = result.hits[index];
      if (!hit) continue;
      hits.push(hit);
      added = true;
    }
    if (!added) break;
  }
  return hits;
}

function providerCapabilities(provider) {
  return {
    phrase: false,
    proximity: false,
    snippets: false,
    ...(typeof provider.capabilities === "function"
      ? provider.capabilities()
      : provider.capabilities ?? {}),
  };
}

function normalizedHit(scope, hit) {
  const provider = String(hit?.provider ?? scope);
  const kind = String(hit?.kind ?? "record");
  const id = String(hit?.id ?? "");
  return {
    provider,
    kind,
    id,
    ref: typeof hit?.ref === "string" ? hit.ref : null,
    objectType: typeof hit?.objectType === "string" ? hit.objectType : null,
    source: typeof hit?.source === "string" ? hit.source : null,
    title: String(hit?.title ?? `${kind} ${id}`).trim(),
    snippet: hit?.snippet == null ? null : String(hit.snippet),
    matchedFields: Array.isArray(hit?.matchedFields) ? hit.matchedFields.map(String) : [],
    occurredAtUtc: hit?.occurredAtUtc ?? null,
    actionRef: hit?.actionRef && typeof hit.actionRef === "object" ? hit.actionRef : {},
    ...(hit?.providerRank == null ? {} : { providerRank: Number(hit.providerRank) }),
    ...(hit?.object && typeof hit.object === "object" ? { object: hit.object } : {}),
  };
}

function deduplicatedHits(hits) {
  const seen = new Set();
  return hits.filter((hit) => {
    const key = hit.ref || `${hit.provider}:${hit.kind}:${hit.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class SearchCoordinator {
  constructor({ providers = [] } = {}) {
    this.providers = new Map();
    for (const provider of providers) this.register(provider);
  }

  register(provider) {
    if (!provider || typeof provider.id !== "string" || !provider.id.trim()) {
      throw new Error("A search provider needs a non-empty id");
    }
    if (typeof provider.search !== "function") {
      throw new Error(`Search provider ${provider.id} needs a search function`);
    }
    if (this.providers.has(provider.id)) throw new Error(`Duplicate search provider: ${provider.id}`);
    this.providers.set(provider.id, provider);
    return this;
  }

  listProviders({ includeInternal = false } = {}) {
    return [...this.providers.values()].filter((provider) => includeInternal || provider.global !== false).map((provider) => ({
      id: provider.id,
      description: provider.description ?? `${provider.id} search provider`,
      capabilities: providerCapabilities(provider),
    }));
  }

  async searchScope(scope, input) {
    const provider = this.providers.get(scope);
    if (!provider) throw inputError(`Unknown search scope: ${scope}`);
    const query = normalizedQuery(input?.query);
    const mode = input?.mode ?? "terms";
    if (!searchModes.has(mode)) throw inputError("mode must be terms, phrase, or near.");
    return provider.search({
      ...input,
      query,
      mode,
      maxDistance: boundedInteger(input?.maxDistance, "maxDistance", {
        minimum: 1, maximum: 50, fallback: 12,
      }),
      contextTokens: boundedInteger(input?.contextTokens, "contextTokens", {
        minimum: 5, maximum: 64, fallback: 24,
      }),
      limit: boundedInteger(input?.limit, "limit", { minimum: 1, maximum: 200, fallback: 20 }),
    });
  }

  async searchNativeObjects({ query, limit = 24, domainTypes = null } = {}) {
    const result = await this.searchScope("objects", {
      query,
      limit,
      options: { domainTypes },
    });
    return result.native;
  }

  async search({
    query, scopes = null, mode = "terms", maxDistance = 12, contextTokens = 24,
    limit = 20, options = {},
  } = {}) {
    const selectedQuery = normalizedQuery(query);
    const selectedLimit = boundedInteger(limit, "limit", { minimum: 1, maximum: 100, fallback: 20 });
    const availableScopes = this.listProviders().map(({ id }) => id);
    const availableScopeSet = new Set(availableScopes);
    if (scopes !== null && !Array.isArray(scopes)) {
      throw inputError("scopes must be an array of search scope names or null.");
    }
    const selectedScopes = scopes == null ? availableScopes : [...new Set(scopes)];
    if (selectedScopes.length === 0) {
      throw inputError("scopes must contain at least one search scope.");
    }
    for (const scope of selectedScopes) {
      if (!availableScopeSet.has(scope)) throw inputError(`Unknown search scope: ${scope}`);
    }

    const settled = await Promise.all(selectedScopes.map(async (scope) => {
      const capabilities = providerCapabilities(this.providers.get(scope));
      try {
        const result = await this.searchScope(scope, {
          query: selectedQuery,
          mode,
          maxDistance,
          contextTokens,
          limit: selectedLimit,
          options: options?.[scope] ?? {},
        });
        return {
          scope,
          status: "complete",
          hits: Array.isArray(result.hits)
            ? result.hits.map((hit) => normalizedHit(scope, hit))
            : [],
          exhaustive: result.exhaustive !== false,
          hasMore: Boolean(result.hasMore),
          matchMode: result.matchMode ?? "terms",
          warnings: result.warnings ?? [],
          capabilities,
        };
      } catch (error) {
        return {
          scope,
          status: "error",
          hits: [],
          exhaustive: false,
          hasMore: false,
          matchMode: null,
          warnings: [],
          capabilities,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }));
    const uniqueHits = deduplicatedHits(interleavedHits(settled));
    const hits = uniqueHits.slice(0, selectedLimit);
    return {
      query: selectedQuery,
      requestedMode: mode,
      scopes: selectedScopes,
      count: hits.length,
      hasMore: settled.some((result) => result.hasMore)
        || uniqueHits.length > hits.length,
      partial: settled.some((result) => result.status === "error" || !result.exhaustive),
      providers: settled.map(({ hits: providerHits, ...result }) => ({
        ...result,
        count: providerHits.length,
      })),
      hits,
    };
  }
}
