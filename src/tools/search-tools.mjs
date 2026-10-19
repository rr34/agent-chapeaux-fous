import { recordedReferenceSets } from "../reference-sets.mjs";

const toolDescriptions = Object.freeze({
  "global_search": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Search across selected native domains and return compact normalized discovery hits while preserving provider matching rules.",
    "actionClasses": [
      "READ"
    ],
    "effectClassifications": [
      "READ-ONLY"
    ]
  },
  "reference_set_record": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Preserve an exact named set of currently verified objects or directed relationships for later conversational reference.",
    "actionClasses": ["UPDATE"],
    "effectClassifications": ["MUTATING"]
  },
});
export function registerSearchTools(registry, searchCoordinator) {
  registry = registry.withCapability?.("search", toolDescriptions) ?? registry;
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
  registry.register({
    name: "reference_set_record",
    description: "Record exact sets derived during this request so later conversation can refer to them without reconstructing membership or pairings from prose. Every member and every relationship endpoint must already be a verified stable object reference returned in this request or supplied in its accepted core. A relationship set is directed: preserve each from_ref → to_ref pair exactly, declare the actual domain type at each endpoint, and never submit two independent endpoint lists.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        object_sets: {
          type: "array", maxItems: 20,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              display: { type: "string", minLength: 1, maxLength: 500 },
              member_refs: {
                type: "array", minItems: 1, maxItems: 500, uniqueItems: true,
                items: { type: "string", minLength: 1, maxLength: 1000 },
              },
            },
            required: ["display", "member_refs"],
          },
        },
        relationship_sets: {
          type: "array", maxItems: 20,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              display: { type: "string", minLength: 1, maxLength: 500 },
              relationship_type: { type: "string", pattern: "^[a-z][a-z0-9_.:-]{0,199}$" },
              from_type: { type: "string", minLength: 1, maxLength: 200 },
              to_type: { type: "string", minLength: 1, maxLength: 200 },
              edges: {
                type: "array", minItems: 1, maxItems: 500,
                items: {
                  type: "object", additionalProperties: false,
                  properties: {
                    from_ref: { type: "string", minLength: 1, maxLength: 1000 },
                    to_ref: { type: "string", minLength: 1, maxLength: 1000 },
                  },
                  required: ["from_ref", "to_ref"],
                },
              },
            },
            required: ["display", "relationship_type", "from_type", "to_type", "edges"],
          },
        },
      },
      required: ["object_sets", "relationship_sets"],
    },
    async execute({ object_sets: objectSets, relationship_sets: relationshipSets }, context) {
      const referenceSets = recordedReferenceSets({
        requestId: context.requestId,
        availableObjectReferences: context.verifiedObjectReferences,
        objectSets: objectSets.map(({ display, member_refs: memberRefs }) => ({ display, memberRefs })),
        relationshipSets: relationshipSets.map((set) => ({
          display: set.display,
          relationshipType: set.relationship_type,
          fromType: set.from_type,
          toType: set.to_type,
          edges: set.edges.map(({ from_ref: fromRef, to_ref: toRef }) => ({ fromRef, toRef })),
        })),
      });
      return { recorded_count: referenceSets.length, referenceSets };
    },
  });
}
