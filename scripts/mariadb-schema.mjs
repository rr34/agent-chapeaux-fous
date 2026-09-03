const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteMariaDbIdentifier(value) {
  if (!identifierPattern.test(value)) throw new Error(`Invalid MariaDB identifier: ${value}`);
  return `\`${value}\``;
}

export function parseMariaDbScript(source) {
  const statements = [];
  let delimiter = ";";
  let buffer = "";
  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    const directive = line.match(/^\s*DELIMITER\s+(\S+)\s*$/iu);
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

export function databaseConnectionFromEnvironment(environment = process.env, { database = null, test = false } = {}) {
  const prefix = test ? "SLAYER_TEST_DATABASE_" : "SLAYER_DATABASE_";
  const fallback = (name) => test ? environment[`SLAYER_DATABASE_${name}`] : undefined;
  const selectedDatabase = database ?? environment[`${prefix}NAME`]?.trim() ?? fallback("NAME")?.trim();
  const user = environment[`${prefix}USER`]?.trim() ?? fallback("USER")?.trim();
  const password = environment[`${prefix}PASSWORD`] ?? fallback("PASSWORD");
  if (!user || password == null) {
    throw new Error(`${prefix}USER and ${prefix}PASSWORD are required`);
  }
  if (selectedDatabase && !identifierPattern.test(selectedDatabase)) {
    throw new Error(`${prefix}NAME must be a valid MariaDB identifier`);
  }
  const port = Number(environment[`${prefix}PORT`] || fallback("PORT") || 3306);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${prefix}PORT must be an integer from 1 to 65535`);
  }
  return {
    host: environment[`${prefix}HOST`]?.trim() || fallback("HOST")?.trim() || "localhost",
    port,
    socketPath: environment[`${prefix}SOCKET`]?.trim() || fallback("SOCKET")?.trim() || undefined,
    user,
    password,
    ...(selectedDatabase ? { database: selectedDatabase } : {}),
  };
}
