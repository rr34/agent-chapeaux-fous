const optionalText = (maximum) => ({ type: ["string", "null"], minLength: 1, maxLength: maximum });

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    created: { type: "boolean" },
    unchanged: { type: "boolean" },
    renderQueued: { type: "boolean" },
    videoScript: {
      type: "object", additionalProperties: false,
      properties: {
        id: { type: "integer" }, title: { type: "string" }, status: { type: "string" },
        sourceRequestIds: { type: "array", items: { type: "string" } }, version: { type: "integer" },
      },
      required: ["id", "title", "status", "sourceRequestIds", "version"],
    },
    render: {
      type: ["object", "null"],
      properties: {
        id: { type: "integer" }, status: { type: "string" }, outputFileId: { type: ["integer", "null"] },
        downloadUrl: { type: ["string", "null"] }, error: { type: ["string", "null"] },
      },
    },
  },
  required: ["created", "unchanged", "renderQueued", "videoScript", "render"],
};

function parameters({ production = false } = {}) {
  const sceneProperties = {
    sceneNumber: { type: "integer", minimum: 1, maximum: 40 },
    durationSeconds: { type: "integer", minimum: 1, maximum: 120 },
    sourceRequestIds: {
      type: "array", minItems: 1, maxItems: 8, uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 64 },
    },
    renderSceneType: production
      ? {
          type: "string", enum: ["intro", "request", "activity", "response", "outro"],
          description: "Built-in Agent-interface scene. Request and response scenes must each reference exactly one interaction; every selected interaction must appear in at least one of them.",
        }
      : { type: ["string", "null"], enum: ["intro", "request", "activity", "response", "outro", null] },
    visualPrompt: { type: "string", minLength: 1, maxLength: 5000 },
    voiceover: production ? { type: "string", minLength: 1, maxLength: 3000 } : optionalText(3000),
    onScreenText: {
      type: "array", maxItems: 10,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    cameraMotion: optionalText(1000),
    audioNotes: optionalText(1000),
    transition: optionalText(1000),
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      sourceRequestIds: {
        type: "array", minItems: 1, maxItems: 8, uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 64 },
        description: "Every selected source request ID, exactly once and in the supplied chronological order.",
      },
      title: { type: "string", minLength: 1, maxLength: 200 },
      concept: { type: "string", minLength: 1, maxLength: 3000 },
      audience: { type: "string", minLength: 1, maxLength: 1000 },
      durationSeconds: {
        type: "integer", minimum: 5, maximum: 600,
        description: "Total target duration in seconds; must equal the sum of every scene duration.",
      },
      aspectRatio: { type: "string", enum: ["9:16", "16:9", "1:1", "4:5"] },
      visualStyle: { type: "string", minLength: 1, maxLength: 3000 },
      generatorPrompt: {
        type: "string", minLength: 1, maxLength: 20000,
        description: "One consolidated, copy-ready prompt for a general AI video generator.",
      },
      scenes: {
        type: "array", minItems: 1, maxItems: 40,
        items: {
          type: "object", additionalProperties: false,
          properties: sceneProperties,
          required: [
            "sceneNumber", "durationSeconds", "sourceRequestIds", "renderSceneType",
            "visualPrompt", "voiceover", "onScreenText", "cameraMotion", "audioNotes", "transition",
          ],
        },
      },
      continuityNotes: {
        type: "array", maxItems: 30,
        items: { type: "string", minLength: 1, maxLength: 2000 },
      },
      negativeConstraints: {
        type: "array", minItems: 1, maxItems: 30,
        items: { type: "string", minLength: 1, maxLength: 2000 },
        description: "Explicit instructions preventing fabrication, privacy leakage, visual inconsistency, and unwanted generator behavior.",
      },
    },
    required: [
      "sourceRequestIds", "title", "concept", "audience", "durationSeconds", "aspectRatio",
      "visualStyle", "generatorPrompt", "scenes", "continuityNotes", "negativeConstraints",
    ],
  };
}

function compactResult(result) {
  return {
    created: result.created,
    unchanged: result.unchanged,
    renderQueued: result.renderQueued,
    videoScript: {
      id: result.script.id,
      title: result.script.title,
      status: result.script.status,
      sourceRequestIds: result.script.sources.map(({ requestId }) => requestId),
      version: result.script.version,
    },
    render: result.render,
  };
}

export function registerVideoScriptTools(registry, videoScripts, { onRenderQueued = () => {} } = {}) {
  const capabilityRegistry = registry.withCapability?.("video") ?? registry;
  capabilityRegistry.register({
    name: "video_script_create",
    title: "Create an AI-video script",
    description: "Persist a portable script from every explicitly selected interaction without rendering it. Use this only when the user wants the script alone; use video_production_create when they also want a finished MP4.",
    parameters: parameters(),
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    execute(args, context) {
      return compactResult(videoScripts.create(args, { ...context, actorName: "video_script_create" }));
    },
  });

  capabilityRegistry.register({
    name: "video_production_create",
    title: "Create a script and queue its MP4",
    description: "Persist one grounded script from every explicitly selected interaction and atomically queue a background Remotion MP4 that follows its built-in scene types and server narration. This proves the script and render job exist, not that rendering has finished.",
    parameters: parameters({ production: true }),
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    execute(args, context) {
      const result = videoScripts.create(args, { ...context, actorName: "video_production_create" }, { queueRender: true });
      if (result.renderQueued) onRenderQueued();
      return compactResult(result);
    },
  });

  registry.registerContextView("video", {
    id: "video.selected_interactions",
    title: "Selected interactions for an AI-video production",
    description: "The exact completed interactions explicitly selected in the current video request, bounded and ordered chronologically. Request this view before creating either the script or the combined script-and-MP4 production.",
    maximumItems: 8,
    execute(context) {
      return videoScripts.selectedInteractionContext(context.requestId);
    },
  });
}
