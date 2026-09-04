import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseMigrationLedger,
  readMigrationLedger,
  splitMariaDbStatements,
  validatePendingMigrations,
} from "../scripts/database-migrations.mjs";
import {
  acquireMigrationLock,
  migrationsFilename,
  readCurrentSchemaVersion,
  runDatabaseMigrations,
} from "../scripts/migrate-database.mjs";

const block = (version, name = `migration-${version}`, sql = `SELECT ${version};`) => {
  const label = String(version).padStart(4, "0");
  return `-- migration ${label}: ${name}\n${sql}\n-- end migration ${label}\n`;
};

test("the migration ledger is newest-first and returned oldest-first for execution", () => {
  const migrations = readMigrationLedger(migrationsFilename);
  assert.deepEqual(migrations.map(({ version }) => version), [30, 31]);
  assert.deepEqual(validatePendingMigrations(migrations, 29).map(({ version }) => version), [30, 31]);
  assert.deepEqual(validatePendingMigrations(migrations, 30).map(({ version }) => version), [31]);
  assert.deepEqual(validatePendingMigrations(migrations, 31), []);
});

test("ledger parser rejects reordered, duplicate, missing, malformed, and outside SQL", () => {
  assert.throws(() => parseMigrationLedger(`${block(1)}${block(2)}`), /newest first/u);
  assert.throws(() => parseMigrationLedger(`${block(2)}${block(2)}`), /duplicate migration version 2/u);
  assert.throws(
    () => validatePendingMigrations(parseMigrationLedger(`${block(4)}${block(2)}`), 1),
    /requires pending migration 3, found 4|newest first/u,
  );
  assert.throws(
    () => parseMigrationLedger("-- migration 0002: example\nSELECT 2;\n-- end migration 0003\n"),
    /ends as 0003/u,
  );
  assert.throws(() => parseMigrationLedger("SELECT 1;\n"), /outside a migration block/u);
  assert.throws(() => validatePendingMigrations([{ version: 3 }], 1), /requires pending migration 2/u);
  assert.throws(
    () => validatePendingMigrations([{ version: 2 }], 3),
    /schema version 3 is newer than migration ledger version 2/u,
  );
});

test("MariaDB statement splitting handles comments, semicolons in values, and prepared statements", () => {
  const statements = splitMariaDbStatements(`
-- comment
INSERT INTO example (value) VALUES ('semi;colon');
/* block ; */ SET @sql = 'SELECT 1;';
PREPARE s FROM @sql;
EXECUTE s;
DEALLOCATE PREPARE s;
`);
  assert.equal(statements.length, 5);
  assert.match(statements[0], /semi;colon/u);
  assert.match(statements[4], /DEALLOCATE/u);
});

test("advisory lock acquisition rejects contention", async () => {
  const calls = [];
  const connection = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return [[{ acquired: calls.length === 1 ? 1 : 0 }]];
    },
  };
  await acquireMigrationLock(connection, "slayer_test", 7);
  assert.deepEqual(calls[0].params, ["chapeaux-fous:migrations:slayer_test", 7]);
  await assert.rejects(() => acquireMigrationLock(connection, "slayer_test", 7), /Could not acquire/u);
});

function fakeConnection({ version = 2, failStatement = false } = {}) {
  const calls = [];
  const connection = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/GET_LOCK/u.test(sql)) return [[{ acquired: 1 }]];
      if (/RELEASE_LOCK/u.test(sql)) return [[{ released: 1 }]];
      if (/COUNT\(\*\) AS table_count[\s\S]*information_schema\.TABLES/u.test(sql)) {
        return [[{ table_count: 1 }]];
      }
      if (/SELECT singleton, schema_version FROM database_meta/u.test(sql)) {
        return [[{ singleton: 1, schema_version: version }]];
      }
      if (/@@SESSION\.foreign_key_checks/u.test(sql)) return [[{ enabled: 1 }]];
      if (/TABLE_TYPE = 'BASE TABLE'/u.test(sql)) return [[]];
      if (/information_schema\.KEY_COLUMN_USAGE/u.test(sql)) return [[]];
      if (/SELECT 2/u.test(sql)) {
        if (failStatement) throw new Error("simulated implicit-commit DDL failure");
        return [[], []];
      }
      if (/^UPDATE database_meta/u.test(sql)) {
        version = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected SQL in fake connection: ${sql}`);
    },
    end: async () => calls.push({ end: true }),
  };
  return { calls, connection, currentVersion: () => version };
}

test("a completed block advances the durable schema version after integrity checks", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slayer-ledger-success-"));
  const ledger = path.join(directory, "migrations.sql");
  fs.writeFileSync(ledger, block(2));
  const fake = fakeConnection({ version: 1 });
  try {
    const result = await runDatabaseMigrations({
      connectionSettings: { database: "slayer_test" },
      connect: async () => fake.connection,
      ledgerFilename: ledger,
      backupConfirmed: true,
      output: { write() {} },
    });
    assert.deepEqual(result, { previousVersion: 1, currentVersion: 2, applied: [2] });
    assert.equal(fake.currentVersion(), 2);
    const updateIndex = fake.calls.findIndex(({ sql = "" }) => /^UPDATE database_meta/u.test(sql));
    const integrityIndex = fake.calls.findIndex(({ sql = "" }) => /information_schema\.KEY_COLUMN_USAGE/u.test(sql));
    assert.ok(integrityIndex >= 0 && updateIndex > integrityIndex);
    assert.ok(fake.calls.some(({ sql = "" }) => /RELEASE_LOCK/u.test(sql)));
    assert.ok(fake.calls.some(({ end }) => end));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed block does not advance the version and still releases the lock", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slayer-ledger-failure-"));
  const ledger = path.join(directory, "migrations.sql");
  fs.writeFileSync(ledger, block(2));
  const fake = fakeConnection({ version: 1, failStatement: true });
  try {
    await assert.rejects(
      () => runDatabaseMigrations({
        connectionSettings: { database: "slayer_test" },
        connect: async () => fake.connection,
        ledgerFilename: ledger,
        backupConfirmed: true,
        output: { write() {} },
      }),
      /simulated implicit-commit DDL failure/u,
    );
    assert.equal(fake.currentVersion(), 1);
    assert.equal(fake.calls.some(({ sql = "" }) => /^UPDATE database_meta/u.test(sql)), false);
    assert.ok(fake.calls.some(({ sql = "" }) => /RELEASE_LOCK/u.test(sql)));
    assert.ok(fake.calls.some(({ end }) => end));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a block that declares writer downtime requires the operator confirmation", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "slayer-ledger-downtime-"));
  const ledger = path.join(directory, "migrations.sql");
  fs.writeFileSync(ledger, block(2, "downtime", "-- writer downtime: required; test rebuild.\nSELECT 2;"));
  const fake = fakeConnection({ version: 1 });
  try {
    await assert.rejects(
      () => runDatabaseMigrations({
        connectionSettings: { database: "slayer_test" },
        connect: async () => fake.connection,
        ledgerFilename: ledger,
        backupConfirmed: true,
        writersStopped: false,
        output: { write() {} },
      }),
      /require database writers to be stopped/u,
    );
    assert.equal(fake.calls.some(({ sql = "" }) => /SELECT 2/u.test(sql)), false);
    assert.equal(fake.currentVersion(), 1);
    assert.ok(fake.calls.some(({ sql = "" }) => /RELEASE_LOCK/u.test(sql)));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("missing schema metadata is never treated as an empty migration baseline", async () => {
  const connection = { query: async () => [[{ table_count: 0 }]] };
  await assert.rejects(
    () => readCurrentSchemaVersion(connection, "slayer_test"),
    /initialize an empty database from db\/mariadb\/0001-baseline\.sql/u,
  );
});
