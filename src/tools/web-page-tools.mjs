export function registerWebPageTools(registry, client) {
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
}
