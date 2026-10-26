import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { runDatabaseMigrations } from "../scripts/migrate-database.mjs";
import { verifyDatabase } from "../scripts/verify-database.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { baselineBeforeContactSourceAliases, temporaryDatabase } from "./helpers.mjs";

test("Android contact source alias migration adds an empty provenance table", async (context) => {
  const schema = baselineBeforeContactSourceAliases(fs.readFileSync(baselineFilename, "utf8"));
  const temporary = temporaryDatabase({ schema });
  context.after(temporary.cleanup);
  const database = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => database.close());

  database.prepare(`
    INSERT INTO contacts (display_name, source, updated_at_utc)
    VALUES ('Existing Contact', 'agent', '2027-01-01T00:00:00.000Z')
  `).run();
  const result = await runDatabaseMigrations({
    connectionSettings: temporary.target.connection,
    backupConfirmed: true,
    writersStopped: true,
    output: { write() {} },
  });
  assert.deepEqual(result.applied, [58]);
  await verifyDatabase(database);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contacts").get().count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM contact_source_aliases").get().count, 0);
});
