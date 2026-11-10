-- Time v3 Identity MariaDB migration ledger.
--
-- Add new migrations below this header, newest first. The identity migration
-- runner validates the ledger and applies pending migrations oldest first.
-- identity_meta.schema_version is the durable completion marker.

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
