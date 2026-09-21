function stableRef(prefix, id) {
  return `${prefix}${encodeURIComponent(String(id))}`;
}

function identifiedVideoScript(script) {
  if (!script || script.id == null) return script;
  return {
    ...script,
    video_script_id: script.id,
    video_script_ref: stableRef("agent-slayer://video-scripts/", script.id),
    video_script_title: script.title,
  };
}

function identifiedContentGroup(group) {
  if (!group || group.id == null) return group;
  return {
    ...group,
    content_group_id: group.id,
    content_group_ref: stableRef("agent-slayer://content-groups/", group.id),
    content_group_name: group.name,
  };
}

function identifiedContentItem(item) {
  if (!item || item.id == null) return item;
  return {
    ...item,
    content_id: item.id,
    content_ref: stableRef("agent-slayer://content-items/", item.id),
    content_title: item.title,
  };
}

const videoScriptIdentityProperties = {
  video_script_id: { type: "integer" },
  video_script_ref: { type: "string" },
  video_script_title: { type: "string" },
};

const compactVideoScriptSchema = {
  type: "object", additionalProperties: false,
  properties: {
    id: { type: "integer" }, title: { type: "string" }, status: { type: "string" },
    sourceRequestIds: { type: "array", items: { type: "string" } }, version: { type: "integer" },
    ...videoScriptIdentityProperties,
  },
  required: [
    "id", "title", "status", "sourceRequestIds", "version",
    "video_script_id", "video_script_ref", "video_script_title",
  ],
};

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    created: { type: "boolean" },
    unchanged: { type: "boolean" },
    renderQueued: { type: "boolean" },
    videoScript: compactVideoScriptSchema,
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
        content_id: { type: "integer" }, content_ref: { type: "string" }, content_title: { type: "string" },
      },
      required: [
        "id", "groupId", "groupName", "sequence", "title", "primaryFileId",
        "content_id", "content_ref", "content_title",
      ],
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

const contentListItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "integer" },
    groupId: { type: "integer" },
    sequence: { type: "integer" },
    contentType: { type: "string" },
    title: { type: "string" },
    titleCharacters: { type: "integer" },
    titleTruncated: { type: "boolean" },
    descriptionExcerpt: { type: ["string", "null"] },
    descriptionCharacters: { type: "integer" },
    descriptionTruncated: { type: "boolean" },
    transcriptExcerpt: { type: ["string", "null"] },
    transcriptCharacters: { type: "integer" },
    transcriptTruncated: { type: "boolean" },
    publishedAtUtc: { type: "string" },
    contentHost: { type: "string" },
    contentStatus: { type: "string" },
    content_id: { type: "integer" },
    content_ref: { type: "string" },
    content_title: { type: "string" },
  },
  required: [
    "id", "groupId", "sequence", "contentType", "title", "titleCharacters", "titleTruncated",
    "descriptionExcerpt", "descriptionCharacters", "descriptionTruncated",
    "transcriptExcerpt", "transcriptCharacters", "transcriptTruncated",
    "publishedAtUtc", "contentHost", "contentStatus", "content_id", "content_ref", "content_title",
  ],
};

const contentListOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    group: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: ["integer", "string"] },
        name: { type: "string" },
        sortPosition: { type: ["integer", "string"] },
        archivedAtUtc: { type: ["string", "null"] },
        createdAtUtc: { type: "string" },
        updatedAtUtc: { type: ["string", "null"] },
        content_group_id: { type: ["integer", "string"] },
        content_group_ref: { type: "string" },
        content_group_name: { type: "string" },
      },
      required: [
        "id", "name", "sortPosition", "archivedAtUtc", "createdAtUtc", "updatedAtUtc",
        "content_group_id", "content_group_ref", "content_group_name",
      ],
    },
    textFields: {
      type: "array", minItems: 1, maxItems: 2, uniqueItems: true,
      items: { type: "string", enum: ["description", "transcript"] },
    },
    items: { type: "array", items: contentListItemSchema },
    count: { type: "integer" },
    hasMore: { type: "boolean" },
    nextAfterSequence: { type: ["integer", "null"] },
  },
  required: ["group", "textFields", "items", "count", "hasMore", "nextAfterSequence"],
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
    videoScript: identifiedVideoScript({
      id: result.script.id,
      title: result.script.title,
      status: result.script.status,
      sourceRequestIds: result.script.sources.map(({ requestId }) => requestId),
      version: result.script.version,
    }),
    render: result.render,
  };
}

export function registerVideoScriptTools(
  registry, videoScripts, { videoContent = null, onRenderQueued = () => {} } = {},
) {
  const capabilityRegistry = registry.withCapability?.("video") ?? registry;
  capabilityRegistry.register({
    name: "video_script_get",
    title: "Read a generated-video script",
    description: "Read one exact durable generated-video script by stable ID. Returns compact identity, source-request IDs, lifecycle status, version, and latest render status without loading the complete script body.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: { videoScriptId: { type: "integer", minimum: 1 } },
      required: ["videoScriptId"],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async execute({ videoScriptId }) {
      const script = videoScripts.get(videoScriptId);
      if (!script) throw new Error(`Unknown video script ID: ${videoScriptId}`);
      return {
        videoScript: identifiedVideoScript({
          id: script.id,
          title: script.title,
          status: script.status,
          sourceRequestIds: script.sources.map(({ requestId }) => requestId),
          version: script.version,
        }),
        render: script.render,
      };
    },
  });

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

  if (videoContent) {
    capabilityRegistry.register({
      name: "video_content_list",
      title: "Read a content-library sequence",
      description: "Read one active content-library group's numbered items in ascending sequence order. Pass afterSequence 0 for the first page and nextAfterSequence for each continuation. Select description, transcript, or both in textFields; omitted textFields defaults to both. Each selected field is returned as a bounded excerpt with its exact source length and truncation flag. Unselected text is not read. Unnumbered items are excluded.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "integer", minimum: 1, description: "The exact active content-group ID." },
          afterSequence: {
            type: "integer", minimum: 0,
            description: "Return numbered items whose sequence is greater than this cursor. Omit or use 0 for the first page.",
          },
          limit: {
            type: "integer", minimum: 1, maximum: 20,
            description: "Maximum sequenced items to return in this page. Omit for 20.",
          },
          textCharactersPerField: {
            type: "integer", minimum: 250, maximum: 1500,
            description: "Maximum leading characters returned from each selected text field. Omit for 1500; exact source lengths and truncation flags are always returned.",
          },
          textFields: {
            type: "array", minItems: 1, maxItems: 2, uniqueItems: true,
            items: { type: "string", enum: ["description", "transcript"] },
            description: "Source-text fields to read. Select description, transcript, or both; omit to read both.",
          },
        },
        required: ["groupId"],
      },
      outputSchema: contentListOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute(args) {
        const result = videoContent.list(args);
        return {
          ...result,
          group: identifiedContentGroup(result.group),
          items: result.items.map(identifiedContentItem),
        };
      },
    });

    capabilityRegistry.register({
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
          content: identifiedContentItem({
            id: result.content.id,
            groupId: result.content.groupId,
            groupName: result.content.groupName,
            sequence: result.content.sequence,
            title: result.content.title,
            primaryFileId: result.content.primaryFileId,
          }),
          video: {
            scriptId: result.script.id,
            jobId: result.script.render.id,
            fileId: result.script.render.outputFileId,
          },
        };
      },
    });
  }

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
        data: { groups: groups.map(identifiedContentGroup) },
        text: [
          "Active content-library groups:",
          ...groups.map((group) => `- ${group.name} [content_group_id=${group.id}]`),
        ].join("\n"),
      };
    },
  });
}
