import crypto from "node:crypto";
import fs from "node:fs";

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteMariaDbIdentifier(value) {
  if (!identifierPattern.test(value)) throw new Error(`Invalid MariaDB identifier: ${value}`);
  return `\`${value}\``;
}

export function quoteSqliteIdentifier(value) {
  if (!identifierPattern.test(value)) throw new Error(`Invalid SQLite identifier: ${value}`);
  return `"${value}"`;
}

export function assertMigrationTarget(databaseName, { allowLive = false } = {}) {
  if (!identifierPattern.test(databaseName)) throw new Error(`Invalid MariaDB database name: ${databaseName}`);
  if (!allowLive && !databaseName.endsWith("_rehearsal")) {
    throw new Error(
      `Refusing non-rehearsal database ${databaseName}. Use --allow-live only for the deliberate cutover.`,
    );
  }
  return databaseName;
}

export function parseMariaDbScript(source) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    const directive = line.match(/^\s*DELIMITER\s+(\S+)\s*$/i);
    if (directive) {
      if (buffer.trim()) throw new Error("DELIMITER changed in the middle of a SQL statement");
      delimiter = directive[1];
      continue;
    }
    buffer += `${line}\n`;
    const trimmed = buffer.trimEnd();
    if (!trimmed.endsWith(delimiter)) continue;
    const statement = trimmed.slice(0, -delimiter.length).trim();
    if (statement) statements.push(statement);
    buffer = "";
  }
  if (buffer.trim()) throw new Error("MariaDB schema ends with an unterminated SQL statement");
  return statements;
}

export function readApplicationTables(semanticFormFilename) {
  const form = JSON.parse(fs.readFileSync(semanticFormFilename, "utf8"));
  return Object.entries(form.schemaObjects)
    .filter(([, object]) => (
      object.mechanics?.present
      && object.mechanics?.kind === "table"
      && !/^\s*CREATE\s+VIRTUAL\s+TABLE\b/iu.test(object.mechanics.definition ?? "")
    ))
    .map(([name]) => name)
    .sort();
}

export function sqliteTableShape(database, tableName) {
  const columns = database.prepare(`PRAGMA table_info(${quoteSqliteIdentifier(tableName)})`).all();
  if (!columns.length) throw new Error(`SQLite source table is missing: ${tableName}`);
  return {
    columns: columns.map(({ name }) => name),
    primaryKey: columns
      .filter(({ pk }) => pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map(({ name }) => name),
  };
}

function hashValue(hash, value) {
  if (value === null) {
    hash.update("n;");
    return;
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buffer = Buffer.from(value);
    hash.update(`b${buffer.length}:`);
    hash.update(buffer);
    hash.update(";");
    return;
  }
  const normalized = typeof value === "bigint" ? value.toString() : String(value);
  // MariaDB drivers may return BIGINT values as strings while node:sqlite
  // returns the same safe value as a number. Column order supplies the type
  // context, so hash their canonical text identically across both engines.
  hash.update(`v${Buffer.byteLength(normalized)}:`);
  hash.update(normalized);
  hash.update(";");
}

export function hashRows(rows, columns, hash = crypto.createHash("sha256")) {
  for (const row of rows) {
    hash.update("r{");
    for (const column of columns) hashValue(hash, row[column]);
    hash.update("}");
  }
  return hash;
}

function estimateRowBytes(row) {
  let total = 0;
  for (const value of Object.values(row)) {
    if (value === null) total += 4;
    else if (Buffer.isBuffer(value) || value instanceof Uint8Array) total += value.byteLength;
    else total += Buffer.byteLength(String(value));
  }
  return total;
}

export function chunkRows(rows, { maximumRows = 100, maximumBytes = 2 * 1024 * 1024 } = {}) {
  const chunks = [];
  let chunk = [];
  let bytes = 0;
  for (const row of rows) {
    const rowBytes = estimateRowBytes(row);
    if (chunk.length && (chunk.length >= maximumRows || bytes + rowBytes > maximumBytes)) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
    }
    chunk.push(row);
    bytes += rowBytes;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export async function assertEmptyMariaDbDatabase(connection, databaseName) {
  const [rows] = await connection.execute(
    `SELECT TABLE_NAME AS object_name, TABLE_TYPE AS object_type
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME`,
    [databaseName],
  );
  if (rows.length) {
    throw new Error(
      `MariaDB database ${databaseName} is not empty (${rows.length} table/view objects found). `
      + "The rehearsal importer never overwrites an existing database.",
    );
  }
}

export async function inspectMariaDbServer(connection, databaseName) {
  const [[server]] = await connection.query("SELECT VERSION() AS version, DATABASE() AS database_name");
  const [[schema]] = await connection.execute(
    `SELECT DEFAULT_CHARACTER_SET_NAME AS character_set, DEFAULT_COLLATION_NAME AS collation
       FROM information_schema.SCHEMATA
      WHERE SCHEMA_NAME = ?`,
    [databaseName],
  );
  if (!schema) throw new Error(`MariaDB database does not exist: ${databaseName}`);
  if (server.database_name !== databaseName) {
    throw new Error(`Connected to ${server.database_name ?? "no database"}, expected ${databaseName}`);
  }
  if (schema.character_set !== "utf8mb4") {
    throw new Error(
      `MariaDB database ${databaseName} uses ${schema.character_set}/${schema.collation}; expected utf8mb4.`,
    );
  }
  return { version: server.version, databaseName, ...schema };
}

export async function applyMariaDbSchema(connection, schemaSource) {
  const deferredTriggers = [];
  let applied = 0;
  for (const statement of parseMariaDbScript(schemaSource)) {
    if (/^CREATE\s+TRIGGER\b/iu.test(statement)) {
      deferredTriggers.push(statement);
      continue;
    }
    if (/^INSERT\s+INTO\s+database_meta\b/iu.test(statement)) continue;
    await connection.query(statement);
    applied += 1;
  }
  return { applied, deferredTriggers };
}

export async function importSqliteTable({ sqlite, maria, tableName, batchSize = 500 }) {
  const shape = sqliteTableShape(sqlite, tableName);
  const sqliteColumns = shape.columns.map(quoteSqliteIdentifier).join(", ");
  const mariaColumns = shape.columns.map(quoteMariaDbIdentifier).join(", ");
  const orderColumns = (shape.primaryKey.length ? shape.primaryKey : shape.columns).map(quoteSqliteIdentifier).join(", ");
  const select = sqlite.prepare(
    `SELECT ${sqliteColumns} FROM ${quoteSqliteIdentifier(tableName)} ORDER BY ${orderColumns} LIMIT ? OFFSET ?`,
  );
  let offset = 0;
  let count = 0;
  const sourceHash = crypto.createHash("sha256");
  while (true) {
    const rows = select.all(batchSize, offset);
    if (!rows.length) break;
    hashRows(rows, shape.columns, sourceHash);
    for (const chunk of chunkRows(rows)) {
      const placeholders = chunk.map(() => `(${shape.columns.map(() => "?").join(", ")})`).join(", ");
      const values = chunk.flatMap((row) => shape.columns.map((column) => row[column]));
      await maria.execute(
        `INSERT INTO ${quoteMariaDbIdentifier(tableName)} (${mariaColumns}) VALUES ${placeholders}`,
        values,
      );
    }
    count += rows.length;
    offset += rows.length;
  }
  return { tableName, columns: shape.columns, primaryKey: shape.primaryKey, count, sourceDigest: sourceHash.digest("hex") };
}

export async function digestMariaDbTable(connection, table) {
  const columns = table.columns.map(quoteMariaDbIdentifier).join(", ");
  const order = (table.primaryKey.length ? table.primaryKey : table.columns).map(quoteMariaDbIdentifier).join(", ");
  const [rows] = await connection.query(
    `SELECT ${columns} FROM ${quoteMariaDbIdentifier(table.tableName)} ORDER BY ${order}`,
  );
  return {
    count: rows.length,
    digest: hashRows(rows, table.columns).digest("hex"),
  };
}

export async function findForeignKeyViolations(connection, databaseName) {
  const [rows] = await connection.execute(
    `SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME,
            REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, ORDINAL_POSITION
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
    [databaseName],
  );
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.TABLE_NAME}\u0000${row.CONSTRAINT_NAME}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const violations = [];
  for (const parts of groups.values()) {
    const [{ TABLE_NAME: child, REFERENCED_TABLE_NAME: parent, CONSTRAINT_NAME: constraint }] = parts;
    const join = parts.map(({ COLUMN_NAME, REFERENCED_COLUMN_NAME }) => (
      `child.${quoteMariaDbIdentifier(COLUMN_NAME)} = parent.${quoteMariaDbIdentifier(REFERENCED_COLUMN_NAME)}`
    )).join(" AND ");
    const populated = parts.map(({ COLUMN_NAME }) => `child.${quoteMariaDbIdentifier(COLUMN_NAME)} IS NOT NULL`).join(" AND ");
    const missing = parts.map(({ REFERENCED_COLUMN_NAME }) => `parent.${quoteMariaDbIdentifier(REFERENCED_COLUMN_NAME)} IS NULL`).join(" AND ");
    const [[result]] = await connection.query(
      `SELECT COUNT(*) AS violation_count
         FROM ${quoteMariaDbIdentifier(child)} AS child
         LEFT JOIN ${quoteMariaDbIdentifier(parent)} AS parent ON ${join}
        WHERE ${populated} AND ${missing}`,
    );
    const count = Number(result.violation_count);
    if (count) violations.push({ constraint, child, parent, count });
  }
  return violations;
}
