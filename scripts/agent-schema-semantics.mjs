import fs from "node:fs";
import { assertSemanticForm, syncSemanticForm } from "schema-semantic-compiler";
import { extractMariaDbCatalog } from "schema-semantic-compiler/mariadb";
import { semanticFormFilename } from "./agent-schema.mjs";

export function agentSchemaVersion(database) {
  const row = database.prepare(`
    SELECT schema_version
    FROM database_meta
    WHERE singleton = 1
  `).get();
  const version = Number(row?.schema_version);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("database_meta does not contain a valid schema version");
  }
  return version;
}

export function readAgentSemanticForm(filename = semanticFormFilename) {
  if (!fs.existsSync(filename)) return null;
  let form;
  try {
    form = JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch (error) {
    throw new Error(`Cannot parse agent schema semantic form ${filename}: ${error.message}`);
  }
  return assertSemanticForm(form);
}

function currentSemanticForm(form) {
  for (const [objectName, object] of Object.entries(form.schemaObjects)) {
    if (object.mechanics.present === false) {
      delete form.schemaObjects[objectName];
      continue;
    }
    for (const [fieldName, field] of Object.entries(object.fields)) {
      if (field.mechanics.present === false) delete object.fields[fieldName];
    }
    for (const [relationshipId, relationship] of Object.entries(object.relationships)) {
      if (relationship.mechanics.present === false) delete object.relationships[relationshipId];
    }
  }
  return form;
}

export async function compileAgentSemanticForm(database, {
  existingForm = readAgentSemanticForm(),
  seedComments = false,
  now = new Date(),
} = {}) {
  const databaseName = database.configuration?.database;
  const catalog = await extractMariaDbCatalog({
    query: async (sql, parameters = []) => database.prepare(sql).all(...parameters),
    databaseName,
    schemaVersion: agentSchemaVersion(database),
  });
  const synchronized = syncSemanticForm({ catalog, existingForm, seedComments, now });
  synchronized.form = currentSemanticForm(synchronized.form);
  return synchronized;
}

export async function writeAgentSemanticForm(database, {
  filename = semanticFormFilename,
  seedComments = false,
} = {}) {
  const existingForm = readAgentSemanticForm(filename);
  const compiled = await compileAgentSemanticForm(database, {
    existingForm,
    seedComments: seedComments || existingForm == null,
  });
  const temporaryFilename = `${filename}.tmp`;
  fs.writeFileSync(temporaryFilename, `${JSON.stringify(compiled.form, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFilename, filename);
  return compiled.report;
}

export async function assertAgentSemanticFormMatches(database, filename = semanticFormFilename) {
  const existingForm = readAgentSemanticForm(filename);
  if (!existingForm) throw new Error(`Tracked schema semantic form not found: ${filename}`);
  const extractedAt = new Date(existingForm.database.extractedAt);
  if (Number.isNaN(extractedAt.getTime())) {
    throw new Error(`Schema semantic form has an invalid extractedAt value: ${existingForm.database.extractedAt}`);
  }
  const { form: expected } = await compileAgentSemanticForm(database, {
    existingForm,
    seedComments: false,
    now: extractedAt,
  });
  if (`${JSON.stringify(existingForm, null, 2)}\n` !== `${JSON.stringify(expected, null, 2)}\n`) {
    throw new Error(
      `Agent schema semantic form drift detected. Run npm run schema:semantics:sync and inspect ${filename}.`,
    );
  }
}
