#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { loadIdentityDatabaseTarget } from "../src/config.mjs";
import { openApplicationDatabase } from "../src/database-connection.mjs";

export const requiredIdentityShape = Object.freeze({
  identity_meta: ["singleton", "schema_version"],
  accounts: ["account_id", "display_name", "email", "account_status", "email_verified_at_utc", "created_by_account_id"],
  password_credentials: ["account_id", "algorithm", "salt", "password_hash", "memory_kib", "passes", "parallelism"],
  people: ["person_id", "display_name", "handle", "person_kind", "person_status", "account_id", "experience", "contact_policy", "contact_manager_account_id", "weekly_ai_token_limit"],
  auth_sessions: ["auth_session_id", "account_id", "selected_person_id", "client_id", "token_hash", "expires_at_utc", "revoked_at_utc"],
  email_challenges: ["email_challenge_id", "account_id", "challenge_purpose", "code_hash", "attempts", "expires_at_utc", "consumed_at_utc"],
  authorization_codes: ["authorization_code_id", "account_id", "person_id", "client_id", "code_hash", "redirect_uri", "expires_at_utc", "consumed_at_utc"],
  auth_rate_limits: ["rate_limit_id", "action_name", "subject_hash", "window_started_at_utc", "attempt_count"],
  auth_security_events: ["security_event_id", "account_id", "event_type", "outcome", "occurred_at_utc"],
  node_pairings: ["node_pairing_id", "device_code_hash", "user_code_hash", "device_name", "approved_account_id", "approved_person_id", "pairing_status", "expires_at_utc"],
  node_devices: ["node_device_id", "person_id", "approved_by_account_id", "device_name", "token_prefix", "token_hash", "device_status", "last_seen_at_utc", "revoked_at_utc"],
});

export function verifyIdentityDatabase(database) {
  const objects = database.prepare(`
    SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME, ORDINAL_POSITION
  `).all();
  const columns = new Map();
  for (const row of objects) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Set());
    columns.get(row.table_name).add(row.column_name);
  }
  const problems = [];
  for (const [table, required] of Object.entries(requiredIdentityShape)) {
    if (!columns.has(table)) problems.push(`Missing identity table ${table}`);
    else for (const column of required) if (!columns.get(table).has(column)) problems.push(`Missing identity column ${table}.${column}`);
  }
  if (columns.has("account_people")) problems.push("Obsolete identity table account_people still exists");
  if (columns.get("accounts")?.has("email_normalized")) problems.push("Obsolete identity column accounts.email_normalized still exists");
  if (columns.get("people")?.has("created_by_account_id")) problems.push("Obsolete identity column people.created_by_account_id still exists");
  const meta = columns.has("identity_meta")
    ? database.prepare("SELECT singleton, schema_version FROM identity_meta").all()
    : [];
  if (meta.length !== 1 || Number(meta[0]?.singleton) !== 1 || Number(meta[0]?.schema_version) !== 3) {
    problems.push("identity_meta must contain exactly schema version 3");
  }
  if (problems.length) throw new Error(`Time v3 Identity database is not ready:\n- ${problems.join("\n- ")}`);
  return { tableCount: Object.keys(requiredIdentityShape).length, schemaVersion: 3 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const databaseTarget = loadIdentityDatabaseTarget();
  const database = openApplicationDatabase(databaseTarget);
  try {
    const result = verifyIdentityDatabase(database);
    console.log(`Time v3 Identity database is ready: ${databaseTarget.connection.database}`);
    console.log(`Verified schema version ${result.schemaVersion} and ${result.tableCount} identity tables.`);
  } finally {
    database.close();
  }
}
