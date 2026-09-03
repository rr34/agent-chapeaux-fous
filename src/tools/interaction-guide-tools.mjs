import { withSchemaProjection } from "./schema-result.mjs";

const interactionGuideFields = [
  "interaction_guide_id", "name", "status", "version",
  "created_at_utc", "updated_at_utc",
];

const interactionGuideStepFields = [
  "interaction_guide_step_id", "interaction_guide_id", "step_number",
  "opening_text", "instructions_text", "answers_json", "progress_state",
  "completion_mode", "enabled", "created_at_utc", "updated_at_utc",
];

function databaseStep(step) {
  if (!step) return null;
  return {
    interaction_guide_step_id: step.id,
    interaction_guide_id: step.guideId,
    step_number: step.stepNumber,
    opening_text: step.openingText,
    instructions_text: step.instructionsText,
    answers_json: step.answers,
    progress_state: step.progressState,
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
        started_at_utc: guide.activeRun.startedAtUtc,
        started_local_date: guide.activeRun.startedLocalDate,
        current_local_date: guide.activeRun.currentLocalDate,
        time_zone: guide.activeRun.timeZone,
        requires_daily_choice: guide.activeRun.requiresDailyChoice,
      },
    } : {}),
  };
}

function databaseRun(run) {
  return {
    run_id: run.id,
    interaction_guide_id: run.interactionGuideId,
    guide_version: run.guideVersion,
    status: run.status,
    current_step_number: run.currentStepNumber,
    started_at_utc: run.startedAtUtc,
    started_local_date: run.startedLocalDate,
    current_local_date: run.currentLocalDate,
    time_zone: run.timeZone,
    requires_daily_choice: run.requiresDailyChoice,
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

function boundedContextField(value, maximumCharacters) {
  if (value == null) return { text: null, truncated: false };
  const text = String(value);
  return text.length <= maximumCharacters
    ? { text, truncated: false }
    : { text: text.slice(0, maximumCharacters), truncated: true };
}

export function activeBriefingRunContext(interactionGuides, limit = 8) {
  const snapshot = interactionGuides.activeRuns({ limit });
  const runs = snapshot.runs.map(({ guide, run, currentStep }) => {
    const opening = boundedContextField(currentStep.openingText, 10_000);
    const instructions = boundedContextField(currentStep.instructionsText, 12_000);
    const answers = boundedContextField(JSON.stringify(currentStep.answers), 4_000);
    return {
      interactionGuideId: guide.id,
      briefingName: guide.name,
      guideVersion: guide.version,
      runId: run.id,
      startedLocalDate: run.startedLocalDate,
      currentLocalDate: run.currentLocalDate,
      timeZone: run.timeZone,
      requiresDailyChoice: run.requiresDailyChoice,
      currentExchange: {
        interactionGuideStepId: currentStep.id,
        stepNumber: currentStep.stepNumber,
        openingText: opening.text,
        instructionsText: instructions.text,
        answersJson: answers.text,
        progressState: currentStep.progressState,
        completionMode: currentStep.completionMode,
        truncatedFields: [
          ...(opening.truncated ? ["openingText"] : []),
          ...(instructions.truncated ? ["instructionsText"] : []),
          ...(answers.truncated ? ["answersJson"] : []),
        ],
      },
    };
  });
  return {
    heading: "Active briefing runs",
    text: runs.length ? [
      "Use an active run below only when the current request unambiguously answers its exact current opening. If requires_daily_choice is true, do not process an answer or run other exchange tools until the user explicitly chooses to resume or start over. Preserve terse supplied values literally and do not infer omitted units. If a required field is marked truncated, fetch that exact briefing before acting.",
      ...runs.flatMap((entry) => [
        `- Briefing: ${entry.briefingName} [interaction_guide_id=${entry.interactionGuideId}; run_id=${entry.runId}; guide_version=${entry.guideVersion}; started_local_date=${entry.startedLocalDate}; current_local_date=${entry.currentLocalDate}; time_zone=${entry.timeZone}; requires_daily_choice=${entry.requiresDailyChoice}]`,
        `  Current exchange ${entry.currentExchange.stepNumber} [interaction_guide_step_id=${entry.currentExchange.interactionGuideStepId}; completion_mode=${entry.currentExchange.completionMode}; progress_state=${entry.currentExchange.progressState}]`,
        `  Opening: ${entry.currentExchange.openingText}`,
        `  Instructions: ${entry.currentExchange.instructionsText ?? "None"}`,
        `  Existing answers: ${entry.currentExchange.answersJson}`,
        ...(entry.currentExchange.truncatedFields.length
          ? [`  Truncated fields: ${entry.currentExchange.truncatedFields.join(", ")}`]
          : []),
      ]),
      ...(snapshot.omittedCount ? [`[${snapshot.omittedCount} additional active briefing run(s) omitted]`] : []),
    ].join("\n") : "No active briefing runs exist.",
    data: {
      runs,
      totalCount: snapshot.totalCount,
      omittedCount: snapshot.omittedCount,
    },
  };
}

export function registerInteractionGuideTools(registry, interactionGuides, schemaSemantics = null) {
  const rootRegistry = registry;
  registry = registry.withCapability?.("interaction-guides") ?? registry;
  rootRegistry.registerContextView?.("interaction-guides", {
    id: "interaction-guides.active_runs",
    title: "Active briefing runs",
    description: "Bounded active briefing run identities and each exact current exchange opening, instructions, answers, progress, and completion mode.",
    maximumItems: 8,
    execute: () => activeBriefingRunContext(interactionGuides),
  });
  registry.register({
    name: "interaction_guide_list",
    description: "List briefing metadata without loading its numbered exchanges. Use this to discover the exact internal guide ID and briefing name before fetching, editing, scheduling, or starting one.",
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
      }, "interaction_guide_list", "List briefing metadata without loading numbered exchanges", [
        "interaction_guide_id", "name", "status", "version", "created_at_utc", "updated_at_utc",
      ]);
    },
  });

  registry.register({
    name: "interaction_guide_get",
    description: "Fetch one exact briefing, including all numbered exchanges, current answers, and progress states. Call this only when the user asks to use, inspect, or change that briefing. Supply exactly one internal guide ID or name.",
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
      if (!guide) throw new Error("Briefing not found");
      return guideResult(schemaSemantics, context, { guide: databaseGuide(guide) },
        "interaction_guide_get", "Return one complete briefing and all numbered exchanges",
        interactionGuideFields, true);
    },
  });

  registry.register({
    name: "interaction_guide_step_add",
    description: "Add one numbered exchange to a briefing. For an explicitly selected briefing, supply its ID, current version, and requested number. When no briefing is specified, set interaction_guide_id, expected_version, and step_number to null; the owning service atomically uses or creates the generic Exchange Inbox and appends the exchange at its next number. The parent version increments and answers_json starts as an empty object.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
        expected_version: { type: ["integer", "null"], minimum: 1 },
        step_number: { type: ["integer", "null"], minimum: 1 },
        opening_text: { type: "string", minLength: 1, maxLength: 10_000 },
        instructions_text: { type: ["string", "null"], minLength: 1, maxLength: 50_000 },
        completion_mode: {
          type: "string", enum: ["response_valid", "user_advances", "tool_receipt"],
        },
        enabled: { type: "boolean" },
      },
      required: [
        "interaction_guide_id", "expected_version", "step_number",
        "opening_text", "instructions_text", "completion_mode", "enabled",
      ],
    },
    async execute(argumentsObject, context) {
      const result = interactionGuides.addStep({
        guideId: argumentsObject.interaction_guide_id,
        expectedVersion: argumentsObject.expected_version,
        stepNumber: argumentsObject.step_number,
        openingText: argumentsObject.opening_text,
        instructionsText: argumentsObject.instructions_text,
        completionMode: argumentsObject.completion_mode,
        enabled: argumentsObject.enabled,
      }, context);
      return stepResult(schemaSemantics, context, {
        created: result.created,
        default_briefing: result.defaultGuide,
        default_briefing_created: result.defaultGuideCreated,
        guide: databaseGuide(result.guide),
        step: databaseStep(result.step),
      }, "interaction_guide_step_add", "Return the newly added numbered exchange and new parent version");
    },
  });

  registry.register({
    name: "interaction_guide_step_update",
    description: "Replace the complete definition of one numbered exchange after fetching its briefing. Supply the parent internal guide's current version; successful changes increment only that version. This does not change answers_json.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        interaction_guide_step_id: { type: "integer", minimum: 1 },
        expected_version: { type: "integer", minimum: 1 },
        step_number: { type: "integer", minimum: 1 },
        opening_text: { type: "string", minLength: 1, maxLength: 10_000 },
        instructions_text: { type: ["string", "null"], minLength: 1, maxLength: 50_000 },
        completion_mode: {
          type: "string", enum: ["response_valid", "user_advances", "tool_receipt"],
        },
        enabled: { type: "boolean" },
      },
      required: [
        "interaction_guide_step_id", "expected_version", "step_number",
        "opening_text", "instructions_text", "completion_mode", "enabled",
      ],
    },
    async execute(argumentsObject, context) {
      const result = interactionGuides.updateStep({
        stepId: argumentsObject.interaction_guide_step_id,
        expectedVersion: argumentsObject.expected_version,
        stepNumber: argumentsObject.step_number,
        openingText: argumentsObject.opening_text,
        instructionsText: argumentsObject.instructions_text,
        completionMode: argumentsObject.completion_mode,
        enabled: argumentsObject.enabled,
      }, context);
      return stepResult(schemaSemantics, context, {
        updated: result.updated, guide: databaseGuide(result.guide), step: databaseStep(result.step),
      }, "interaction_guide_step_update", "Return the replaced numbered exchange and new parent version");
    },
  });

  registry.register({
    name: "interaction_guide_step_move",
    description: "Move one exchange from its current briefing into one different active briefing. Read both briefings first and supply both current versions. The exchange is appended after the destination's existing exchanges; current answers and progress reset while ledger history remains.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        interaction_guide_step_id: { type: "integer", minimum: 1 },
        expected_source_version: { type: "integer", minimum: 1 },
        target_interaction_guide_id: { type: "integer", minimum: 1 },
        expected_target_version: { type: "integer", minimum: 1 },
      },
      required: [
        "interaction_guide_step_id", "expected_source_version",
        "target_interaction_guide_id", "expected_target_version",
      ],
    },
    async execute(argumentsObject, context) {
      const result = interactionGuides.moveStep({
        stepId: argumentsObject.interaction_guide_step_id,
        expectedSourceVersion: argumentsObject.expected_source_version,
        targetGuideId: argumentsObject.target_interaction_guide_id,
        expectedTargetVersion: argumentsObject.expected_target_version,
      }, context);
      return stepResult(schemaSemantics, context, {
        moved: result.moved,
        source_guide: databaseGuide(result.sourceGuide),
        target_guide: databaseGuide(result.targetGuide),
        step: databaseStep(result.step),
      }, "interaction_guide_step_move", "Return the moved exchange and both newly versioned briefings");
    },
  });

  registry.register({
    name: "interaction_guide_start",
    description: "Start or resume one exact briefing. For an ordinary request, set stale_run_action to ask: an unfinished run from the current local day resumes, while an earlier-day run returns choice_required without advancing. Set stale_run_action to resume only after the user explicitly chooses to keep the earlier run. Set restart true only when the user explicitly asks to discard the unfinished run and start over. Completed runs remain in the ledger while their reusable exchange state is reset.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
        name: { type: ["string", "null"], minLength: 1, maxLength: 200 },
        restart: { type: "boolean" },
        stale_run_action: { type: "string", enum: ["ask", "resume"] },
      },
      required: ["interaction_guide_id", "name", "restart", "stale_run_action"],
    },
    async execute({ interaction_guide_id: guideId, name, restart, stale_run_action: staleRunAction }, context) {
      const result = interactionGuides.begin({ guideId, name, restart, staleRunAction }, context);
      return stepResult(schemaSemantics, context, {
        started: result.started,
        resumed: result.resumed,
        choice_required: result.choiceRequired,
        available_choices: result.choiceRequired ? ["resume", "start_over"] : [],
        run: databaseRun(result.run),
        guide: databaseGuide(result.guide),
        current_step: databaseStep(result.currentStep),
      }, "interaction_guide_start", "Return either the required earlier-run choice or the durable run identity and exact current numbered exchange");
    },
  });

  registry.register({
    name: "interaction_guide_step_answer",
    description: "Merge the user's answers into answers_json for the active numbered exchange. Keep step_complete false while required answers remain. Completion advances to the next enabled exchange and returns its fixed opening. Modes enforce answers, user advancement, or a same-request tool receipt.",
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
        run: databaseRun(result.run),
        step: databaseStep(result.step),
        current_step: databaseStep(result.currentStep),
      }, "interaction_guide_step_answer", "Return saved answers and the exact current or next numbered exchange");
    },
  });

  registry.register({
    name: "interaction_guide_run_cancel",
    description: "Cancel one exact active briefing, reset its current exchange progress and answers, and retain its prior state in ledger history. Use only when the user explicitly abandons it or needs to edit the briefing before starting again.",
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
      }, "interaction_guide_run_cancel", "Return the terminal status of the exact cancelled briefing");
    },
  });

  registry.register({
    name: "interaction_guide_create",
    description: "Create one named durable, user-owned briefing. Add its user-visible openings and agent instructions as numbered exchanges before starting it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["name"],
    },
    async execute({ name }, context) {
      const result = interactionGuides.create({ name }, context);
      return guideResult(schemaSemantics, context, {
        created: result.created,
        guide: databaseGuide(result.guide),
      }, "interaction_guide_create", "Return the newly created briefing");
    },
  });

  registry.register({
    name: "interaction_guide_update",
    description: "Rename one exact briefing after reading it. Supply its current internal guide version for conflict protection. Its conversation content remains owned by its numbered exchanges.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        interaction_guide_id: { type: "integer", minimum: 1 },
        expected_version: { type: "integer", minimum: 1 },
        name: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["interaction_guide_id", "expected_version", "name"],
    },
    async execute({ interaction_guide_id: guideId, expected_version: expectedVersion, name }, context) {
      const result = interactionGuides.update({ guideId, expectedVersion, name }, context);
      return guideResult(schemaSemantics, context, {
        updated: result.updated,
        unchanged: result.unchanged,
        guide: databaseGuide(result.guide),
      }, "interaction_guide_update", "Return the versioned briefing after applying explicit changes");
    },
  });

  registry.register({
    name: "interaction_guide_archive",
    description: "Archive one exact briefing after reading it. Supply its current internal guide version. Archival is rejected while an enabled repeating to-do links to the briefing.",
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
      }, "interaction_guide_archive", "Return the archived briefing");
    },
  });
}
