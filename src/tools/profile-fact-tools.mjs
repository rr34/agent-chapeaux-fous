const factKey = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,199}$",
  description: "Stable lowercase key such as preferred_name, default_location, vehicle, or address.",
};

export function registerProfileFactTools(registry, profileFacts) {
  registry.register({
    name: "profile_fact_list",
    description: "List active or archived durable user profile facts. Active facts are loaded automatically into the bounded context for every first model request.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["active", "archived", "all"] },
        keys: { type: ["array", "null"], items: factKey, maxItems: 100 },
      },
      required: ["status", "keys"],
    },
    async execute(argumentsObject) {
      return profileFacts.list(argumentsObject);
    },
  });

  registry.register({
    name: "profile_fact_set",
    description: "Create or replace one durable user profile fact, archiving the prior value when it changes. Use this when the user asks to remember or change stable personal information or preferences.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        key: factKey,
        value: { type: "string", minLength: 1, maxLength: 10000 },
      },
      required: ["key", "value"],
    },
    async execute(argumentsObject, context) {
      return profileFacts.set(argumentsObject, context);
    },
  });

  registry.register({
    name: "profile_fact_delete",
    description: "Archive one durable user profile fact so it is retained as history but omitted from future model context.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { key: factKey },
      required: ["key"],
    },
    async execute(argumentsObject, context) {
      return profileFacts.archive(argumentsObject, context);
    },
  });
}
