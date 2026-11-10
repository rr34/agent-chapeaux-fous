import { createHash } from "node:crypto";
import fs from "node:fs";
import { agentPersonTables, personDataTablePrefix } from "../src/person-isolation.mjs";
import { baselineFilename } from "./agent-schema.mjs";
import { parseMariaDbScript } from "./mariadb-schema.mjs";

function quote(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new Error(`Unsafe MariaDB identifier: ${name}`);
  return `\`${name}\``;
}

function indexColumns(rows, { withPerson = false } = {}) {
  const columns = rows.map((row) => {
    const name = quote(row.COLUMN_NAME);
    const length = row.SUB_PART == null ? "" : `(${Number(row.SUB_PART)})`;
    const direction = row.COLLATION === "D" ? " DESC" : "";
    return `${name}${length}${direction}`;
  });
  return [...(withPerson ? ["`person_id`"] : []), ...columns].join(", ");
}

function grouped(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const value = key(row);
    if (!result.has(value)) result.set(value, []);
    result.get(value).push(row);
  }
  return result;
}

export function canonicalSchema69Artifacts() {
  const statements = parseMariaDbScript(fs.readFileSync(baselineFilename, "utf8"));
  const foreignKeys = [];
  const derivedViews = [];
  for (const statement of statements) {
    const table = statement.match(/\bCREATE\s+TABLE\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/iu)?.[1];
    if (table && agentPersonTables.includes(table)) {
      const pattern = /CONSTRAINT\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s+FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\(([^)]+)\)([^,;\n]*)/giu;
      for (const match of statement.matchAll(pattern)) {
        const childColumns = match[2].split(",").map((value) => value.trim().replaceAll("`", ""));
        const parentColumns = match[4].split(",").map((value) => value.trim().replaceAll("`", ""));
        const updateRule = match[5].match(/\bON\s+UPDATE\s+(RESTRICT|CASCADE|SET NULL|NO ACTION)/iu)?.[1]?.toUpperCase() ?? "RESTRICT";
        const deleteRule = match[5].match(/\bON\s+DELETE\s+(RESTRICT|CASCADE|SET NULL|NO ACTION)/iu)?.[1]?.toUpperCase() ?? "RESTRICT";
        foreignKeys.push(childColumns.map((column, index) => ({
          TABLE_NAME: table,
          CONSTRAINT_NAME: match[1],
          COLUMN_NAME: column,
          ORDINAL_POSITION: index + 1,
          REFERENCED_TABLE_NAME: match[3],
          REFERENCED_COLUMN_NAME: parentColumns[index],
          UPDATE_RULE: updateRule,
          DELETE_RULE: deleteRule,
        })));
      }
    }
    const view = statement.match(/\bCREATE(?:\s+OR\s+REPLACE)?[\s\S]*?\bVIEW\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s+AS\b/iu)?.[1];
    if (view && !agentPersonTables.includes(view)) derivedViews.push({ name: view, sql: statement });
  }
  if (foreignKeys.length !== 68 || derivedViews.length !== 9) {
    throw new Error(`Could not reconstruct schema-69 artifacts: found ${foreignKeys.length} foreign keys and ${derivedViews.length} views`);
  }
  return { foreignKeys, derivedViews };
}

async function removePartialForeignKeys(connection, databaseName, canonicalForeignKeys) {
  const currentRows = await queryRows(connection, `
    SELECT TABLE_NAME, CONSTRAINT_NAME
      FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME LIKE 'person\\_data\\_%'
  `, [databaseName]);
  for (const row of currentRows) {
    await connection.query(`ALTER TABLE ${quote(row.TABLE_NAME)} DROP FOREIGN KEY ${quote(row.CONSTRAINT_NAME)}`);
  }

  const constraintNames = new Set(canonicalForeignKeys.map((rows) => rows[0].CONSTRAINT_NAME));
  const indexRows = await queryRows(connection, `
    SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, SEQ_IN_INDEX
      FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 'person\\_data\\_%'
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
  `, [databaseName]);
  for (const rows of grouped(indexRows, (row) => `${row.TABLE_NAME}\0${row.INDEX_NAME}`).values()) {
    const partialAutomaticIndex = constraintNames.has(rows[0].INDEX_NAME)
      && rows[0].COLUMN_NAME === "person_id";
    if (partialAutomaticIndex || rows[0].INDEX_NAME.startsWith("t3_fk_")) {
      await connection.query(`ALTER TABLE ${quote(rows[0].TABLE_NAME)} DROP INDEX ${quote(rows[0].INDEX_NAME)}`);
    }
  }

  const validationTriggers = await queryRows(connection, `
    SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = ? AND TRIGGER_NAME LIKE 't3\\_ref\\_%'
  `, [databaseName]);
  for (const row of validationTriggers) await connection.query(`DROP TRIGGER ${quote(row.TRIGGER_NAME)}`);

  const ownerColumns = await queryRows(connection, `
    SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 'person\\_data\\_%'
       AND COLUMN_NAME LIKE 't3\\_ref\\_owner\\_%'
     ORDER BY TABLE_NAME, COLUMN_NAME
  `, [databaseName]);
  for (const row of ownerColumns) {
    await connection.query(`ALTER TABLE ${quote(row.TABLE_NAME)} DROP COLUMN ${quote(row.COLUMN_NAME)}`);
  }
}

function portableViewDefinition(sql) {
  return sql.replace(/\s+DEFINER=`[^`]+`@`[^`]+`/iu, "");
}

function boundedName(prefix, ...parts) {
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
  return `${prefix}_${digest}`;
}

function referenceOwnerColumn(table, constraint) {
  return boundedName("t3_ref_owner", table, constraint);
}

function referenceOwnerTriggerSql({ event, table, constraint, childColumns }) {
  const timing = event === "INSERT" ? "insert" : "update";
  const ownershipTrigger = `t3_person_${timing}_${table}`.slice(0, 64);
  const triggerName = boundedName(event === "INSERT" ? "t3_ref_bi" : "t3_ref_bu", table, constraint);
  const completeReference = childColumns.map((column) => `NEW.${quote(column)} IS NOT NULL`).join(" AND ");
  const ownerColumn = referenceOwnerColumn(table, constraint);
  return `CREATE TRIGGER ${quote(triggerName)}
    BEFORE ${event} ON ${quote(`${personDataTablePrefix}${table}`)} FOR EACH ROW
    FOLLOWS ${quote(ownershipTrigger)}
    SET NEW.${quote(ownerColumn)} = IF(${completeReference}, NEW.person_id, NULL)`;
}

export function personIsolationForeignKeyStatements(rows, { initialPersonId = 1 } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Foreign-key metadata is required");
  const personId = Number(initialPersonId);
  if (!Number.isSafeInteger(personId) || personId < 1) throw new Error("Initial person ID must be a positive safe integer");
  const first = rows[0];
  const childColumnNames = rows.map((row) => row.COLUMN_NAME);
  const parentColumnNames = rows.map((row) => row.REFERENCED_COLUMN_NAME);
  const childColumns = childColumnNames.map(quote).join(", ");
  const parentColumns = parentColumnNames.map(quote).join(", ");
  const childTable = quote(`${personDataTablePrefix}${first.TABLE_NAME}`);
  const parentTable = quote(`${personDataTablePrefix}${first.REFERENCED_TABLE_NAME}`);
  const nullableAction = first.UPDATE_RULE === "SET NULL" || first.DELETE_RULE === "SET NULL";
  if (nullableAction) {
    const ownerColumnName = referenceOwnerColumn(first.TABLE_NAME, first.CONSTRAINT_NAME);
    const ownerColumn = quote(ownerColumnName);
    const indexName = boundedName("t3_fk", first.TABLE_NAME, first.CONSTRAINT_NAME);
    return [
      `ALTER TABLE ${childTable}
        ADD COLUMN ${ownerColumn} BIGINT UNSIGNED NULL DEFAULT ${personId}
          COMMENT 'Internal nullable owner used to scope ${first.CONSTRAINT_NAME} without changing the row owner.'`,
      referenceOwnerTriggerSql({
        event: "INSERT", table: first.TABLE_NAME, constraint: first.CONSTRAINT_NAME,
        childColumns: childColumnNames,
      }),
      referenceOwnerTriggerSql({
        event: "UPDATE", table: first.TABLE_NAME, constraint: first.CONSTRAINT_NAME,
        childColumns: childColumnNames,
      }),
      `ALTER TABLE ${childTable}
        ADD KEY ${quote(indexName)} (${ownerColumn}, ${childColumns})`,
      `ALTER TABLE ${childTable}
        ADD CONSTRAINT ${quote(first.CONSTRAINT_NAME)}
        FOREIGN KEY (${ownerColumn}, ${childColumns})
        REFERENCES ${parentTable} (person_id, ${parentColumns})
        ON UPDATE ${first.UPDATE_RULE} ON DELETE ${first.DELETE_RULE}`,
    ];
  }
  const indexName = boundedName("t3_fk", first.TABLE_NAME, first.CONSTRAINT_NAME);
  return [
    `ALTER TABLE ${childTable}
      ADD KEY ${quote(indexName)} (person_id, ${childColumns})`,
    `ALTER TABLE ${childTable}
      ADD CONSTRAINT ${quote(first.CONSTRAINT_NAME)}
      FOREIGN KEY (person_id, ${childColumns})
      REFERENCES ${parentTable} (person_id, ${parentColumns})
      ON UPDATE ${first.UPDATE_RULE} ON DELETE ${first.DELETE_RULE}`,
  ];
}

async function queryRows(connection, sql, parameters = []) {
  const [rows] = await connection.query(sql, parameters);
  return rows;
}

async function installPersonForeignKeys(connection, foreignKeys, initialPersonId) {
  const expected = new Set(agentPersonTables);
  for (const rows of foreignKeys) {
    const first = rows[0];
    if (!expected.has(first.TABLE_NAME) || !expected.has(first.REFERENCED_TABLE_NAME)) {
      throw new Error(`Unexpected schema-69 foreign key ${first.CONSTRAINT_NAME}`);
    }
    // SET NULL cannot include the row's non-null owner column. It uses a
    // hidden nullable owner shadow in its composite key; all other
    // relationships use the row owner directly.
    for (const statement of personIsolationForeignKeyStatements(rows, { initialPersonId })) {
      await connection.query(statement);
    }
  }
}

export async function applyPersonIsolationMigration(connection, databaseName, {
  initialPersonId = 1,
  output = process.stdout,
} = {}) {
  const personId = Number(initialPersonId);
  if (!Number.isSafeInteger(personId) || personId < 1) {
    throw new Error("SLAYER_LEGACY_PERSON_ID must be a positive safe integer");
  }
  const objects = await queryRows(connection, `
    SELECT TABLE_NAME, TABLE_TYPE
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?
  `, [databaseName]);
  const types = new Map(objects.map((row) => [row.TABLE_NAME, row.TABLE_TYPE]));
  const completed = agentPersonTables.every((name) => (
    types.get(name) === "VIEW" && types.get(`${personDataTablePrefix}${name}`) === "BASE TABLE"
  ));
  if (completed) {
    output.write("Detected a partially committed schema-70 conversion; rebuilding its foreign keys and derived views in place.\n");
    const canonical = canonicalSchema69Artifacts();
    await removePartialForeignKeys(connection, databaseName, canonical.foreignKeys);
    await installPersonForeignKeys(connection, canonical.foreignKeys, personId);
    const existingDerivedViews = canonical.derivedViews
      .map(({ name }) => name)
      .filter((name) => types.get(name) === "VIEW");
    if (existingDerivedViews.length) {
      await connection.query(`DROP VIEW ${existingDerivedViews.map(quote).join(", ")}`);
    }
    for (const view of canonical.derivedViews) await connection.query(view.sql);
    output.write("Repaired the partial schema-70 conversion in place.\n");
    return;
  }
  const missing = agentPersonTables.filter((name) => types.get(name) !== "BASE TABLE");
  if (missing.length) {
    throw new Error(`Schema 70 requires intact schema-69 base tables; missing: ${missing.join(", ")}`);
  }

  const viewNames = objects.filter((row) => row.TABLE_TYPE === "VIEW").map((row) => row.TABLE_NAME);
  const viewDefinitions = [];
  for (const name of viewNames) {
    const rows = await queryRows(connection, `SHOW CREATE VIEW ${quote(name)}`);
    viewDefinitions.push({ name, sql: portableViewDefinition(rows[0]?.["Create View"] ?? "") });
  }
  if (viewDefinitions.some(({ sql }) => !sql)) throw new Error("Could not capture every schema-69 view definition");

  const foreignKeyRows = await queryRows(connection, `
    SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
           k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
           r.UPDATE_RULE, r.DELETE_RULE
      FROM information_schema.KEY_COLUMN_USAGE k
      JOIN information_schema.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
       AND r.TABLE_NAME = k.TABLE_NAME
       AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.CONSTRAINT_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION
  `, [databaseName]);
  const foreignKeys = [...grouped(foreignKeyRows, (row) => `${row.TABLE_NAME}\0${row.CONSTRAINT_NAME}`).values()];

  const uniqueRows = await queryRows(connection, `
    SELECT s.TABLE_NAME, s.INDEX_NAME, s.COLUMN_NAME, s.SEQ_IN_INDEX, s.SUB_PART, s.COLLATION,
           c.EXTRA
      FROM information_schema.STATISTICS s
      JOIN information_schema.COLUMNS c
        ON c.TABLE_SCHEMA = s.TABLE_SCHEMA AND c.TABLE_NAME = s.TABLE_NAME
       AND c.COLUMN_NAME = s.COLUMN_NAME
     WHERE s.TABLE_SCHEMA = ? AND s.NON_UNIQUE = 0 AND s.TABLE_NAME <> 'database_meta'
     ORDER BY s.TABLE_NAME, s.INDEX_NAME, s.SEQ_IN_INDEX
  `, [databaseName]);
  const uniqueIndexes = [...grouped(uniqueRows, (row) => `${row.TABLE_NAME}\0${row.INDEX_NAME}`).values()];

  if (viewNames.length) await connection.query(`DROP VIEW ${viewNames.map(quote).join(", ")}`);
  for (const rows of foreignKeys) {
    await connection.query(`ALTER TABLE ${quote(rows[0].TABLE_NAME)} DROP FOREIGN KEY ${quote(rows[0].CONSTRAINT_NAME)}`);
  }

  for (const table of agentPersonTables) {
    const indexName = `t3_person_${table}`.slice(0, 64);
    await connection.query(`ALTER TABLE ${quote(table)}
      ADD COLUMN person_id BIGINT UNSIGNED NOT NULL DEFAULT ${personId}
        COMMENT 'Time v3 person that directly owns this private Agent row.',
      ADD KEY ${quote(indexName)} (person_id)`);
  }

  for (const rows of uniqueIndexes) {
    const { TABLE_NAME: table, INDEX_NAME: name } = rows[0];
    const autoIncrementPrimary = name === "PRIMARY"
      && rows.some((row) => String(row.EXTRA).includes("auto_increment"));
    if (autoIncrementPrimary) {
      const scopedName = `t3_person_pk_${table}`.slice(0, 64);
      await connection.query(`ALTER TABLE ${quote(table)} ADD UNIQUE KEY ${quote(scopedName)} (${indexColumns(rows, { withPerson: true })})`);
    } else if (name === "PRIMARY") {
      const originalColumns = indexColumns(rows);
      const supportName = `t3_original_pk_${table}`.slice(0, 64);
      await connection.query(`ALTER TABLE ${quote(table)}
        ADD KEY ${quote(supportName)} (${originalColumns}),
        DROP PRIMARY KEY,
        ADD PRIMARY KEY (person_id, ${originalColumns})`);
    } else {
      await connection.query(`ALTER TABLE ${quote(table)}
        DROP INDEX ${quote(name)},
        ADD UNIQUE KEY ${quote(name)} (${indexColumns(rows, { withPerson: true })})`);
    }
  }

  const renameSql = agentPersonTables.map((name) => (
    `${quote(name)} TO ${quote(`${personDataTablePrefix}${name}`)}`
  )).join(", ");
  await connection.query(`RENAME TABLE ${renameSql}`);

  await connection.query("DROP FUNCTION IF EXISTS timev3_current_person_id");
  await connection.query(`CREATE FUNCTION timev3_current_person_id()
    RETURNS BIGINT UNSIGNED NOT DETERMINISTIC NO SQL RETURN @timev3_person_id`);

  for (const table of agentPersonTables) {
    const physical = `${personDataTablePrefix}${table}`;
    const columnRows = await queryRows(connection, `
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME <> 'person_id'
       ORDER BY ORDINAL_POSITION
    `, [databaseName, physical]);
    const columns = columnRows.map((row) => quote(row.COLUMN_NAME)).join(", ");
    await connection.query(`CREATE ALGORITHM=MERGE SQL SECURITY INVOKER VIEW ${quote(table)} AS
      SELECT ${columns} FROM ${quote(physical)}
       WHERE person_id = timev3_current_person_id()
      WITH CASCADED CHECK OPTION`);
    await connection.query(`CREATE TRIGGER ${quote(`t3_person_insert_${table}`.slice(0, 64))}
      BEFORE INSERT ON ${quote(physical)} FOR EACH ROW
      SET NEW.person_id = timev3_current_person_id()`);
    await connection.query(`CREATE TRIGGER ${quote(`t3_person_update_${table}`.slice(0, 64))}
      BEFORE UPDATE ON ${quote(physical)} FOR EACH ROW
      SET NEW.person_id = OLD.person_id`);
  }

  await installPersonForeignKeys(connection, foreignKeys, personId);

  for (const view of viewDefinitions) await connection.query(view.sql);
  output.write(`Assigned schema-69 Agent rows to person_id ${personId} and installed ${agentPersonTables.length} person-filtered logical views.\n`);
}

export async function assertPersonIsolationMigration(connection, databaseName) {
  const rows = await queryRows(connection, `
    SELECT TABLE_NAME, TABLE_TYPE
      FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?
  `, [databaseName]);
  const types = new Map(rows.map((row) => [row.TABLE_NAME, row.TABLE_TYPE]));
  for (const table of agentPersonTables) {
    if (types.get(table) !== "VIEW") throw new Error(`Schema 70 is missing logical person view ${table}`);
    if (types.get(`${personDataTablePrefix}${table}`) !== "BASE TABLE") {
      throw new Error(`Schema 70 is missing physical person table ${personDataTablePrefix}${table}`);
    }
  }
  const [functionRows] = await connection.query(`
    SELECT ROUTINE_NAME FROM information_schema.ROUTINES
     WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION'
       AND ROUTINE_NAME = 'timev3_current_person_id'
  `, [databaseName]);
  if (functionRows.length !== 1) throw new Error("Schema 70 is missing timev3_current_person_id()");

  const columns = await queryRows(connection, `
    SELECT TABLE_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND COLUMN_NAME = 'person_id'
  `, [databaseName]);
  const personColumns = new Set(columns.map((row) => row.TABLE_NAME));
  const missingColumns = agentPersonTables
    .map((table) => `${personDataTablePrefix}${table}`)
    .filter((table) => !personColumns.has(table));
  if (missingColumns.length) {
    throw new Error(`Schema 70 is missing person_id on: ${missingColumns.join(", ")}`);
  }

  const triggers = await queryRows(connection, `
    SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION
      FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = ? AND TRIGGER_NAME LIKE 't3\\_%'
  `, [databaseName]);
  const triggerKeys = new Set(triggers.map((row) => (
    `${row.EVENT_OBJECT_TABLE}\0${row.ACTION_TIMING}\0${row.EVENT_MANIPULATION}`
  )));
  for (const table of agentPersonTables) {
    const physical = `${personDataTablePrefix}${table}`;
    if (!triggerKeys.has(`${physical}\0BEFORE\0INSERT`) || !triggerKeys.has(`${physical}\0BEFORE\0UPDATE`)) {
      throw new Error(`Schema 70 is missing person ownership triggers for ${physical}`);
    }
  }

  const views = await queryRows(connection, `
    SELECT TABLE_NAME, CHECK_OPTION, VIEW_DEFINITION
      FROM information_schema.VIEWS
     WHERE TABLE_SCHEMA = ?
  `, [databaseName]);
  const viewByName = new Map(views.map((view) => [view.TABLE_NAME, view]));
  for (const table of agentPersonTables) {
    const view = viewByName.get(table);
    if (view?.CHECK_OPTION !== "CASCADED"
        || !String(view.VIEW_DEFINITION).toLowerCase().includes("timev3_current_person_id")) {
      throw new Error(`Schema 70 person view ${table} does not enforce the current MariaDB person`);
    }
  }

  const foreignKeyRows = await queryRows(connection, `
    SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
           k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
      FROM information_schema.KEY_COLUMN_USAGE k
      JOIN information_schema.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
       AND r.TABLE_NAME = k.TABLE_NAME
       AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.CONSTRAINT_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
       AND k.TABLE_NAME LIKE 'person\\_data\\_%'
     ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION
  `, [databaseName]);
  const triggerNames = new Set(triggers.map((row) => row.TRIGGER_NAME));
  for (const rows of grouped(foreignKeyRows, (row) => `${row.TABLE_NAME}\0${row.CONSTRAINT_NAME}`).values()) {
    const first = rows[0];
    const logicalTable = first.TABLE_NAME.slice(personDataTablePrefix.length);
    const nullableAction = first.UPDATE_RULE === "SET NULL" || first.DELETE_RULE === "SET NULL";
    if (nullableAction) {
      const expectedOwnerColumn = referenceOwnerColumn(logicalTable, first.CONSTRAINT_NAME);
      if (first.COLUMN_NAME !== expectedOwnerColumn || first.REFERENCED_COLUMN_NAME !== "person_id"
          || !String(first.REFERENCED_TABLE_NAME).startsWith(personDataTablePrefix)) {
        throw new Error(`Schema 70 nullable foreign key ${first.TABLE_NAME}.${first.CONSTRAINT_NAME} is not person-scoped`);
      }
      for (const prefix of ["t3_ref_bi", "t3_ref_bu"]) {
        const name = boundedName(prefix, logicalTable, first.CONSTRAINT_NAME);
        if (!triggerNames.has(name)) {
          throw new Error(`Schema 70 is missing ${name} for nullable reference ${first.CONSTRAINT_NAME}`);
        }
      }
      continue;
    }
    if (first.COLUMN_NAME !== "person_id" || first.REFERENCED_COLUMN_NAME !== "person_id"
        || !String(first.REFERENCED_TABLE_NAME).startsWith(personDataTablePrefix)) {
      throw new Error(`Schema 70 foreign key ${first.TABLE_NAME}.${first.CONSTRAINT_NAME} is not person-scoped`);
    }
  }
}
