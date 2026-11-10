import { agentPersonTables, personDataTablePrefix } from "../src/person-isolation.mjs";

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

function portableViewDefinition(sql) {
  return sql.replace(/\s+DEFINER=`[^`]+`@`[^`]+`/iu, "");
}

async function queryRows(connection, sql, parameters = []) {
  const [rows] = await connection.query(sql, parameters);
  return rows;
}

export async function applyPersonIsolationMigration(connection, databaseName, {
  initialPersonId = 1,
  output = process.stdout,
} = {}) {
  const personId = Number(initialPersonId);
  if (!Number.isSafeInteger(personId) || personId < 1) {
    throw new Error("SLAYER_LEGACY_PERSON_ID must be a positive safe integer");
  }
  const expected = new Set(agentPersonTables);
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
    output.write("Person-isolated physical tables and logical views already exist; validating replay state.\n");
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

  for (const rows of foreignKeys) {
    const first = rows[0];
    if (!expected.has(first.TABLE_NAME) || !expected.has(first.REFERENCED_TABLE_NAME)) {
      throw new Error(`Unexpected schema-69 foreign key ${first.CONSTRAINT_NAME}`);
    }
    const childColumns = rows.map((row) => quote(row.COLUMN_NAME)).join(", ");
    const parentColumns = rows.map((row) => quote(row.REFERENCED_COLUMN_NAME)).join(", ");
    await connection.query(`ALTER TABLE ${quote(`${personDataTablePrefix}${first.TABLE_NAME}`)}
      ADD CONSTRAINT ${quote(first.CONSTRAINT_NAME)}
      FOREIGN KEY (person_id, ${childColumns})
      REFERENCES ${quote(`${personDataTablePrefix}${first.REFERENCED_TABLE_NAME}`)} (person_id, ${parentColumns})
      ON UPDATE ${first.UPDATE_RULE} ON DELETE ${first.DELETE_RULE}`);
  }

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
    SELECT EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION
      FROM information_schema.TRIGGERS
     WHERE TRIGGER_SCHEMA = ? AND TRIGGER_NAME LIKE 't3_person\\_%'
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
    SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION,
           REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
      FROM information_schema.KEY_COLUMN_USAGE
     WHERE CONSTRAINT_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
       AND TABLE_NAME LIKE 'person\\_data\\_%'
     ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION
  `, [databaseName]);
  for (const rows of grouped(foreignKeyRows, (row) => `${row.TABLE_NAME}\0${row.CONSTRAINT_NAME}`).values()) {
    const first = rows[0];
    if (first.COLUMN_NAME !== "person_id" || first.REFERENCED_COLUMN_NAME !== "person_id"
        || !String(first.REFERENCED_TABLE_NAME).startsWith(personDataTablePrefix)) {
      throw new Error(`Schema 70 foreign key ${first.TABLE_NAME}.${first.CONSTRAINT_NAME} is not person-scoped`);
    }
  }
}
