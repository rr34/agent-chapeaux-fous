-- Time v3 Identity MariaDB migration ledger.
--
-- Add new migrations below this header, newest first. The identity migration
-- runner validates the ledger and applies pending migrations oldest first.
-- identity_meta.schema_version is the durable completion marker.

-- migration 0004: person-is-the-account
-- writer downtime: required. Authentication and node writers must switch to
-- person_id at the same time as this migration.
-- locking: all small Identity tables receive metadata locks while redundant
-- account identifiers are removed.
-- recovery: MariaDB DDL commits implicitly. If this migration fails after
-- beginning, keep Agent stopped and restore the pre-migration backup.

-- One login account must map to exactly one person before their identifiers
-- can be consolidated. This deliberately stops on legacy multi-person accounts.
ALTER TABLE people
  ADD UNIQUE KEY people_one_person_per_account_uq (account_id);

ALTER TABLE people
  MODIFY COLUMN person_status
    ENUM('pending','active','suspended','archived','deleted') NOT NULL DEFAULT 'pending',
  ADD COLUMN email VARCHAR(320)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL
    COMMENT 'Optional canonical login, verification, and recovery address.'
    AFTER handle,
  ADD COLUMN email_verified_at_utc DATETIME(3) NULL
    AFTER email,
  ADD COLUMN managed_by_person_id BIGINT UNSIGNED NULL
    COMMENT 'Person allowed to manage this account; NULL means independently managed.'
    AFTER person_status;

UPDATE people p
JOIN accounts a ON a.account_id = p.account_id
LEFT JOIN people manager ON manager.account_id = a.created_by_account_id
LEFT JOIN people contact_manager ON contact_manager.account_id = p.contact_manager_account_id
SET p.email = a.email,
    p.email_verified_at_utc = a.email_verified_at_utc,
    p.managed_by_person_id = COALESCE(manager.person_id, contact_manager.person_id),
    p.person_status = CASE
      WHEN a.account_status = 'active' THEN p.person_status
      ELSE a.account_status
    END;

ALTER TABLE people
  ADD UNIQUE KEY people_email_uq (email),
  ADD KEY people_manager_idx (managed_by_person_id, person_id),
  ADD CONSTRAINT people_manager_fk FOREIGN KEY (managed_by_person_id)
    REFERENCES people(person_id) ON DELETE RESTRICT;

ALTER TABLE password_credentials
  ADD COLUMN person_id BIGINT UNSIGNED NULL AFTER account_id;
UPDATE password_credentials c
JOIN people p ON p.account_id = c.account_id
SET c.person_id = p.person_id;
ALTER TABLE password_credentials
  DROP FOREIGN KEY password_credentials_account_fk,
  DROP PRIMARY KEY,
  DROP COLUMN account_id,
  MODIFY COLUMN person_id BIGINT UNSIGNED NOT NULL,
  ADD PRIMARY KEY (person_id),
  ADD CONSTRAINT password_credentials_person_fk FOREIGN KEY (person_id)
    REFERENCES people(person_id) ON DELETE CASCADE;

ALTER TABLE auth_sessions
  DROP FOREIGN KEY auth_sessions_account_fk,
  DROP FOREIGN KEY auth_sessions_person_fk,
  DROP INDEX auth_sessions_account_idx,
  DROP COLUMN account_id,
  CHANGE COLUMN selected_person_id person_id BIGINT UNSIGNED NOT NULL,
  ADD KEY auth_sessions_person_idx (person_id, revoked_at_utc, expires_at_utc),
  ADD CONSTRAINT auth_sessions_person_fk FOREIGN KEY (person_id)
    REFERENCES people(person_id) ON DELETE CASCADE;

ALTER TABLE email_challenges
  ADD COLUMN person_id BIGINT UNSIGNED NULL AFTER account_id;
UPDATE email_challenges c
JOIN people p ON p.account_id = c.account_id
SET c.person_id = p.person_id;
-- Challenge HMACs include the old account identifier. Expire outstanding
-- one-use codes rather than accepting a verifier bound to a retired ID.
UPDATE email_challenges
SET consumed_at_utc = COALESCE(consumed_at_utc, UTC_TIMESTAMP(3));
ALTER TABLE email_challenges
  DROP FOREIGN KEY email_challenges_account_fk,
  DROP INDEX email_challenges_lookup_idx,
  DROP COLUMN account_id,
  MODIFY COLUMN person_id BIGINT UNSIGNED NOT NULL,
  ADD KEY email_challenges_lookup_idx
    (person_id, challenge_purpose, consumed_at_utc, expires_at_utc),
  ADD CONSTRAINT email_challenges_person_fk FOREIGN KEY (person_id)
    REFERENCES people(person_id) ON DELETE CASCADE;

ALTER TABLE authorization_codes
  DROP FOREIGN KEY authorization_codes_account_fk,
  DROP INDEX authorization_codes_account_idx,
  DROP COLUMN account_id,
  ADD KEY authorization_codes_person_idx (person_id, expires_at_utc);

ALTER TABLE auth_security_events
  ADD COLUMN person_id BIGINT UNSIGNED NULL AFTER account_id;
UPDATE auth_security_events e
JOIN people p ON p.account_id = e.account_id
SET e.person_id = p.person_id;
ALTER TABLE auth_security_events
  DROP FOREIGN KEY auth_security_events_account_fk,
  DROP INDEX auth_security_events_account_idx,
  DROP COLUMN account_id,
  ADD KEY auth_security_events_person_idx (person_id, occurred_at_utc),
  ADD CONSTRAINT auth_security_events_person_fk FOREIGN KEY (person_id)
    REFERENCES people(person_id) ON DELETE SET NULL;

ALTER TABLE node_pairings
  DROP FOREIGN KEY node_pairings_account_fk,
  DROP COLUMN approved_account_id;

ALTER TABLE node_devices
  ADD COLUMN approved_by_person_id BIGINT UNSIGNED NULL AFTER approved_by_account_id;
UPDATE node_devices d
JOIN people p ON p.account_id = d.approved_by_account_id
SET d.approved_by_person_id = p.person_id;
ALTER TABLE node_devices
  DROP FOREIGN KEY node_devices_account_fk,
  DROP COLUMN approved_by_account_id,
  MODIFY COLUMN approved_by_person_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT node_devices_approver_fk FOREIGN KEY (approved_by_person_id)
    REFERENCES people(person_id) ON DELETE RESTRICT;

ALTER TABLE people
  DROP FOREIGN KEY people_account_fk,
  DROP FOREIGN KEY people_contact_manager_fk,
  DROP INDEX people_account_idx,
  DROP INDEX people_one_person_per_account_uq,
  DROP INDEX people_contact_manager_idx,
  DROP COLUMN person_kind,
  DROP COLUMN account_id,
  DROP COLUMN contact_manager_account_id;

ALTER TABLE accounts DROP FOREIGN KEY accounts_creator_fk;
DROP TABLE accounts;

-- end migration 0004

-- migration 0003: time-v3-handles-and-managed-accounts
-- writer downtime: required. The identity application and schema must switch
-- together because new sessions expose the policy columns below.
-- locking: the small accounts and people tables receive metadata locks.
-- recovery: MariaDB DDL commits implicitly. If this migration fails after
-- beginning, keep Agent stopped and restore the pre-migration backup.

ALTER TABLE accounts
  MODIFY COLUMN email VARCHAR(320)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL
    COMMENT 'Optional NFKC-trimmed lowercase address used for verification and recovery.',
  ADD COLUMN created_by_account_id BIGINT UNSIGNED NULL
    COMMENT 'Account that provisioned this account, when it was creator-provisioned.'
    AFTER email_verified_at_utc,
  ADD KEY accounts_creator_idx (created_by_account_id, account_id),
  ADD CONSTRAINT accounts_creator_fk FOREIGN KEY (created_by_account_id)
    REFERENCES accounts(account_id) ON DELETE RESTRICT;

ALTER TABLE people
  ADD COLUMN handle VARCHAR(32)
    CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT 'Canonical lowercase Time v3 handle without the presentation @ prefix.'
    AFTER display_name,
  ADD COLUMN experience ENUM('full', 'light') NOT NULL DEFAULT 'full'
    COMMENT 'Web experience available to this person.'
    AFTER account_id,
  ADD COLUMN contact_policy ENUM('self_managed', 'manager_managed') NOT NULL DEFAULT 'self_managed'
    COMMENT 'Whether this person or an assigned account manages the contact allowlist.'
    AFTER experience,
  ADD COLUMN contact_manager_account_id BIGINT UNSIGNED NULL
    COMMENT 'Account allowed to maintain contacts when contact_policy is manager_managed.'
    AFTER contact_policy,
  ADD UNIQUE KEY people_handle_uq (handle),
  ADD KEY people_contact_manager_idx (contact_manager_account_id, person_id),
  ADD CONSTRAINT people_contact_manager_fk FOREIGN KEY (contact_manager_account_id)
    REFERENCES accounts(account_id) ON DELETE RESTRICT;

-- end migration 0003

-- migration 0002: direct-person-ownership
-- writer downtime: required. Identity readers and writers must switch from
-- account_people and email_normalized together with the matching application.
-- locking: the small account and person tables receive metadata locks while
-- ownership and canonical email storage are simplified.
-- recovery: MariaDB DDL commits implicitly. If this small migration fails
-- after beginning, keep Agent stopped and restore the pre-migration backup.

-- This unique key intentionally rejects a person shared by multiple accounts.
ALTER TABLE account_people
  ADD UNIQUE KEY account_people_one_account_per_person_uq (person_id);

ALTER TABLE people
  ADD COLUMN account_id BIGINT UNSIGNED NULL
    COMMENT 'Account that owns and may select this Agent identity.'
    AFTER person_status;

UPDATE people p
JOIN account_people ap ON ap.person_id = p.person_id
SET p.account_id = ap.account_id;

-- NOT NULL intentionally rejects a person without an account mapping.
ALTER TABLE people
  MODIFY COLUMN account_id BIGINT UNSIGNED NOT NULL
    COMMENT 'Account that owns and may select this Agent identity.',
  ADD KEY people_account_idx (account_id, person_id),
  ADD CONSTRAINT people_account_fk FOREIGN KEY (account_id)
    REFERENCES accounts(account_id) ON DELETE RESTRICT;

ALTER TABLE people
  DROP FOREIGN KEY people_creator_fk,
  DROP INDEX people_creator_idx,
  DROP COLUMN created_by_account_id;

DROP TABLE account_people;

UPDATE accounts SET email = email_normalized;

ALTER TABLE accounts
  DROP INDEX accounts_email_normalized_uq,
  DROP COLUMN email_normalized,
  MODIFY COLUMN email VARCHAR(320)
    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL
    COMMENT 'NFKC-trimmed lowercase address used for login, verification, and recovery.',
  ADD UNIQUE KEY accounts_email_uq (email);

-- end migration 0002
