import fs from "node:fs";

const migrationStart = /^-- migration (\d{4,}): ([a-z0-9][a-z0-9-]*)$/;
const migrationEnd = /^-- end migration (\d{4,})$/;

export function parseMigrationLedger(source, filename = "migration ledger") {
  const migrations = [];
  let current = null;

  for (const [index, line] of String(source).replaceAll("\r\n", "\n").split("\n").entries()) {
    const lineNumber = index + 1;
    const start = migrationStart.exec(line);
    const end = migrationEnd.exec(line);

    if (start) {
      if (current) {
        throw new Error(`${filename}:${lineNumber}: migration ${current.label} has no end marker`);
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
      if (!sql) throw new Error(`${filename}:${current.startLine}: migration ${current.versionLabel} is empty`);
      migrations.push({
        version: current.version,
        name: current.name,
        label: `${current.versionLabel}:${current.name}`,
        sql: `${sql}\n`,
      });
      current = null;
      continue;
    }

    if (current) {
      current.lines.push(line);
      continue;
    }

    if (line.trim() && !line.startsWith("--")) {
      throw new Error(`${filename}:${lineNumber}: SQL appears outside a migration block`);
    }
  }

  if (current) throw new Error(`${filename}:${current.startLine}: migration ${current.versionLabel} has no end marker`);
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
