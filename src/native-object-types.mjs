import {
  objectDescriptionProtocol, objectDescriptionVersion,
} from "./object-description.mjs";

const field = (name, summary) => Object.freeze({ field: name, summary });
const relationship = (name, targetType, summary) => Object.freeze({ name, targetType, summary });
const integerIdentity = Object.freeze({ idKind: "integer" });
const stringIdentity = Object.freeze({ idKind: "string" });

// This is the reviewed native-domain equivalent of provider-published Object
// Description metadata. It is the single source for orientation catalogs,
// result binding, native object search references, and ID-consuming inputs.
export const nativeFirstClassObjectTypes = Object.freeze([
  {
    ...integerIdentity,
    capabilityId: "contacts", source: "native:contacts", readTool: "contact_search",
    id: "contacts.contact", searchType: "contact", table: "contacts", key: "contact_id",
    title: "Contact", summary: "A person, organization, or service in the native address book.",
    aliases: ["contact", "person", "organization"],
    identity: field("contact_id", "Stable native contact primary ID."),
    reference: field("ref", "Stable Agent Slayer contact reference."),
    display: field("display_name", "Preferred human-facing contact name."),
    qualifiers: [field("contact_kind", "Person, organization, or service."), field("status", "Current address-book status.")],
    relationships: [],
    idFields: ["contact_id", "contactId"], displayFields: ["display_name", "displayName"],
    refFields: ["ref"], refPrefix: "agent-slayer://contacts/",
    inputFields: ["contact_id", "contact_ids", "related_contact_id", "keep_contact_id"],
    searchFields: ["display_name", "given_name", "family_name", "organization_name", "tags.label"],
  },
  {
    ...integerIdentity,
    capabilityId: "contacts", source: "native:contacts", readTool: "contact_search",
    id: "contacts.method", searchType: null, table: "contact_methods", key: "contact_method_id",
    title: "Contact method", summary: "One address, number, handle, URL, or reachable identity belonging to a contact.",
    aliases: ["contact method", "address", "phone number", "email address"],
    identity: field("contact_method_id", "Stable native contact-method primary ID."),
    reference: field("method_ref", "Stable Agent Slayer contact-method reference."),
    display: field("method_display", "Human-facing contact-method label and value."),
    qualifiers: [field("method_kind", "Kind of reachable identity."), field("contact_id", "Owning contact ID.")],
    relationships: [relationship("contact", "contacts.contact", "Contact that owns this method.")],
    idFields: ["contact_method_id", "address_method_id"], displayFields: ["method_display"],
    refFields: ["method_ref"], refPrefix: "agent-slayer://contact-methods/",
    inputFields: ["address_method_id"],
  },
  {
    ...integerIdentity,
    capabilityId: "todos", source: "native:todos", readTool: "todo_group_list",
    id: "todos.todo_group", searchType: "todo_group", table: "todo_groups", key: "todo_group_id",
    title: "To-do group", summary: "A named native group containing personal to-dos.",
    aliases: ["to-do group", "task group", "list"],
    identity: field("todo_group_id", "Stable native to-do group primary ID."),
    reference: field("ref", "Stable Agent Slayer to-do group reference."),
    display: field("name", "Human-facing to-do group name."),
    qualifiers: [field("open_task_count", "Current number of non-terminal tasks in the group.")],
    relationships: [relationship("tasks", "todos.personal_task", "Personal to-dos contained by this group.")],
    idFields: ["todo_group_id", "todoGroupId"], displayFields: ["group_name", "name"],
    refFields: ["group_ref", "ref"], refPrefix: "agent-slayer://todo-groups/",
    inputFields: ["todo_group_id"], searchFields: ["name"],
  },
  {
    ...integerIdentity,
    capabilityId: "todos", source: "native:todos", readTool: "todo_list",
    id: "todos.personal_task", searchType: "todo", table: "todo_personal", key: "personal_task_id",
    title: "To-do", summary: "One non-temporal item in the native personal to-do list.",
    aliases: ["to-do", "todo", "task", "reminder"],
    identity: field("personal_task_id", "Stable native personal to-do primary ID."),
    reference: field("ref", "Stable Agent Slayer personal to-do reference."),
    display: field("text", "Human-facing to-do text."),
    qualifiers: [field("status", "Current to-do status."), field("group_name", "Owning to-do group name.")],
    relationships: [relationship("group", "todos.todo_group", "Group containing this personal to-do."), relationship("contact", "contacts.contact", "Optional contact related to this to-do.")],
    idFields: ["personal_task_id", "personalTaskId"], displayFields: ["text", "title"],
    refFields: ["ref"], refPrefix: "agent-slayer://todos/",
    inputFields: ["personal_task_id", "personal_task_ids"],
    searchFields: ["text", "todo_groups.name", "contacts.display_name"],
  },
  {
    ...integerIdentity,
    capabilityId: "journal", source: "native:journal", readTool: "tracker_list",
    id: "journal.group", searchType: "journal_group", table: "journal1_groups", key: "journal_group_id",
    title: "Journal group", summary: "A named native parent grouping personal-journal trackers.",
    aliases: ["journal group", "tracker group"],
    identity: field("journal_group_id", "Stable native journal-group primary ID."),
    reference: field("group_ref", "Stable Agent Slayer journal-group reference."),
    display: field("group_name", "Human-facing journal-group name."),
    qualifiers: [], relationships: [relationship("trackers", "journal.tracker", "Trackers contained by this journal group.")],
    idFields: ["journal_group_id", "journalGroupId"], displayFields: ["group_name", "groupName", "group", "name"],
    refFields: ["group_ref", "groupRef"], refPrefix: "agent-slayer://journal-groups/",
    inputFields: ["journal_group_id"], searchFields: ["name"],
  },
  {
    ...integerIdentity,
    capabilityId: "journal", source: "native:journal", readTool: "tracker_list",
    id: "journal.tracker", searchType: "tracker", table: "journal2_trackers", key: "tracker_id",
    title: "Journal tracker", summary: "A reusable subject whose observations form one journal series.",
    aliases: ["tracker", "journal tracker"],
    identity: field("tracker_id", "Stable native tracker primary ID."),
    reference: field("ref", "Stable Agent Slayer tracker reference."),
    display: field("name", "Human-facing tracked-subject name."),
    qualifiers: [field("unit", "Canonical unit for numeric observations."), field("group_name", "Owning journal-group name.")],
    relationships: [relationship("group", "journal.group", "Journal group containing this tracker."), relationship("entries", "journal.entry", "Observations recorded under this tracker.")],
    idFields: ["tracker_id", "trackerId"], displayFields: ["tracker_name", "name"],
    refFields: ["tracker_ref", "ref"], refPrefix: "agent-slayer://journal-trackers/",
    inputFields: ["tracker_id"], searchFields: ["name", "unit", "journal1_groups.name"],
  },
  {
    ...integerIdentity,
    capabilityId: "journal", source: "native:journal", readTool: "journal_list",
    id: "journal.entry", searchType: "journal_entry", table: "journal3_entries", key: "journal_entry_id",
    title: "Journal entry", summary: "One dated observation in the native personal journal.",
    aliases: ["journal entry", "observation", "log"],
    identity: field("journal_entry_id", "Stable native journal-entry primary ID."),
    reference: field("ref", "Stable Agent Slayer journal-entry reference."),
    display: field("content_text", "Complete human-readable journal content."),
    qualifiers: [field("occurred_at_utc", "UTC instant when the observation occurred."), field("tracker_name", "Tracker under which the observation is recorded.")],
    relationships: [relationship("tracker", "journal.tracker", "Tracker owning this journal entry.")],
    idFields: ["journal_entry_id", "journalEntryId"], displayFields: ["content_text", "text", "title"],
    refFields: ["ref"], refPrefix: "agent-slayer://journal-entries/",
    inputFields: ["journal_entry_id"], searchFields: ["content_text", "journal2_trackers.name", "journal1_groups.name"],
  },
  {
    ...integerIdentity,
    capabilityId: "calendar", source: "native:calendar", readTool: "calendar_event_search",
    id: "calendar.event", searchType: null, table: "calendar_events", key: "calendar_event_id",
    title: "Calendar event", summary: "One stored native calendar event or recurring event series.",
    aliases: ["calendar event", "event", "appointment", "meeting"],
    identity: field("calendar_event_id", "Stable native calendar-event primary ID."),
    reference: field("ref", "Stable Agent Slayer calendar-event reference."),
    display: field("title", "Human-facing calendar-event title."),
    qualifiers: [field("starts_at_utc", "Stored UTC start instant."), field("status", "Current calendar-event status.")],
    relationships: [relationship("todos", "todos.personal_task", "Personal to-dos linked to this event."), relationship("contacts", "contacts.contact", "Contacts linked to this event.")],
    idFields: ["calendar_event_id", "calendarEventId"], displayFields: ["title", "summary", "name"],
    refFields: ["ref"], refPrefix: "agent-slayer://calendar-events/",
    inputFields: ["calendar_event_id"],
  },
  {
    ...integerIdentity,
    capabilityId: "calendar", source: "native:calendar", readTool: "calendar_routine_list",
    id: "calendar.routine", searchType: null, table: "calendar_routines", key: "calendar_routine_id",
    title: "Calendar routine", summary: "A reusable native schedule definition that generates concrete calendar events.",
    aliases: ["calendar routine", "routine", "schedule"],
    identity: field("calendar_routine_id", "Stable native calendar-routine primary ID."),
    reference: field("ref", "Stable Agent Slayer calendar-routine reference."),
    display: field("routine_title", "Human-facing calendar-routine title."),
    qualifiers: [field("recurrence_rule", "Structured recurrence for generated events."), field("disabled_at_utc", "When the routine was disabled, if applicable.")],
    relationships: [relationship("events", "calendar.event", "Concrete events generated by this routine.")],
    idFields: ["calendar_routine_id", "calendarRoutineId"], displayFields: ["routine_title"],
    refFields: ["routine_ref"], refPrefix: "agent-slayer://calendar-routines/",
    inputFields: ["calendar_routine_id"],
  },
  {
    ...integerIdentity,
    capabilityId: "files", source: "native:files", readTool: "file_get",
    id: "files.file", searchType: null, table: "files", key: "file_id",
    title: "File", summary: "One durably stored native upload or generated artifact.",
    aliases: ["file", "upload", "attachment", "artifact"],
    identity: field("fileId", "Stable native file primary ID."),
    reference: field("ref", "Stable Agent Slayer file reference."),
    display: field("title", "Human-facing file title."),
    qualifiers: [field("originalFilename", "Original filename when known."), field("mimeType", "Declared media type when known.")],
    relationships: [],
    idFields: ["file_id", "fileId"], displayFields: ["title", "original_filename", "originalFilename", "name"],
    refFields: ["ref"], refPrefix: "agent-slayer://files/",
    inputFields: ["file_id"],
  },
  {
    ...integerIdentity,
    capabilityId: "interaction-guides", source: "native:interaction-guides", readTool: "interaction_guide_list",
    id: "interaction_guide.guide", searchType: null, table: "interaction_guides", key: "interaction_guide_id",
    title: "Briefing", summary: "A named, versioned container for a durable user-owned structured interaction.",
    aliases: ["briefing", "interaction guide", "guide"],
    identity: field("interaction_guide_id", "Stable native briefing primary ID."),
    reference: field("ref", "Stable Agent Slayer briefing reference."),
    display: field("name", "Human-facing briefing name."),
    qualifiers: [field("status", "Current briefing lifecycle state."), field("version", "Current optimistic-concurrency version.")],
    relationships: [relationship("steps", "interaction_guide.step", "Numbered exchanges owned by this briefing."), relationship("runs", "interaction_guide.run", "Execution runs of this briefing.")],
    idFields: ["interaction_guide_id", "interactionGuideId"], displayFields: ["briefingName", "name"],
    refFields: ["guide_ref", "ref"], refPrefix: "agent-slayer://interaction-guides/",
    inputFields: ["interaction_guide_id", "target_interaction_guide_id"],
  },
  {
    ...integerIdentity,
    capabilityId: "interaction-guides", source: "native:interaction-guides", readTool: "interaction_guide_get",
    id: "interaction_guide.step", searchType: null, table: "interaction_guide_steps", key: "interaction_guide_step_id",
    title: "Briefing exchange", summary: "One numbered exchange definition and its current-run progress within a briefing.",
    aliases: ["briefing exchange", "exchange", "briefing step"],
    identity: field("interaction_guide_step_id", "Stable native briefing-exchange primary ID."),
    reference: field("ref", "Stable Agent Slayer briefing-exchange reference."),
    display: field("opening_text", "Literal human-facing opening text for the exchange."),
    qualifiers: [field("step_number", "User-facing exchange number."), field("progress_state", "Current-run exchange progress.")],
    relationships: [relationship("guide", "interaction_guide.guide", "Briefing that owns this exchange.")],
    idFields: ["interaction_guide_step_id", "interactionGuideStepId"], displayFields: ["opening_text", "openingText"],
    refFields: ["step_ref", "ref"], refPrefix: "agent-slayer://interaction-guide-steps/",
    inputFields: ["interaction_guide_step_id"],
  },
  {
    ...stringIdentity,
    capabilityId: "interaction-guides", source: "native:interaction-guides", readTool: "interaction_guide_get",
    id: "interaction_guide.run", searchType: null, table: "activity_events", key: "run_id",
    title: "Briefing run", summary: "One exact resumable execution of a briefing.",
    aliases: ["briefing run", "run"],
    identity: field("run_id", "Stable native briefing-run ID."),
    reference: field("run_ref", "Stable Agent Slayer briefing-run reference."),
    display: field("run_display", "Human-facing briefing name for this exact run."),
    qualifiers: [field("status", "Current run lifecycle state."), field("current_step_number", "Current exchange number when active.")],
    relationships: [relationship("guide", "interaction_guide.guide", "Briefing being executed by this run.")],
    idFields: ["run_id", "runId"], displayFields: ["run_display", "runDisplay", "briefingName"],
    refFields: ["run_ref"], refPrefix: "agent-slayer://interaction-guide-runs/",
    inputFields: ["run_id"],
  },
  {
    ...integerIdentity,
    capabilityId: "profile", source: "native:profile", readTool: "profile_fact_list",
    id: "profile.fact", searchType: null, table: "profile_facts", key: "profile_fact_id",
    title: "Profile fact", summary: "One durable fact or lasting preference describing the user or their world.",
    aliases: ["profile fact", "fact", "preference"],
    identity: field("profile_fact_id", "Stable native profile-fact primary ID."),
    reference: field("ref", "Stable Agent Slayer profile-fact reference."),
    display: field("fact_text", "Complete human-facing statement of the fact."),
    qualifiers: [field("fact_type", "Broad repeatable fact category."), field("fact_status", "Current fact lifecycle state.")],
    relationships: [],
    idFields: ["profile_fact_id"], displayFields: ["fact_text"],
    refFields: ["ref"], refPrefix: "agent-slayer://profile-facts/",
    inputFields: ["profile_fact_id", "replaces_profile_fact_id"],
  },
  {
    ...integerIdentity,
    capabilityId: "catch-up", source: "native:catch-up", readTool: "catch_up_list",
    id: "catch_up.question", searchType: null, table: "catch_up_questions", key: "question_id",
    title: "Check-in question", summary: "One generated, source-linked question in the native Check-in workflow.",
    aliases: ["check-in question", "catch-up question", "question"],
    identity: field("question_id", "Stable native Check-in question primary ID."),
    reference: field("ref", "Stable Agent Slayer Check-in-question reference."),
    display: field("question_text", "Human-facing source-grounded question text."),
    qualifiers: [field("question_kind", "Journal, planning, or event-review question kind."), field("version", "Current optimistic-concurrency version.")],
    relationships: [relationship("event", "calendar.event", "Optional source calendar event."), relationship("tracker", "journal.tracker", "Optional source journal tracker.")],
    idFields: ["question_id"], displayFields: ["question_text"],
    refFields: ["ref"], refPrefix: "agent-slayer://catch-up-questions/",
    inputFields: ["question_id"],
  },
  {
    ...stringIdentity,
    capabilityId: "email", source: "native:email", readTool: "email_account_list",
    id: "email.account", searchType: null, table: null, key: "account_id",
    title: "Email account", summary: "One live provider mail account available through the native JMAP adapter.",
    aliases: ["email account", "mail account"],
    identity: field("account_id", "Provider-native JMAP account ID."),
    reference: field("account_ref", "Stable Agent Slayer email-account reference."),
    display: field("account_display", "Human-facing provider account name."),
    qualifiers: [], relationships: [relationship("mailboxes", "email.mailbox", "Mailboxes owned by this account.")],
    idFields: ["account_id"], displayFields: ["account_display"],
    refFields: ["account_ref"], refPrefix: "agent-slayer://email-accounts/",
    inputFields: ["account_id"],
  },
  {
    ...stringIdentity,
    capabilityId: "email", source: "native:email", readTool: "email_mailbox_list",
    id: "email.mailbox", searchType: null, table: null, key: "mailbox_id",
    title: "Email mailbox", summary: "One live provider mailbox such as Inbox, Drafts, Sent, Archive, or Trash.",
    aliases: ["mailbox", "inbox", "drafts", "sent", "archive", "trash"],
    identity: field("mailbox_id", "Provider-native JMAP mailbox ID."),
    reference: field("mailbox_ref", "Stable Agent Slayer mailbox reference."),
    display: field("mailbox_name", "Human-facing mailbox name."),
    qualifiers: [field("role", "Provider-defined mailbox role when present.")],
    relationships: [relationship("account", "email.account", "Mail account that owns this mailbox.")],
    idFields: ["mailbox_id"], displayFields: ["mailbox_name"],
    refFields: ["mailbox_ref"], refPrefix: "agent-slayer://email-mailboxes/",
    inputFields: ["mailbox_ids", "in_mailbox", "in_mailbox_id", "drafts_mailbox_id", "sent_mailbox_id", "replace_mailbox_ids", "add_mailbox_ids", "remove_mailbox_ids"],
  },
  {
    ...stringIdentity,
    capabilityId: "email", source: "native:email", readTool: "email_identity_list",
    id: "email.identity", searchType: null, table: null, key: "identity_id",
    title: "Email identity", summary: "One live provider sending identity with an address and signature settings.",
    aliases: ["email identity", "sending identity", "sender"],
    identity: field("identity_id", "Provider-native JMAP identity ID."),
    reference: field("identity_ref", "Stable Agent Slayer email-identity reference."),
    display: field("identity_display", "Human-facing sending name and email address."),
    qualifiers: [], relationships: [relationship("account", "email.account", "Mail account that owns this identity.")],
    idFields: ["identity_id"], displayFields: ["identity_display"],
    refFields: ["identity_ref"], refPrefix: "agent-slayer://email-identities/",
    inputFields: ["identity_id", "identity_ids"],
  },
  {
    ...stringIdentity,
    capabilityId: "email", source: "native:email", readTool: "email_search",
    id: "email.message", searchType: null, table: null, key: "email_id",
    title: "Email message", summary: "One live provider email message or draft.",
    aliases: ["email", "message", "draft"],
    identity: field("email_id", "Provider-native JMAP Email ID."),
    reference: field("email_ref", "Stable Agent Slayer email-message reference."),
    display: field("email_display", "Human-facing email subject or preview."),
    qualifiers: [field("receivedAt", "Provider receipt timestamp."), field("sentAt", "Provider sent timestamp.")],
    relationships: [relationship("thread", "email.thread", "Conversation thread containing this message."), relationship("blobs", "email.blob", "Raw message or attachments belonging to this email.")],
    idFields: ["email_id"], displayFields: ["email_display"],
    refFields: ["email_ref"], refPrefix: "agent-slayer://emails/",
    inputFields: ["email_id", "email_ids", "replace_draft_email_id"],
  },
  {
    ...stringIdentity,
    capabilityId: "email", source: "native:email", readTool: "email_thread_get",
    id: "email.thread", searchType: null, table: null, key: "thread_id",
    title: "Email thread", summary: "One live provider email conversation thread.",
    aliases: ["email thread", "thread", "conversation"],
    identity: field("thread_id", "Provider-native JMAP Thread ID."),
    reference: field("thread_ref", "Stable Agent Slayer email-thread reference."),
    display: field("thread_display", "Human-facing subject of the thread."),
    qualifiers: [], relationships: [relationship("messages", "email.message", "Messages contained by this thread.")],
    idFields: ["thread_id"], displayFields: ["thread_display"],
    refFields: ["thread_ref"], refPrefix: "agent-slayer://email-threads/",
    inputFields: ["thread_ids"],
  },
  {
    ...stringIdentity,
    capabilityId: "email", source: "native:email", readTool: "email_get",
    id: "email.blob", searchType: null, table: null, key: "blob_id",
    title: "Email blob", summary: "One provider-owned raw message or attachment blob identified from an email read.",
    aliases: ["email attachment", "attachment", "raw message", "blob"],
    identity: field("blob_id", "Provider-native JMAP blob ID."),
    reference: field("blob_ref", "Stable Agent Slayer email-blob reference."),
    display: field("blob_display", "Human-facing attachment filename or raw-message label."),
    qualifiers: [field("type", "Declared media type when known.")],
    relationships: [relationship("message", "email.message", "Email message that owns or references this blob.")],
    idFields: ["blob_id"], displayFields: ["blob_display"],
    refFields: ["blob_ref"], refPrefix: "agent-slayer://email-blobs/",
    inputFields: ["blob_id"],
  },
  {
    ...integerIdentity,
    capabilityId: "video", source: "native:video", readTool: "video_script_get",
    id: "video.script", searchType: null, table: "video_scripts", key: "video_script_id",
    title: "Video script", summary: "One durable source-grounded script for an Agent-interface video.",
    aliases: ["video script", "generated video", "production"],
    identity: field("video_script_id", "Stable native video-script primary ID."),
    reference: field("video_script_ref", "Stable Agent Slayer video-script reference."),
    display: field("video_script_title", "Human-facing video-script title."),
    qualifiers: [field("status", "Current script lifecycle state."), field("version", "Current script version.")],
    relationships: [relationship("content", "video.content_item", "Optional content-library item created from this script.")],
    idFields: ["video_script_id"], displayFields: ["video_script_title"],
    refFields: ["video_script_ref"], refPrefix: "agent-slayer://video-scripts/",
    inputFields: ["videoScriptId"],
  },
  {
    ...integerIdentity,
    capabilityId: "video", source: "native:video", readTool: "video_content_list",
    id: "video.content_group", searchType: null, table: "content_groups", key: "content_group_id",
    title: "Content group", summary: "One named ordered destination in the native content library.",
    aliases: ["content group", "content sequence", "content library"],
    identity: field("content_group_id", "Stable native content-group primary ID."),
    reference: field("content_group_ref", "Stable Agent Slayer content-group reference."),
    display: field("content_group_name", "Human-facing content-group name."),
    qualifiers: [field("sortPosition", "Current ordering position among content groups.")],
    relationships: [relationship("items", "video.content_item", "Ordered content items contained by this group.")],
    idFields: ["content_group_id"], displayFields: ["content_group_name"],
    refFields: ["content_group_ref"], refPrefix: "agent-slayer://content-groups/",
    inputFields: ["groupId"],
  },
  {
    ...integerIdentity,
    capabilityId: "video", source: "native:video", readTool: "video_content_list",
    id: "video.content_item", searchType: null, table: "content_items", key: "content_id",
    title: "Content item", summary: "One durable numbered item in a native content-library sequence.",
    aliases: ["content item", "library item", "video item"],
    identity: field("content_id", "Stable native content-item primary ID."),
    reference: field("content_ref", "Stable Agent Slayer content-item reference."),
    display: field("content_title", "Human-facing content-item title."),
    qualifiers: [field("sequence", "Number within the owning content group."), field("contentStatus", "Current content lifecycle state.")],
    relationships: [relationship("group", "video.content_group", "Content group containing this item."), relationship("file", "files.file", "Primary rendered file when present.")],
    idFields: ["content_id"], displayFields: ["content_title"],
    refFields: ["content_ref"], refPrefix: "agent-slayer://content-items/",
    inputFields: [],
  },
]);

const publicType = (type) => ({
  id: type.id, title: type.title, summary: type.summary, aliases: type.aliases,
  identity: type.identity, reference: type.reference, display: type.display,
  qualifiers: type.qualifiers, relationships: type.relationships,
});

export function nativeObjectDescriptionForTool(toolName) {
  const types = nativeFirstClassObjectTypes.filter(({ readTool }) => readTool === toolName);
  if (!types.length) return null;
  return {
    protocol: objectDescriptionProtocol,
    version: objectDescriptionVersion,
    types: types.map(publicType),
  };
}

export function nativeObjectTypeForSearchType(searchType) {
  return nativeFirstClassObjectTypes.find((type) => type.searchType === searchType) ?? null;
}

export const nativeObjectInputFields = Object.freeze(Object.fromEntries(
  nativeFirstClassObjectTypes.flatMap((type) => type.inputFields.map((name) => [name, {
    objectType: type.id,
    value: "id",
    members: name.endsWith("_ids"),
  }])),
));

const nativeIdentityKindsByField = (() => {
  const fields = new Map();
  for (const type of nativeFirstClassObjectTypes) {
    for (const name of type.idFields) {
      const existing = fields.get(name);
      if (existing && existing !== type.idKind) {
        throw new Error(`Native identity field ${name} has conflicting scalar kinds`);
      }
      fields.set(name, type.idKind);
    }
  }
  return fields;
})();

function normalizedIdentityScalar(value, kind) {
  if (kind !== "integer") return value;
  if (Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return value;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

/**
 * MariaDB BIGINT values can arrive as decimal strings even though every native
 * database identity schema declares an integer. Canonicalize only reviewed
 * identity fields and only when conversion is exact; opaque provider IDs stay
 * strings and unsafe integers remain unchanged so schema validation can expose
 * them rather than silently losing precision.
 */
export function normalizeNativeIdentityScalars(value, seen = new WeakMap()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value);
    const output = [];
    seen.set(value, output);
    for (const item of value) output.push(normalizeNativeIdentityScalars(item, seen));
    return output;
  }
  if (value == null || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  if (seen.has(value)) return seen.get(value);
  const output = {};
  seen.set(value, output);
  for (const [name, child] of Object.entries(value)) {
    const kind = nativeIdentityKindsByField.get(name);
    output[name] = kind
      ? normalizedIdentityScalar(child, kind)
      : normalizeNativeIdentityScalars(child, seen);
  }
  return output;
}
