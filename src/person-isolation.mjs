export const personIsolationSchemaVersion = 70;

export function inspectPersonIsolation(database, applicationTables) {
  const names = [...new Set(applicationTables)].filter((name) => name !== "database_meta");
  const meta = database.prepare(`
    SELECT schema_version FROM database_meta WHERE singleton = 1
  `).get();
  const rows = database.prepare(`
    SELECT TABLE_NAME AS table_name
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'person_id'
  `).all();
  const scoped = new Set(rows.map((row) => row.table_name));
  return {
    schemaVersion: Number(meta?.schema_version ?? 0),
    missingTables: names.filter((name) => !scoped.has(name)),
  };
}

export function assertPersonIsolationReady(database, applicationTables) {
  const result = inspectPersonIsolation(database, applicationTables);
  if (result.schemaVersion < personIsolationSchemaVersion || result.missingTables.length) {
    const missing = result.missingTables.length
      ? ` Missing person_id on: ${result.missingTables.join(", ")}.`
      : "";
    throw new Error(
      `Time v3 Auth cannot start against Agent schema version ${result.schemaVersion}; `
      + `person-isolated schema version ${personIsolationSchemaVersion} is required.${missing}`,
    );
  }
  return result;
}
