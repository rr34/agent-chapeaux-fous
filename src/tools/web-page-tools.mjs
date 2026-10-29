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
    "summary": "Search and browse the live public web through OpenAI's hosted Responses tool, retaining its actions, sources, and citations.",
    "actionClasses": ["READ"],
    "effectClassifications": ["READ-ONLY"]
  },
});
export function registerWebPageTools(registry, client) {
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
    description: "Search and browse the live public web through OpenAI's hosted Responses web search. The provider chooses bounded search, open-page, and find-in-page actions and returns cited sources in the assistant response. Do not search for private data or send uploaded file contents; use only the minimum public identifying terms needed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
    metadata: {
      openaiHostedTool: {
        type: "web_search",
        search_context_size: "medium",
        external_web_access: true,
      },
    },
    async execute() {
      throw new Error("web_search is hosted by the OpenAI Responses transport and cannot execute locally");
    },
  });
}
