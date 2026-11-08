import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { objectRelationshipTypes } from "../src/object-relationships.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "..");
const baselineFilename = path.join(repositoryRoot, "db/mariadb/0001-baseline.sql");
const migrationsFilename = path.join(repositoryRoot, "db/migrations.sql");

const quoted = (value) => `'${value.replaceAll("'", "''")}'`;
const fixed = (value) => () => quoted(value);
const column = (name) => (record) => `${record}.${name}`;

const edgeSources = Object.freeze([
  { table: "calendar_event_contacts_join", deduplicated: true, type: (r) => `IF(${r}.participant_role = 'other', 'event-contact', 'event-contact-owned')`, left: column("calendar_event_id"), right: column("contact_id") },
  { table: "payment_invoice_line_receipts_join", deduplicated: true, type: fixed("invoice-file-receipt"), left: (r) => `(SELECT payment_invoice_id FROM payment_invoice_lines WHERE payment_invoice_line_id = ${r}.payment_invoice_line_id)`, right: column("file_id") },
  { table: "calendar_events_todo_join", type: (r) => `IF(${r}.relationship_kind = 'context', 'todo-event', 'todo-event-owned')`, left: column("calendar_event_id"), right: column("personal_task_id") },
  { table: "todo_content_join", type: fixed("todo-content"), left: column("personal_task_id"), right: column("content_id") },
  { table: "physical_items_todo_join", type: (r) => `IF(${r}.relationship_kind = 'related', 'thing-todo', 'thing-todo-owned')`, left: column("physical_item_id"), right: column("personal_task_id") },
  { table: "physical_items_content_join", type: (r) => `IF(${r}.relationship_kind = 'related', 'thing-content', 'thing-content-owned')`, left: column("physical_item_id"), right: column("content_id") },
  { table: "physical_items_files_join", type: (r) => `IF(${r}.file_role = 'attachment', 'thing-file', 'thing-file-owned')`, left: column("physical_item_id"), right: column("file_id") },
  { table: "physical_items_contacts_join", type: (r) => `IF(${r}.relationship_kind = 'related', 'thing-contact', 'thing-contact-owned')`, left: column("physical_item_id"), right: column("contact_id") },
  { table: "todo_correspondence_join", type: fixed("todo-correspondence"), left: column("personal_task_id"), right: column("correspondence_id") },
  { table: "calendar_events_correspondence_join", type: fixed("event-correspondence"), left: column("calendar_event_id"), right: column("correspondence_id") },
  { table: "correspondence_files_join", type: fixed("correspondence-file"), left: column("correspondence_id"), right: column("file_id") },
  { table: "todo_personal", type: fixed("todo-group"), left: column("todo_group_id"), right: column("personal_task_id") },
  { table: "todo_personal", type: fixed("todo-contact"), left: column("personal_task_id"), right: column("related_contact_id") },
  { table: "physical_items", type: fixed("physical-item-group"), left: column("physical_item_group_id"), right: column("physical_item_id") },
  { table: "payment_invoices", type: fixed("invoice-payer"), left: column("payment_invoice_id"), right: column("payer_contact_id") },
  { table: "payment_invoice_lines", deduplicated: true, type: fixed("invoice-line"), left: column("payment_invoice_id"), right: column("personal_task_id") },
  { table: "journal2_trackers", type: fixed("journal-group"), left: column("journal_group_id"), right: column("tracker_id") },
  { table: "journal3_entries", type: fixed("tracker-entry"), left: column("tracker_id"), right: column("journal_entry_id") },
  { table: "calendar_events", type: fixed("routine-event"), left: column("calendar_routine_id"), right: column("calendar_event_id") },
  { table: "content_items", type: fixed("content-group"), left: column("content_group_id"), right: column("content_id") },
  { table: "content_items", type: fixed("content-file"), left: column("content_id"), right: column("primary_file_id") },
  { table: "video_jobs", deduplicated: true, type: fixed("script-content"), left: column("video_script_id"), right: column("content_id") },
]);

export const objectRelationshipEdgeSourceTables = Object.freeze([...new Set(edgeSources.map(({ table }) => table))]);

export const objectRelationshipEdgeEndpointTables = Object.freeze({
  contacts: ["contacts.contact", "contact_id"],
  files: ["files.file", "file_id"],
  calendar_events: ["calendar.event", "calendar_event_id"],
  calendar_routines: ["calendar.routine", "calendar_routine_id"],
  todo_groups: ["todos.todo_group", "todo_group_id"],
  todo_personal: ["todos.personal_task", "personal_task_id"],
  payment_invoices: ["payments.invoice", "payment_invoice_id"],
  journal1_groups: ["journal.group", "journal_group_id"],
  journal2_trackers: ["journal.tracker", "tracker_id"],
  journal3_entries: ["journal.entry", "journal_entry_id"],
  content_groups: ["video.content_group", "content_group_id"],
  content_items: ["video.content_item", "content_id"],
  physical_item_groups: ["things.physical_item_group", "physical_item_group_id"],
  physical_items: ["things.physical_item", "physical_item_id"],
  video_scripts: ["video.script", "video_script_id"],
  correspondence: ["correspondence.item", "correspondence_id"],
});

const legacySourceTables = [
  "activity_event_files_join", "contacts_tags_join", "calendar_event_contacts_join",
  "payment_invoice_line_receipts_join", "calendar_events_todo_join", "todo_content_join",
  "physical_items_todo_join", "physical_items_content_join", "physical_items_files_join",
  "physical_items_contacts_join", "video_script_sources_join", "todo_correspondence_join",
  "calendar_events_correspondence_join", "correspondence_files_join",
  "correspondence_participants_join", "correspondence_email_mailboxes_join", "todo_personal",
  "physical_items", "payment_invoices", "payment_invoice_lines", "journal2_trackers",
  "journal3_entries", "calendar_events", "content_items", "video_jobs",
];
const legacyEndpointTables = [
  "activity_events", "files", "contacts", "tags", "contact_methods", "calendar_events",
  "calendar_routines", "todo_groups", "todo_personal", "payment_invoices",
  "payment_invoice_lines", "journal1_groups", "journal2_trackers", "journal3_entries",
  "content_groups", "content_items", "physical_item_groups", "physical_items",
  "video_scripts", "correspondence",
];

export const objectRelationshipEdgeTriggerNames = Object.freeze([...new Set([
  ...legacySourceTables.flatMap((table) => ["ai", "au", "ad"].map((suffix) => `ore_${table}_${suffix}`)),
  ...legacyEndpointTables.map((table) => `ore_cleanup_${table}_bd`),
  "ore_payment_invoice_lines_receipts_au", "ore_jmap_email_mailboxes_au", "ore_jmap_email_mailboxes_bd",
])]);

function exactPredicate(type, left, right) {
  return `relationship_type = ${type} AND left_id = ${left} AND right_id = ${right}`;
}

function restoreFromSource(spec, type, left, right) {
  const candidateType = spec.type("candidate");
  const candidateLeft = spec.left("candidate");
  const candidateRight = spec.right("candidate");
  return `INSERT IGNORE INTO object_relationship_edge_index (relationship_type, left_id, right_id)
    SELECT ${candidateType}, ${candidateLeft}, ${candidateRight}
    FROM ${spec.table} AS candidate
    WHERE ${candidateType} = ${type} AND ${candidateLeft} = ${left} AND ${candidateRight} = ${right}
    LIMIT 1;`;
}

function removeAndRestore(spec, record) {
  const type = spec.type(record);
  const left = spec.left(record);
  const right = spec.right(record);
  return `DELETE FROM object_relationship_edge_index WHERE ${exactPredicate(type, left, right)};${spec.deduplicated
    ? `\n  ${restoreFromSource(spec, type, left, right)}` : ""}`;
}

function insertCurrent(spec, record) {
  const type = spec.type(record);
  const left = spec.left(record);
  const right = spec.right(record);
  return `INSERT IGNORE INTO object_relationship_edge_index (relationship_type, left_id, right_id)
    SELECT ${type}, ${left}, ${right}
    WHERE ${left} IS NOT NULL AND ${right} IS NOT NULL;`;
}

function invoiceReceiptRefresh(record) {
  const invoice = `${record}.payment_invoice_id`;
  return `DELETE FROM object_relationship_edge_index
    WHERE relationship_type = 'invoice-file-receipt' AND left_id = ${invoice};
  INSERT IGNORE INTO object_relationship_edge_index (relationship_type, left_id, right_id)
    SELECT DISTINCT 'invoice-file-receipt', line.payment_invoice_id, receipt.file_id
    FROM payment_invoice_line_receipts_join AS receipt
    JOIN payment_invoice_lines AS line USING (payment_invoice_line_id)
    WHERE line.payment_invoice_id = ${invoice};`;
}

function sourceTriggerBody(table, event, specs) {
  const statements = [];
  if (["DELETE", "UPDATE"].includes(event)) statements.push(...specs.map((spec) => removeAndRestore(spec, "OLD")));
  if (table === "payment_invoice_lines" && ["DELETE", "UPDATE"].includes(event)) statements.push(invoiceReceiptRefresh("OLD"));
  if (["INSERT", "UPDATE"].includes(event)) statements.push(...specs.map((spec) => insertCurrent(spec, "NEW")));
  if (table === "payment_invoice_lines" && ["INSERT", "UPDATE"].includes(event)) statements.push(invoiceReceiptRefresh("NEW"));
  return `BEGIN\n  ${statements.join("\n  ")}\nEND`;
}

function cleanupTrigger(table, objectType, idColumn) {
  const leftTypes = objectRelationshipTypes.filter(({ leftType }) => leftType === objectType).map(({ name }) => quoted(name));
  const rightTypes = objectRelationshipTypes.filter(({ rightType }) => rightType === objectType).map(({ name }) => quoted(name));
  const predicates = [];
  if (leftTypes.length) predicates.push(`(relationship_type IN (${leftTypes.join(", ")}) AND left_id = OLD.${idColumn})`);
  if (rightTypes.length) predicates.push(`(relationship_type IN (${rightTypes.join(", ")}) AND right_id = OLD.${idColumn})`);
  return `CREATE TRIGGER ore_cleanup_${table}_bd BEFORE DELETE ON ${table} FOR EACH ROW BEGIN
  DELETE FROM object_relationship_edge_index WHERE ${predicates.join(" OR ")};
END`;
}

function triggerDefinitions() {
  const definitions = [];
  for (const table of objectRelationshipEdgeSourceTables) {
    const specs = edgeSources.filter((source) => source.table === table);
    for (const [event, suffix] of [["INSERT", "ai"], ["UPDATE", "au"], ["DELETE", "ad"]]) {
      definitions.push({
        name: `ore_${table}_${suffix}`,
        definition: `CREATE TRIGGER ore_${table}_${suffix} AFTER ${event} ON ${table} FOR EACH ROW ${sourceTriggerBody(table, event, specs)}`,
      });
    }
  }
  for (const [table, [objectType, idColumn]] of Object.entries(objectRelationshipEdgeEndpointTables)) {
    definitions.push({ name: `ore_cleanup_${table}_bd`, definition: cleanupTrigger(table, objectType, idColumn) });
  }
  return definitions;
}

export function baselineObjectRelationshipEdgeTriggers() {
  return triggerDefinitions().map(({ definition }) => `${definition}//`).join("\n\n");
}

export function migrationObjectRelationshipEdgeTriggers() {
  return triggerDefinitions().map(({ name, definition }) => `DROP TRIGGER IF EXISTS ${name};
SET @object_relationship_edge_trigger_sql = ${quoted(definition)};
PREPARE object_relationship_edge_trigger_statement FROM @object_relationship_edge_trigger_sql;
EXECUTE object_relationship_edge_trigger_statement;
DEALLOCATE PREPARE object_relationship_edge_trigger_statement;`).join("\n\n");
}

export function migrationDropObjectRelationshipEdgeTriggers() {
  return objectRelationshipEdgeTriggerNames.map((name) => `DROP TRIGGER IF EXISTS ${name};`).join("\n");
}

export function writeBaselineObjectRelationshipEdgeTriggers(filename = baselineFilename) {
  const source = fs.readFileSync(filename, "utf8");
  const markerPattern = /-- BEGIN GENERATED OBJECT RELATIONSHIP EDGE TRIGGERS[\s\S]*?\/\* END GENERATED OBJECT RELATIONSHIP EDGE TRIGGERS \*\/[\/]{2}/u;
  if (!markerPattern.test(source)) throw new Error("Could not find the generated baseline trigger markers");
  fs.writeFileSync(filename, source.replace(markerPattern,
    `-- BEGIN GENERATED OBJECT RELATIONSHIP EDGE TRIGGERS\n${baselineObjectRelationshipEdgeTriggers()}\n/* END GENERATED OBJECT RELATIONSHIP EDGE TRIGGERS *///`));
}

export function writeMigrationObjectRelationshipEdgeTriggers(filename = migrationsFilename) {
  const source = fs.readFileSync(filename, "utf8");
  const pattern = /(-- migration 0067:[\s\S]*?CREATE OR REPLACE SQL SECURITY INVOKER VIEW object_relationship_edges AS[\s\S]*?SELECT relationship_type, left_id, right_id FROM object_relationship_edge_index;\n\n)[\s\S]*?(\n-- end migration 0067)/u;
  if (!pattern.test(source)) throw new Error("Could not find migration 0067 compact trigger section");
  fs.writeFileSync(filename, source.replace(pattern,
    `$1${migrationObjectRelationshipEdgeTriggers()}\n$2`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "baseline") process.stdout.write(`${baselineObjectRelationshipEdgeTriggers()}\n`);
  else if (mode === "migration") process.stdout.write(`${migrationObjectRelationshipEdgeTriggers()}\n`);
  else if (mode === "drop-migration") process.stdout.write(`${migrationDropObjectRelationshipEdgeTriggers()}\n`);
  else if (mode === "write-baseline") writeBaselineObjectRelationshipEdgeTriggers();
  else if (mode === "write-migration") writeMigrationObjectRelationshipEdgeTriggers();
  else throw new Error("Expected baseline, migration, drop-migration, write-baseline, or write-migration output mode");
}
