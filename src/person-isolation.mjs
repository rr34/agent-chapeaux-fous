export const personIsolationSchemaVersion = 70;
export const personDataTablePrefix = "person_data_";

export const agentPersonTables = Object.freeze([
  "files", "activity_events", "activity_event_files_join", "contacts", "contact_methods",
  "contact_source_aliases", "tags", "contacts_tags_join", "content_groups", "journal1_groups",
  "todo_groups", "physical_item_groups", "journal2_trackers", "calendar_routines", "calendar_events",
  "calendar_event_exclusions", "calendar_event_contacts_join", "todo_personal", "payment_provider_accounts",
  "payment_invoices", "payment_invoice_lines", "payment_invoice_line_receipts_join", "reminders",
  "journal3_entries", "content_items", "physical_items", "todo_content_join", "physical_items_todo_join",
  "physical_items_content_join", "physical_items_files_join", "physical_items_contacts_join", "video_scripts",
  "video_script_sources_join", "video_jobs", "profile_facts", "correspondence",
  "correspondence_source_aliases", "jmap_email_mailboxes", "correspondence_email_mailboxes_join",
  "jmap_email_sync_state", "jmap_email_sync_work", "jmap_email_sync_work_items",
  "todo_correspondence_join", "calendar_events_correspondence_join", "correspondence_files_join",
  "correspondence_participants_join", "object_relationship_edge_index",
]);

export function inspectPersonIsolation(database, applicationTables = agentPersonTables) {
  const names = [...new Set(applicationTables)].filter((name) => name !== "database_meta");
  const meta = database.prepare(`
    SELECT schema_version FROM database_meta WHERE singleton = 1
  `).get();
  const rows = database.prepare(`
    SELECT TABLE_NAME AS table_name
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'person_id'
  `).all();
  const scoped = new Set(rows.map((row) => row.table_name.replace(personDataTablePrefix, "")));
  return {
    schemaVersion: Number(meta?.schema_version ?? 0),
    missingTables: names.filter((name) => !scoped.has(name)),
  };
}

export function assertPersonIsolationReady(database, applicationTables = agentPersonTables) {
  const result = inspectPersonIsolation(database, applicationTables);
  if (result.schemaVersion < personIsolationSchemaVersion || result.missingTables.length) {
    const missing = result.missingTables.length
      ? ` Missing person_id on: ${result.missingTables.join(", ")}.`
      : "";
    throw new Error(
      `Time v3 Auth cannot start against Agent schema version ${result.schemaVersion}; `
      + `person-isolated schema version ${personIsolationSchemaVersion} is required.${missing}`,
    );
  }
  return result;
}
