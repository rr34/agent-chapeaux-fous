import { withSchemaProjection } from "./schema-result.mjs";

const factType = {
  type: "string",
  pattern: "^[a-z][a-z0-9_]{0,199}$",
  description: "Broad repeatable lowercase type such as preferred_name, default_location, vehicle, clothing_size, or address.",
};

const profileFactFields = [
  "profile_fact_id", "fact_type", "fact_text", "fact_status", "source_event_id",
  "archived_by_event_id", "created_at_utc", "updated_at_utc", "archived_at_utc",
];

function databaseFact(fact) {
  if (!fact) return null;
  return {
    profile_fact_id: fact.id,
    fact_type: fact.factType,
    fact_text: fact.text,
    fact_status: fact.status,
    source_event_id: fact.sourceEventId,
    archived_by_event_id: fact.archivedByEventId,
    created_at_utc: fact.createdAtUtc,
    updated_at_utc: fact.updatedAtUtc,
    archived_at_utc: fact.archivedAtUtc,
  };
}

function factResult(schemaSemantics, context, result, name, purpose) {
  return withSchemaProjection(schemaSemantics, context, result, {
    name,
    purpose,
    schemaObjects: ["profile_facts"],
    fields: { profile_facts: profileFactFields },
  });
}

export function registerProfileFactTools(registry, profileFacts, schemaSemantics = null) {
  registry.register({
    name: "profile_fact_list",
    description: "List active or archived durable profile facts, including stable row IDs. The first model request automatically includes active rows only for profile types selected as relevant to that request; use this tool when other durable facts clearly need inspection.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["active", "archived", "all"] },
        fact_types: { type: ["array", "null"], items: factType, maxItems: 100 },
      },
      required: ["status", "fact_types"],
    },
    async execute(argumentsObject, context) {
      const result = profileFacts.list({
        status: argumentsObject.status,
        factTypes: argumentsObject.fact_types,
      });
      return factResult(schemaSemantics, context, {
        status: result.status,
        count: result.count,
        facts: result.facts.map(databaseFact),
      }, "profile_fact_list", "List durable profile facts using their stored database fields.");
    },
  });

  registry.register({
    name: "profile_fact_set",
    description: "Add or replace one durable fact about the user, another person, a real-world item in their life, or a lasting cross-task preference. Call this when the user states or corrects stable personal information, even casually. Never store operational IDs, mappings, precision values, quantities, file metadata, import parameters, or other current-task working state unless the user explicitly asks to remember one as a lasting preference or default. Use a broad repeatable fact_type and self-contained fact_text identifying the person or item. Set replaces_profile_fact_id to the exact active row ID only when that same real-world fact changed; use null for a different person or item even if another active row has the same type.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        fact_type: factType,
        fact_text: {
          type: "string",
          minLength: 1,
          maxLength: 10000,
          description: "Self-contained durable personal fact, such as 'My wife's car is a 2020 Honda CR-V.' Never use this for a domain operation's working parameters.",
        },
        replaces_profile_fact_id: {
          type: ["integer", "null"],
          minimum: 1,
          description: "Exact active profile fact ID being corrected, or null to add another row.",
        },
      },
      required: ["fact_type", "fact_text", "replaces_profile_fact_id"],
    },
    async execute(argumentsObject, context) {
      const result = profileFacts.set({
        factType: argumentsObject.fact_type,
        text: argumentsObject.fact_text,
        replacesFactId: argumentsObject.replaces_profile_fact_id,
      }, context);
      return factResult(schemaSemantics, context, {
        created: result.created,
        replaced: result.replaced,
        unchanged: result.unchanged,
        previous_fact: databaseFact(result.previousFact),
        fact: databaseFact(result.fact),
      }, "profile_fact_set", "Return the durable profile fact created or replaced using stored database fields.");
    },
  });

  registry.register({
    name: "profile_fact_delete",
    description: "Archive one durable profile-fact row by its exact stable ID so other active rows, including rows of the same type, remain unchanged.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { profile_fact_id: { type: "integer", minimum: 1 } },
      required: ["profile_fact_id"],
    },
    async execute(argumentsObject, context) {
      const result = profileFacts.archive({ factId: argumentsObject.profile_fact_id }, context);
      return factResult(schemaSemantics, context, {
        archived: result.archived,
        already_archived: result.alreadyArchived,
        fact: databaseFact(result.fact),
      }, "profile_fact_delete", "Return the archived durable profile fact using stored database fields.");
    },
  });
}
