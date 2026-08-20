export function registerSearchTools(registry, searchCoordinator) {
  const scopes = searchCoordinator.listProviders().map(({ id }) => id);
  registry.register({
    name: "global_search",
    description: "Search across one or more application-owned data domains and return compact normalized discovery hits. Use this for broad requests such as finding everything related to a person or topic. Domain providers retain their native matching rules; phrase and proximity modes are applied only by providers that report support, and every provider reports its actual match mode, completeness, warnings, or error. This tool is read-only. Use a domain-specific tool for rich filters, complete native records, or follow-up actions.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1, maxLength: 500 },
        scopes: {
          type: "array", minItems: 1, maxItems: scopes.length, uniqueItems: true,
          items: { type: "string", enum: scopes },
        },
        match_mode: { type: "string", enum: ["terms", "phrase", "near"] },
        max_distance: { type: "integer", minimum: 1, maximum: 50 },
        context_tokens: { type: "integer", minimum: 5, maximum: 64 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["query", "scopes", "match_mode", "max_distance", "context_tokens", "limit"],
    },
    async execute({
      query, scopes: selectedScopes, match_mode: mode, max_distance: maxDistance,
      context_tokens: contextTokens, limit,
    }) {
      return searchCoordinator.search({
        query,
        scopes: selectedScopes,
        mode,
        maxDistance,
        contextTokens,
        limit,
      });
    },
  });
}
