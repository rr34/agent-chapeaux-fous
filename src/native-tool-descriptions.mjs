import { defineToolDescription, toolDescriptionMetadataKey } from "./tool-description.mjs";

const read = (summary) => defineToolDescription({
  summary, actionClasses: ["READ"], effectClassifications: ["READ-ONLY"],
});
const create = (summary, actionClasses = ["CREATE"]) => defineToolDescription({
  summary, actionClasses, effectClassifications: ["MUTATING"],
});
const update = (summary, actionClasses = ["UPDATE"]) => defineToolDescription({
  summary, actionClasses, effectClassifications: ["MUTATING"],
});
const destructive = (summary, actionClasses = ["UPDATE", "DELETE"]) => defineToolDescription({
  summary, actionClasses, effectClassifications: ["MUTATING", "DESTRUCTIVE"],
});
const external = (summary, actionClasses = ["EXECUTE"]) => defineToolDescription({
  summary, actionClasses, effectClassifications: ["MUTATING", "EXTERNAL"],
});

const descriptions = new Map(Object.entries({
  calendar_event_search: read("Search stored native calendar series by terms in title, description, or location. Use calendar_event_list instead for occurrences in a UTC range."),
  calendar_event_list: read("List the calendar schedule in an explicit UTC range, expanding recurrence occurrences and including derived contact birthdays."),
  calendar_event_add: create("Create one native calendar event, including an optional planning prompt, all-day event, or structured recurrence when requested."),
  calendar_event_update: update("Update or cancel one native calendar event by stable ID, including its optional planning prompt. Recurrence changes belong to calendar_event_recurrence_set."),
  calendar_event_recurrence_set: update("Add, replace, or remove structured recurrence on one existing native calendar event."),

  contact_import: create("Import up to 200 normalized structured contacts. Use contact_file_import when the source is an attached CSV or vCard."),
  contact_file_import: create("Import one complete verified CSV or vCard attachment directly, without copying its records through model arguments."),
  contact_search: read("Search contacts by descriptive or partial details using the Contacts UI's matching behavior."),
  contact_lookup_batch: read("Resolve up to 500 exact normalized display names in one bounded lookup, returning every current match and stable ID."),
  contact_tag_add_batch: update("Atomically add one tag to as many as 10,000 contacts while preserving existing tags."),
  contact_tag_rename: update("Atomically rename or merge one contact tag across every assigned contact."),
  contact_dedupe_clear: destructive("Recompute and merge conservative source-aware duplicate contact groups. Use only for automatically eligible exact-name groups."),
  contact_duplicate_list: read("List paginated possible duplicate-contact groups for review. Partial-name matches are never automatically merged."),
  contact_merge: destructive("Atomically merge up to 100 explicitly reviewed contact groups using current IDs and expected versions."),

  database_schema: read("Inspect existing native database tables, views, columns, and foreign keys without changing schema."),
  database_read: read("Read bounded rows from one existing allowlisted native table or view using equality filters, never raw SQL."),
  tool_receipt_list: read("List durable tool-result receipts and their stable event numbers without loading full payloads."),
  tool_receipt_read: read("Page one exact durable tool call/result receipt. Use it to recover prior evidence instead of repeating an action."),
  database_write: defineToolDescription({
    summary: "Insert, update, or delete rows only in explicitly allowlisted transitional native tables. It cannot run raw SQL, change schema, or write tool-owned tables.",
    actionClasses: ["CREATE", "UPDATE", "DELETE"],
    effectClassifications: ["MUTATING", "DESTRUCTIVE"],
    operations: {
      exhaustive: true,
      entries: [
        { name: "insert", title: "Insert rows", summary: "Insert validated rows into one allowlisted transitional table.", actionClasses: ["CREATE"], effectClassifications: ["MUTATING"] },
        { name: "update", title: "Update rows", summary: "Update equality-filtered rows in one allowlisted transitional table.", actionClasses: ["UPDATE"], effectClassifications: ["MUTATING"] },
        { name: "delete", title: "Delete rows", summary: "Delete equality-filtered rows from one allowlisted transitional table.", actionClasses: ["DELETE"], effectClassifications: ["MUTATING", "DESTRUCTIVE"] }
      ]
    }
  }),

  email_cleanup_receipt_list: read("Recover exact recent email-mutation receipts when a prior response omitted or misstated the affected messages."),
  email_account_list: read("Inspect live JMAP mail accounts, the selected primary account, and advertised provider capabilities."),
  email_mailbox_list: read("List live JMAP mailboxes with stable IDs, roles, hierarchy, rights, and current counts."),
  email_identity_list: read("List live JMAP sending identities and their stable IDs, addresses, reply settings, and signatures."),
  email_search: read("Search live JMAP mail and return bounded IDs, compact summaries, or full metadata with exact state tokens."),
  email_get: read("Fetch live JMAP messages by stable IDs, with optional bounded decoded bodies and attachment metadata."),
  email_thread_get: read("Fetch complete live JMAP threads and return their messages in chronological server order."),
  email_changes: read("Read authoritative JMAP changes since a prior Email, Thread, Mailbox, Identity, or Submission state token."),
  email_update: destructive("Update one live JMAP message's mailboxes or keywords, or permanently destroy it, with optional optimistic state checking."),
  email_bulk_update: update("Apply one recoverable Trash, Archive, Inbox, or restore action to up to 100 explicit live email IDs."),
  email_cleanup_preview: read("Build and temporarily save one exact read-only Inbox cleanup selection for later authorized application."),
  email_cleanup_apply: update("Apply Trash or Archive once to the exact saved selection produced by email_cleanup_preview."),
  email_draft_create: create("Create or atomically replace one live JMAP draft without sending it."),
  email_send: external("Submit one existing JMAP draft for external delivery. Draft creation or review alone never authorizes sending."),
  email_submission_get: read("Read live JMAP submission records and delivery status for known submission IDs."),
  email_attachment_get: read("Retrieve one exact live JMAP message or attachment blob with a strict byte limit."),

  file_get: read("Get authoritative metadata and stable provenance for one durable upload. Use file_read for verified contents."),
  file_read: read("Read a verified character range from one durable text, CSV, or vCard upload by stable file ID."),
  file_table_inspect: read("Inspect one complete verified delimited-text upload as a table, returning counts, headers, profiles, and bounded samples."),
  file_table_transform: create("Transform every record in one verified delimited-text upload with a declarative mapping and save a durable JSON Lines result."),
  file_search: read("Search durable uploads by title, description, original filename, and originating request text."),
  file_update: update("Assign an AI-generated title and description to a newly uploaded file without overwriting user-authored metadata."),

  history_recent: read("Return recent user requests and Agent responses from application-owned conversation history."),
  history_search: read("Search older user requests and Agent responses by text."),
  history_range: read("Return paired requests and responses within an explicit UTC range, optionally filtered by topic."),

  interaction_guide_list: read("List briefing metadata without loading numbered exchanges. Use it to resolve the exact briefing before further work."),
  interaction_guide_get: read("Fetch one exact briefing with all numbered exchanges, answers, versions, and progress."),
  interaction_guide_step_add: create("Add one numbered exchange to a selected briefing or atomically append it to the generic Exchange Inbox."),
  interaction_guide_step_update: update("Replace the complete definition of one numbered briefing exchange using the parent briefing's current version."),
  interaction_guide_step_move: update("Move one exchange into a different active briefing after reading both current versions."),
  interaction_guide_start: update("Start or resume one briefing; require an explicit resume or start-over choice when an unfinished run began on an earlier local day."),
  interaction_guide_step_answer: update("Merge answers into the active briefing exchange and advance only when its completion rule is satisfied."),
  interaction_guide_run_cancel: destructive("Cancel one active briefing run, resetting current progress and answers while retaining ledger history."),
  interaction_guide_create: create("Create one named durable user-owned briefing. Add its numbered exchanges separately before starting it."),
  interaction_guide_update: update("Rename one exact briefing using its current version without changing its exchanges."),
  interaction_guide_archive: update("Archive one exact briefing using its current version when no enabled repeating to-do still links to it."),

  log_add: create("Record one authoritative personal-log entry, optionally with a numeric trend value using the tracker's canonical unit."),
  log_import: create("Idempotently import up to 100 personal-log entries with stable source IDs and explicit occurrence times."),
  log_list: read("List recent personal-log entries, optionally filtered by tracker, group, source, or UTC occurrence range."),
  log_update: update("Correct one personal-log entry by stable ID without changing the tracker's canonical unit."),
  tracker_list: read("List personal-log trackers with groups, canonical units, entry counts, and latest occurrence times."),
  tracker_update: update("Rename, regroup, archive, reactivate, or establish the canonical unit of one personal-log tracker."),

  profile_fact_list: read("List active or archived durable profile facts with stable IDs."),
  profile_fact_set: update("Add or replace one durable cross-task fact, relationship, or lasting preference."),
  profile_fact_delete: update("Archive one durable profile-fact row by stable ID without affecting other facts of the same type."),

  global_search: read("Search across selected native domains and return compact normalized discovery hits while preserving provider matching rules."),

  agent_self_knowledge: read("Read focused current facts about Chapeaux Fous identity, interaction, hats, self-conception, or video workflows."),
  agent_self_describe: read("Return a broad current description of Chapeaux Fous infrastructure, request path, integrations, sources, and callable inventory."),

  todo_group_list: read("List active native to-do groups and their open counts so a new task can use the best existing group."),
  todo_list: read("List actual native personal to-dos, including Calendar-screen Scheduled task and All-day task entries."),
  routine_add: create("Create one reusable calendar routine definition without creating an occurrence; range publication later creates linked personal tasks."),
  routine_list: read("List reusable calendar routine definitions separately from dated personal task occurrences."),
  routine_update: update("Update one reusable calendar routine definition without rewriting occurrences already published."),
  todo_add: create("Create one native personal to-do with optional unplanned status, planning prompt, group position, contact, schedule, duration, due date, and recurrence."),
  todo_position_set: update("Move one native personal to-do to an exact position in its group's manual sort order."),
  todo_group_create: create("Create or reactivate one native to-do group after the user has confirmed it."),
  todo_group_rename: update("Rename one active native to-do group without changing its stable identity or contained tasks."),
  todo_group_sequence_set: update("Enable or disable automatic stable sequence numbering for one active native to-do group."),
  todo_group_archive: update("Archive one active native to-do group after all of its tasks are terminal."),
  todo_interaction_guide_set: update("Link or unlink one active briefing on an existing repeating native to-do without changing recurrence."),
  todo_recurrence_set: update("Add, replace, or remove structured recurrence on one existing native to-do, optionally linking a briefing."),
  todo_move_overdue_to_today: update("Move every active overdue one-time to-do onto one specified local day while preserving local time and due-date distance; recurrence-managed schedule entries stay fixed."),
  todo_update: update("Atomically update up to 500 native personal to-dos by stable ID, including filling a scheduled unplanned work window while preserving omitted or null optional fields."),

  video_script_create: create("Persist one portable source-grounded chat script from explicitly selected completed interactions without rendering video."),
  video_content_add: create("Add one completed Agent-interface MP4 to one existing content-library group with the next sequence number."),
  video_production_create: external("Persist one source-grounded chat script and atomically queue its 1080x1620 Agent-interface MP4 render.", ["CREATE", "EXECUTE"]),
  video_render_interaction: external("Render and store one downloadable 1080x1620 MP4 from the source interaction bound to the current request."),

  web_page_read: read("Read one user-supplied or previously discovered public HTTP(S) page and return extracted text, metadata, and links; this does not search the web."),
}));

function titleFromName(name) {
  const words = String(name).split("_");
  return words.map((word, index) => {
    if (["ai", "id", "jmap", "mp4", "sql", "utc"].includes(word)) return word.toUpperCase();
    return index === 0 ? `${word.slice(0, 1).toUpperCase()}${word.slice(1)}` : word;
  }).join(" ");
}

export function nativeToolDescription(name) {
  return descriptions.get(name) ?? null;
}

export function applyNativeToolDescription(tool) {
  const description = nativeToolDescription(tool.name);
  if (!description) return tool;
  return {
    ...tool,
    title: tool.title ?? titleFromName(tool.name),
    metadata: { ...(tool.metadata ?? {}), [toolDescriptionMetadataKey]: description },
  };
}

export function nativeToolDescriptionNames() {
  return [...descriptions.keys()].sort();
}

export function assertNativeToolDescriptions(tools) {
  const missing = tools
    .filter((tool) => String(tool.source ?? "local") === "local")
    .filter((tool) => !tool.metadata?.[toolDescriptionMetadataKey])
    .map(({ name }) => name)
    .sort();
  if (missing.length) {
    throw new Error(`Native tools missing Tool Description metadata: ${missing.join(", ")}`);
  }
}
