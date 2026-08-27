const optionalText = (maximum) => ({ type: ["string", "null"], minLength: 1, maxLength: maximum });

export function registerVideoScriptTools(registry, videoScripts) {
  const capabilityRegistry = registry.withCapability?.("video") ?? registry;
  capabilityRegistry.register({
    name: "video_script_create",
    title: "Create an AI-video script",
    description: "Create and persist one portable AI-video-generator script from every interaction explicitly selected for this request. The selected interaction context is authoritative. Use chronological source IDs exactly as supplied, ground every scene in one or more selected interactions, omit secrets and unrelated private details, and never claim an event or outcome absent from the sources.",
    parameters: {
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
            properties: {
              sceneNumber: { type: "integer", minimum: 1, maximum: 40 },
              durationSeconds: { type: "integer", minimum: 1, maximum: 120 },
              sourceRequestIds: {
                type: "array", minItems: 1, maxItems: 8, uniqueItems: true,
                items: { type: "string", minLength: 1, maxLength: 64 },
              },
              visualPrompt: { type: "string", minLength: 1, maxLength: 5000 },
              voiceover: optionalText(3000),
              onScreenText: {
                type: "array", maxItems: 10,
                items: { type: "string", minLength: 1, maxLength: 500 },
              },
              cameraMotion: optionalText(1000),
              audioNotes: optionalText(1000),
              transition: optionalText(1000),
            },
            required: [
              "sceneNumber", "durationSeconds", "sourceRequestIds", "visualPrompt", "voiceover",
              "onScreenText", "cameraMotion", "audioNotes", "transition",
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
    },
    execute(args, context) {
      const result = videoScripts.create(args, context);
      return {
        created: result.created,
        unchanged: result.unchanged,
        videoScript: {
          id: result.script.id,
          title: result.script.title,
          status: result.script.status,
          sourceRequestIds: result.script.sources.map(({ requestId }) => requestId),
          version: result.script.version,
        },
      };
    },
  });

  registry.registerContextView("video", {
    id: "video.selected_interactions",
    title: "Selected interactions for an AI-video script",
    description: "The exact completed interactions explicitly selected in the current video-script request, bounded and ordered chronologically. Request this view whenever creating the selected script.",
    maximumItems: 8,
    execute(context) {
      return videoScripts.selectedInteractionContext(context.requestId);
    },
  });
}
