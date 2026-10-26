import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { baselineFilename } from "../scripts/agent-schema.mjs";
import { runDatabaseMigrations } from "../scripts/migrate-database.mjs";
import { verifyDatabase } from "../scripts/verify-database.mjs";
import { CorrespondenceSyncService } from "../src/correspondence-sync.mjs";
import { MariaDatabaseSync } from "../src/mariadb-sync.mjs";
import { baselineBeforeCorrespondenceAliases, temporaryDatabase } from "./helpers.mjs";

test("cross-device correspondence migration is sparse and deduplicates a later phone", async (context) => {
  const schema = baselineBeforeCorrespondenceAliases(fs.readFileSync(baselineFilename, "utf8"));
  const temporary = temporaryDatabase({ schema });
  context.after(temporary.cleanup);
  const database = new MariaDatabaseSync(temporary.target.connection);
  context.after(() => database.close());
  database.prepare(`INSERT INTO correspondence (
    medium, direction, source_account_key, thread_key, external_id, body,
    delivery_status, provider_status, occurred_at_utc, received_at_utc
  ) VALUES ('sms', 'inbound', ?, 'sms:7', '101', 'hello',
    'delivered', 'android:sms:inbox:-1', ?, ?)
  `).run(
    "android:0123456789abcdef0123456789abcdef:sim_1",
    "2027-01-15T08:00:00.123Z",
    "2027-01-15T08:00:00.123Z",
  );
  database.prepare(`INSERT INTO correspondence_participants_join (
    correspondence_id, participant_role, address_value, display_name
  ) VALUES (1, 'sender', '+1 (555) 010-0200', 'Alex')`).run();

  const options = {
    connectionSettings: temporary.target.connection,
    backupConfirmed: true,
    writersStopped: true,
    output: { write() {} },
  };
  assert.deepEqual((await runDatabaseMigrations(options)).applied, [57, 58]);
  await verifyDatabase(database);
  assert.equal(database.prepare(`
    SELECT dedupe_fingerprint FROM correspondence WHERE correspondence_id = 1
  `).get().dedupe_fingerprint, null);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM correspondence_source_aliases
  `).get().count, 0);

  const service = new CorrespondenceSyncService({ databaseTarget: temporary.target });
  context.after(() => service.close());
  const result = service.synchronize({
    protocol: "timev3.android-correspondence-sync",
    version: 1,
    deviceId: "fedcba9876543210fedcba9876543210",
    contacts: [],
    correspondence: [{
      medium: "sms",
      direction: "inbound",
      account: "sim_2",
      threadKey: "sms:88",
      externalId: "999",
      body: "hello",
      deliveryStatus: "delivered",
      providerStatus: "android:sms:inbox:-1",
      occurredAtMs: 1_800_000_000_123,
      receivedAtMs: 1_800_000_000_123,
      participants: [{ address: "15550100200", displayName: "A. Rivera" }],
    }],
  });
  assert.deepEqual(result.correspondence, {
    received: 1, created: 0, updated: 0, deduplicated: 1,
  });
  assert.match(database.prepare(`
    SELECT dedupe_fingerprint FROM correspondence WHERE correspondence_id = 1
  `).get().dedupe_fingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correspondence").get().count, 1);
  assert.equal(database.prepare(`
    SELECT COUNT(*) AS count FROM correspondence_source_aliases
  `).get().count, 1);
});
