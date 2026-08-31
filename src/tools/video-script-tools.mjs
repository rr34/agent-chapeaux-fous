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

function parameters() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      sourceRequestIds: {
        type: "array", minItems: 1, maxItems: 8, uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 64 },
        description: "Every selected source request ID, exactly once and in the supplied chronological order.",
      },
      title: {
        type: "string", minLength: 1, maxLength: 200,
        description: "A concise title for the selected user-and-AI conversation.",
      },
      description: {
        type: "string", minLength: 1, maxLength: 3000,
        description: "One or two sentences describing what the selected conversation is about. Do not describe reasoning, processing, tool activity, trace activity, or a scene plan.",
      },
    },
    required: ["sourceRequestIds", "title", "description"],
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
    description: "Persist a concise portable AI-video script from every explicitly selected interaction without rendering it. Supply only a title and short conversation description; the application inserts every exact request and final Agent response as one continuous conversation and omits intermediate activity. Use this only when the user wants the script alone; use video_production_create when they also want a finished MP4.",
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
    description: "Persist one concise script and atomically queue its 1080x1620 Remotion MP4 from every explicitly selected interaction. Supply only a title and short conversation description; the application makes both the script and video one continuous chat containing each exact request and final Agent response, with no trace, activity, tutorial narration, intro, or outro. This proves the script and render job exist, not that rendering has finished.",
    parameters: parameters(),
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
    title: "Exact conversations selected for an AI-interaction video",
    description: "Only the exact user requests and final AI-agent responses explicitly selected in the current video request, ordered chronologically. It contains no intermediate processing or tool activity. Request this view before creating either the script or the combined script-and-MP4 production.",
    maximumItems: 8,
    execute(context) {
      return videoScripts.selectedInteractionContext(context.requestId);
    },
  });
}
