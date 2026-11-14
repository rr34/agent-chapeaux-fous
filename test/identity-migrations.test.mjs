import assert from "node:assert/strict";
import test from "node:test";
import { runIdentityMigrations } from "../scripts/migrate-identity-database.mjs";

function fakeIdentityConnection(initialVersion = 1, invalidAccountCount = 0, resumeErrors = false) {
  const calls = [];
  let version = initialVersion;
  const connection = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/GET_LOCK/u.test(sql)) return [[{ acquired: 1 }]];
      if (/RELEASE_LOCK/u.test(sql)) return [[{ released: 1 }]];
      if (/COUNT\(\*\) AS table_count/u.test(sql)) return [[{ table_count: 1 }]];
      if (/COUNT\(\*\) AS legacy_account_column_count/u.test(sql)) return [[{ legacy_account_column_count: 1 }]];
      if (/COUNT\(\*\) AS invalid_count/u.test(sql)) return [[{ invalid_count: invalidAccountCount }]];
      if (/SELECT singleton, schema_version FROM identity_meta/u.test(sql)) {
        return [[{ singleton: 1, schema_version: version }]];
      }
      if (/SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE, COLLATION_NAME/u.test(sql)) {
        if (sql.includes("managed_by_person_id")) return [[
          { TABLE_NAME: "people", COLUMN_NAME: "person_id", IS_NULLABLE: "NO", COLLATION_NAME: null },
          { TABLE_NAME: "people", COLUMN_NAME: "email", IS_NULLABLE: "YES", COLLATION_NAME: "utf8mb4_bin" },
          { TABLE_NAME: "people", COLUMN_NAME: "managed_by_person_id", IS_NULLABLE: "YES", COLLATION_NAME: null },
          { TABLE_NAME: "password_credentials", COLUMN_NAME: "person_id", IS_NULLABLE: "NO", COLLATION_NAME: null },
          { TABLE_NAME: "auth_sessions", COLUMN_NAME: "person_id", IS_NULLABLE: "NO", COLLATION_NAME: null },
        ]];
        if (sql.includes("contact_manager_account_id")) return [[
          { TABLE_NAME: "accounts", COLUMN_NAME: "email", IS_NULLABLE: "YES", COLLATION_NAME: "utf8mb4_bin" },
          { TABLE_NAME: "accounts", COLUMN_NAME: "created_by_account_id", IS_NULLABLE: "YES", COLLATION_NAME: null },
          { TABLE_NAME: "people", COLUMN_NAME: "handle", IS_NULLABLE: "YES", COLLATION_NAME: "ascii_bin" },
          { TABLE_NAME: "people", COLUMN_NAME: "experience", IS_NULLABLE: "NO", COLLATION_NAME: "utf8mb4_unicode_ci" },
          { TABLE_NAME: "people", COLUMN_NAME: "contact_policy", IS_NULLABLE: "NO", COLLATION_NAME: "utf8mb4_unicode_ci" },
          { TABLE_NAME: "people", COLUMN_NAME: "contact_manager_account_id", IS_NULLABLE: "YES", COLLATION_NAME: null },
        ]];
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
      if (resumeErrors) {
        const completedPhase = [
          [/ALTER TABLE people\s+ADD UNIQUE KEY people_one_person_per_account_uq/u, "ER_DUP_KEYNAME"],
          [/ALTER TABLE people\s+MODIFY COLUMN person_status/u, "ER_DUP_FIELDNAME"],
          [/ALTER TABLE people\s+ADD UNIQUE KEY people_email_uq/u, "ER_DUP_KEYNAME"],
          [/ALTER TABLE password_credentials\s+ADD COLUMN person_id/u, "ER_BAD_FIELD_ERROR"],
          [/UPDATE password_credentials c/u, "ER_BAD_FIELD_ERROR"],
          [/ALTER TABLE password_credentials\s+DROP FOREIGN KEY/u, "ER_CANT_DROP_FIELD_OR_KEY"],
        ].find(([pattern]) => pattern.test(sql));
        if (completedPhase) throw Object.assign(new Error("already applied"), { code: completedPhase[1] });
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
  assert.deepEqual(result, { previousVersion: 1, currentVersion: 4, applied: [2, 3, 4] });
  assert.equal(fake.currentVersion(), 4);
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

test("current identity schema verification checks only the current consolidated shape", async () => {
  const fake = fakeIdentityConnection(4);
  const result = await runIdentityMigrations({
    connectionSettings: { database: "timev3_identity" },
    connect: async () => fake.connection,
    output: { write() {} },
  });
  assert.deepEqual(result, { previousVersion: 4, currentVersion: 4, applied: [] });
  assert.ok(fake.calls.some(({ sql = "" }) => sql.includes("managed_by_person_id")));
  assert.equal(fake.calls.some(({ sql = "" }) => sql.includes("accounts.email_normalized")), false);
});

test("account consolidation refuses ambiguous account-to-person mappings before DDL", async () => {
  const fake = fakeIdentityConnection(3, 1);
  await assert.rejects(() => runIdentityMigrations({
    connectionSettings: { database: "timev3_identity" },
    connect: async () => fake.connection,
    backupConfirmed: true,
    writersStopped: true,
    output: { write() {} },
  }), /exactly one person for every account/u);
  assert.equal(fake.calls.some(({ sql = "" }) => /ALTER TABLE people/u.test(sql)), false);
});

test("account consolidation resumes after statement-sized DDL phases committed", async () => {
  const fake = fakeIdentityConnection(3, 0, true);
  const output = [];
  const result = await runIdentityMigrations({
    connectionSettings: { database: "timev3_identity" },
    connect: async () => fake.connection,
    backupConfirmed: true,
    writersStopped: true,
    output: { write(value) { output.push(value); } },
  });
  assert.deepEqual(result, { previousVersion: 3, currentVersion: 4, applied: [4] });
  assert.match(output.join(""), /skipped an already-applied phase/u);
  assert.ok(fake.calls.some(({ sql = "" }) => /auth_sessions_identity_fk/u.test(sql)));
});
