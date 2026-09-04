import fs from "node:fs";

const migrationStart = /^-- migration (\d{4,}): ([a-z0-9][a-z0-9-]*)$/;
const migrationEnd = /^-- end migration (\d{4,})$/;

function executableSql(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/--[^\n]*/gu, "")
    .replace(/#[^\n]*/gu, "")
    .trim();
}

export function parseMigrationLedger(source, filename = "migration ledger") {
  const migrations = [];
  let current = null;

  for (const [index, rawLine] of String(source)
    .replace(/^\uFEFF/u, "")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .entries()) {
    const lineNumber = index + 1;
    const start = migrationStart.exec(rawLine);
    const end = migrationEnd.exec(rawLine);

    if (start) {
      if (current) {
        throw new Error(`${filename}:${lineNumber}: migration ${current.versionLabel} has no end marker`);
      }
      current = {
        version: Number.parseInt(start[1], 10),
        versionLabel: start[1],
        name: start[2],
        startLine: lineNumber,
        lines: [],
      };
      continue;
    }

    if (end) {
      if (!current) throw new Error(`${filename}:${lineNumber}: unexpected migration end marker`);
      if (end[1] !== current.versionLabel) {
        throw new Error(
          `${filename}:${lineNumber}: migration ${current.versionLabel} ends as ${end[1]}`,
        );
      }
      const sql = current.lines.join("\n").trim();
      if (!executableSql(sql)) {
        throw new Error(`${filename}:${current.startLine}: migration ${current.versionLabel} is empty`);
      }
      migrations.push({
        version: current.version,
        versionLabel: current.versionLabel,
        name: current.name,
        label: `${current.versionLabel}:${current.name}`,
        sql: `${sql}\n`,
      });
      current = null;
      continue;
    }

    if (current) {
      current.lines.push(rawLine);
      continue;
    }

    if (rawLine.trim() && !rawLine.startsWith("--")) {
      throw new Error(`${filename}:${lineNumber}: executable SQL appears outside a migration block`);
    }
  }

  if (current) {
    throw new Error(`${filename}:${current.startLine}: migration ${current.versionLabel} has no end marker`);
  }

  const versions = new Set();
  for (const [index, migration] of migrations.entries()) {
    if (versions.has(migration.version)) {
      throw new Error(`${filename} contains duplicate migration version ${migration.version}`);
    }
    versions.add(migration.version);
    if (index > 0 && migrations[index - 1].version <= migration.version) {
      throw new Error(`${filename} migrations must be ordered newest first`);
    }
  }

  return migrations.toSorted((left, right) => left.version - right.version);
}

export function readMigrationLedger(filename) {
  return parseMigrationLedger(fs.readFileSync(filename, "utf8"), filename);
}

export function validatePendingMigrations(migrations, currentVersion) {
  if (!Number.isInteger(currentVersion) || currentVersion < 1) {
    throw new Error(`Invalid current database schema version: ${currentVersion}`);
  }
  const latestVersion = migrations.at(-1)?.version;
  if (latestVersion != null && currentVersion > latestVersion) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than migration ledger version ${latestVersion}`,
    );
  }
  const pending = migrations.filter(({ version }) => version > currentVersion);
  let expectedVersion = currentVersion + 1;
  for (const migration of pending) {
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Database schema version ${currentVersion} requires pending migration ${expectedVersion}, found ${migration.version}`,
      );
    }
    expectedVersion += 1;
  }
  return pending;
}

export function splitMariaDbStatements(source, filename = "migration SQL") {
  const statements = [];
  let statement = "";
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  const text = String(source).replaceAll("\r\n", "\n");

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    statement += char;

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        statement += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\" && quote !== "`") {
        escaped = true;
      } else if (char === quote) {
        if (next === quote) {
          statement += next;
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if ((char === "-" && next === "-" && /\s/u.test(text[index + 2] ?? "")) || char === "#") {
      lineComment = true;
      continue;
    }
    if (char === "/" && next === "*") {
      statement += next;
      index += 1;
      blockComment = true;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === ";") {
      if (executableSql(statement)) statements.push(statement.trim());
      statement = "";
    }
  }

  if (quote) throw new Error(`${filename}: unterminated ${quote} quote`);
  if (blockComment) throw new Error(`${filename}: unterminated block comment`);
  if (executableSql(statement)) statements.push(statement.trim());
  if (statements.some((sql) => /^DELIMITER\b/imu.test(executableSql(sql)))) {
    throw new Error(`${filename}: DELIMITER and stored-program bodies are not supported`);
  }
  return statements;
}
