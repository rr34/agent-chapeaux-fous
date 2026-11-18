import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hashPassword, IdentityStore, normalizeAccountEmail, normalizeHandle, verifyPassword } from "../src/identity-store.mjs";
import { requiredIdentityShape } from "../scripts/verify-identity-database.mjs";
import { readMigrationLedger } from "../scripts/database-migrations.mjs";

test("Time v3 passwords use salted Argon2id verifiers", () => {
  const first = hashPassword("correct horse battery staple");
  const second = hashPassword("correct horse battery staple");
  assert.equal(first.algorithm, "argon2id");
  assert.equal(first.memory, 19_456);
  assert.equal(first.passes, 2);
  assert.notDeepEqual(first.salt, second.salt);
  assert.notDeepEqual(first.hash, second.hash);
  assert.equal(verifyPassword("correct horse battery staple", {
    algorithm: first.algorithm, salt: first.salt, password_hash: first.hash,
    memory_kib: first.memory, passes: first.passes, parallelism: first.parallelism,
  }), true);
  assert.equal(verifyPassword("wrong password value", {
    algorithm: first.algorithm, salt: first.salt, password_hash: first.hash,
    memory_kib: first.memory, passes: first.passes, parallelism: first.parallelism,
  }), false);
});

test("self-service password replacement verifies the current password and revokes sessions", () => {
  const original = hashPassword("original password value");
  const account = {
    person_id: 17, person_status: "active", algorithm: original.algorithm,
    salt: original.salt, password_hash: original.hash, memory_kib: original.memory,
    passes: original.passes, parallelism: original.parallelism,
  };
  const events = [];
  let replacement = null;
  let revoked = false;
  const store = Object.create(IdentityStore.prototype);
  store.database = {
    prepare(sql) {
      if (sql.includes("FROM people p")) return { get: () => account };
      if (sql.includes("UPDATE password_credentials")) return { run: (salt, hash, memory, passes, parallelism) => {
        replacement = { algorithm: "argon2id", salt, password_hash: hash,
          memory_kib: memory, passes, parallelism };
      } };
      if (sql.includes("UPDATE auth_sessions")) return { run: () => { revoked = true; } };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  store.transaction = (callback) => callback();
  store.recordSecurityEvent = (event) => events.push(event);

  assert.equal(store.changePassword(17, "original password value", "replacement password value"), true);
  assert.equal(verifyPassword("replacement password value", replacement), true);
  assert.equal(revoked, true);
  assert.equal(events.at(-1).outcome, "success");

  assert.throws(
    () => store.changePassword(17, "incorrect password", "another replacement value"),
    (error) => error.code === "CURRENT_PASSWORD_INVALID" && error.statusCode === 401,
  );
  assert.equal(events.at(-1).outcome, "failure");
});

test("account email normalization is exact and bounded", () => {
  assert.equal(normalizeAccountEmail("  Nate@Example.COM "), "nate@example.com");
  assert.throws(() => normalizeAccountEmail("not-an-email"), /valid email/);
});

test("Time v3 handles have one canonical human-facing form", () => {
  assert.equal(normalizeHandle("  @Grandma_Neaner "), "grandma_neaner");
  assert.equal(normalizeHandle("vince-node"), "vince-node");
  assert.throws(() => normalizeHandle("two words"), /handle/i);
  assert.throws(() => normalizeHandle("ab"), /handle/i);
});

test("a person can change their own Time v3 handle", () => {
  let person = {
    person_id: 17, display_name: "Nate", handle: "old-handle", email: null,
    person_status: "active", managed_by_person_id: null, experience: "full",
    contact_policy: "self_managed", weekly_ai_token_limit: 100,
  };
  const events = [];
  const store = Object.create(IdentityStore.prototype);
  store.authorizedPerson = () => person;
  store.transaction = (callback) => callback();
  store.recordSecurityEvent = (event) => events.push(event);
  store.database = {
    prepare(sql) {
      if (sql.includes("SELECT person_id FROM people WHERE handle")) return { get: () => undefined };
      if (sql.includes("UPDATE people SET handle")) return { run: (handle) => { person = { ...person, handle }; } };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  assert.equal(store.setPersonHandle(17, 17, "new-handle").handle, "@new-handle");
  assert.equal(events.at(-1).type, "person.handle_changed");
});

test("identity handle lookup accepts canonical input and one legacy presentation prefix", () => {
  const rows = [
    { person_id: 7, display_name: "Vince", handle: "@vince", person_status: "active", experience: "light", contact_policy: "manager_managed", weekly_ai_token_limit: 100 },
  ];
  const store = Object.create(IdentityStore.prototype);
  store.database = {
    prepare(sql) {
      if (sql.includes("WHERE p.handle = ?")) return { get: (handle) => rows.find((row) => row.handle === handle) };
      if (sql.includes("TRIM(LEADING '@'")) return { all: (handle) => rows.filter((row) => row.handle.replace(/^@/u, "") === handle) };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  assert.equal(store.activePersonByHandle("vince").personId, 7);
  assert.equal(store.activePersonByHandle("@VINCE").handle, "@vince");
});

test("identity baseline declares every verified table and keeps Agent data separate", () => {
  const filename = fileURLToPath(new URL("../db/identity/0001-baseline.sql", import.meta.url));
  const sql = fs.readFileSync(filename, "utf8");
  for (const table of Object.keys(requiredIdentityShape)) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`, "u"));
  }
  assert.doesNotMatch(sql, /CREATE TABLE (?:contacts|files|activity_events)\b/u);
  assert.match(sql, /INSERT INTO identity_meta \(singleton, schema_version\) VALUES \(1, 1\)/u);
  assert.match(sql, /UNIQUE KEY node_pairings_user_code_uq \(user_code_hash\)/u);
  assert.match(sql, /weekly_ai_token_limit\s+BIGINT UNSIGNED NOT NULL DEFAULT 19100000/u);
  assert.doesNotMatch(sql, /ON UPDATE UTC_TIMESTAMP/u);
});

test("identity migrations consolidate login accounts into managed people", () => {
  const filename = fileURLToPath(new URL("../db/identity/migrations.sql", import.meta.url));
  const migrations = readMigrationLedger(filename);
  assert.deepEqual(migrations.map(({ version }) => version), [2, 3, 4]);
  const ownership = migrations.find(({ version }) => version === 2).sql;
  assert.match(ownership, /ADD COLUMN account_id BIGINT UNSIGNED NULL/u);
  assert.match(ownership, /DROP TABLE account_people/u);
  assert.match(ownership, /DROP COLUMN email_normalized/u);
  assert.match(ownership, /ADD UNIQUE KEY accounts_email_uq \(email\)/u);
  const policy = migrations.find(({ version }) => version === 3).sql;
  assert.match(policy, /ADD COLUMN handle VARCHAR\(32\)/u);
  assert.match(policy, /ADD UNIQUE KEY people_handle_uq \(handle\)/u);
  assert.match(policy, /ADD COLUMN contact_policy ENUM\('self_managed', 'manager_managed'\)/u);
  const consolidation = migrations.find(({ version }) => version === 4).sql;
  assert.match(consolidation, /ADD COLUMN managed_by_person_id BIGINT UNSIGNED NULL/u);
  assert.match(consolidation, /DROP TABLE accounts/u);
  assert.match(consolidation, /password_credentials_person_fk/u);
  assert.doesNotMatch(`${ownership}\n${policy}\n${consolidation}`, /UPDATE identity_meta/u);
});

test("the identity store reads and writes the consolidated people model", () => {
  const filename = fileURLToPath(new URL("../src/identity-store.mjs", import.meta.url));
  const source = fs.readFileSync(filename, "utf8");
  assert.doesNotMatch(source, /\b(?:FROM|JOIN|INSERT INTO|UPDATE) accounts\b/u);
  assert.doesNotMatch(source, /\b(?:approved|created|managed)_by_account_id\b/u);
  assert.match(source, /managed_by_person_id/u);
  assert.match(source, /schema version 4 is required/u);
});
