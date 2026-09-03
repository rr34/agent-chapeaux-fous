import { parentPort } from "node:worker_threads";
import { serialize } from "node:v8";
import mysql from "mysql2/promise";
import { mariaDbHybridSearch } from "./search/mariadb-search.mjs";
import { parseUpdateReturning, translateSqliteSql } from "./mariadb-sql.mjs";

let connection = null;
let transactionActive = false;
const primaryKeys = new Map();

function plainRows(rows) {
  return Array.isArray(rows) ? rows.map((row) => ({ ...row })) : rows;
}

async function tablePrimaryKey(table) {
  if (primaryKeys.has(table)) return primaryKeys.get(table);
  const [rows] = await connection.execute(
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
  const primaryKey = await tablePrimaryKey(parsed.table);
  if (primaryKey.length !== 1) {
    throw new Error(`UPDATE RETURNING emulation requires one primary-key column on ${parsed.table}`);
  }
  const key = primaryKey[0];
  const whereParameters = parameters.slice(parsed.setParameterCount);
  const ownsTransaction = !transactionActive;
  if (ownsTransaction) await connection.beginTransaction();
  try {
    const [targets] = await connection.execute(
      `SELECT \`${key}\` FROM \`${parsed.table}\` WHERE ${parsed.whereSql} FOR UPDATE`,
      whereParameters,
    );
    if (!targets.length) {
      if (ownsTransaction) await connection.commit();
      return { rows: [], result: { affectedRows: 0, insertId: 0 } };
    }
    const [result] = await connection.execute(
      `UPDATE \`${parsed.table}\` SET ${parsed.setSql} WHERE ${parsed.whereSql}`,
      parameters,
    );
    const ids = targets.map((row) => row[key]);
    const [rows] = await connection.execute(
      `SELECT ${parsed.returningSql} FROM \`${parsed.table}\` WHERE \`${key}\` IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
    if (ownsTransaction) await connection.commit();
    return { rows: plainRows(rows), result };
  } catch (error) {
    if (ownsTransaction) await connection.rollback();
    throw error;
  }
}

function normalizeError(error) {
  let message = error instanceof Error ? error.message : String(error);
  if (error?.code === "ER_DUP_ENTRY") {
    const key = /for key ['`]?([^'`]+)['`]?/iu.exec(message)?.[1] ?? "";
    if (key.includes("contact_methods")) message = `UNIQUE constraint failed: contact_methods (${message})`;
    else if (key.includes("trackers_name")) message = `UNIQUE constraint failed: trackers.name (${message})`;
  }
  return {
    name: error?.name ?? "Error",
    message,
    stack: error?.stack ?? null,
    code: error?.code ? "ERR_SQLITE_ERROR" : null,
    mariaDbCode: error?.code ?? null,
    errno: error?.errno ?? null,
    sqlState: error?.sqlState ?? null,
  };
}

async function prepared({ mode, sql, parameters }) {
  const translated = translateSqliteSql(sql);
  if (translated === null) return mode === "run" ? { changes: 0, lastInsertRowid: 0 } : mode === "all" ? [] : undefined;
  const update = parseUpdateReturning(translated);
  if (update) {
    const outcome = await updateReturning(update, parameters);
    if (mode === "all") return outcome.rows;
    if (mode === "get") return outcome.rows[0];
    return { changes: outcome.result.affectedRows, lastInsertRowid: outcome.result.insertId ?? 0 };
  }
  const [result] = await connection.execute(translated, parameters);
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

async function handle(request) {
  if (request.type === "init") {
    connection = await mysql.createConnection({
      ...request.configuration,
      charset: "utf8mb4",
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      decimalNumbers: true,
    });
    await connection.query("SET time_zone = '+00:00'");
    return { version: (await connection.query("SELECT VERSION() AS version"))[0][0].version };
  }
  if (!connection) throw new Error("MariaDB worker is not connected");
  if (request.type === "close") {
    await connection.end();
    connection = null;
    return true;
  }
  if (request.type === "exec") {
    const translated = translateSqliteSql(request.sql);
    if (translated !== null) {
      await connection.query(translated);
      if (/^START\s+TRANSACTION\b/iu.test(translated)) transactionActive = true;
      else if (/^(COMMIT|ROLLBACK)\b/iu.test(translated)) transactionActive = false;
    }
    return true;
  }
  if (request.type === "prepared") return prepared(request);
  if (request.type === "hybridSearch") return mariaDbHybridSearch({ connection, ...request.options });
  throw new Error(`Unknown MariaDB worker operation: ${request.type}`);
}

parentPort.on("message", async ({ request, controlBuffer, responseBuffer }) => {
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
