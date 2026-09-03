import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openApplicationDatabase } from "./database-connection.mjs";

export const requiredDatabaseShape = {
  database_meta: ["singleton", "schema_version"],
  activity_events: [
    "event_seq", "event_id", "event_type", "event_phase", "status", "actor_type",
    "source", "channel", "session_id", "turn_id", "trace_id", "operation_id",
    "name", "content_text", "payload_json", "primary_file_id", "subject_type", "subject_id", "error_text",
  ],
  files: [
    "file_id", "storage_path", "original_filename", "title", "description", "title_source",
    "media_kind", "mime_type", "sha256", "byte_size", "created_at_utc", "updated_at_utc",
  ],
  contacts: [
    "contact_id", "contact_kind", "display_name", "given_name", "family_name",
    "organization_name", "is_self", "status", "birth_date", "notes", "source", "external_id",
  ],
  contact_methods: [
    "contact_method_id", "contact_id", "method_kind", "label", "value",
    "normalized_value", "is_primary", "can_receive",
  ],
  tags: ["tag_id", "slug", "label", "is_active"],
  record_tags: ["tag_id", "record_type", "record_id"],
  content_groups: ["content_group_id", "name", "sort_position", "archived_at_utc"],
  content_items: [
    "content_id", "content_group_id", "sequence", "content_type", "title",
    "transcript", "description", "published_at_utc", "content_host", "content_status", "content_url",
  ],
  video_scripts: [
    "video_script_id", "title", "status", "schema_version", "script_json", "script_text",
    "created_by_event_id", "created_at_utc", "updated_at_utc", "archived_at_utc", "version",
  ],
  video_script_sources: ["video_script_id", "request_event_id", "source_order"],
  video_jobs: [
    "video_job_id", "request_event_id", "source_turn_id", "content_id", "renderer",
    "template", "status", "input_json", "output_file_id", "error_text", "created_at_utc",
    "started_at_utc", "completed_at_utc", "updated_at_utc", "personal_task_id", "video_script_id",
  ],
  calendar_events: [
    "calendar_event_id", "title", "description", "location_text", "starts_at_utc",
    "ends_at_utc", "time_zone", "is_all_day", "status", "recurrence_rule",
    "source_event_id", "created_at_utc", "updated_at_utc", "planning_prompt_text",
  ],
  calendar_event_exclusions: ["calendar_event_id", "excluded_starts_at_utc"],
  todo_groups: ["todo_group_id", "name", "sort_position", "uses_sequence", "archived_at_utc"],
  personal_tasks: [
    "personal_task_id", "todo_group_id", "text", "status", "sort_position",
    "scheduled_at_utc", "is_all_day", "duration_minutes", "due_at_utc", "completed_at_utc", "source_event_id",
    "planning_prompt_text",
  ],
  log_groups: ["log_group_id", "name", "archived_at_utc"],
  trackers: ["tracker_id", "log_group_id", "name", "unit", "archived_at_utc"],
  log_entries: [
    "log_entry_id", "tracker_id", "occurred_at_utc", "content_text",
    "number_value", "source_event_id", "source", "external_id",
  ],
  profile_facts: [
    "profile_fact_id", "fact_type", "fact_text", "fact_status", "source_event_id",
    "archived_by_event_id",
    "created_at_utc", "updated_at_utc", "archived_at_utc",
  ],
  interaction_guides: [
    "interaction_guide_id", "name", "status", "version",
    "created_at_utc", "updated_at_utc",
  ],
  interaction_guide_steps: [
    "interaction_guide_step_id", "interaction_guide_id", "step_number",
    "opening_text", "contract_json", "answers_json", "progress_state",
    "enabled", "created_at_utc", "updated_at_utc",
  ],
  todo_routines: [
    "todo_routine_id", "todo_group_id", "text", "first_scheduled_at_utc",
    "first_due_at_utc", "time_zone", "recurrence_rule", "disabled_at_utc",
    "created_at_utc", "updated_at_utc", "is_all_day", "interaction_guide_id",
    "planning_prompt_text",
  ],
};

// Transitional model-write surface. Every focused native domain table is
// default-deny and must be mutated through its owning service/tool. Content has
// no focused model mutation tools yet, so it remains explicitly available.
export const modelWritableTables = new Set(["content_groups", "content_items"]);

function identifier(name, label = "identifier") {
  if (typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQLite ${label}: ${String(name)}`);
  }
  return `"${name}"`;
}

function serializable(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializable(item)]));
  }
  return value;
}

function normalizeValue(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value !== null && typeof value === "object") return JSON.stringify(serializable(value));
  return value;
}

export function inspectDatabase(database) {
  const problems = [];
  const objects = database.prepare(`
    SELECT type, name, sql FROM sqlite_schema
    WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all();
  const byName = new Map(objects.map((object) => [object.name, object]));
  for (const [name, requiredColumns] of Object.entries(requiredDatabaseShape)) {
    const object = byName.get(name);
    if (!object || object.type !== "table") {
      problems.push(`Missing required table: ${name}`);
      continue;
    }
    const columns = new Set(database.prepare(`PRAGMA table_info(${identifier(name, "table")})`).all().map((row) => row.name));
    for (const column of requiredColumns) {
      if (!columns.has(column)) problems.push(`Missing required column: ${name}.${column}`);
    }
  }
  const integrity = database.prepare("PRAGMA quick_check").get();
  if (integrity?.quick_check !== "ok") problems.push(`SQLite quick_check: ${integrity?.quick_check ?? "unknown failure"}`);
  return { ready: problems.length === 0, problems, objects: objects.map(serializable) };
}

export function inspectMariaDatabase(database) {
  const problems = [];
  const objects = database.prepare(`
    SELECT TABLE_NAME AS name, TABLE_TYPE AS table_type
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_TYPE, TABLE_NAME
  `).all();
  const byName = new Map(objects.map((object) => [object.name, object]));
  for (const [name, requiredColumns] of Object.entries(requiredDatabaseShape)) {
    const object = byName.get(name);
    if (!object || object.table_type !== "BASE TABLE") {
      problems.push(`Missing required table: ${name}`);
      continue;
    }
    const columns = new Set(database.prepare(`
      SELECT COLUMN_NAME AS name
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    `).all(name).map((row) => row.name));
    for (const column of requiredColumns) {
      if (!columns.has(column)) problems.push(`Missing required column: ${name}.${column}`);
    }
  }
  const meta = database.prepare(`
    SELECT schema_version FROM database_meta WHERE singleton = 1
  `).get();
  if (Number(meta?.schema_version) !== 28) {
    problems.push(`Expected MariaDB schema version 28, found ${meta?.schema_version ?? "none"}`);
  }
  return { ready: problems.length === 0, problems, objects };
}

export function summarizeDatabaseObjects(objects) {
  const entries = Array.isArray(objects) ? objects : [];
  const fts5Tables = entries.filter((object) => (
    object?.type === "table"
    && /^\s*CREATE\s+VIRTUAL\s+TABLE\b[\s\S]*\bUSING\s+fts5\s*\(/iu.test(String(object.sql ?? ""))
  ));
  const fts5ShadowNames = new Set(fts5Tables.flatMap(({ name }) => (
    ["data", "idx", "content", "docsize", "config"].map((suffix) => `${name}_${suffix}`)
  )));
  const logical = entries.filter(({ name }) => !fts5ShadowNames.has(name));
  const applicationTableCount = logical.filter(({ type }) => type === "table").length;
  const applicationViewCount = logical.filter(({ type }) => type === "view").length;
  return {
    applicationTableCount,
    applicationViewCount,
    applicationObjectCount: applicationTableCount + applicationViewCount,
    sqliteObjectCount: entries.length,
    fts5ShadowTableCount: entries.filter(({ name }) => fts5ShadowNames.has(name)).length,
  };
}

export class SlayerDatabase {
  constructor(target) {
    this.databaseTarget = target;
    this.filename = typeof target === "string" ? target : target?.filename ?? target?.connection?.database ?? null;
    this.engine = typeof target === "object" ? target.engine : "sqlite";
    this.database = null;
    this.status = { ready: false, reason: "database has not been opened" };
    if (this.engine === "sqlite" && !fs.existsSync(this.filename)) {
      this.status = { ready: false, reason: `database file is missing: ${this.filename}` };
      return;
    }
    try {
      this.database = openApplicationDatabase(target);
      this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
      const inspection = this.engine === "mariadb"
        ? inspectMariaDatabase(this.database)
        : inspectDatabase(this.database);
      this.status = inspection.ready
        ? { ready: true, engine: this.engine, database: this.filename }
        : { ready: false, reason: inspection.problems.join("; "), engine: this.engine, database: this.filename };
    } catch (error) {
      this.status = {
        ready: false,
        reason: error instanceof Error ? error.message : String(error),
        engine: this.engine,
        database: this.filename,
      };
      this.database?.close();
      this.database = null;
    }
  }

  requireReady() {
    if (!this.database || !this.status.ready) throw new Error(`Slayer database unavailable: ${this.status.reason}`);
    return this.database;
  }

  close() {
    this.database?.close();
    this.database = null;
  }

  objects() {
    if (this.engine === "mariadb") {
      return this.requireReady().prepare(`
        SELECT CASE WHEN TABLE_TYPE = 'BASE TABLE' THEN 'table' ELSE 'view' END AS type,
               TABLE_NAME AS name, NULL AS \`sql\`
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY type, name
      `).all().map(serializable);
    }
    return this.requireReady().prepare(`
      SELECT type, name, sql FROM sqlite_schema
      WHERE type IN ('table', 'view')
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'activity_events_fts_%'
        AND name NOT LIKE 'files_fts_%'
      ORDER BY type, name
    `).all().map(serializable);
  }

  objectInfo(name, { writable = false } = {}) {
    identifier(name, "object");
    const object = this.objects().find((candidate) => candidate.name === name);
    if (!object) throw new Error(`Unknown database object: ${name}`);
    if (writable && (object.type !== "table" || !modelWritableTables.has(name) || /^CREATE VIRTUAL TABLE/i.test(object.sql))) {
      throw new Error(`Model writes are not permitted on ${name}`);
    }
    const columns = this.engine === "mariadb"
      ? this.requireReady().prepare(`
          SELECT ORDINAL_POSITION - 1 AS cid, COLUMN_NAME AS name, COLUMN_TYPE AS type,
                 CASE WHEN IS_NULLABLE = 'NO' THEN 1 ELSE 0 END AS notnull,
                 COLUMN_DEFAULT AS dflt_value,
                 CASE WHEN COLUMN_KEY = 'PRI' THEN 1 ELSE 0 END AS pk
          FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION
        `).all(name).map(serializable)
      : this.requireReady().prepare(`PRAGMA table_info(${identifier(name, "object")})`).all().map(serializable);
    const foreignKeys = this.engine === "mariadb"
      ? this.requireReady().prepare(`
          SELECT ORDINAL_POSITION - 1 AS id, POSITION_IN_UNIQUE_CONSTRAINT - 1 AS seq,
                 REFERENCED_TABLE_NAME AS \`table\`, COLUMN_NAME AS \`from\`,
                 REFERENCED_COLUMN_NAME AS \`to\`
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
          ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION
        `).all(name).map(serializable)
      : this.requireReady().prepare(`PRAGMA foreign_key_list(${identifier(name, "object")})`).all().map(serializable);
    return { ...object, writable: object.type === "table" && modelWritableTables.has(name), columns, foreignKeys };
  }

  quotedIdentifier(name, label) {
    identifier(name, label);
    return this.engine === "mariadb" ? `\`${name}\`` : `"${name}"`;
  }

  validateColumns(names, available) {
    const allowed = new Set(available.map((column) => column.name));
    for (const name of names) {
      identifier(name, "column");
      if (!allowed.has(name)) throw new Error(`Unknown column: ${name}`);
    }
  }

  buildWhere(where, columns) {
    const entries = Object.entries(where ?? {});
    this.validateColumns(entries.map(([column]) => column), columns);
    if (entries.length === 0) return { sql: "", values: [] };
    const clauses = [];
    const values = [];
    for (const [column, item] of entries) {
      if (item === null) clauses.push(`${this.quotedIdentifier(column, "column")} IS NULL`);
      else {
        clauses.push(`${this.quotedIdentifier(column, "column")} = ?`);
        values.push(normalizeValue(item));
      }
    }
    return { sql: ` WHERE ${clauses.join(" AND ")}`, values };
  }

  read({ objectName, columns = null, where = {}, orderBy = null, orderDirection = "asc", limit = 50, offset = 0 }) {
    const object = this.objectInfo(objectName);
    const selected = Array.isArray(columns) && columns.length ? columns : object.columns.map((column) => column.name);
    this.validateColumns(selected, object.columns);
    const condition = this.buildWhere(where, object.columns);
    let ordering = "";
    if (orderBy) {
      this.validateColumns([orderBy], object.columns);
      ordering = ` ORDER BY ${this.quotedIdentifier(orderBy, "column")} ${orderDirection === "desc" ? "DESC" : "ASC"}`;
    }
    const boundedLimit = Number(limit);
    if (!Number.isInteger(boundedLimit) || boundedLimit < 1 || boundedLimit > 200) {
      throw new Error("limit must be an integer from 1 to 200");
    }
    const boundedOffset = Number(offset);
    if (!Number.isSafeInteger(boundedOffset) || boundedOffset < 0 || boundedOffset > 1_000_000) {
      throw new Error("offset must be an integer from 0 to 1000000");
    }
    const sql = `SELECT ${selected.map((column) => this.quotedIdentifier(column, "column")).join(", ")} FROM ${this.quotedIdentifier(objectName, "object")}${condition.sql}${ordering} LIMIT ? OFFSET ?`;
    const fetched = this.requireReady().prepare(sql).all(...condition.values, boundedLimit + 1, boundedOffset).map(serializable);
    const hasMore = fetched.length > boundedLimit;
    const rows = fetched.slice(0, boundedLimit);
    return {
      objectName,
      sql,
      count: rows.length,
      limit: boundedLimit,
      offset: boundedOffset,
      hasMore,
      nextOffset: hasMore ? boundedOffset + rows.length : null,
      rows,
    };
  }

  write({ action, table, values = {}, where = {} }) {
    const object = this.objectInfo(table, { writable: true });
    const database = this.requireReady();
    let rows;
    database.exec("BEGIN IMMEDIATE");
    try {
      if (action === "insert") {
        const entries = Object.entries(values);
        if (entries.length === 0) throw new Error("Insert requires values");
        this.validateColumns(entries.map(([column]) => column), object.columns);
        const sql = `INSERT INTO ${this.quotedIdentifier(table, "table")} (${entries.map(([column]) => this.quotedIdentifier(column, "column")).join(", ")}) VALUES (${entries.map(() => "?").join(", ")}) RETURNING *`;
        rows = database.prepare(sql).all(...entries.map(([, value]) => normalizeValue(value)));
      } else {
        if (!where || Object.keys(where).length === 0) throw new Error(`${action} requires a nonempty where object`);
        const condition = this.buildWhere(where, object.columns);
        if (action === "update") {
          const entries = Object.entries(values);
          if (entries.length === 0) throw new Error("Update requires values");
          this.validateColumns(entries.map(([column]) => column), object.columns);
        const set = entries.map(([column]) => `${this.quotedIdentifier(column, "column")} = ?`).join(", ");
          rows = database.prepare(`UPDATE ${this.quotedIdentifier(table, "table")} SET ${set}${condition.sql} RETURNING *`)
            .all(...entries.map(([, value]) => normalizeValue(value)), ...condition.values);
        } else if (action === "delete") {
          rows = database.prepare(`DELETE FROM ${this.quotedIdentifier(table, "table")}${condition.sql} RETURNING *`).all(...condition.values);
        } else {
          throw new Error(`Unsupported database action: ${action}`);
        }
      }
      database.exec("COMMIT");
      return { action, table, affectedRows: rows.length, rows: rows.map(serializable) };
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
