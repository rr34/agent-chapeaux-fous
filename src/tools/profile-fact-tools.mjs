const factType = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,199}$",
  description: "Broad repeatable lowercase type such as preferred_name, default_location, vehicle, clothing_size, or address.",
};

export function registerProfileFactTools(registry, profileFacts) {
  registry.register({
    name: "profile_fact_list",
    description: "List active or archived durable profile facts, including stable row IDs. The first model request automatically includes active rows only for profile types selected as relevant to that request; use this tool when other durable facts clearly need inspection.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["active", "archived", "all"] },
        factTypes: { type: ["array", "null"], items: factType, maxItems: 100 },
      },
      required: ["status", "factTypes"],
    },
    async execute(argumentsObject) {
      return profileFacts.list(argumentsObject);
    },
  });

  registry.register({
    name: "profile_fact_set",
    description: "Add or replace one durable profile-fact row. Call this whenever the user states or corrects stable personal information, even casually. Use a broad repeatable factType and self-contained text identifying the person or item. Set replacesFactId to the exact active row ID only when that same real-world fact changed; use null for a different person or item even if another active row has the same type.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        factType,
        text: {
          type: "string",
          minLength: 1,
          maxLength: 10000,
          description: "Self-contained natural-language fact, such as 'My wife's car is a 2020 Honda CR-V.'",
        },
        replacesFactId: {
          type: ["integer", "null"],
          minimum: 1,
          description: "Exact active profile fact ID being corrected, or null to add another row.",
        },
      },
      required: ["factType", "text", "replacesFactId"],
    },
    async execute(argumentsObject, context) {
      return profileFacts.set(argumentsObject, context);
    },
  });

  registry.register({
    name: "profile_fact_delete",
    description: "Archive one durable profile-fact row by its exact stable ID so other active rows, including rows of the same type, remain unchanged.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { factId: { type: "integer", minimum: 1 } },
      required: ["factId"],
    },
    async execute(argumentsObject, context) {
      return profileFacts.archive(argumentsObject, context);
    },
  });
}
