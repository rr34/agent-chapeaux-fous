
const toolDescriptions = Object.freeze({
  "web_page_read": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Read one user-supplied or previously discovered public HTTP(S) page and return extracted text, metadata, and links; this does not search the web.",
    "actionClasses": [
      "READ"
    ],
    "effectClassifications": [
      "READ-ONLY"
    ]
  },
  "web_search": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Search the public web for one to five bounded queries and return ranked source URLs with snippets for subsequent reading.",
    "actionClasses": ["READ"],
    "effectClassifications": ["READ-ONLY"]
  },
});
export function registerWebPageTools(registry, client, searchClient = null) {
  registry = registry.withCapability?.("web", toolDescriptions) ?? registry;
  registry.register({
    name: "web_page_read",
    description: "Read one specific HTTP(S) page by URL and return its extracted text, metadata, and links. Use only for a URL the user supplied or a link returned by a previously read page, including pagination. This tool does not search the web. Private/local network targets and non-text responses are rejected.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", minLength: 8, maxLength: 4096 },
        maximum_characters: { type: "integer", minimum: 1000, maximum: 100000 },
      },
      required: ["url", "maximum_characters"],
    },
    async execute({ url, maximum_characters: maximumCharacters }) {
      return client.read(url, maximumCharacters);
    },
  });
  registry.register({
    name: "web_search",
    description: "Search the public web through the configured Brave Search API. Submit 1-5 independent queries in one call. Results are ranked discovery evidence with source URLs and snippets, not verified facts; read promising result URLs with web_page_read before relying on details that require page evidence. Do not search for private data or send uploaded file contents; use only the minimum public identifying terms needed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        queries: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: { type: "string", minLength: 1, maxLength: 500 },
              count: { type: "integer", minimum: 1, maximum: 10 },
            },
            required: ["query", "count"],
          },
        },
      },
      required: ["queries"],
    },
    async execute({ queries }) {
      if (!searchClient?.search) throw new Error("Web search is not configured: BRAVE_SEARCH_API_KEY is required");
      const results = [];
      for (const { query, count } of queries) results.push(await searchClient.search(query, count));
      return { provider: "brave", queries: results };
    },
  });
}
