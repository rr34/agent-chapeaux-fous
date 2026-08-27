export const nativeCapabilityManifests = [
  {
    id: "web", title: "Web pages", summary: "Read specific web pages supplied by URL.",
    aliases: ["web page", "website", "url", "link"], instructionFile: "web.md",
    readOnlyTools: ["web_page_read"],
  },
  {
    id: "calendar", title: "Calendar", summary: "Read and manage native calendar events and schedules.",
    aliases: ["calendar", "schedule", "agenda", "appointment", "meeting", "event"],
    instructionFile: "calendar.md",
    readOnlyTools: ["calendar_event_search", "calendar_event_list"],
  },
  {
    id: "contacts", title: "Contacts", summary: "Search, import, tag, and merge native contacts.",
    aliases: ["contact", "contacts", "address book", "vcard"], instructionFile: "contacts.md",
    attachmentHints: [
      { extensions: [".vcf", ".vcard"], mimeIncludes: ["vcard"] },
      { extensions: [".csv"], mimeIncludes: ["csv"], headerTerms: ["email", "phone", "given_name", "family_name", "display_name", "categories"] },
    ],
    readOnlyTools: ["contact_search", "contact_lookup_batch", "contact_duplicate_list"],
  },
  {
    id: "todos", title: "To-dos", summary: "Read and manage native personal to-do items and groups.",
    aliases: ["todo", "to-do", "task", "reminder", "chore"], instructionFile: "todos.md",
    readOnlyTools: ["todo_group_list", "todo_list"],
  },
  {
    id: "logs", title: "Personal logs", summary: "Read, record, and correct native personal logs and trackers.",
    aliases: ["log", "tracker", "weight", "mood", "symptom", "workout", "sleep"],
    instructionFile: "logs.md",
    attachmentHints: [
      { extensions: [".csv"], mimeIncludes: ["csv"], headerTerms: ["tracker", "occurred_at", "number_value", "content_text", "unit"] },
    ],
    readOnlyTools: ["log_list", "tracker_list"],
  },
  {
    id: "interaction-guides", title: "Interaction guides",
    summary: "Build and run numbered, resumable user-owned scripts for structured interactions.",
    aliases: ["interaction guide", "guided interaction", "structured conversation", "structured interaction"], instructionFile: "interaction-guides.md",
    readOnlyTools: ["interaction_guide_list", "interaction_guide_get"],
  },
  {
    id: "profile", title: "Profile facts", summary: "Read and maintain durable cross-task profile facts.",
    aliases: ["profile", "remember", "preference"], instructionFile: "profile.md",
    readOnlyTools: ["profile_fact_list"],
  },
  {
    id: "files", title: "Files",
    summary: "Find, retrieve, inspect, and safely transform durable text and tabular uploads.",
    aliases: ["file", "upload", "attachment", "document", "csv", "tsv", "table", "delimited text"], instructionFile: "files.md",
    attachmentHints: [
      { extensions: [".csv", ".tsv"], mimeIncludes: ["csv", "tab-separated"] },
    ],
    readOnlyTools: ["file_get", "file_read", "file_table_inspect", "file_search"],
  },
  {
    id: "database", title: "Database reads and receipts",
    summary: "Inspect native schema and read bounded application data, history, and durable tool receipts.",
    aliases: ["database", "schema", "table", "receipt", "ledger"], instructionFile: "database.md",
    readOnlyTools: ["database_schema", "database_read", "tool_receipt_list", "tool_receipt_read"],
  },
  {
    id: "database-write", title: "Transitional database writes",
    summary: "Write only explicitly allowlisted native tables that do not yet have a focused model mutation tool.",
    aliases: ["database write", "update database"], instructionFile: "database-write.md",
  },
  {
    id: "history", title: "Conversation history", summary: "Search prior Agent Slayer conversations.",
    aliases: ["history", "previous conversation", "earlier"], instructionFile: "history.md",
    readOnlyTools: ["history_recent", "history_search", "history_range"],
  },
  {
    id: "email", title: "Email", summary: "Read, draft, send, organize, and clean up email.",
    aliases: ["email", "mail", "inbox", "mailbox"], instructionFile: "email.md",
    dependentTools: ["contact_lookup_batch"],
    readOnlyTools: [
      "email_account_list", "email_mailbox_list", "email_identity_list", "email_search",
      "email_get", "email_thread_get", "email_changes", "email_cleanup_preview",
      "email_submission_get", "email_attachment_get", "email_cleanup_receipt_list",
    ],
  },
  {
    id: "video", title: "AI-video scripts", summary: "Create portable AI-video-generator scripts from explicitly selected interactions.",
    aliases: ["video", "video script", "script"], instructionFile: "video.md",
  },
  {
    id: "search", title: "Global search",
    summary: "Search across native calendar, contacts, durable uploads, and conversation history.",
    aliases: ["global search", "search everywhere"], instructionFile: "search.md",
    readOnlyTools: ["global_search"],
  },
];

export function registerNativeCapabilities(registry) {
  for (const manifest of nativeCapabilityManifests) registry.registerCapability(manifest);
  return registry;
}
