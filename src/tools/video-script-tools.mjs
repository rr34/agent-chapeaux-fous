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
        id: { type: "integer" }, status: { type: "string" },
        outputFileId: { type: ["integer", "null"] }, contentId: { type: ["integer", "null"] },
        downloadUrl: { type: ["string", "null"] }, error: { type: ["string", "null"] },
      },
    },
  },
  required: ["created", "unchanged", "renderQueued", "videoScript", "render"],
};

const contentOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    created: { type: "boolean" },
    unchanged: { type: "boolean" },
    content: {
      type: "object", additionalProperties: false,
      properties: {
        id: { type: "integer" }, groupId: { type: "integer" }, groupName: { type: "string" },
        sequence: { type: "integer" }, title: { type: "string" }, primaryFileId: { type: "integer" },
      },
      required: ["id", "groupId", "groupName", "sequence", "title", "primaryFileId"],
    },
    video: {
      type: "object", additionalProperties: false,
      properties: {
        scriptId: { type: "integer" }, jobId: { type: "integer" }, fileId: { type: "integer" },
      },
      required: ["scriptId", "jobId", "fileId"],
    },
  },
  required: ["created", "unchanged", "content", "video"],
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

export function registerVideoScriptTools(
  registry, videoScripts, { videoContent = null, onRenderQueued = () => {} } = {},
) {
  const capabilityRegistry = registry.withCapability?.("video") ?? registry;
  capabilityRegistry.register({
    name: "video_script_create",
    title: "Create an AI-video script",
    description: "Persist a concise portable AI-video script from every explicitly selected interaction without rendering it. Supply only a title and short conversation description; the application inserts the chronological request and final response after removing machine-only references and opaque identifiers, while leaving stored exchanges unchanged. Use this only for the script; use video_production_create for an MP4.",
    parameters: parameters(),
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    execute(args, context) {
      return compactResult(videoScripts.create(args, { ...context, actorName: "video_script_create" }));
    },
  });

  if (videoContent) capabilityRegistry.register({
    name: "video_content_add",
    title: "Add a completed video to a content sequence",
    description: "Add one referenced, completed Agent-interface MP4 to exactly one existing content-library group. The application uses the rendered file, appends the next sequence number atomically, stores the script as its transcript, links the video job to the content item, and returns the durable result. Exact replay is unchanged. Do not call this until the user has selected or named the destination group.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        videoScriptId: { type: "integer", minimum: 1, description: "The referenced generated video script ID." },
        groupId: { type: "integer", minimum: 1, description: "The exact active destination content-group ID." },
      },
      required: ["videoScriptId", "groupId"],
    },
    outputSchema: contentOutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    execute(args, context) {
      const result = videoContent.add(args, { ...context, actorName: "video_content_add" });
      return {
        created: result.created,
        unchanged: result.unchanged,
        content: {
          id: result.content.id,
          groupId: result.content.groupId,
          groupName: result.content.groupName,
          sequence: result.content.sequence,
          title: result.content.title,
          primaryFileId: result.content.primaryFileId,
        },
        video: {
          scriptId: result.script.id,
          jobId: result.script.render.id,
          fileId: result.script.render.outputFileId,
        },
      };
    },
  });

  capabilityRegistry.register({
    name: "video_production_create",
    title: "Create a script and queue its MP4",
    description: "Persist one concise script and atomically queue its 1080x1620 Remotion MP4 from every explicitly selected interaction. Supply only a title and short conversation description; the application makes one chronological chat after removing machine-only references and opaque identifiers, while leaving stored exchanges unchanged. This proves the script and render job exist, not that rendering finished.",
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
    title: "Conversations selected for an AI-interaction video",
    description: "The selected user requests and final AI-agent responses in chronological order, projected only for video by removing machine-only references and opaque identifiers. Stored exchanges remain unchanged, and no intermediate processing or tool activity is included. Request this before creating the script or combined production.",
    maximumItems: 8,
    execute(context) {
      return videoScripts.selectedInteractionContext(context.requestId);
    },
  });

  if (videoContent) registry.registerContextView("video", {
    id: "video.content_groups",
    title: "Active content-library groups",
    description: "The bounded active destination groups available when the user wants to add an already-completed generated video to a content sequence.",
    maximumItems: 200,
    execute() {
      const groups = videoContent.listGroups().slice(0, 200);
      return {
        data: { groups },
        text: [
          "Active content-library groups:",
          ...groups.map((group) => `- ${group.name} [content_group_id=${group.id}]`),
        ].join("\n"),
      };
    },
  });
}
