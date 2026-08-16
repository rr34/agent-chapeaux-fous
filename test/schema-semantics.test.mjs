import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SlayerDatabase } from "../src/database.mjs";
import { Ledger } from "../src/ledger.mjs";
import { SchemaSemantics } from "../src/schema-semantics.mjs";
import { ToolRegistry } from "../src/tools/registry.mjs";
import { registerDatabaseTools } from "../src/tools/database-tools.mjs";
import { temporaryDatabase } from "./helpers.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("structured database reads return an exact schema-semantic projection", async (context) => {
  const temporary = temporaryDatabase();
  context.after(() => temporary.cleanup());
  const store = new SlayerDatabase(temporary.filename);
  context.after(() => store.close());
  const ledger = new Ledger(store);
  const schemaSemantics = new SchemaSemantics({
    filename: path.join(repositoryRoot, "db", "schema-semantics.json"),
    ledger,
  });
  const registry = new ToolRegistry();
  registerDatabaseTools(registry, store, ledger, schemaSemantics);
  const request = ledger.createRequest({ text: "Read active profile facts" });

  const result = await registry.execute("database_read", {
    objectName: "profile_facts",
    columns: ["fact_type", "fact_text"],
    where: { fact_status: "active" },
    orderBy: "fact_type",
    orderDirection: "asc",
    limit: 20,
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "database-read",
  });

  assert.equal(result.schemaProjection.product, "schema-semantic-compiler/schema-semantic-projection");
  assert.deepEqual(
    Object.keys(result.schemaProjection.schemaProjection.schemaObjects),
    ["profile_facts"],
  );
  assert.equal(
    result.schemaProjection.schemaProjection.schemaObjects.profile_facts.fields.fact_text.meaning,
    "Self-contained natural-language statement identifying the fact's person or item.",
  );
  assert.equal(
    ledger.trace(request.requestId).some((event) => event.type === "schema.semantics.compiled"),
    true,
  );

  const logResult = await registry.execute("database_read", {
    objectName: "log_entries",
    columns: ["content_text", "number_value", "unit", "source", "external_id"],
    where: {},
    orderBy: "occurred_at_utc",
    orderDirection: "desc",
    limit: 20,
  }, {
    requestId: request.requestId,
    requestEventId: request.eventId,
    callId: "log-schema-read",
  });
  const logFields = logResult.schemaProjection.schemaProjection.schemaObjects.log_entries.fields;
  assert.match(logFields.content_text.meaning, /Complete self-contained natural-language content/);
  assert.match(logFields.number_value.meaning, /Optional numeric projection/);
  assert.match(logFields.external_id.meaning, /make imports idempotent/);
});
