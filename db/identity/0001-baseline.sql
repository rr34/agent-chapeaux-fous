-- Time v3 Identity MariaDB schema baseline.
-- Target: MariaDB 10.11, schema version 1.
--
-- Apply only to the empty timev3_identity database after reviewing the
-- operator runbook. Agent application data does not belong in this database.

SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE identity_meta (
    singleton       TINYINT UNSIGNED NOT NULL,
    schema_version  INT UNSIGNED NOT NULL,
    created_at_utc  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (singleton),
    CONSTRAINT identity_meta_singleton CHECK (singleton = 1)
) ENGINE=InnoDB COMMENT='Records the installed Time v3 Identity schema version. Contains no person or credential data.';

CREATE TABLE accounts (
    account_id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable internal identifier for one authenticated Time v3 account.',
    display_name          VARCHAR(200) NOT NULL COMMENT 'Account holder name shown in authentication and account-management interfaces.',
    email                 VARCHAR(320) NOT NULL COMMENT 'Current delivery address for login verification and account recovery.',
    email_normalized      VARCHAR(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'NFKC-trimmed lowercase email used only for exact account matching.',
    account_status        ENUM('pending','active','suspended','deleted') NOT NULL DEFAULT 'pending' COMMENT 'pending: email is unverified; active: login allowed; suspended: administratively blocked; deleted: retained tombstone.',
    email_verified_at_utc DATETIME(3) COMMENT 'UTC instant when control of the current email address was verified.',
    created_at_utc        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at_utc        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (account_id),
    UNIQUE KEY accounts_email_normalized_uq (email_normalized)
) ENGINE=InnoDB COMMENT='Owns login-level identity. Agent records never use account_id as their data owner; they use a selected person_id.';

CREATE TABLE password_credentials (
    account_id       BIGINT UNSIGNED NOT NULL,
    algorithm        ENUM('argon2id') NOT NULL DEFAULT 'argon2id',
    salt             VARBINARY(32) NOT NULL COMMENT 'Unique random Argon2id salt; not a secret.',
    password_hash    VARBINARY(64) NOT NULL COMMENT 'Argon2id output; plaintext passwords are never stored.',
    memory_kib       INT UNSIGNED NOT NULL,
    passes           INT UNSIGNED NOT NULL,
    parallelism      INT UNSIGNED NOT NULL,
    changed_at_utc   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (account_id),
    CONSTRAINT password_credentials_account_fk FOREIGN KEY (account_id)
      REFERENCES accounts(account_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Stores one current password verifier for an account, independently from ordinary account fields.';

CREATE TABLE people (
    person_id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'Stable Agent data-owner identity selected after account authentication.',
    display_name               VARCHAR(200) NOT NULL COMMENT 'User-chosen label that distinguishes this Agent identity; it need not be a legal name.',
    person_kind                ENUM('primary','managed') NOT NULL COMMENT 'primary: created with public account registration; managed: additional identity created inside an account.',
    person_status              ENUM('active','archived') NOT NULL DEFAULT 'active',
    created_by_account_id      BIGINT UNSIGNED NOT NULL COMMENT 'Account that created this identity; retained as provenance rather than sole authorization.',
    weekly_ai_token_limit      BIGINT UNSIGNED NOT NULL DEFAULT 19100000 COMMENT 'Maximum recorded model tokens permitted in a rolling seven-day window for this person.',
    created_at_utc             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at_utc             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (person_id),
    KEY people_creator_idx (created_by_account_id, person_id),
    CONSTRAINT people_creator_fk FOREIGN KEY (created_by_account_id)
      REFERENCES accounts(account_id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='Defines the direct owner of Agent application data. A managed identity requires no email or separate login.';

CREATE TABLE account_people (
    account_id       BIGINT UNSIGNED NOT NULL,
    person_id        BIGINT UNSIGNED NOT NULL,
    access_role      ENUM('owner','operator') NOT NULL DEFAULT 'owner',
    created_at_utc   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (account_id, person_id),
    KEY account_people_person_idx (person_id, account_id),
    CONSTRAINT account_people_account_fk FOREIGN KEY (account_id)
      REFERENCES accounts(account_id) ON DELETE CASCADE,
    CONSTRAINT account_people_person_fk FOREIGN KEY (person_id)
      REFERENCES people(person_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Authorizes an authenticated account to operate one exact Agent person identity.';

CREATE TABLE auth_sessions (
    auth_session_id  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_id       BIGINT UNSIGNED NOT NULL,
    selected_person_id BIGINT UNSIGNED NOT NULL,
    client_id        VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Host-local session audience, initially auth or agent.',
    token_hash       BINARY(32) NOT NULL COMMENT 'SHA-256 verifier for the random token held only in an HttpOnly cookie.',
    created_at_utc   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_seen_at_utc DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at_utc   DATETIME(3) NOT NULL,
    revoked_at_utc   DATETIME(3),
    user_agent       VARCHAR(500),
    ip_address       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
    PRIMARY KEY (auth_session_id),
    UNIQUE KEY auth_sessions_token_uq (token_hash),
    KEY auth_sessions_account_idx (account_id, revoked_at_utc, expires_at_utc),
    CONSTRAINT auth_sessions_account_fk FOREIGN KEY (account_id)
      REFERENCES accounts(account_id) ON DELETE CASCADE,
    CONSTRAINT auth_sessions_person_fk FOREIGN KEY (selected_person_id)
      REFERENCES people(person_id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='Stores revocable host-local browser sessions. One account may hold separate auth and Agent cookies.';

CREATE TABLE email_challenges (
    email_challenge_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_id         BIGINT UNSIGNED NOT NULL,
    challenge_purpose  ENUM('verify_email','reset_password') NOT NULL,
    code_hash          BINARY(32) NOT NULL COMMENT 'HMAC-SHA-256 verifier for a six-digit code; the code is sent but never stored.',
    attempts           INT UNSIGNED NOT NULL DEFAULT 0,
    created_at_utc     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at_utc     DATETIME(3) NOT NULL,
    consumed_at_utc    DATETIME(3),
    PRIMARY KEY (email_challenge_id),
    KEY email_challenges_lookup_idx (account_id, challenge_purpose, consumed_at_utc, expires_at_utc),
    CONSTRAINT email_challenges_account_fk FOREIGN KEY (account_id)
      REFERENCES accounts(account_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Stores short-lived one-use email verification and recovery challenges.';

CREATE TABLE authorization_codes (
    authorization_code_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_id             BIGINT UNSIGNED NOT NULL,
    person_id              BIGINT UNSIGNED NOT NULL,
    client_id              VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    code_hash              BINARY(32) NOT NULL COMMENT 'SHA-256 verifier for a random one-use browser handoff code.',
    redirect_uri           VARCHAR(2048) NOT NULL,
    created_at_utc         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at_utc         DATETIME(3) NOT NULL,
    consumed_at_utc        DATETIME(3),
    PRIMARY KEY (authorization_code_id),
    UNIQUE KEY authorization_codes_hash_uq (code_hash),
    KEY authorization_codes_account_idx (account_id, expires_at_utc),
    CONSTRAINT authorization_codes_account_fk FOREIGN KEY (account_id)
      REFERENCES accounts(account_id) ON DELETE CASCADE,
    CONSTRAINT authorization_codes_person_fk FOREIGN KEY (person_id)
      REFERENCES people(person_id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Stores five-minute one-use codes that establish a host-local Agent session after authentication.';

CREATE TABLE auth_rate_limits (
    rate_limit_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    action_name       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    subject_hash      BINARY(32) NOT NULL COMMENT 'SHA-256 of the normalized email or network subject; plaintext rate-limit subjects are not retained.',
    window_started_at_utc DATETIME(3) NOT NULL,
    attempt_count     INT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (rate_limit_id),
    UNIQUE KEY auth_rate_limits_window_uq (action_name, subject_hash, window_started_at_utc),
    KEY auth_rate_limits_cleanup_idx (window_started_at_utc)
) ENGINE=InnoDB COMMENT='Persists bounded authentication attempt counters so process restarts do not clear abuse controls.';

CREATE TABLE auth_security_events (
    security_event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    account_id        BIGINT UNSIGNED,
    event_type        VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    outcome           ENUM('success','failure','blocked') NOT NULL,
    ip_address        VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
    user_agent        VARCHAR(500),
    details_text      TEXT COMMENT 'Bounded non-secret operational detail; never stores passwords, session tokens, or verification codes.',
    occurred_at_utc   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (security_event_id),
    KEY auth_security_events_account_idx (account_id, occurred_at_utc),
    KEY auth_security_events_type_idx (event_type, occurred_at_utc),
    CONSTRAINT auth_security_events_account_fk FOREIGN KEY (account_id)
      REFERENCES accounts(account_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Append-oriented authentication security history with secrets excluded.';

CREATE TABLE node_pairings (
    node_pairing_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_code_hash      BINARY(32) NOT NULL COMMENT 'SHA-256 verifier for the long random code returned only to the requesting node.',
    user_code_hash        BINARY(32) NOT NULL COMMENT 'HMAC-SHA-256 verifier for the short code shown to the person.',
    device_name           VARCHAR(200) NOT NULL COMMENT 'Node-supplied label shown during confirmation.',
    hardware_identifier   VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin COMMENT 'Optional stable hardware identifier used for display and duplicate review, never as a credential.',
    approved_account_id   BIGINT UNSIGNED,
    approved_person_id    BIGINT UNSIGNED,
    pairing_status        ENUM('pending','approved','denied','consumed','expired') NOT NULL DEFAULT 'pending',
    created_at_utc        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at_utc        DATETIME(3) NOT NULL,
    approved_at_utc       DATETIME(3),
    consumed_at_utc       DATETIME(3),
    PRIMARY KEY (node_pairing_id),
    UNIQUE KEY node_pairings_device_code_uq (device_code_hash),
    UNIQUE KEY node_pairings_user_code_uq (user_code_hash),
    KEY node_pairings_expiry_idx (pairing_status, expires_at_utc),
    CONSTRAINT node_pairings_account_fk FOREIGN KEY (approved_account_id)
      REFERENCES accounts(account_id) ON DELETE SET NULL,
    CONSTRAINT node_pairings_person_fk FOREIGN KEY (approved_person_id)
      REFERENCES people(person_id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='Holds short-lived node pairing attempts. Approval binds one exact pending node to the currently selected person.';

CREATE TABLE node_devices (
    node_device_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    person_id            BIGINT UNSIGNED NOT NULL COMMENT 'Exact Agent identity whose data this node may access.',
    approved_by_account_id BIGINT UNSIGNED NOT NULL,
    device_name          VARCHAR(200) NOT NULL,
    hardware_identifier VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin,
    token_prefix         VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Non-secret prefix shown when the person reviews devices.',
    token_hash           BINARY(32) NOT NULL COMMENT 'SHA-256 verifier for the 256-bit random device credential; plaintext is returned once.',
    device_status        ENUM('active','revoked') NOT NULL DEFAULT 'active',
    created_at_utc       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_seen_at_utc     DATETIME(3),
    revoked_at_utc      DATETIME(3),
    PRIMARY KEY (node_device_id),
    UNIQUE KEY node_devices_token_uq (token_hash),
    UNIQUE KEY node_devices_person_hardware_uq (person_id, hardware_identifier),
    KEY node_devices_person_idx (person_id, device_status, node_device_id),
    CONSTRAINT node_devices_person_fk FOREIGN KEY (person_id)
      REFERENCES people(person_id) ON DELETE RESTRICT,
    CONSTRAINT node_devices_account_fk FOREIGN KEY (approved_by_account_id)
      REFERENCES accounts(account_id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='Stores revocable Agent node credentials owned directly by one person identity.';

INSERT INTO identity_meta (singleton, schema_version) VALUES (1, 1);
