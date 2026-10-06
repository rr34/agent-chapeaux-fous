
const toolDescriptions = Object.freeze({
  "video_content_add": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Add one completed Agent-interface MP4 to one existing content-library group with the next sequence number.",
    "actionClasses": [
      "CREATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "video_content_group_create": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Create or reuse one named active content-library group before creating items in it.",
    "actionClasses": [
      "CREATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "video_content_create": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Create up to 50 ordinary content-library items in one exact group, preserving each explicit sequence value and metadata.",
    "actionClasses": [
      "CREATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "video_content_list": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Read one active content-library group's numbered items in ascending sequence order with bounded source-text excerpts and explicit pagination.",
    "actionClasses": [
      "READ"
    ],
    "effectClassifications": [
      "READ-ONLY"
    ]
  },
  "video_production_create": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Persist one source-grounded chat script and atomically queue its 1080x1620 Agent-interface MP4 render.",
    "actionClasses": [
      "CREATE",
      "EXECUTE"
    ],
    "effectClassifications": [
      "MUTATING",
      "EXTERNAL"
    ]
  },
  "video_script_create": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Persist one portable source-grounded chat script from explicitly selected completed interactions without rendering video.",
    "actionClasses": [
      "CREATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "video_script_get": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Read one exact durable generated-video script by stable ID, including its title, status, source requests, version, and latest render status.",
    "actionClasses": [
      "READ"
    ],
    "effectClassifications": [
      "READ-ONLY"
    ]
  }
});
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

const contentGroupSchema = {
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
};

const contentGroupCreateOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    created: { type: "boolean" },
    unchanged: { type: "boolean" },
    group: contentGroupSchema,
  },
  required: ["created", "unchanged", "group"],
};

const createdContentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "integer" },
    groupId: { type: "integer" },
    sequence: { type: ["integer", "null"] },
    contentType: { type: "string" },
    title: { type: "string" },
    publishedAtUtc: { type: "string" },
    contentHost: { type: "string" },
    contentStatus: { type: "string" },
    contentUrl: { type: ["string", "null"] },
    content_id: { type: "integer" },
    content_ref: { type: "string" },
    content_title: { type: "string" },
  },
  required: [
    "id", "groupId", "sequence", "contentType", "title", "publishedAtUtc",
    "contentHost", "contentStatus", "contentUrl",
    "content_id", "content_ref", "content_title",
  ],
};

const contentCreateOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    group: contentGroupSchema,
    createdCount: { type: "integer" },
    items: {
      type: "array",
      items: createdContentSchema,
    },
  },
  required: ["group", "createdCount", "items"],
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
      ...contentGroupSchema,
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

const nativeToolContracts = Object.freeze({
  video_script_get: { objectTypes: ["video.script"], allowUnboundInputs: true },
  video_content_list: {
    objectTypes: ["video.content_group", "video.content_item"],
    allowUnboundInputs: true,
  },
});

export function registerVideoScriptTools(
  registry, videoScripts, { videoContent = null, onRenderQueued = () => {} } = {},
) {
  const capabilityRegistry = registry.withCapability?.(
    "video", toolDescriptions, nativeToolContracts,
  ) ?? registry;
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
      name: "video_content_group_create",
      title: "Create a content-library group",
      description: "Create one named active content-library group, or return the unchanged active group when its exact name already exists. An archived group with that name is a conflict and is never silently restored. The returned group carries its stable native ID, reference, and display name so a later content mutation can consume the exact new binding.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: {
            type: "string", minLength: 1, maxLength: 200,
            description: "Complete human-facing name for the content-library group.",
          },
        },
        required: ["name"],
      },
      outputSchema: contentGroupCreateOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute(args) {
        const result = videoContent.createGroup(args);
        return { ...result, group: identifiedContentGroup(result.group) };
      },
    });

    capabilityRegistry.register({
      name: "video_content_create",
      title: "Create content-library items",
      description: "Atomically create a bounded batch of 1 through 50 ordinary items in one exact active content-library group. Each item carries its own title, optional text, publication time, type, host, status, optional HTTP(S) source URL, and explicit positive sequence or null. Null remains unnumbered and array order never generates sequence. Duplicate non-null sequences reject the complete call without partial writes. This is a general content mutation, not an external-source import or media transfer; it does not download, render, or publish media. A successful result proves new items were created, so do not replay the call.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "integer", minimum: 1, description: "The exact active destination content-group ID." },
          items: {
            type: "array", minItems: 1, maxItems: 50,
            description: "The complete intended content-item batch; array order does not determine sequence.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                sequence: {
                  type: ["integer", "null"], minimum: 1,
                  description: "Explicit positive sequence number for this item, or null to keep it unnumbered.",
                },
                title: { type: "string", minLength: 1, maxLength: 10_000 },
                description: { type: ["string", "null"], maxLength: 10_000 },
                transcript: { type: ["string", "null"], maxLength: 50_000 },
                publishedAtUtc: {
                  type: "string", minLength: 1, maxLength: 64,
                  description: "ISO-8601 publication date or instant. A date without a time is normalized to midnight UTC as a storage representation.",
                },
                contentHost: {
                  type: "string", enum: ["youtube", "vimeo", "spotify", "mytlomdotcom", "none"],
                  description: "Known content host; use none when no named host applies.",
                },
                contentType: {
                  type: "string",
                  enum: [
                    "mobileUGC_tutorial", "mobileUGC_ad", "webUGC_tutorial", "webUGC_ad",
                    "video_ad", "podcast", "image", "unknown",
                  ],
                },
                contentStatus: {
                  type: "string", enum: ["active", "obsolete", "unused", "queued"],
                },
                contentUrl: {
                  type: ["string", "null"], minLength: 1, maxLength: 2048,
                  description: "Optional HTTP(S) source or destination URL for this content item.",
                },
              },
              required: [
                "sequence", "title", "description", "transcript", "publishedAtUtc",
                "contentHost", "contentType", "contentStatus", "contentUrl",
              ],
            },
          },
        },
        required: ["groupId", "items"],
      },
      outputSchema: contentCreateOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      execute(args, context) {
        const result = videoContent.createItems(args, { ...context, actorName: "video_content_create" });
        return {
          group: identifiedContentGroup(result.group),
          createdCount: result.createdCount,
          items: result.items.map((content) => identifiedContentItem({
            id: Number(content.id),
            groupId: Number(content.groupId),
            sequence: content.sequence == null ? null : Number(content.sequence),
            contentType: content.contentType,
            title: content.title,
            publishedAtUtc: content.publishedAtUtc,
            contentHost: content.contentHost,
            contentStatus: content.contentStatus,
            contentUrl: content.contentUrl,
          })),
        };
      },
    });

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
    description: "The bounded active destination groups available for reading or changing a content-library sequence. If no group matches a requested new library, use the owned group-creation tool rather than inventing an ID.",
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
