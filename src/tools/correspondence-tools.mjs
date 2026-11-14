const toolDescriptions = Object.freeze({
  correspondence_list: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Read and group synchronized correspondence with participant-tag, time, content, medium, direction, and mailbox filters.",
    actionClasses: ["READ"], effectClassifications: ["READ-ONLY"],
  },
  correspondence_todo_link_set: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Atomically link or unlink exact correspondence and to-do pairs.",
    actionClasses: ["CREATE", "DELETE"], effectClassifications: ["MUTATING"],
  },
  correspondence_calendar_event_link_set: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Link or unlink exact synchronized correspondence and saved calendar-event pairs without changing either endpoint.",
    actionClasses: ["CREATE", "DELETE"], effectClassifications: ["MUTATING"],
  },
  sms_draft_create: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Prepare a structured SMS draft for one exact contact and receivable phone method without sending it.",
    actionClasses: ["EXECUTE"], effectClassifications: ["READ-ONLY"],
  },
});

const nativeToolContracts = Object.freeze({
  correspondence_list: {
    objectTypes: ["correspondence.item"], allowUnboundInputs: true,
    inputRoles: { "/mailbox_id": "mailbox_filter" },
  },
});

export function registerCorrespondenceTools(rootRegistry, service) {
  const registry = rootRegistry.withCapability("correspondence", toolDescriptions, nativeToolContracts);
  registry.register({
    name: "correspondence_list",
    description: "List or group the local synchronized correspondence mirror. Filters combine subject/body text, inclusive occurred-from and exclusive occurred-before UTC instants, medium, direction, provider mailbox, and one exact contact-tag label or slug on a known participant. group_by=none returns complete correspondence items with participants, mailboxes, unread state, and linked objects. group_by=contact returns one bounded summary per matching active participant contact with correspondence count, earliest and latest occurrence, media, directions, and current tags. Use contact grouping for questions such as which tagged customers had correspondence in a period. JMAP and phone sources remain authoritative.",
    parameters: { type: "object", additionalProperties: false, properties: {
      q: { type: "string", maxLength: 500 },
      medium: { type: ["string", "null"], enum: ["email", "sms", "mms", "rcs", "imessage", "whatsapp", "chat", "call", "voicemail", "timev3", "other", null] },
      direction: { type: ["string", "null"], enum: ["inbound", "outbound", null] },
      mailbox_id: { type: ["string", "null"], maxLength: 255 },
      occurred_from_utc: { type: ["string", "null"], format: "date-time", description: "Inclusive lower UTC occurrence boundary." },
      occurred_before_utc: { type: ["string", "null"], format: "date-time", description: "Exclusive upper UTC occurrence boundary." },
      participant_tag: { type: ["string", "null"], maxLength: 200, description: "Exact contact-tag label or slug; the application normalizes labels to their stable slug." },
      group_by: { type: "string", enum: ["none", "contact"] },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      offset: { type: "integer", minimum: 0 },
    }, required: [
      "q", "medium", "direction", "mailbox_id", "occurred_from_utc", "occurred_before_utc",
      "participant_tag", "group_by", "limit", "offset",
    ] },
    outputSchema: { type: "object", properties: {
      result_type: { type: "string", enum: ["items", "contacts"] },
      items: { type: "array", items: { type: "object" } },
      contact_groups: { type: "array", items: { type: "object" } },
      mailboxes: { type: "array", items: { type: "object" } },
      contact_tags: { type: "array", items: { type: "object" } },
      count: { type: "integer" },
      has_more: { type: "boolean" },
    } },
    execute: (input) => service.list({
      ...input,
      mailboxId: input.mailbox_id,
      occurredFromUtc: input.occurred_from_utc,
      occurredBeforeUtc: input.occurred_before_utc,
      participantTag: input.participant_tag,
      groupBy: input.group_by,
    }),
  });
  registry.register({
    name: "correspondence_todo_link_set",
    description: "Atomically link or unlink 1 through 500 exact correspondence and personal to-do pairs. This changes only todo_correspondence_join and never changes, sends, deletes, or marks correspondence read.",
    parameters: { type: "object", additionalProperties: false, properties: {
      links: { type: "array", minItems: 1, maxItems: 500, items: { type: "object", additionalProperties: false,
        properties: { correspondence_id: { type: "integer", minimum: 1 }, todo_id: { type: "integer", minimum: 1 }, linked: { type: "boolean" } },
        required: ["correspondence_id", "todo_id", "linked"] } },
    }, required: ["links"] },
    outputSchema: { type: "object", properties: { updated: { type: "integer" }, links: { type: "array", items: { type: "object" } } } },
    execute: (input, context) => service.setTodoLinks(input, context),
  });
  registry.register({
    name: "correspondence_calendar_event_link_set",
    description: "Atomically link or unlink 1 through 500 exact existing synchronized-correspondence and saved-calendar-event pairs. Each item changes only the named association; it does not alter, send, delete, or mark correspondence read, and it does not modify the calendar event. The complete batch is validated before any association changes.",
    annotations: {
      readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false,
    },
    parameters: { type: "object", additionalProperties: false, properties: {
      links: { type: "array", minItems: 1, maxItems: 500, items: {
        type: "object", additionalProperties: false, properties: {
          correspondence_id: { type: "integer", minimum: 1, description: "Existing synchronized correspondence ID." },
          calendar_event_id: { type: "integer", minimum: 1, description: "Existing saved calendar event or recurring-series ID." },
          linked: { type: "boolean", description: "True creates this exact association; false removes only this exact association." },
        }, required: ["correspondence_id", "calendar_event_id", "linked"],
      } },
    }, required: ["links"] },
    outputSchema: { type: "object", additionalProperties: false, properties: {
      selected_count: { type: "integer", minimum: 1 },
      changed_count: { type: "integer", minimum: 0 },
      unchanged_count: { type: "integer", minimum: 0 },
      results: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        correspondence_id: { type: "integer" }, calendar_event_id: { type: "integer" },
        linked: { type: "boolean" }, changed: { type: "boolean" },
      }, required: ["correspondence_id", "calendar_event_id", "linked", "changed"] } },
    }, required: ["selected_count", "changed_count", "unchanged_count", "results"] },
    execute: (input, context) => service.setCalendarEventLinks(input, context),
  });
  registry.register({
    name: "sms_draft_create",
    description: "Prepare, but never send, an SMS draft for one exact active contact. If contact_method_id is null, use the unique primary receivable phone method or the only receivable phone method. When several choices remain, return needs_selection with exact choices. A ready result is a handoff action for the mobile Messages app or web copy controls; it is not delivery evidence and must not create correspondence.",
    parameters: { type: "object", additionalProperties: false, properties: {
      contact_id: { type: "integer", minimum: 1 },
      contact_method_id: { type: ["integer", "null"], minimum: 1 },
      body: { type: "string", minLength: 1, maxLength: 10_000 },
    }, required: ["contact_id", "contact_method_id", "body"] },
    outputSchema: { type: "object", properties: {
      status: { type: "string", enum: ["ready", "needs_selection"] },
      draft: { type: "object" }, methods: { type: "array", items: { type: "object" } },
    } },
    execute: (input) => service.createSmsDraft(input),
  });
}
