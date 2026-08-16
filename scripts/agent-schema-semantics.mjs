import fs from "node:fs";
import {
  assertSemanticForm,
  syncSemanticForm,
} from "schema-semantic-compiler";
import { extractSqliteCatalog } from "schema-semantic-compiler/sqlite";
import { semanticFormFilename } from "./agent-schema.mjs";

export function agentSchemaVersion(database) {
  const row = database.prepare(`
    SELECT schema_version
    FROM database_meta
    WHERE singleton = 1
  `).get();
  if (!row || !Number.isInteger(row.schema_version) || row.schema_version < 1) {
    throw new Error("database_meta does not contain a valid schema version");
  }
  return row.schema_version;
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

export function compileAgentSemanticForm(database, {
  existingForm = readAgentSemanticForm(),
  seedComments = false,
  now = new Date(),
} = {}) {
  const catalog = extractSqliteCatalog({
    database,
    databaseName: "main",
    schemaVersion: agentSchemaVersion(database),
  });
  return syncSemanticForm({ catalog, existingForm, seedComments, now });
}

export function writeAgentSemanticForm(database, {
  filename = semanticFormFilename,
  seedComments = false,
} = {}) {
  const existingForm = readAgentSemanticForm(filename);
  const compiled = compileAgentSemanticForm(database, {
    existingForm,
    seedComments: seedComments || existingForm == null,
  });
  const temporaryFilename = `${filename}.tmp`;
  fs.writeFileSync(temporaryFilename, `${JSON.stringify(compiled.form, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFilename, filename);
  return compiled.report;
}

export function assertAgentSemanticFormMatches(database, filename = semanticFormFilename) {
  const existingForm = readAgentSemanticForm(filename);
  if (!existingForm) {
    throw new Error(`Tracked schema semantic form not found: ${filename}`);
  }
  const extractedAt = new Date(existingForm.database.extractedAt);
  if (Number.isNaN(extractedAt.getTime())) {
    throw new Error(`Schema semantic form has an invalid extractedAt value: ${existingForm.database.extractedAt}`);
  }
  const { form: expected } = compileAgentSemanticForm(database, {
    existingForm,
    seedComments: false,
    now: extractedAt,
  });
  const actualText = `${JSON.stringify(existingForm, null, 2)}\n`;
  const expectedText = `${JSON.stringify(expected, null, 2)}\n`;
  if (actualText !== expectedText) {
    throw new Error(
      `Agent schema semantic form drift detected. Run npm run schema:semantics:sync and inspect ${filename}.`,
    );
  }
}
