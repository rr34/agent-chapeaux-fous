export function registerVideoTools(registry, videoService) {
  registry = registry.withCapability?.("video") ?? registry;
  registry.register({
    name: "video_render_interaction",
    description: "Render and store one downloadable 1080x1920 MP4 from the source interaction bound to this request. Use the saved authentic audio and exact activity trace; supply the editorial hook, normalized captions, one contiguous audio range, and response highlights.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string", minLength: 1, maxLength: 100, description: "Short accurate hook shown at the beginning." },
        normalizedTranscript: { type: "string", minLength: 1, maxLength: 8000, description: "Cleaned caption transcript preserving the user's meaning and voice." },
        audioStartMs: { type: "integer", minimum: 0, description: "Absolute start in milliseconds in the source recording." },
        audioEndMs: { type: "integer", minimum: 1, description: "Absolute end in milliseconds in the source recording; no more than 30 seconds after audioStartMs." },
        captionCues: {
          type: "array", minItems: 1, maxItems: 80,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              startMs: { type: "integer", minimum: 0 },
              endMs: { type: "integer", minimum: 1 },
              text: { type: "string", minLength: 1, maxLength: 180 },
            },
            required: ["startMs", "endMs", "text"],
          },
        },
        responseHighlights: {
          type: "array", minItems: 1, maxItems: 6,
          items: { type: "string", minLength: 1, maxLength: 240 },
          description: "Concise, accurate lines summarizing the actual response or error.",
        },
      },
      required: ["title", "normalizedTranscript", "audioStartMs", "audioEndMs", "captionCues", "responseHighlights"],
    },
    execute(args, context) {
      return videoService.renderInteraction(args, context);
    },
  });
}
