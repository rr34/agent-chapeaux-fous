const toolDescriptions = Object.freeze({
  correspondence_list: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Read synchronized correspondence with participants and linked to-dos or calendar events.",
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
    description: "List the local synchronized correspondence mirror with participants, email mailboxes, unread state, linked to-dos, and linked calendar events. Filter by search text, medium, direction, or one exact provider mailbox id. JMAP remains authoritative for email; phone synchronization remains authoritative for mobile messages and calls.",
    parameters: { type: "object", additionalProperties: false, properties: {
      q: { type: "string", maxLength: 500 },
      medium: { type: ["string", "null"], enum: ["email", "sms", "mms", "rcs", "imessage", "whatsapp", "chat", "call", "voicemail", "other", null] },
      direction: { type: ["string", "null"], enum: ["inbound", "outbound", null] },
      mailbox_id: { type: ["string", "null"], maxLength: 255 },
      limit: { type: "integer", minimum: 1, maximum: 200 },
      offset: { type: "integer", minimum: 0 },
    }, required: ["q", "medium", "direction", "mailbox_id", "limit", "offset"] },
    outputSchema: { type: "object", properties: {
      items: { type: "array", items: { type: "object" } },
      mailboxes: { type: "array", items: { type: "object" } },
      count: { type: "integer" },
    } },
    execute: (input) => service.list({ ...input, mailboxId: input.mailbox_id }),
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
