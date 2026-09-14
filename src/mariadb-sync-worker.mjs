import { parentPort } from "node:worker_threads";
import { serialize } from "node:v8";
import mysql from "mysql2/promise";
import { mariaDbHybridSearch } from "./search/mariadb-search.mjs";
import { parseUpdateReturning } from "./mariadb-sql.mjs";

export function canonicalUtcDateTime(value) {
  if (value == null) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/u);
  if (!match) throw new Error(`MariaDB returned an invalid DATETIME value: ${String(value)}`);
  return `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
}

export function mariaDbUtcTypeCast(field, next) {
  if (!["DATETIME", "TIMESTAMP"].includes(field?.type)) return next();
  return canonicalUtcDateTime(field.string());
}

const utcInstantParameter = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u;
const instantColumn = /(?:^|\.)(?:[A-Za-z_][A-Za-z0-9_]*_at_utc|ask_after|resolved_at|routine_occurrence_key)$/iu;

function placeholderOffsets(sql) {
  const offsets = [];
  let quote = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote && sql[index + 1] === quote) index += 1;
      else if (character === quote && sql[index - 1] !== "\\") quote = null;
      continue;
    }
    if (["'", '"', "`"].includes(character)) quote = character;
    else if (character === "?") offsets.push(index);
  }
  return offsets;
}

function commaSeparatedExpressions(source, start, end) {
  const expressions = [];
  let depth = 0;
  let quote = null;
  let expressionStart = start;
  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index + 1] === quote) index += 1;
      else if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (["'", '"', "`"].includes(character)) quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      expressions.push([expressionStart, index]);
      expressionStart = index + 1;
    }
  }
  expressions.push([expressionStart, end]);
  return expressions;
}

function closingParenthesis(source, opening) {
  let depth = 0;
  let quote = null;
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index + 1] === quote) index += 1;
      else if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (["'", '"', "`"].includes(character)) quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")" && --depth === 0) return index;
  }
  return -1;
}

function insertInstantParameterIndexes(sql, offsets) {
  const marked = new Set();
  const match = /\bINSERT\s+(?:IGNORE\s+)?INTO\s+[`"A-Za-z_][`"A-Za-z0-9_]*\s*\(([^)]*)\)\s*VALUES\s*\(/iu.exec(sql);
  if (!match) return marked;
  const columns = match[1].split(",").map((column) => column.trim().replace(/[`"]/gu, ""));
  let opening = match.index + match[0].length - 1;
  while (opening >= 0) {
    const closing = closingParenthesis(sql, opening);
    if (closing < 0) return marked;
    const expressions = commaSeparatedExpressions(sql, opening + 1, closing);
    for (let index = 0; index < Math.min(columns.length, expressions.length); index += 1) {
      if (!instantColumn.test(columns[index])) continue;
      const [start, end] = expressions[index];
      offsets.forEach((offset, parameterIndex) => {
        if (offset >= start && offset < end) marked.add(parameterIndex);
      });
    }
    const nextTuple = /^\s*,\s*\(/u.exec(sql.slice(closing + 1));
    opening = nextTuple ? closing + 1 + nextTuple[0].lastIndexOf("(") : -1;
  }
  return marked;
}

export function normalizeMariaDbDateTimeParameters(sql, parameters) {
  const offsets = placeholderOffsets(sql);
  const marked = insertInstantParameterIndexes(sql, offsets);
  const sqlIdentifier = "[`\"]?[A-Za-z_][A-Za-z0-9_]*[`\"]?";
  const columnName = `(?:${sqlIdentifier}\\.)?[\`\"]?(?:[A-Za-z_][A-Za-z0-9_]*_at_utc|ask_after|resolved_at|routine_occurrence_key)[\`\"]?`;
  offsets.forEach((offset, parameterIndex) => {
    const before = sql.slice(Math.max(0, offset - 500), offset);
    const after = sql.slice(offset + 1, Math.min(sql.length, offset + 500));
    if (new RegExp(`${columnName}\\s*(?:=|<>|!=|<=|>=|<|>|BETWEEN)\\s*$`, "iu").test(before)
        || new RegExp(`${columnName}\\s+BETWEEN\\s+\\?[\\s\\S]*?\\bAND\\s*$`, "iu").test(before)
        || new RegExp(`${columnName}\\s*=\\s*(?:COALESCE|IFNULL)\\s*\\([^?]*$`, "iu").test(before)
        || new RegExp(`[A-Za-z_][A-Za-z0-9_]*\\s*\\([^)]*${columnName}[^)]*\\)\\s*(?:=|<>|!=|<=|>=|<|>)\\s*$`, "iu").test(before)
        || new RegExp(`^\\s*(?:=|<>|!=|<=|>=|<|>)\\s*${columnName}\\b`, "iu").test(after)) {
      marked.add(parameterIndex);
    }
  });
  return parameters.map((value, index) => {
    if (!marked.has(index) || typeof value !== "string" || !utcInstantParameter.test(value)) return value;
    return value.slice(0, -1).replace("T", " ");
  });
}

function plainRows(rows) {
  return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : rows;
}

function normalizeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error instanceof Error ? error.message : String(error),
    stack: error?.stack ?? null,
    code: error?.code ?? null,
    errno: error?.errno ?? null,
    sqlState: error?.sqlState ?? null,
  };
}

function connectionFailure(error) {
  return error?.fatal === true
    || ["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(error?.code)
    || /connection is in closed state|connection lost|can't write in closed state/iu.test(error?.message ?? "");
}

export function createMariaDbWorkerHandler({
  createConnection = (configuration) => mysql.createConnection(configuration),
  reportConnectionError = (message) => console.error(message),
} = {}) {
  let connection = null;
  let configuration = null;
  let transactionActive = false;
  const primaryKeys = new Map();

  function invalidateConnection(candidate, error = null) {
    if (connection !== candidate) return;
    connection = null;
    transactionActive = false;
    primaryKeys.clear();
    if (error) {
      reportConnectionError(
        `[agent-slayer] MariaDB connection closed; reconnecting on the next operation: ${error.message}`,
      );
    }
  }

  async function connect() {
    if (!configuration) throw new Error("MariaDB worker has no connection configuration");
    const candidate = await createConnection({
      ...configuration,
      charset: "utf8mb4",
      dateStrings: true,
      timezone: "Z",
      typeCast: mariaDbUtcTypeCast,
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalNumbers: true,
    });
    connection = candidate;
    candidate.on?.("error", (error) => invalidateConnection(candidate, error));
    try {
      await candidate.query("SET time_zone = '+00:00'");
      const [[modeRow]] = await candidate.query("SELECT @@SESSION.sql_mode AS sql_mode");
      const sqlModes = String(modeRow?.sql_mode ?? "").split(",").filter(Boolean);
      if (!sqlModes.includes("STRICT_ALL_TABLES") && !sqlModes.includes("STRICT_TRANS_TABLES")) {
        sqlModes.push("STRICT_TRANS_TABLES");
        await candidate.query("SET SESSION sql_mode = ?", [sqlModes.join(",")]);
      }
      const [[versionRow]] = await candidate.query("SELECT VERSION() AS version");
      return { version: versionRow.version };
    } catch (error) {
      invalidateConnection(candidate);
      await candidate.end().catch(() => {});
      throw error;
    }
  }

  async function activeConnection() {
    if (!connection) await connect();
    return connection;
  }

  async function tablePrimaryKey(table, current) {
    if (primaryKeys.has(table)) return primaryKeys.get(table);
    const [rows] = await current.execute(
      `SELECT COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION`,
      [table],
    );
    const columns = rows.map(({ COLUMN_NAME }) => COLUMN_NAME);
    primaryKeys.set(table, columns);
    return columns;
  }

  async function updateReturning(parsed, parameters) {
    const current = await activeConnection();
    const primaryKey = await tablePrimaryKey(parsed.table, current);
    if (primaryKey.length !== 1) {
      throw new Error(`UPDATE RETURNING emulation requires one primary-key column on ${parsed.table}`);
    }
    const key = primaryKey[0];
    const whereParameters = parameters.slice(parsed.setParameterCount);
    const ownsTransaction = !transactionActive;
    if (ownsTransaction) await current.beginTransaction();
    try {
      const [targets] = await current.execute(
        `SELECT \`${key}\` FROM \`${parsed.table}\` WHERE ${parsed.whereSql} FOR UPDATE`,
        whereParameters,
      );
      if (!targets.length) {
        if (ownsTransaction) await current.commit();
        return { rows: [], result: { affectedRows: 0, insertId: 0 } };
      }
      const [result] = await current.execute(
        `UPDATE \`${parsed.table}\` SET ${parsed.setSql} WHERE ${parsed.whereSql}`,
        parameters,
      );
      const ids = targets.map((row) => row[key]);
      const [rows] = await current.execute(
        `SELECT ${parsed.returningSql} FROM \`${parsed.table}\` WHERE \`${key}\` IN (${ids.map(() => "?").join(", ")})`,
        ids,
      );
      if (ownsTransaction) await current.commit();
      return { rows: plainRows(rows), result };
    } catch (error) {
      if (ownsTransaction && connection === current) await current.rollback();
      throw error;
    }
  }

  async function prepared({ mode, sql, parameters }) {
    parameters = normalizeMariaDbDateTimeParameters(sql, parameters);
    const update = parseUpdateReturning(sql);
    if (update) {
      const outcome = await updateReturning(update, parameters);
      if (mode === "all") return outcome.rows;
      if (mode === "get") return outcome.rows[0];
      return { changes: outcome.result.affectedRows, lastInsertRowid: outcome.result.insertId ?? 0 };
    }
    const current = await activeConnection();
    const [result] = await current.execute(sql, parameters);
    if (Array.isArray(result)) {
      const rows = plainRows(result);
      if (mode === "all") return rows;
      if (mode === "get") return rows[0];
      return { changes: rows.length, lastInsertRowid: 0 };
    }
    if (mode === "all") return [];
    if (mode === "get") return undefined;
    return { changes: result.affectedRows ?? 0, lastInsertRowid: result.insertId ?? 0 };
  }

  return async function handle(request) {
    if (request.type === "init") {
      configuration = { ...request.configuration };
      return connect();
    }
    if (request.type === "close") {
      const current = connection;
      connection = null;
      transactionActive = false;
      primaryKeys.clear();
      if (current) await current.end();
      return true;
    }
    const current = await activeConnection();
    try {
      if (request.type === "exec") {
        await current.query(request.sql);
        if (/^START\s+TRANSACTION\b/iu.test(request.sql)) transactionActive = true;
        else if (/^(COMMIT|ROLLBACK)\b/iu.test(request.sql)) transactionActive = false;
        return true;
      }
      if (request.type === "prepared") return await prepared(request);
      if (request.type === "hybridSearch") {
        return await mariaDbHybridSearch({ connection: current, ...request.options });
      }
      throw new Error(`Unknown MariaDB worker operation: ${request.type}`);
    } catch (error) {
      if (connectionFailure(error)) invalidateConnection(current, error);
      throw error;
    }
  };
}

const handle = createMariaDbWorkerHandler();

parentPort?.on("message", async ({ request, controlBuffer, responseBuffer }) => {
  const control = new Int32Array(controlBuffer);
  let envelope;
  try {
    envelope = { ok: true, value: await handle(request) };
  } catch (error) {
    envelope = { ok: false, error: normalizeError(error) };
  }
  let bytes = serialize(envelope);
  if (bytes.length > responseBuffer.byteLength) {
    bytes = serialize({
      ok: false,
      error: normalizeError(new Error(
        `MariaDB response exceeded the synchronous bridge limit (${bytes.length} > ${responseBuffer.byteLength} bytes)`,
      )),
    });
  }
  new Uint8Array(responseBuffer, 0, bytes.length).set(bytes);
  Atomics.store(control, 1, bytes.length);
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0, 1);
});
