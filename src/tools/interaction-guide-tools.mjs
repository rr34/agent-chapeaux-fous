import { withSchemaProjection } from "./schema-result.mjs";

const interactionGuideFields = [
  "interaction_guide_id", "name", "guide_text", "status", "version",
  "created_at_utc", "updated_at_utc",
];

function databaseGuide(guide) {
  if (!guide) return null;
  return {
    interaction_guide_id: guide.id,
    name: guide.name,
    ...(Object.hasOwn(guide, "guideText") ? { guide_text: guide.guideText } : {}),
    status: guide.status,
    version: guide.version,
    created_at_utc: guide.createdAtUtc,
    updated_at_utc: guide.updatedAtUtc,
  };
}

function guideResult(schemaSemantics, context, result, name, purpose, fields = interactionGuideFields) {
  return withSchemaProjection(schemaSemantics, context, result, {
    name,
    purpose,
    schemaObjects: ["interaction_guides"],
    fields: { interaction_guides: fields },
  });
}

export function registerInteractionGuideTools(registry, interactionGuides, schemaSemantics = null) {
  registry = registry.withCapability?.("interaction-guides") ?? registry;
  registry.register({
    name: "interaction_guide_list",
    description: "List interaction-guide metadata without loading any guide text. Use this to discover the exact guide ID and name before fetching, editing, scheduling, or starting one.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: "string", enum: ["active", "archived", "all"] },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      required: ["status", "limit"],
    },
    async execute({ status, limit }, context) {
      const result = interactionGuides.list({ status, limit });
      return guideResult(schemaSemantics, context, {
        ...result,
        guides: result.guides.map(databaseGuide),
      }, "interaction_guide_list", "List interaction-guide metadata without loading guide text", [
        "interaction_guide_id", "name", "status", "version", "created_at_utc", "updated_at_utc",
      ]);
    },
  });

  registry.register({
    name: "interaction_guide_get",
    description: "Fetch one exact interaction guide, including its complete guide text. Call this only when the user asks to use, inspect, or change that guide. Supply exactly one ID or name.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
        name: { type: ["string", "null"], minLength: 1, maxLength: 200 },
      },
      required: ["interaction_guide_id", "name"],
    },
    async execute({ interaction_guide_id: guideId, name }, context) {
      const guide = interactionGuides.get({ guideId, name });
      if (!guide) throw new Error("Interaction guide not found");
      return guideResult(schemaSemantics, context, { guide: databaseGuide(guide) },
        "interaction_guide_get", "Return the complete text and metadata of one explicitly selected interaction guide");
    },
  });

  registry.register({
    name: "interaction_guide_create",
    description: "Create one durable, user-owned interaction guide. guide_text is the complete flexible plan for a possibly multi-turn interaction and may use Markdown-style headings and lists.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
        guide_text: { type: "string", minLength: 1, maxLength: 50_000 },
      },
      required: ["name", "guide_text"],
    },
    async execute({ name, guide_text: guideText }, context) {
      const result = interactionGuides.create({ name, guideText }, context);
      return guideResult(schemaSemantics, context, {
        created: result.created,
        guide: databaseGuide(result.guide),
      }, "interaction_guide_create", "Return the newly created interaction guide");
    },
  });

  registry.register({
    name: "interaction_guide_update",
    description: "Update one exact interaction guide after reading it. Supply its current version for conflict protection. A null name or guide_text preserves that field; at least one field must be non-null.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        interaction_guide_id: { type: "integer", minimum: 1 },
        expected_version: { type: "integer", minimum: 1 },
        name: { type: ["string", "null"], minLength: 1, maxLength: 200 },
        guide_text: { type: ["string", "null"], minLength: 1, maxLength: 50_000 },
      },
      required: ["interaction_guide_id", "expected_version", "name", "guide_text"],
    },
    async execute({ interaction_guide_id: guideId, expected_version: expectedVersion, name, guide_text: guideText }, context) {
      const result = interactionGuides.update({ guideId, expectedVersion, name, guideText }, context);
      return guideResult(schemaSemantics, context, {
        updated: result.updated,
        unchanged: result.unchanged,
        guide: databaseGuide(result.guide),
      }, "interaction_guide_update", "Return the versioned interaction guide after applying explicit changes");
    },
  });

  registry.register({
    name: "interaction_guide_archive",
    description: "Archive one exact interaction guide after reading it. Supply its current version. Archival is rejected while an enabled repeating to-do links to the guide.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        interaction_guide_id: { type: "integer", minimum: 1 },
        expected_version: { type: "integer", minimum: 1 },
      },
      required: ["interaction_guide_id", "expected_version"],
    },
    async execute({ interaction_guide_id: guideId, expected_version: expectedVersion }, context) {
      const result = interactionGuides.archive({ guideId, expectedVersion }, context);
      return guideResult(schemaSemantics, context, {
        archived: result.archived,
        already_archived: result.alreadyArchived,
        guide: databaseGuide(result.guide),
      }, "interaction_guide_archive", "Return the archived interaction guide");
    },
  });
}
