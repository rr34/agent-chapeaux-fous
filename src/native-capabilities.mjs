export const nativeCapabilityManifests = [
  {
    id: "catch-up", title: "Check-in catch-up",
    summary: "Generate questions for selected journal dates, upcoming event planning, and past-event follow-up. Ask one at a time and retain the exact selection, source-linked resolution, comments and deferral.",
    aliases: ["catch me up", "catch up on the day", "check-in", "check in", "complete logs", "plan ahead", "daily review", "nag me", "hold me accountable", "unresolved", "get my life in order", "keep going"],
    instructionFile: "catch-up.md",
    readOnlyTools: ["catch_up_list"],
    dependentTools: ["calendar_event_update", "calendar_event_occurrence_update", "journal_add", "tracker_list", "tracker_asking_schedule_set", "contact_lookup_batch"],
  },
  {
    id: "self", title: "Chapeaux Fous identity and infrastructure",
    summary: "Read focused or detailed current knowledge about Chapeaux Fous, including its identity and name, interaction and hats system, self-conception, infrastructure, chat-video workflow, request path, and callable capabilities.",
    aliases: [
      "who are you", "what does Chapeaux Fous mean", "how do you work", "how am I talking to you",
      "how do I interact with you", "how can I interact with you", "how should I talk to you", "how do I use you",
      "describe the hats system", "how do hats work", "what are the hats", "hats system", "hats", "self aware",
      "self-awareness", "are you self-aware", "take over the world", "world domination",
      "how do you generate videos", "how do you make a video", "how did you generate that video", "videos of your chats",
      "how can I create a video", "how can I make a video", "how do I create a video",
      "is it easy to create a video", "how long does it take to create a video", "how many clicks to create a video",
      "your identity", "your infrastructure", "Chapofu", "Shapofu", "Chapo fu",
    ],
    instructionFile: "self.md",
    readOnlyTools: ["agent_self_knowledge", "agent_self_describe"],
  },
  {
    id: "web", title: "Web pages", summary: "Read specific web pages supplied by URL.",
    aliases: ["web page", "website", "url", "link"], instructionFile: "web.md",
    readOnlyTools: ["web_page_read"],
  },
  {
    id: "calendar", title: "Calendar and routines", summary: "Read and manage all temporal commitments, deadlines, reusable routines, generated events, and their links to to-dos.",
    aliases: ["calendar", "schedule", "agenda", "appointment", "meeting", "event", "routine", "habit", "deadline", "due date", "work window"],
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
    id: "todos", title: "To-dos", summary: "Read and manage non-temporal personal to-dos. Calendar events own schedules and deadlines and may link to multiple to-dos.",
    aliases: ["todo", "to-do", "task", "reminder", "chore"], instructionFile: "todos.md",
    readOnlyTools: ["todo_group_list", "todo_list"],
  },
  {
    id: "journal", title: "Personal journal", summary: "Read, record, and correct native journal entries and trackers.",
    aliases: ["journal", "tracker", "weight", "mood", "symptom", "workout", "sleep"],
    instructionFile: "journal.md",
    attachmentHints: [
      { extensions: [".csv"], mimeIncludes: ["csv"], headerTerms: ["tracker", "occurred_at", "number_value", "content_text", "unit", "tracker_unit"] },
    ],
    readOnlyTools: ["journal_list", "tracker_list"],
  },
  {
    id: "interaction-guides", title: "Briefings",
    summary: "Build and conduct resumable, agent-led briefings made of ordered exchanges and openings.",
    aliases: ["briefing", "exchange", "opening", "interaction guide", "guided interaction", "structured conversation", "structured interaction"], instructionFile: "interaction-guides.md",
    readOnlyTools: ["interaction_guide_list", "interaction_guide_get"],
  },
  {
    id: "profile", title: "Profile facts", summary: "Read and maintain durable cross-task profile facts, including the standard core-profile onboarding brief and contextual defaults such as location.",
    aliases: ["profile", "profile setup", "onboarding", "onboard me", "remember", "preference"], instructionFile: "profile.md",
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
    id: "video", title: "Video scripts and productions", summary: "Create grounded scripts and Agent-interface MP4 productions from selected interactions, or add a completed generated video to a content-library sequence.",
    aliases: ["video", "video script", "script", "add video to content", "content sequence"], instructionFile: "video.md",
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
