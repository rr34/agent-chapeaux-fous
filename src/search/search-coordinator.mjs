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

function interleavedHits(results, limit) {
  const hits = [];
  for (let index = 0; hits.length < limit; index += 1) {
    let added = false;
    for (const result of results) {
      const hit = result.hits[index];
      if (!hit) continue;
      hits.push(hit);
      added = true;
      if (hits.length === limit) break;
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

  listProviders() {
    return [...this.providers.values()].map((provider) => ({
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

  async search({
    query, scopes = null, mode = "terms", maxDistance = 12, contextTokens = 24,
    limit = 20, options = {},
  } = {}) {
    const selectedQuery = normalizedQuery(query);
    const selectedLimit = boundedInteger(limit, "limit", { minimum: 1, maximum: 100, fallback: 20 });
    const availableScopes = [...this.providers.keys()];
    if (scopes !== null && !Array.isArray(scopes)) {
      throw inputError("scopes must be an array of search scope names or null.");
    }
    const selectedScopes = scopes == null ? availableScopes : [...new Set(scopes)];
    if (selectedScopes.length === 0) {
      throw inputError("scopes must contain at least one search scope.");
    }
    for (const scope of selectedScopes) {
      if (!this.providers.has(scope)) throw inputError(`Unknown search scope: ${scope}`);
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
          hits: Array.isArray(result.hits) ? result.hits : [],
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
    const hits = interleavedHits(settled, selectedLimit);
    return {
      query: selectedQuery,
      requestedMode: mode,
      scopes: selectedScopes,
      count: hits.length,
      hasMore: settled.some((result) => result.hasMore)
        || settled.reduce((sum, result) => sum + result.hits.length, 0) > hits.length,
      partial: settled.some((result) => result.status === "error" || !result.exhaustive),
      providers: settled.map(({ hits: providerHits, ...result }) => ({
        ...result,
        count: providerHits.length,
      })),
      hits,
    };
  }
}
