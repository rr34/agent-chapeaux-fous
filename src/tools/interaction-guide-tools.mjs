import { withSchemaProjection } from "./schema-result.mjs";

const interactionGuideFields = [
  "interaction_guide_id", "name", "guide_text", "status", "version",
  "created_at_utc", "updated_at_utc",
];

const interactionGuideStepFields = [
  "interaction_guide_step_id", "interaction_guide_id", "step_number", "name",
  "opening_text", "objective_text", "instructions_text", "answers_json",
  "completion_mode", "enabled", "created_at_utc", "updated_at_utc",
];

function databaseStep(step) {
  if (!step) return null;
  return {
    interaction_guide_step_id: step.id,
    interaction_guide_id: step.guideId,
    step_number: step.stepNumber,
    name: step.name,
    opening_text: step.openingText,
    objective_text: step.objectiveText,
    instructions_text: step.instructionsText,
    answers_json: step.answers,
    completion_mode: step.completionMode,
    enabled: step.enabled,
    created_at_utc: step.createdAtUtc,
    updated_at_utc: step.updatedAtUtc,
  };
}

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
    ...(Array.isArray(guide.steps) ? { steps: guide.steps.map(databaseStep) } : {}),
    ...(guide.activeRun ? {
      active_run: {
        run_id: guide.activeRun.id,
        guide_version: guide.activeRun.guideVersion,
        status: guide.activeRun.status,
        current_step_number: guide.activeRun.currentStepNumber,
      },
    } : {}),
  };
}

function guideResult(
  schemaSemantics, context, result, name, purpose,
  fields = interactionGuideFields, includeSteps = false,
) {
  return withSchemaProjection(schemaSemantics, context, result, {
    name,
    purpose,
    schemaObjects: includeSteps ? ["interaction_guides", "interaction_guide_steps"] : ["interaction_guides"],
    fields: {
      interaction_guides: fields,
      ...(includeSteps ? { interaction_guide_steps: interactionGuideStepFields } : {}),
    },
  });
}

function stepResult(schemaSemantics, context, result, name, purpose) {
  return withSchemaProjection(schemaSemantics, context, result, {
    name,
    purpose,
    schemaObjects: ["interaction_guides", "interaction_guide_steps"],
    fields: {
      interaction_guides: interactionGuideFields,
      interaction_guide_steps: interactionGuideStepFields,
    },
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
        "interaction_guide_get", "Return one complete interaction guide and all numbered steps",
        interactionGuideFields, true);
    },
  });

  registry.register({
    name: "interaction_guide_step_add",
    description: "Add one numbered scripted step to an interaction guide after reading its current version. The parent guide version is the concurrency boundary and increments on success. answers_json starts as an empty object.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        interaction_guide_id: { type: "integer", minimum: 1 },
        expected_version: { type: "integer", minimum: 1 },
        step_number: { type: "integer", minimum: 1 },
        name: { type: ["string", "null"], minLength: 1, maxLength: 200 },
        opening_text: { type: "string", minLength: 1, maxLength: 10_000 },
        objective_text: { type: "string", minLength: 1, maxLength: 10_000 },
        instructions_text: { type: ["string", "null"], minLength: 1, maxLength: 50_000 },
        completion_mode: {
          type: "string", enum: ["response_valid", "user_advances", "tool_receipt"],
        },
        enabled: { type: "boolean" },
      },
      required: [
        "interaction_guide_id", "expected_version", "step_number", "name",
        "opening_text", "objective_text", "instructions_text", "completion_mode", "enabled",
      ],
    },
    async execute(argumentsObject, context) {
      const result = interactionGuides.addStep({
        guideId: argumentsObject.interaction_guide_id,
        expectedVersion: argumentsObject.expected_version,
        stepNumber: argumentsObject.step_number,
        name: argumentsObject.name,
        openingText: argumentsObject.opening_text,
        objectiveText: argumentsObject.objective_text,
        instructionsText: argumentsObject.instructions_text,
        completionMode: argumentsObject.completion_mode,
        enabled: argumentsObject.enabled,
      }, context);
      return stepResult(schemaSemantics, context, {
        created: result.created, guide: databaseGuide(result.guide), step: databaseStep(result.step),
      }, "interaction_guide_step_add", "Return the newly added numbered interaction step and new parent version");
    },
  });

  registry.register({
    name: "interaction_guide_step_update",
    description: "Replace the complete definition of one numbered interaction step after fetching the guide. Supply the parent guide's current version; successful definition changes increment only that parent version. This does not change answers_json.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        interaction_guide_step_id: { type: "integer", minimum: 1 },
        expected_version: { type: "integer", minimum: 1 },
        step_number: { type: "integer", minimum: 1 },
        name: { type: ["string", "null"], minLength: 1, maxLength: 200 },
        opening_text: { type: "string", minLength: 1, maxLength: 10_000 },
        objective_text: { type: "string", minLength: 1, maxLength: 10_000 },
        instructions_text: { type: ["string", "null"], minLength: 1, maxLength: 50_000 },
        completion_mode: {
          type: "string", enum: ["response_valid", "user_advances", "tool_receipt"],
        },
        enabled: { type: "boolean" },
      },
      required: [
        "interaction_guide_step_id", "expected_version", "step_number", "name",
        "opening_text", "objective_text", "instructions_text", "completion_mode", "enabled",
      ],
    },
    async execute(argumentsObject, context) {
      const result = interactionGuides.updateStep({
        stepId: argumentsObject.interaction_guide_step_id,
        expectedVersion: argumentsObject.expected_version,
        stepNumber: argumentsObject.step_number,
        name: argumentsObject.name,
        openingText: argumentsObject.opening_text,
        objectiveText: argumentsObject.objective_text,
        instructionsText: argumentsObject.instructions_text,
        completionMode: argumentsObject.completion_mode,
        enabled: argumentsObject.enabled,
      }, context);
      return stepResult(schemaSemantics, context, {
        updated: result.updated, guide: databaseGuide(result.guide), step: databaseStep(result.step),
      }, "interaction_guide_step_update", "Return the replaced numbered interaction step and new parent version");
    },
  });

  registry.register({
    name: "interaction_guide_start",
    description: "Start or resume one exact structured interaction. An unfinished run resumes at its first uncompleted enabled step. Set restart true only when the user explicitly asks to discard that active run and begin again; a new run clears current answers_json after preserving prior progress in the ledger.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
        name: { type: ["string", "null"], minLength: 1, maxLength: 200 },
        restart: { type: "boolean" },
      },
      required: ["interaction_guide_id", "name", "restart"],
    },
    async execute({ interaction_guide_id: guideId, name, restart }, context) {
      const result = interactionGuides.begin({ guideId, name, restart }, context);
      return stepResult(schemaSemantics, context, {
        started: result.started,
        resumed: result.resumed,
        run: {
          run_id: result.run.id,
          interaction_guide_id: result.run.interactionGuideId,
          guide_version: result.run.guideVersion,
          status: result.run.status,
          current_step_number: result.run.currentStepNumber,
        },
        guide: databaseGuide(result.guide),
        current_step: databaseStep(result.currentStep),
      }, "interaction_guide_start", "Return the durable run identity and exact current numbered step");
    },
  });

  registry.register({
    name: "interaction_guide_step_answer",
    description: "Merge the user's answers into answers_json for the exact active numbered step. Keep step_complete false while required answers remain. Completion advances automatically to the next higher enabled step; the result supplies that next step's fixed opening text. Completion modes enforce recorded answers, explicit user advancement, or a successful same-request tool receipt.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: { type: "string", minLength: 8, maxLength: 100 },
        step_number: { type: "integer", minimum: 1 },
        answers: { type: "object" },
        step_complete: { type: "boolean" },
        user_confirmed_advance: { type: "boolean" },
        completion_receipt_event_seq: { type: ["integer", "null"], minimum: 1 },
      },
      required: [
        "run_id", "step_number", "answers", "step_complete",
        "user_confirmed_advance", "completion_receipt_event_seq",
      ],
    },
    async execute(argumentsObject, context) {
      const result = interactionGuides.answerStep({
        runId: argumentsObject.run_id,
        stepNumber: argumentsObject.step_number,
        answers: argumentsObject.answers,
        stepComplete: argumentsObject.step_complete,
        userConfirmedAdvance: argumentsObject.user_confirmed_advance,
        completionReceiptEventSeq: argumentsObject.completion_receipt_event_seq,
      }, context);
      return stepResult(schemaSemantics, context, {
        recorded: result.recorded,
        step_complete: result.stepComplete,
        run_complete: result.runCompleted,
        run: {
          run_id: result.run.id,
          interaction_guide_id: result.run.interactionGuideId,
          guide_version: result.run.guideVersion,
          status: result.run.status,
          current_step_number: result.run.currentStepNumber,
        },
        step: databaseStep(result.step),
        current_step: databaseStep(result.currentStep),
      }, "interaction_guide_step_answer", "Return saved answers and the exact current or next numbered step");
    },
  });

  registry.register({
    name: "interaction_guide_run_cancel",
    description: "Cancel one exact active structured-interaction run while retaining its current answers and complete ledger history. Use only when the user explicitly abandons that run or needs to edit the guide definition before starting again.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        run_id: { type: "string", minLength: 8, maxLength: 100 },
        reason: { type: "string", minLength: 1, maxLength: 1_000 },
      },
      required: ["run_id", "reason"],
    },
    async execute({ run_id: runId, reason }, context) {
      const result = interactionGuides.cancelRun({ runId, reason }, context);
      return stepResult(schemaSemantics, context, {
        cancelled: result.cancelled,
        run: {
          run_id: result.run.id,
          interaction_guide_id: result.run.interactionGuideId,
          guide_version: result.run.guideVersion,
          status: result.run.status,
          current_step_number: result.run.currentStepNumber,
        },
      }, "interaction_guide_run_cancel", "Return the terminal status of the exact cancelled structured-interaction run");
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
