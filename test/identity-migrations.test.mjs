import assert from "node:assert/strict";
import test from "node:test";
import { runIdentityMigrations } from "../scripts/migrate-identity-database.mjs";

function fakeIdentityConnection() {
  const calls = [];
  let version = 1;
  const connection = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/GET_LOCK/u.test(sql)) return [[{ acquired: 1 }]];
      if (/RELEASE_LOCK/u.test(sql)) return [[{ released: 1 }]];
      if (/COUNT\(\*\) AS table_count/u.test(sql)) return [[{ table_count: 1 }]];
      if (/SELECT singleton, schema_version FROM identity_meta/u.test(sql)) {
        return [[{ singleton: 1, schema_version: version }]];
      }
      if (/SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLLATION_NAME/u.test(sql)) {
        return [[
          { TABLE_NAME: "accounts", COLUMN_NAME: "email", IS_NULLABLE: "NO", COLLATION_NAME: "utf8mb4_bin" },
          { TABLE_NAME: "people", COLUMN_NAME: "account_id", IS_NULLABLE: "NO", COLLATION_NAME: null },
        ]];
      }
      if (/SELECT TABLE_NAME FROM information_schema\.TABLES/u.test(sql)) return [[]];
      if (/UPDATE identity_meta SET schema_version/u.test(sql)) {
        version = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      return [{ affectedRows: 1 }, []];
    },
    async end() { calls.push({ end: true }); },
  };
  return { calls, connection, currentVersion: () => version };
}

test("identity migration command applies the shared ledger and advances identity_meta last", async () => {
  const fake = fakeIdentityConnection();
  const result = await runIdentityMigrations({
    connectionSettings: { database: "timev3_identity" },
    connect: async () => fake.connection,
    backupConfirmed: true,
    writersStopped: true,
    output: { write() {} },
  });
  assert.deepEqual(result, { previousVersion: 1, currentVersion: 2, applied: [2] });
  assert.equal(fake.currentVersion(), 2);
  const versionUpdate = fake.calls.findIndex(({ sql = "" }) => /UPDATE identity_meta SET schema_version/u.test(sql));
  const schemaAlter = fake.calls.findIndex(({ sql = "" }) => /ALTER TABLE account_people/u.test(sql));
  assert.ok(schemaAlter >= 0 && versionUpdate > schemaAlter);
  assert.ok(fake.calls.some(({ sql = "" }) => /RELEASE_LOCK/u.test(sql)));
  assert.ok(fake.calls.some(({ end }) => end));
});

test("identity migration command requires backup and writer-stop confirmations", async () => {
  const withoutBackup = fakeIdentityConnection();
  await assert.rejects(() => runIdentityMigrations({
    connectionSettings: { database: "timev3_identity" },
    connect: async () => withoutBackup.connection,
    backupConfirmed: false,
    writersStopped: true,
    output: { write() {} },
  }), /require a recoverable backup/u);

  const withWriter = fakeIdentityConnection();
  await assert.rejects(() => runIdentityMigrations({
    connectionSettings: { database: "timev3_identity" },
    connect: async () => withWriter.connection,
    backupConfirmed: true,
    writersStopped: false,
    output: { write() {} },
  }), /require writers to be stopped/u);
});
