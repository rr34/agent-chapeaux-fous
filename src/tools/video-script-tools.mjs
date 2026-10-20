
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
  "video_content_group_rename": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Rename one exact active content-library group without changing its stable identity or contained items.",
    "actionClasses": [
      "UPDATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "video_content_group_sequence_set": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Enable or disable automatic sequence assignment for one exact content-library group.",
    "actionClasses": [
      "UPDATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "video_content_create": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Create up to 50 ordinary content-library items in one exact group, preserving explicit metadata and using the current UTC time when publication time is absent.",
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
  "video_content_update": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Atomically update up to 50 exact content-library items using versions returned by the owning sequence read.",
    "actionClasses": [
      "UPDATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "video_content_file_reconcile_preview": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Preview a complete verified delimited source against one content group using canonical external source identity.",
    "actionClasses": ["READ"],
    "effectClassifications": ["READ-ONLY"]
  },
  "video_content_file_reconcile_apply": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Atomically apply an unchanged source-identity reconciliation preview to one content group.",
    "actionClasses": ["CREATE", "UPDATE"],
    "effectClassifications": ["MUTATING"]
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
    usesSequence: { type: "boolean" },
    archivedAtUtc: { type: ["string", "null"] },
    createdAtUtc: { type: "string" },
    updatedAtUtc: { type: ["string", "null"] },
    content_group_id: { type: ["integer", "string"] },
    content_group_ref: { type: "string" },
    content_group_name: { type: "string" },
  },
  required: [
    "id", "name", "sortPosition", "usesSequence", "archivedAtUtc", "createdAtUtc", "updatedAtUtc",
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

const contentGroupRenameOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    renamed: { type: "boolean" },
    previousName: { type: "string" },
    group: contentGroupSchema,
  },
  required: ["renamed", "previousName", "group"],
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

const updatedContentSchema = {
  ...createdContentSchema,
  properties: {
    ...createdContentSchema.properties,
    version: { type: "string" },
  },
  required: [...createdContentSchema.required, "version"],
};

const contentUpdateOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    updatedCount: { type: "integer" },
    unchangedCount: { type: "integer" },
    items: { type: "array", items: updatedContentSchema },
  },
  required: ["updatedCount", "unchangedCount", "items"],
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
    contentUrl: { type: ["string", "null"] },
    version: { type: "string" },
    content_id: { type: "integer" },
    content_ref: { type: "string" },
    content_title: { type: "string" },
  },
  required: [
    "id", "groupId", "sequence", "contentType", "title", "titleCharacters", "titleTruncated",
    "descriptionExcerpt", "descriptionCharacters", "descriptionTruncated",
    "transcriptExcerpt", "transcriptCharacters", "transcriptTruncated",
    "publishedAtUtc", "contentHost", "contentStatus", "contentUrl", "version",
    "content_id", "content_ref", "content_title",
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

const reconciliationActionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceRecordNumber: { type: "integer", minimum: 1 },
    sourceIdentity: { type: "string" },
    action: { type: "string", enum: ["create", "update", "unchanged"] },
    contentId: { type: ["integer", "null"] },
    sequence: { type: "integer", minimum: 1 },
    title: { type: "string" },
    publishedAtUtc: { type: "string" },
    contentUrl: { type: "string" },
    changedFields: { type: "array", items: { type: "string" } },
  },
  required: [
    "sourceRecordNumber", "sourceIdentity", "action", "contentId", "sequence",
    "title", "publishedAtUtc", "contentUrl", "changedFields",
  ],
};

const reconciliationInputProperties = {
  file_id: {
    type: "integer", minimum: 1,
    description: "Stable ID of the complete durable CSV or delimited source file.",
  },
  groupId: { type: "integer", minimum: 1, description: "Exact target content-group ID." },
  delimiter: { type: "string", enum: ["auto", "comma", "tab", "semicolon", "pipe"] },
  first_sequence: {
    type: "integer", minimum: 1,
    description: "Sequence assigned to the first nonblank source data record; later records increment by one.",
  },
  source_url_column: { type: "string", minLength: 1, maxLength: 500 },
  title_column: { type: "string", minLength: 1, maxLength: 500 },
  published_at_column: { type: "string", minLength: 1, maxLength: 500 },
  content_host: { type: "string", enum: ["youtube", "vimeo", "spotify", "mytlomdotcom", "none"] },
};

const reconciliationRequired = [
  "file_id", "groupId", "delimiter", "first_sequence", "source_url_column",
  "title_column", "published_at_column", "content_host",
];

const reconciliationPreviewOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fileId: { type: "integer" }, fileSha256: { type: "string" }, groupId: { type: "integer" },
    headers: { type: "array", items: { type: "string" } },
    sourceRecordCount: { type: "integer" }, existingNumberedCount: { type: "integer" },
    createCount: { type: "integer" }, updateCount: { type: "integer" },
    unchangedCount: { type: "integer" }, canApply: { type: "boolean" },
    conflicts: { type: "array", items: { type: "object" } },
    previewDigest: { type: "string" },
    actions: { type: "array", items: reconciliationActionSchema },
  },
  required: [
    "fileId", "fileSha256", "groupId", "headers", "sourceRecordCount",
    "existingNumberedCount", "createCount", "updateCount", "unchangedCount",
    "canApply", "conflicts", "previewDigest", "actions",
  ],
};

const reconciliationApplyOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceRecordCount: { type: "integer" }, verifiedCount: { type: "integer" },
    createdCount: { type: "integer" }, updatedCount: { type: "integer" },
    unchangedCount: { type: "integer" }, previewDigest: { type: "string" },
    items: { type: "array", items: { type: "object" } },
  },
  required: [
    "sourceRecordCount", "verifiedCount", "createdCount", "updatedCount",
    "unchangedCount", "previewDigest", "items",
  ],
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
  registry, videoScripts, {
    videoContent = null, videoContentReconciler = null, onRenderQueued = () => {},
  } = {},
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
          usesSequence: {
            type: "boolean",
            description: "Whether this group should automatically assign sequence numbers to ordinary content saved without one. Defaults to false.",
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
      name: "video_content_group_rename",
      title: "Rename a content-library group",
      description: "Rename one exact active content-library group by stable ID. This preserves the group ID, item membership, sequence values, and group ordering. General is the permanent catchall and cannot be renamed. The returned group carries its stable native ID, reference, and updated display name.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: {
            type: "integer", minimum: 1,
            description: "Stable ID of the exact active content-library group to rename.",
          },
          name: {
            type: "string", minLength: 1, maxLength: 200,
            description: "Complete new human-facing name for the group.",
          },
        },
        required: ["groupId", "name"],
      },
      outputSchema: contentGroupRenameOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute(args, context) {
        const result = videoContent.renameGroup(args, {
          ...context, actorType: "tool", actorName: "video_content_group_rename",
          source: "agent-slayer", channel: context.channel ?? "agent",
        });
        return { ...result, group: identifiedContentGroup(result.group) };
      },
    });

    capabilityRegistry.register({
      name: "video_content_group_sequence_set",
      title: "Set content-library group sequencing",
      description: "Enable or disable automatic sequence assignment for one exact active content-library group. Enabling assigns numbers to existing unnumbered items in stable creation order after the current maximum. Disabling preserves every existing number and makes later blank ordinary saves remain unnumbered.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "integer", minimum: 1, description: "Stable ID of the exact active content-library group." },
          usesSequence: { type: "boolean", description: "True enables automatic numbering; false disables it without clearing existing numbers." },
        },
        required: ["groupId", "usesSequence"],
      },
      outputSchema: {
        type: "object", additionalProperties: false,
        properties: {
          changed: { type: "boolean" },
          assignedItemCount: { type: "integer" },
          group: contentGroupSchema,
        },
        required: ["changed", "assignedItemCount", "group"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute(args, context) {
        const result = videoContent.setGroupSequenceMode(args, {
          ...context, actorType: "tool", actorName: "video_content_group_sequence_set",
          source: "agent-slayer", channel: context.channel ?? "agent",
        });
        return { ...result, group: identifiedContentGroup(result.group) };
      },
    });

    capabilityRegistry.register({
      name: "video_content_create",
      title: "Create content-library items",
      description: "Atomically create a bounded batch of 1 through 50 ordinary items in one exact active content-library group. Each item carries its own title, optional text, optional publication time, type, host, status, optional HTTP(S) source URL, and explicit positive sequence or null. An omitted or null publication time uses the current UTC time captured for the batch. Null sequence remains unnumbered and array order never generates sequence. Duplicate non-null sequences reject the complete call without partial writes. This is a general content mutation, not an external-source import or media transfer; it does not download, render, or publish media. A successful result proves new items were created, so do not replay the call.",
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
                  type: ["string", "null"], minLength: 1, maxLength: 64,
                  description: "Optional ISO-8601 publication date or instant. Omit or use null to store the current UTC time. A date without a time is normalized to midnight UTC as a storage representation.",
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
                "sequence", "title", "description", "transcript",
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
      readResultCollectionPaths: ["/items"],
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
      name: "video_content_update",
      title: "Update content-library items",
      description: "Atomically update a bounded batch of 1 through 50 exact content-library items. Read every target with video_content_list first and pass each returned content_id and version. Omitted fields remain unchanged; null sequence makes an item unnumbered. Text and URL fields accept values only; use their explicit clear flags when the user asks to erase them. The complete batch is rejected on a stale version, duplicate target, contradictory value-and-clear input, invalid destination group, or final non-null sequence conflict. Sequence swaps and shifts among items in the same batch are supported. The result returns every current item and its new version as mutation evidence. Do not reconstruct a complete file reconciliation with this tool; use the source-identity preview/apply operations.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          updates: {
            type: "array", minItems: 1, maxItems: 50,
            description: "The complete intended batch. Include each exact content item once.",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                content_id: {
                  type: "integer", minimum: 1,
                  description: "Stable ID of the exact content item returned by video_content_list.",
                },
                version: {
                  type: "string", minLength: 1, maxLength: 64,
                  description: "Exact current version returned for this item by video_content_list.",
                },
                groupId: {
                  type: "integer", minimum: 1,
                  description: "Exact active destination content-group ID; omit to preserve the current group.",
                },
                sequence: {
                  type: ["integer", "null"], minimum: 1,
                  description: "New positive sequence number, null to make the item unnumbered, or omit to preserve it.",
                },
                title: { type: "string", minLength: 1, maxLength: 10_000 },
                description: { type: "string", maxLength: 10_000 },
                clearDescription: {
                  type: "boolean",
                  description: "True clears the description; use only for an explicit request to erase it.",
                },
                transcript: { type: "string", maxLength: 50_000 },
                clearTranscript: {
                  type: "boolean",
                  description: "True clears the transcript; use only for an explicit request to erase it.",
                },
                publishedAtUtc: {
                  type: "string", minLength: 1, maxLength: 64,
                  description: "New ISO-8601 publication date or instant; omit to preserve it.",
                },
                contentHost: {
                  type: "string", enum: ["youtube", "vimeo", "spotify", "mytlomdotcom", "none"],
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
                  type: "string", minLength: 1, maxLength: 2048,
                  description: "New HTTP(S) source URL, or omit to preserve it.",
                },
                clearContentUrl: {
                  type: "boolean",
                  description: "True clears the source URL; use only for an explicit request to erase it.",
                },
              },
              required: ["content_id", "version"],
            },
          },
        },
        required: ["updates"],
      },
      outputSchema: contentUpdateOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      execute(args, context) {
        const updates = args.updates.map((entry, index) => {
          const pairs = [
            ["description", "clearDescription"],
            ["transcript", "clearTranscript"],
            ["contentUrl", "clearContentUrl"],
          ];
          for (const [field, clearField] of pairs) {
            if (Object.hasOwn(entry, field) && entry[clearField] === true) {
              throw new Error(`updates[${index}] cannot set ${field} and ${clearField} together`);
            }
          }
          const { clearDescription, clearTranscript, clearContentUrl, ...update } = entry;
          return {
            ...update,
            ...(clearDescription === true ? { description: null } : {}),
            ...(clearTranscript === true ? { transcript: null } : {}),
            ...(clearContentUrl === true ? { contentUrl: null } : {}),
          };
        });
        const result = videoContent.updateItems({ updates }, { ...context, actorName: "video_content_update" });
        return {
          updatedCount: result.updatedCount,
          unchangedCount: result.unchangedCount,
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
            version: content.version,
          })),
        };
      },
    });

    if (videoContentReconciler) {
      capabilityRegistry.register({
        name: "video_content_file_reconcile_preview",
        title: "Preview content source reconciliation",
        description: "Read a complete checksum-verified delimited file and compare every nonblank source row with one exact content group. Rows are matched only by canonical external source identity, including normalized YouTube video ID; title, date, position, or record count never authorize repurposing a different item. The preview reports every create, update, and unchanged mapping plus blocking duplicate-identity or occupied-sequence conflicts and returns a digest bound to the file checksum, current item versions, mapping, and full source projection. This changes no data.",
        parameters: {
          type: "object", additionalProperties: false,
          properties: reconciliationInputProperties,
          required: reconciliationRequired,
        },
        outputSchema: reconciliationPreviewOutputSchema,
        readResultCollectionPaths: ["/actions", "/conflicts"],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        async execute(args) { return videoContentReconciler.preview(args); },
      });

      capabilityRegistry.register({
        name: "video_content_file_reconcile_apply",
        title: "Apply content source reconciliation",
        description: "Recompute and atomically apply one unchanged content reconciliation preview. The complete verified file is parsed again, canonical source identities and current item versions are rechecked, and the digest must match. Existing items are updated only when their external identity matches the source row; unmatched rows create new items, and a sequence occupied by a different identity blocks the entire transaction. The result returns a full row-to-object projection as mutation evidence.",
        parameters: {
          type: "object", additionalProperties: false,
          properties: {
            ...reconciliationInputProperties,
            preview_digest: { type: "string", minLength: 64, maxLength: 64 },
          },
          required: [...reconciliationRequired, "preview_digest"],
        },
        outputSchema: reconciliationApplyOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        async execute(args, context) {
          return videoContentReconciler.apply(args, {
            ...context, actorName: "video_content_file_reconcile_apply",
          });
        },
      });
    }

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
          ...groups.map((group) => `- ${group.name} [content_group_id=${group.id}; automatic_sequence=${group.usesSequence ? "on" : "off"}]`),
        ].join("\n"),
      };
    },
  });
}
