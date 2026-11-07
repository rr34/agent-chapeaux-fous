import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(directory, "..");
const baselineFilename = path.join(repositoryRoot, "db/mariadb/0001-baseline.sql");
const migrationsFilename = path.join(repositoryRoot, "db/migrations.sql");

const sourcePrimaryKeys = Object.freeze({
  activity_event_files_join: ["event_id", "file_id"],
  contacts_tags_join: ["tag_id", "record_type", "record_id"],
  calendar_event_contacts_join: ["calendar_event_id", "contact_id", "participant_role"],
  payment_invoice_line_receipts_join: ["payment_invoice_line_id", "file_id"],
  calendar_events_todo_join: ["calendar_event_id", "personal_task_id"],
  todo_content_join: ["personal_task_id", "content_id"],
  physical_items_todo_join: ["physical_item_id", "personal_task_id"],
  physical_items_content_join: ["physical_item_id", "content_id"],
  physical_items_files_join: ["physical_item_id", "file_id"],
  physical_items_contacts_join: ["physical_item_id", "contact_id"],
  video_script_sources_join: ["video_script_id", "request_event_id"],
  todo_correspondence_join: ["personal_task_id", "correspondence_id"],
  calendar_events_correspondence_join: ["calendar_event_id", "correspondence_id"],
  correspondence_files_join: ["correspondence_id", "file_id"],
  correspondence_participants_join: ["correspondence_id", "participant_role", "address_value"],
  correspondence_email_mailboxes_join: ["correspondence_id", "source_account_key", "mailbox_id"],
  todo_personal: ["personal_task_id"],
  physical_items: ["physical_item_id"],
  payment_invoices: ["payment_invoice_id"],
  payment_invoice_lines: ["payment_invoice_line_id"],
  journal2_trackers: ["tracker_id"],
  journal3_entries: ["journal_entry_id"],
  calendar_events: ["calendar_event_id"],
  content_items: ["content_id"],
  video_jobs: ["video_job_id"],
});

export const objectRelationshipEdgeSourceTables = Object.freeze(Object.keys(sourcePrimaryKeys));

export const objectRelationshipEdgeEndpointTables = Object.freeze({
  activity_events: ["activity.event", "event_id"],
  files: ["files.file", "file_id"],
  contacts: ["contacts.contact", "contact_id"],
  tags: ["contacts.tag", "tag_id"],
  contact_methods: ["contacts.contact_method", "contact_method_id"],
  calendar_events: ["calendar.event", "calendar_event_id"],
  calendar_routines: ["calendar.routine", "calendar_routine_id"],
  todo_groups: ["todos.todo_group", "todo_group_id"],
  todo_personal: ["todos.personal_task", "personal_task_id"],
  payment_invoices: ["payments.invoice", "payment_invoice_id"],
  payment_invoice_lines: ["payments.invoice_line", "payment_invoice_line_id"],
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

const edgeColumns = Object.freeze([
  "left_type", "left_id", "relationship_type", "right_type", "right_id",
  "relationship_family", "source_table", "source_key_json", "created_at_utc",
  "relationship_qualifier", "sort_order", "attributes_json",
]);

function splitTopLevel(source, separator = ",") {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index + 1] === quote) index += 1;
      else if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (["'", "\"", "`"].includes(character)) quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === separator && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function canonicalBody(source) {
  const view = source.match(/CREATE SQL SECURITY INVOKER VIEW object_relationship_edges_source AS[\s\S]*?\nWITH canonical_edges AS \(\n([\s\S]*?)\n\)\nSELECT\n/u);
  if (!view) throw new Error("Could not find the canonical object_relationship_edges_source view");
  return view[1];
}

function parseBranch(sql) {
  const match = sql.match(/^\s*SELECT\s+([\s\S]*?)\s+FROM\s+([\s\S]+)$/u);
  if (!match) throw new Error(`Invalid canonical edge branch: ${sql}`);
  const expressions = splitTopLevel(match[1]);
  if (expressions.length !== edgeColumns.length) {
    throw new Error(`Expected ${edgeColumns.length} edge expressions, found ${expressions.length}`);
  }
  const sourceMatch = expressions[6].match(/^'([^']+)'(?:\s+AS\s+source_table)?$/iu);
  if (!sourceMatch) throw new Error(`Could not read edge source table from ${expressions[6]}`);
  const sourceTable = sourceMatch[1];
  const fromMatch = match[2].match(new RegExp(`^${sourceTable}\\s+AS\\s+([A-Za-z_][A-Za-z0-9_]*)`, "iu"));
  if (!fromMatch) throw new Error(`Could not read ${sourceTable} alias`);
  return { sourceTable, alias: fromMatch[1], expressions, from: match[2] };
}

export function canonicalEdgeBranches(source = fs.readFileSync(baselineFilename, "utf8")) {
  return canonicalBody(source).split(/\n\s*UNION ALL\n/u).map(parseBranch);
}

function triggerBranch(branch, recordName) {
  if (!sourcePrimaryKeys[branch.sourceTable]) {
    throw new Error(`Missing primary-key declaration for ${branch.sourceTable}`);
  }
  const alias = new RegExp(`\\b${branch.alias}[.]`, "gu");
  const selected = branch.expressions.map((expression, index) => {
    const unaliased = expression.replace(/\s+AS\s+[A-Za-z_][A-Za-z0-9_]*\s*$/iu, "");
    return `${unaliased.replaceAll(alias, `${recordName}.`)} AS ${edgeColumns[index]}`;
  });
  let remainder = branch.from.replace(
    new RegExp(`^${branch.sourceTable}\\s+AS\\s+${branch.alias}\\s*`, "iu"),
    "",
  ).replaceAll(alias, `${recordName}.`).trim();
  if (/^JOIN\b/iu.test(remainder)) {
    const using = remainder.match(/^JOIN\s+(.+?\s+AS\s+([A-Za-z_][A-Za-z0-9_]*))\s+USING\s*\(([A-Za-z_][A-Za-z0-9_]*)\)([\s\S]*)$/iu);
    remainder = using
      ? `FROM ${using[1]} WHERE ${using[2]}.${using[3]} = ${recordName}.${using[3]}${using[4]}`
      : remainder.replace(/^JOIN\s+/iu, "FROM ").replace(/\s+ON\s+/iu, " WHERE ");
  }
  return `SELECT\n      ${selected.join(",\n      ")}${remainder ? `\n    ${remainder}` : ""}`;
}

function directedInsert(branch, recordName) {
  const canonical = triggerBranch(branch, recordName);
  const forward = `SELECT left_type, left_id, relationship_type, right_type, right_id,
      relationship_family, source_table, source_key_json,
      UNHEX(SHA2(CAST(source_key_json AS CHAR), 256)), created_at_utc,
      relationship_qualifier, sort_order, attributes_json, 0
    FROM (${canonical}) AS edge`;
  const reverse = `SELECT right_type, right_id, relationship_type, left_type, left_id,
      relationship_family, source_table, source_key_json,
      UNHEX(SHA2(CAST(source_key_json AS CHAR), 256)), created_at_utc,
      relationship_qualifier, sort_order, attributes_json, 1
    FROM (${canonical}) AS edge`;
  return `INSERT INTO object_relationship_edge_index (
      from_type, from_id, relationship_type, to_type, to_id,
      relationship_family, source_table, source_key_json, source_key_sha256,
      created_at_utc, relationship_qualifier, sort_order, attributes_json, is_reverse
    )\n    ${forward}\n    UNION ALL\n    ${reverse};`;
}

function deleteSource(branch, recordName) {
  const expression = branch.expressions[7].replaceAll(new RegExp(`\\b${branch.alias}[.]`, "gu"), `${recordName}.`)
    .replace(/\s+AS\s+source_key_json\s*$/iu, "");
  return `DELETE FROM object_relationship_edge_index
    WHERE source_table = '${branch.sourceTable}'
      AND source_key_sha256 = UNHEX(SHA2(CAST(${expression} AS CHAR), 256));`;
}

function triggerBody(sourceTable, event, branches) {
  const statements = [];
  if (["DELETE", "UPDATE"].includes(event)) statements.push(deleteSource(branches[0], "OLD"));
  if (["INSERT", "UPDATE"].includes(event)) {
    statements.push(...branches.map((branch) => directedInsert(branch, "NEW")));
  }
  return `BEGIN\n  ${statements.join("\n  ")}\nEND`;
}

function triggersBySource(source) {
  const grouped = new Map();
  for (const branch of canonicalEdgeBranches(source)) {
    if (!grouped.has(branch.sourceTable)) grouped.set(branch.sourceTable, []);
    grouped.get(branch.sourceTable).push(branch);
  }
  return grouped;
}

function endpointCleanupTrigger(table, type, idColumn) {
  const dependentAttributes = table === "contact_methods"
    ? `UPDATE object_relationship_edge_index
    SET attributes_json = JSON_SET(attributes_json, '$.contact_method_id', NULL)
    WHERE source_table = 'correspondence_participants_join'
      AND relationship_type = 'correspondence-contact'
      AND JSON_VALUE(attributes_json, '$.contact_method_id') = OLD.contact_method_id;\n  `
    : table === "contacts"
      ? `UPDATE object_relationship_edge_index
    SET attributes_json = JSON_SET(attributes_json, '$.contact_id', NULL)
    WHERE source_table = 'correspondence_participants_join'
      AND relationship_type = 'correspondence-contact-method'
      AND JSON_VALUE(attributes_json, '$.contact_id') = OLD.contact_id;\n  `
      : "";
  const cascadingEndpoints = table === "contacts"
    ? `\n      OR ((from_type = 'contacts.contact_method' AND from_id IN (
        SELECT CAST(contact_method_id AS CHAR) FROM contact_methods
        WHERE contact_id = OLD.contact_id
      )) OR (to_type = 'contacts.contact_method' AND to_id IN (
        SELECT CAST(contact_method_id AS CHAR) FROM contact_methods
        WHERE contact_id = OLD.contact_id
      )))`
    : table === "payment_invoices"
      ? `\n      OR ((from_type = 'payments.invoice_line' AND from_id IN (
        SELECT CAST(payment_invoice_line_id AS CHAR) FROM payment_invoice_lines
        WHERE payment_invoice_id = OLD.payment_invoice_id
      )) OR (to_type = 'payments.invoice_line' AND to_id IN (
        SELECT CAST(payment_invoice_line_id AS CHAR) FROM payment_invoice_lines
        WHERE payment_invoice_id = OLD.payment_invoice_id
      )))`
      : table === "payment_invoice_lines"
        ? `\n      OR (source_table = 'payment_invoice_line_receipts_join'
        AND JSON_VALUE(source_key_json, '$.payment_invoice_line_id') = OLD.payment_invoice_line_id)`
        : "";
  return `CREATE TRIGGER ore_cleanup_${table}_bd\nBEFORE DELETE ON ${table}\nFOR EACH ROW\nBEGIN
  ${dependentAttributes}DELETE FROM object_relationship_edge_index
    WHERE (from_type = '${type}' AND from_id = CAST(OLD.${idColumn} AS CHAR))
       OR (to_type = '${type}' AND to_id = CAST(OLD.${idColumn} AS CHAR))${cascadingEndpoints};
END`;
}

function dependencyTriggers() {
  return [
    `CREATE TRIGGER ore_payment_invoice_lines_receipts_au
AFTER UPDATE ON payment_invoice_lines
FOR EACH ROW
BEGIN
  UPDATE object_relationship_edge_index
  SET from_id = CASE WHEN from_type = 'payments.invoice' THEN CAST(NEW.payment_invoice_id AS CHAR) ELSE from_id END,
      to_id = CASE WHEN to_type = 'payments.invoice' THEN CAST(NEW.payment_invoice_id AS CHAR) ELSE to_id END,
      sort_order = NEW.line_position,
      attributes_json = JSON_SET(attributes_json, '$.line_position', NEW.line_position)
  WHERE source_table = 'payment_invoice_line_receipts_join'
    AND relationship_type = 'invoice-line-receipt'
    AND (from_type = 'payments.invoice' OR to_type = 'payments.invoice')
    AND JSON_VALUE(source_key_json, '$.payment_invoice_line_id') = NEW.payment_invoice_line_id;
END`,
    `CREATE TRIGGER ore_jmap_email_mailboxes_au
AFTER UPDATE ON jmap_email_mailboxes
FOR EACH ROW
BEGIN
  UPDATE object_relationship_edge_index
  SET relationship_qualifier = NEW.role,
      sort_order = NEW.sort_order,
      attributes_json = JSON_OBJECT('source_account_key', NEW.source_account_key,
        'mailbox_name', NEW.name, 'mailbox_role', NEW.role)
  WHERE source_table = 'correspondence_email_mailboxes_join'
    AND JSON_VALUE(source_key_json, '$.source_account_key') = NEW.source_account_key
    AND JSON_VALUE(source_key_json, '$.mailbox_id') = NEW.mailbox_id;
END`,
    `CREATE TRIGGER ore_jmap_email_mailboxes_bd
BEFORE DELETE ON jmap_email_mailboxes
FOR EACH ROW
BEGIN
  DELETE FROM object_relationship_edge_index
  WHERE source_table = 'correspondence_email_mailboxes_join'
    AND JSON_VALUE(source_key_json, '$.source_account_key') = OLD.source_account_key
    AND JSON_VALUE(source_key_json, '$.mailbox_id') = OLD.mailbox_id;
END`,
  ];
}

function allTriggerDefinitions(source) {
  const definitions = [];
  for (const [sourceTable, branches] of triggersBySource(source)) {
    for (const [event, suffix] of [["INSERT", "ai"], ["UPDATE", "au"], ["DELETE", "ad"]]) {
      definitions.push({
        name: `ore_${sourceTable}_${suffix}`,
        definition: `CREATE TRIGGER ore_${sourceTable}_${suffix} AFTER ${event} ON ${sourceTable} FOR EACH ROW ${triggerBody(sourceTable, event, branches)}`,
      });
    }
  }
  for (const [table, [type, idColumn]] of Object.entries(objectRelationshipEdgeEndpointTables)) {
    definitions.push({
      name: `ore_cleanup_${table}_bd`,
      definition: endpointCleanupTrigger(table, type, idColumn),
    });
  }
  for (const definition of dependencyTriggers()) {
    definitions.push({ name: definition.match(/^CREATE TRIGGER ([A-Za-z0-9_]+)/u)[1], definition });
  }
  return definitions;
}

export function baselineObjectRelationshipEdgeTriggers(source = fs.readFileSync(baselineFilename, "utf8")) {
  return allTriggerDefinitions(source).map(({ definition }) => `${definition}//`).join("\n\n");
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function migrationObjectRelationshipEdgeTriggers(source = fs.readFileSync(baselineFilename, "utf8")) {
  const statements = [];
  for (const { name, definition } of allTriggerDefinitions(source)) {
    statements.push(`DROP TRIGGER IF EXISTS ${name};\nSET @object_relationship_edge_trigger_sql = ${sqlLiteral(definition)};\nPREPARE object_relationship_edge_trigger_statement FROM @object_relationship_edge_trigger_sql;\nEXECUTE object_relationship_edge_trigger_statement;\nDEALLOCATE PREPARE object_relationship_edge_trigger_statement;`);
  }
  return statements.join("\n\n");
}

export function writeBaselineObjectRelationshipEdgeTriggers(filename = baselineFilename) {
  const source = fs.readFileSync(filename, "utf8");
  const generated = baselineObjectRelationshipEdgeTriggers(source);
  const markerPattern = /-- BEGIN GENERATED OBJECT RELATIONSHIP EDGE TRIGGERS[\s\S]*?\/\* END GENERATED OBJECT RELATIONSHIP EDGE TRIGGERS \*\/[\/]{2}/u;
  if (!markerPattern.test(source)) throw new Error("Could not find the generated baseline trigger markers");
  const next = source.replace(
    markerPattern,
    `-- BEGIN GENERATED OBJECT RELATIONSHIP EDGE TRIGGERS\n${generated}\n/* END GENERATED OBJECT RELATIONSHIP EDGE TRIGGERS *///`,
  );
  fs.writeFileSync(filename, next);
}

function matchedStatement(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) throw new Error(`Could not find baseline ${label}`);
  return match[0];
}

export function writeObjectRelationshipEdgeMigration({
  baseline = baselineFilename,
  migrations = migrationsFilename,
} = {}) {
  const source = fs.readFileSync(baseline, "utf8");
  const table = matchedStatement(
    source,
    /CREATE TABLE object_relationship_edge_index \([\s\S]*?\n\) ENGINE=InnoDB[^\n]*;/u,
    "edge-index table",
  ).replace("CREATE TABLE object_relationship_edge_index", "CREATE TABLE IF NOT EXISTS object_relationship_edge_index");
  const canonicalView = matchedStatement(
    source,
    /CREATE SQL SECURITY INVOKER VIEW object_relationship_edges_source AS[\s\S]*?\nFROM canonical_edges;/u,
    "canonical edge source view",
  ).replace("CREATE SQL SECURITY INVOKER VIEW", "CREATE OR REPLACE SQL SECURITY INVOKER VIEW");
  const publicView = matchedStatement(
    source,
    /CREATE SQL SECURITY INVOKER VIEW object_relationship_edges AS[\s\S]*?\nFROM object_relationship_edge_index;/u,
    "public edge view",
  ).replace("CREATE SQL SECURITY INVOKER VIEW", "CREATE OR REPLACE SQL SECURITY INVOKER VIEW");
  const migration = `-- migration 0065: indexed-object-relationship-projection
-- writer downtime: required while the complete relationship projection is
-- copied, its public view is redirected, and source-table maintenance triggers
-- are installed. No authoritative relationship or domain row is changed.
-- locking: creating and populating the derived index reads every relationship
-- source and writes two directed projection rows per canonical relationship.
-- Trigger creation and view replacement take metadata locks on their source
-- tables. The derived index may require substantial temporary disk space.
-- recovery: MariaDB DDL commits implicitly. Keep writers stopped and rerun the
-- complete migration after a partial commit. Replay clears and rebuilds only
-- the derived index, replaces both views, and recreates every maintenance
-- trigger before the schema version can advance.

${canonicalView}

${table}

DELETE FROM object_relationship_edge_index;

INSERT INTO object_relationship_edge_index (
  from_type, from_id, relationship_type, to_type, to_id,
  relationship_family, source_table, source_key_json, source_key_sha256,
  created_at_utc, relationship_qualifier, sort_order, attributes_json, is_reverse
)
SELECT from_type, from_id, relationship_type, to_type, to_id,
       relationship_family, source_table, source_key_json,
       UNHEX(SHA2(CAST(source_key_json AS CHAR), 256)),
       created_at_utc, relationship_qualifier, sort_order, attributes_json, is_reverse
FROM object_relationship_edges_source;

${publicView}

${migrationObjectRelationshipEdgeTriggers(source)}

-- end migration 0065
`;
  const ledger = fs.readFileSync(migrations, "utf8");
  const withoutPrevious = ledger.replace(/-- migration 0065:[\s\S]*?-- end migration 0065\n\n/u, "");
  const insertionPoint = withoutPrevious.indexOf("-- migration 0064:");
  if (insertionPoint < 0) throw new Error("Could not find migration 0064 insertion point");
  fs.writeFileSync(migrations, `${withoutPrevious.slice(0, insertionPoint)}${migration}\n${withoutPrevious.slice(insertionPoint)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "baseline") process.stdout.write(`${baselineObjectRelationshipEdgeTriggers()}\n`);
  else if (mode === "migration") process.stdout.write(`${migrationObjectRelationshipEdgeTriggers()}\n`);
  else if (mode === "write-baseline") writeBaselineObjectRelationshipEdgeTriggers();
  else if (mode === "write-migration") writeObjectRelationshipEdgeMigration();
  else throw new Error("Expected baseline or migration output mode");
}
