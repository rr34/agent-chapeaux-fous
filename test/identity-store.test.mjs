import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hashPassword, normalizeAccountEmail, normalizeHandle, verifyPassword } from "../src/identity-store.mjs";
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

test("identity migrations store direct ownership, handles, and managed-account policy", () => {
  const filename = fileURLToPath(new URL("../db/identity/migrations.sql", import.meta.url));
  const migrations = readMigrationLedger(filename);
  assert.deepEqual(migrations.map(({ version }) => version), [2, 3]);
  const ownership = migrations.find(({ version }) => version === 2).sql;
  assert.match(ownership, /ADD COLUMN account_id BIGINT UNSIGNED NULL/u);
  assert.match(ownership, /DROP TABLE account_people/u);
  assert.match(ownership, /DROP COLUMN email_normalized/u);
  assert.match(ownership, /ADD UNIQUE KEY accounts_email_uq \(email\)/u);
  const policy = migrations.find(({ version }) => version === 3).sql;
  assert.match(policy, /ADD COLUMN handle VARCHAR\(32\)/u);
  assert.match(policy, /ADD UNIQUE KEY people_handle_uq \(handle\)/u);
  assert.match(policy, /ADD COLUMN contact_policy ENUM\('self_managed', 'manager_managed'\)/u);
  assert.doesNotMatch(`${ownership}\n${policy}`, /UPDATE identity_meta/u);
});
