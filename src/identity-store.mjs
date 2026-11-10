import {
  argon2Sync, createHash, createHmac, randomBytes, randomInt, timingSafeEqual,
} from "node:crypto";
import { openApplicationDatabase } from "./database-connection.mjs";

const passwordParameters = Object.freeze({
  algorithm: "argon2id",
  memory: 19_456,
  passes: 2,
  parallelism: 1,
  tagLength: 32,
});

function identityError(message, statusCode = 400, code = "IDENTITY_INPUT_INVALID") {
  return Object.assign(new Error(message), { statusCode, code });
}

export function normalizeAccountEmail(value) {
  const email = String(value ?? "").normalize("NFKC").trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw identityError("Enter a valid email address.", 400, "EMAIL_INVALID");
  }
  return email;
}

function displayName(value, label = "Name") {
  const name = String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!name || name.length > 200) throw identityError(`${label} is required and must be at most 200 characters.`);
  return name;
}

function passwordBytes(value) {
  if (typeof value !== "string") throw identityError("Password is required.", 400, "PASSWORD_INVALID");
  const bytes = Buffer.from(value, "utf8");
  if (value.length < 12 || bytes.length > 1024) {
    throw identityError("Password must be at least 12 characters and at most 1,024 bytes.", 400, "PASSWORD_INVALID");
  }
  return bytes;
}

function passwordVerifier(password, salt, parameters = passwordParameters) {
  return argon2Sync(parameters.algorithm, {
    message: passwordBytes(password), nonce: salt,
    parallelism: parameters.parallelism, tagLength: parameters.tagLength,
    memory: parameters.memory, passes: parameters.passes,
  });
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  return { ...passwordParameters, salt, hash: passwordVerifier(password, salt) };
}

export function verifyPassword(password, credential) {
  let actual;
  try {
    actual = passwordVerifier(password, Buffer.from(credential.salt), {
      algorithm: credential.algorithm,
      memory: Number(credential.memory_kib),
      passes: Number(credential.passes),
      parallelism: Number(credential.parallelism),
      tagLength: Buffer.from(credential.password_hash).length,
    });
  } catch {
    return false;
  }
  const expected = Buffer.from(credential.password_hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function tokenDigest(token) {
  return createHash("sha256").update(String(token), "utf8").digest();
}

function nodeCode(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

function publicAccount(row) {
  return {
    accountId: Number(row.account_id),
    displayName: row.account_display_name,
    email: row.email,
    status: row.account_status,
  };
}

function publicPerson(row) {
  return {
    personId: Number(row.person_id),
    displayName: row.person_display_name ?? row.display_name,
    kind: row.person_kind,
    status: row.person_status,
    weeklyAiTokenLimit: Number(row.weekly_ai_token_limit),
  };
}

export class IdentityStore {
  constructor({ databaseTarget, challengeSecret, sessionDays = 30, weeklyAiTokenLimit = 19_100_000 }) {
    if (!databaseTarget) throw new Error("Time v3 Identity database configuration is required");
    if (!challengeSecret || Buffer.byteLength(challengeSecret) < 32) {
      throw new Error("TIMEV3_AUTH_CHALLENGE_SECRET must contain at least 32 bytes");
    }
    this.database = openApplicationDatabase(databaseTarget);
    const identityMeta = this.database.prepare(`
      SELECT schema_version FROM identity_meta WHERE singleton = 1
    `).get();
    if (Number(identityMeta?.schema_version) !== 2) {
      this.database.close();
      throw new Error(`Time v3 Identity schema version 2 is required; found ${identityMeta?.schema_version ?? "none"}`);
    }
    this.challengeSecret = challengeSecret;
    this.sessionSeconds = Math.max(1, Number(sessionDays)) * 86_400;
    this.weeklyAiTokenLimit = Number(weeklyAiTokenLimit);
    this.dummyCredential = hashPassword(randomBytes(32).toString("base64url"));
  }

  close() { this.database.close(); }

  transaction(callback) {
    this.database.exec("START TRANSACTION");
    try {
      const result = callback();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  accountByEmail(email) {
    return this.database.prepare(`
      SELECT a.account_id, a.display_name AS account_display_name, a.email,
             a.account_status, a.email_verified_at_utc,
             p.algorithm, p.salt, p.password_hash, p.memory_kib, p.passes, p.parallelism
        FROM accounts a
        LEFT JOIN password_credentials p ON p.account_id = a.account_id
       WHERE a.email = ?
    `).get(normalizeAccountEmail(email));
  }

  challengeDigest(accountId, purpose, code) {
    return createHmac("sha256", this.challengeSecret)
      .update(`${Number(accountId)}\0${purpose}\0${String(code)}`, "utf8").digest();
  }

  nodeUserCodeDigest(code) {
    return createHmac("sha256", this.challengeSecret).update(`node-pairing\0${nodeCode(code)}`, "utf8").digest();
  }

  createChallenge(accountId, purpose) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.database.prepare(`
      UPDATE email_challenges SET consumed_at_utc = UTC_TIMESTAMP(3)
       WHERE account_id = ? AND challenge_purpose = ? AND consumed_at_utc IS NULL
    `).run(accountId, purpose);
    this.database.prepare(`
      INSERT INTO email_challenges
        (account_id, challenge_purpose, code_hash, expires_at_utc)
      VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))
    `).run(accountId, purpose, this.challengeDigest(accountId, purpose, code));
    return code;
  }

  consumeChallenge(accountId, purpose, code) {
    const challenge = this.database.prepare(`
      SELECT email_challenge_id, code_hash, attempts
        FROM email_challenges
       WHERE account_id = ? AND challenge_purpose = ?
         AND consumed_at_utc IS NULL AND expires_at_utc > UTC_TIMESTAMP(3)
       ORDER BY email_challenge_id DESC LIMIT 1
       FOR UPDATE
    `).get(accountId, purpose);
    if (!challenge || Number(challenge.attempts) >= 6) {
      throw identityError("The verification code is invalid or expired.", 400, "CHALLENGE_INVALID");
    }
    this.database.prepare(`
      UPDATE email_challenges SET attempts = attempts + 1 WHERE email_challenge_id = ?
    `).run(challenge.email_challenge_id);
    const actual = this.challengeDigest(accountId, purpose, String(code ?? "").trim());
    const expected = Buffer.from(challenge.code_hash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw identityError("The verification code is invalid or expired.", 400, "CHALLENGE_INVALID");
    }
    this.database.prepare(`
      UPDATE email_challenges SET consumed_at_utc = UTC_TIMESTAMP(3)
       WHERE email_challenge_id = ?
    `).run(challenge.email_challenge_id);
  }

  register({ name, email, password }) {
    const normalizedEmail = normalizeAccountEmail(email);
    const normalizedName = displayName(name);
    const credential = hashPassword(password);
    return this.transaction(() => {
      if (this.database.prepare("SELECT account_id FROM accounts WHERE email = ?").get(normalizedEmail)) {
        throw identityError("An account already exists for that email address.", 409, "ACCOUNT_EXISTS");
      }
      const inserted = this.database.prepare(`
        INSERT INTO accounts (display_name, email)
        VALUES (?, ?)
      `).run(normalizedName, normalizedEmail);
      const accountId = Number(inserted.lastInsertRowid);
      this.database.prepare(`
        INSERT INTO password_credentials
          (account_id, algorithm, salt, password_hash, memory_kib, passes, parallelism)
        VALUES (?, 'argon2id', ?, ?, ?, ?, ?)
      `).run(accountId, credential.salt, credential.hash, credential.memory, credential.passes, credential.parallelism);
      const personInsert = this.database.prepare(`
        INSERT INTO people
          (display_name, person_kind, account_id, weekly_ai_token_limit)
        VALUES (?, 'primary', ?, ?)
      `).run(normalizedName, accountId, this.weeklyAiTokenLimit);
      const personId = Number(personInsert.lastInsertRowid);
      const code = this.createChallenge(accountId, "verify_email");
      this.recordSecurityEvent({ accountId, type: "account.register", outcome: "success" });
      return { accountId, personId, displayName: normalizedName, email: normalizedEmail, code };
    });
  }

  assertRegistrationEmailAllowed(email, initialOwnerEmail) {
    const normalized = normalizeAccountEmail(email);
    const count = Number(this.database.prepare("SELECT COUNT(*) AS count FROM people").get()?.count ?? 0);
    if (count === 0 && normalized !== normalizeAccountEmail(initialOwnerEmail)) {
      throw identityError("The initial Time v3 owner account must be registered first.", 403, "INITIAL_OWNER_REQUIRED");
    }
    return normalized;
  }

  verifyEmail({ email, code, clientId = "auth", userAgent = null, ipAddress = null }) {
    const account = this.accountByEmail(email);
    if (!account || account.account_status === "deleted") {
      throw identityError("The verification code is invalid or expired.", 400, "CHALLENGE_INVALID");
    }
    this.transaction(() => {
      this.consumeChallenge(account.account_id, "verify_email", code);
      this.database.prepare(`
        UPDATE accounts
           SET account_status = 'active', email_verified_at_utc = COALESCE(email_verified_at_utc, UTC_TIMESTAMP(3))
         WHERE account_id = ?
      `).run(account.account_id);
      this.recordSecurityEvent({ accountId: account.account_id, type: "account.email_verified", outcome: "success", userAgent, ipAddress });
    });
    return this.createSession({ accountId: account.account_id, clientId, userAgent, ipAddress });
  }

  resendVerification(email) {
    let account;
    try { account = this.accountByEmail(email); } catch { return null; }
    if (!account || account.account_status !== "pending") return null;
    return {
      accountId: Number(account.account_id),
      displayName: account.account_display_name,
      email: account.email,
      code: this.createChallenge(account.account_id, "verify_email"),
    };
  }

  authenticate({ email, password, clientId = "auth", userAgent = null, ipAddress = null }) {
    const account = this.accountByEmail(email);
    const dummy = {
      algorithm: this.dummyCredential.algorithm, salt: this.dummyCredential.salt,
      password_hash: this.dummyCredential.hash, memory_kib: this.dummyCredential.memory,
      passes: this.dummyCredential.passes, parallelism: this.dummyCredential.parallelism,
    };
    const valid = verifyPassword(password, account?.password_hash ? account : dummy);
    if (!valid || account.account_status !== "active") {
      this.recordSecurityEvent({ accountId: account?.account_id ?? null, type: "account.login", outcome: "failure", userAgent, ipAddress });
      throw identityError("Email or password is incorrect.", 401, "LOGIN_INVALID");
    }
    this.recordSecurityEvent({ accountId: account.account_id, type: "account.login", outcome: "success", userAgent, ipAddress });
    return this.createSession({ accountId: account.account_id, clientId, userAgent, ipAddress });
  }

  primaryPerson(accountId) {
    return this.database.prepare(`
      SELECT p.* FROM people p
       WHERE p.account_id = ? AND p.person_status = 'active'
       ORDER BY p.person_kind = 'primary' DESC, p.person_id LIMIT 1
    `).get(accountId);
  }

  createSession({ accountId, clientId, selectedPersonId = null, userAgent = null, ipAddress = null }) {
    const person = selectedPersonId
      ? this.authorizedPerson(accountId, selectedPersonId)
      : this.primaryPerson(accountId);
    if (!person) throw identityError("This account has no active Agent identity.", 403, "PERSON_UNAVAILABLE");
    const token = randomBytes(32).toString("base64url");
    const inserted = this.database.prepare(`
      INSERT INTO auth_sessions
        (account_id, selected_person_id, client_id, token_hash, expires_at_utc, user_agent, ip_address)
      VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND), ?, ?)
    `).run(accountId, person.person_id, clientId, tokenDigest(token), this.sessionSeconds,
      String(userAgent ?? "").slice(0, 500) || null, String(ipAddress ?? "").slice(0, 64) || null);
    return { token, sessionId: Number(inserted.lastInsertRowid), accountId: Number(accountId), person: publicPerson(person) };
  }

  session(token, clientId) {
    if (!token) return null;
    const row = this.database.prepare(`
      SELECT s.auth_session_id, s.account_id, s.selected_person_id, s.client_id,
             a.display_name AS account_display_name, a.email, a.account_status,
             p.person_id, p.display_name AS person_display_name, p.person_kind,
             p.person_status, p.weekly_ai_token_limit
        FROM auth_sessions s
        JOIN accounts a ON a.account_id = s.account_id
        JOIN people p ON p.person_id = s.selected_person_id AND p.account_id = s.account_id
       WHERE s.token_hash = ? AND s.client_id = ? AND s.revoked_at_utc IS NULL
         AND s.expires_at_utc > UTC_TIMESTAMP(3)
         AND a.account_status = 'active' AND p.person_status = 'active'
    `).get(tokenDigest(token), clientId);
    if (!row) return null;
    this.database.prepare(`
      UPDATE auth_sessions SET last_seen_at_utc = UTC_TIMESTAMP(3) WHERE auth_session_id = ?
    `).run(row.auth_session_id);
    return {
      sessionId: Number(row.auth_session_id),
      account: publicAccount(row),
      person: publicPerson(row),
    };
  }

  revokeSession(token, clientId) {
    if (!token) return false;
    return this.database.prepare(`
      UPDATE auth_sessions SET revoked_at_utc = UTC_TIMESTAMP(3)
       WHERE token_hash = ? AND client_id = ? AND revoked_at_utc IS NULL
    `).run(tokenDigest(token), clientId).changes > 0;
  }

  authorizedPerson(accountId, personId) {
    return this.database.prepare(`
      SELECT p.* FROM people p
       WHERE p.account_id = ? AND p.person_id = ? AND p.person_status = 'active'
    `).get(accountId, personId);
  }

  listPeople(accountId) {
    return this.database.prepare(`
      SELECT p.* FROM people p
       WHERE p.account_id = ? AND p.person_status = 'active'
       ORDER BY p.person_kind = 'primary' DESC, p.person_id
    `).all(accountId).map(publicPerson);
  }

  activePersonIds() {
    return this.database.prepare(`
      SELECT person_id FROM people WHERE person_status = 'active' ORDER BY person_id
    `).all().map((row) => Number(row.person_id));
  }

  createManagedPerson(accountId, name) {
    const normalizedName = displayName(name, "Identity name");
    return this.transaction(() => {
      const inserted = this.database.prepare(`
        INSERT INTO people
          (display_name, person_kind, account_id, weekly_ai_token_limit)
        VALUES (?, 'managed', ?, ?)
      `).run(normalizedName, accountId, this.weeklyAiTokenLimit);
      const personId = Number(inserted.lastInsertRowid);
      this.recordSecurityEvent({ accountId, type: "person.created", outcome: "success", details: `person_id=${personId}` });
      return publicPerson(this.authorizedPerson(accountId, personId));
    });
  }

  switchPerson(sessionId, accountId, personId) {
    const person = this.authorizedPerson(accountId, personId);
    if (!person) throw identityError("That Agent identity is unavailable.", 404, "PERSON_UNAVAILABLE");
    this.database.prepare(`
      UPDATE auth_sessions SET selected_person_id = ?, last_seen_at_utc = UTC_TIMESTAMP(3)
       WHERE auth_session_id = ? AND account_id = ? AND revoked_at_utc IS NULL
    `).run(personId, sessionId, accountId);
    return publicPerson(person);
  }

  requestPasswordReset(email) {
    let account;
    try { account = this.accountByEmail(email); } catch { return null; }
    if (!account || account.account_status !== "active") return null;
    return { accountId: Number(account.account_id), displayName: account.account_display_name,
      email: account.email, code: this.createChallenge(account.account_id, "reset_password") };
  }

  resetPassword({ email, code, password }) {
    const account = this.accountByEmail(email);
    if (!account || account.account_status !== "active") {
      throw identityError("The verification code is invalid or expired.", 400, "CHALLENGE_INVALID");
    }
    const credential = hashPassword(password);
    this.transaction(() => {
      this.consumeChallenge(account.account_id, "reset_password", code);
      this.database.prepare(`
        UPDATE password_credentials
           SET algorithm = 'argon2id', salt = ?, password_hash = ?, memory_kib = ?,
               passes = ?, parallelism = ?, changed_at_utc = UTC_TIMESTAMP(3)
         WHERE account_id = ?
      `).run(credential.salt, credential.hash, credential.memory, credential.passes,
        credential.parallelism, account.account_id);
      this.database.prepare(`
        UPDATE auth_sessions SET revoked_at_utc = UTC_TIMESTAMP(3)
         WHERE account_id = ? AND revoked_at_utc IS NULL
      `).run(account.account_id);
      this.recordSecurityEvent({ accountId: account.account_id, type: "account.password_reset", outcome: "success" });
    });
    return true;
  }

  createAuthorizationCode({ accountId, personId, clientId, redirectUri }) {
    if (!this.authorizedPerson(accountId, personId)) throw identityError("That Agent identity is unavailable.", 403);
    const code = randomBytes(32).toString("base64url");
    this.database.prepare(`
      INSERT INTO authorization_codes
        (account_id, person_id, client_id, code_hash, redirect_uri, expires_at_utc)
      VALUES (?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE))
    `).run(accountId, personId, clientId, tokenDigest(code), redirectUri);
    return code;
  }

  consumeAuthorizationCode({ code, clientId, redirectUri, userAgent = null, ipAddress = null }) {
    return this.transaction(() => {
      const row = this.database.prepare(`
        SELECT authorization_code_id, account_id, person_id
          FROM authorization_codes
         WHERE code_hash = ? AND client_id = ? AND redirect_uri = ?
           AND consumed_at_utc IS NULL AND expires_at_utc > UTC_TIMESTAMP(3)
         FOR UPDATE
      `).get(tokenDigest(code), clientId, redirectUri);
      if (!row) throw identityError("The sign-in handoff is invalid or expired.", 400, "AUTHORIZATION_CODE_INVALID");
      this.database.prepare(`
        UPDATE authorization_codes SET consumed_at_utc = UTC_TIMESTAMP(3)
         WHERE authorization_code_id = ?
      `).run(row.authorization_code_id);
      return this.createSession({ accountId: row.account_id, selectedPersonId: row.person_id,
        clientId, userAgent, ipAddress });
    });
  }

  rateLimit({ action, subject, maximum, windowSeconds }) {
    const now = Math.floor(Date.now() / 1000);
    const start = now - (now % windowSeconds);
    const started = new Date(start * 1000).toISOString();
    const hash = tokenDigest(String(subject ?? "").normalize("NFKC").trim().toLowerCase());
    this.database.prepare(`
      INSERT INTO auth_rate_limits
        (action_name, subject_hash, window_started_at_utc, attempt_count)
      VALUES (?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE attempt_count = attempt_count + 1
    `).run(action, hash, started);
    const row = this.database.prepare(`
      SELECT attempt_count FROM auth_rate_limits
       WHERE action_name = ? AND subject_hash = ? AND window_started_at_utc = ?
    `).get(action, hash, started);
    return { allowed: Number(row.attempt_count) <= maximum, attempts: Number(row.attempt_count), retryAfterSeconds: start + windowSeconds - now };
  }

  beginNodePairing({ deviceName, hardwareIdentifier = null }) {
    const name = displayName(deviceName, "Device name");
    const hardware = String(hardwareIdentifier ?? "").trim().slice(0, 255) || null;
    if (hardware && !/^[A-Za-z0-9._:-]+$/u.test(hardware)) {
      throw identityError("Hardware identifier contains unsupported characters.");
    }
    const deviceCode = randomBytes(32).toString("base64url");
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let rawCode = "";
    for (let index = 0; index < 8; index += 1) rawCode += alphabet[randomInt(0, alphabet.length)];
    const userCode = `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;
    this.database.prepare(`
      INSERT INTO node_pairings
        (device_code_hash, user_code_hash, device_name, hardware_identifier, expires_at_utc)
      VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE))
    `).run(tokenDigest(deviceCode), this.nodeUserCodeDigest(userCode), name, hardware);
    return { deviceCode, userCode, expiresIn: 600, interval: 5 };
  }

  approveNodePairing({ accountId, personId, userCode }) {
    const person = this.authorizedPerson(accountId, personId);
    if (!person) throw identityError("That Agent identity is unavailable.", 403, "PERSON_UNAVAILABLE");
    const row = this.transaction(() => {
      const pending = this.database.prepare(`
        SELECT node_pairing_id, device_name, hardware_identifier
          FROM node_pairings
         WHERE user_code_hash = ? AND pairing_status = 'pending'
           AND expires_at_utc > UTC_TIMESTAMP(3)
         ORDER BY node_pairing_id DESC LIMIT 1
         FOR UPDATE
      `).get(this.nodeUserCodeDigest(userCode));
      if (!pending) throw identityError("The node code is invalid or expired.", 404, "NODE_PAIRING_INVALID");
      this.database.prepare(`
        UPDATE node_pairings
           SET approved_account_id = ?, approved_person_id = ?, pairing_status = 'approved',
               approved_at_utc = UTC_TIMESTAMP(3)
         WHERE node_pairing_id = ?
      `).run(accountId, personId, pending.node_pairing_id);
      return pending;
    });
    this.recordSecurityEvent({ accountId, type: "node.approved", outcome: "success",
      details: `person_id=${personId}; node_pairing_id=${row.node_pairing_id}` });
    return { pairingId: Number(row.node_pairing_id), deviceName: row.device_name,
      hardwareIdentifier: row.hardware_identifier, person: publicPerson(person) };
  }

  exchangeNodePairing(deviceCode) {
    return this.transaction(() => {
      const row = this.database.prepare(`
        SELECT node_pairing_id, device_name, hardware_identifier, approved_account_id,
               approved_person_id, pairing_status,
               expires_at_utc > UTC_TIMESTAMP(3) AS is_unexpired
          FROM node_pairings WHERE device_code_hash = ?
         FOR UPDATE
      `).get(tokenDigest(deviceCode));
      if (!row) throw identityError("The node pairing is invalid or expired.", 400, "NODE_PAIRING_INVALID");
      if (row.pairing_status === "pending" && Boolean(row.is_unexpired)) {
        return { pending: true, interval: 5 };
      }
      if (!row.is_unexpired && ["pending", "approved"].includes(row.pairing_status)) {
        this.database.prepare(`
          UPDATE node_pairings SET pairing_status = 'expired' WHERE node_pairing_id = ?
        `).run(row.node_pairing_id);
        row.pairing_status = "expired";
      }
      if (row.pairing_status !== "approved") {
        throw identityError("The node pairing is invalid or expired.", 400, "NODE_PAIRING_INVALID");
      }
      const token = `tv3n_${randomBytes(32).toString("base64url")}`;
      let inserted;
      try {
        inserted = this.database.prepare(`
          INSERT INTO node_devices
            (person_id, approved_by_account_id, device_name, hardware_identifier, token_prefix, token_hash)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(row.approved_person_id, row.approved_account_id, row.device_name,
          row.hardware_identifier, token.slice(0, 12), tokenDigest(token));
      } catch (error) {
        if (error.code !== "ER_DUP_ENTRY" || !row.hardware_identifier) throw error;
        throw identityError("That hardware identifier is already linked to this Agent identity.", 409, "NODE_ALREADY_LINKED");
      }
      this.database.prepare(`
        UPDATE node_pairings SET pairing_status = 'consumed', consumed_at_utc = UTC_TIMESTAMP(3)
         WHERE node_pairing_id = ?
      `).run(row.node_pairing_id);
      return { pending: false, nodeDeviceId: Number(inserted.lastInsertRowid), token,
        personId: Number(row.approved_person_id) };
    });
  }

  authenticateNode(token) {
    if (!token) return null;
    const row = this.database.prepare(`
      SELECT d.node_device_id, d.person_id, d.device_name, d.hardware_identifier,
             p.display_name AS person_display_name, p.person_kind, p.person_status,
             p.weekly_ai_token_limit
        FROM node_devices d JOIN people p ON p.person_id = d.person_id
       WHERE d.token_hash = ? AND d.device_status = 'active' AND p.person_status = 'active'
    `).get(tokenDigest(token));
    if (!row) return null;
    this.database.prepare(`UPDATE node_devices SET last_seen_at_utc = UTC_TIMESTAMP(3) WHERE node_device_id = ?`)
      .run(row.node_device_id);
    return { nodeDeviceId: Number(row.node_device_id), deviceName: row.device_name,
      hardwareIdentifier: row.hardware_identifier, person: publicPerson(row) };
  }

  listNodeDevices(accountId, personId) {
    if (!this.authorizedPerson(accountId, personId)) throw identityError("That Agent identity is unavailable.", 403);
    return this.database.prepare(`
      SELECT node_device_id, device_name, hardware_identifier, token_prefix, device_status,
             created_at_utc, last_seen_at_utc, revoked_at_utc
        FROM node_devices WHERE person_id = ? ORDER BY node_device_id DESC
    `).all(personId).map((row) => ({ ...row, node_device_id: Number(row.node_device_id) }));
  }

  revokeNodeDevice(accountId, personId, nodeDeviceId) {
    if (!this.authorizedPerson(accountId, personId)) throw identityError("That Agent identity is unavailable.", 403);
    const changed = this.database.prepare(`
      UPDATE node_devices SET device_status = 'revoked', revoked_at_utc = UTC_TIMESTAMP(3)
       WHERE node_device_id = ? AND person_id = ? AND device_status = 'active'
    `).run(nodeDeviceId, personId).changes;
    if (!changed) throw identityError("Node device was not found.", 404, "NODE_NOT_FOUND");
    this.recordSecurityEvent({ accountId, type: "node.revoked", outcome: "success",
      details: `person_id=${personId}; node_device_id=${nodeDeviceId}` });
    return true;
  }

  recordSecurityEvent({ accountId = null, type, outcome, ipAddress = null, userAgent = null, details = null }) {
    this.database.prepare(`
      INSERT INTO auth_security_events
        (account_id, event_type, outcome, ip_address, user_agent, details_text)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(accountId, String(type).slice(0, 64), outcome,
      String(ipAddress ?? "").slice(0, 64) || null,
      String(userAgent ?? "").slice(0, 500) || null,
      String(details ?? "").slice(0, 2000) || null);
  }
}
