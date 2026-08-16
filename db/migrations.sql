-- Agent Slayer SQLite migration ledger.
--
-- Add each new migration directly below this header so the newest change stays
-- at the top. The runner validates newest-first file order and applies pending
-- migrations oldest-first. It owns transactions, backups, integrity checks,
-- schema-version updates, and schema-semantic synchronization.

-- migration 0009: typed-profile-facts
-- Let one broad fact type contain multiple self-describing active rows. Tools
-- replace or archive an exact row by its stable profile_fact_id.

DROP INDEX profile_facts_status_key;
DROP INDEX profile_facts_one_active_key;

ALTER TABLE profile_facts RENAME COLUMN fact_key TO fact_type;
ALTER TABLE profile_facts RENAME COLUMN value_text TO fact_text;

UPDATE profile_facts
SET fact_type = CASE fact_type
    WHEN 'wife_vehicle' THEN 'vehicle'
    WHEN 'user_shoe_size' THEN 'clothing_size'
    WHEN 'son_vince_shoe_size' THEN 'clothing_size'
    WHEN 'household_members' THEN 'household_member'
    WHEN 'pets' THEN 'pet'
    WHEN 'scheduling_preferences' THEN 'scheduling_preference'
    WHEN 'dietary_preference' THEN 'dietary_information'
    WHEN 'dietary_preferences' THEN 'dietary_information'
    WHEN 'dietary_requirement' THEN 'dietary_information'
    WHEN 'food_allergy' THEN 'dietary_information'
    WHEN 'food_allergies' THEN 'dietary_information'
    WHEN 'accessibility_needs' THEN 'accessibility_need'
    WHEN 'clothing_sizes' THEN 'clothing_size'
    WHEN 'travel_preferences' THEN 'travel_preference'
    ELSE fact_type
END;

CREATE INDEX profile_facts_status_type
    ON profile_facts(fact_status, fact_type, profile_fact_id);
-- end migration 0009

-- migration 0008: profile-facts
-- Store current and archived user-owned profile facts in SQLite so conversation
-- tools, first-call context, and observability share one durable authority.

CREATE TABLE profile_facts (
    profile_fact_id   INTEGER PRIMARY KEY,
    fact_key          TEXT NOT NULL
                      CHECK (length(trim(fact_key)) BETWEEN 1 AND 200),
    value_text        TEXT NOT NULL
                      CHECK (length(trim(value_text)) BETWEEN 1 AND 10000),
    fact_status       TEXT NOT NULL DEFAULT 'active'
                      CHECK (fact_status IN ('active', 'archived')),
    source_event_id   TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
    archived_by_event_id TEXT REFERENCES activity_events(event_id) ON DELETE SET NULL,
    created_at_utc    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at_utc    TEXT,
    archived_at_utc   TEXT,
    CHECK (
        (fact_status = 'active' AND archived_at_utc IS NULL)
        OR (fact_status = 'archived' AND archived_at_utc IS NOT NULL)
    )
) STRICT;

CREATE INDEX profile_facts_status_key
    ON profile_facts(fact_status, fact_key);

CREATE UNIQUE INDEX profile_facts_one_active_key
    ON profile_facts(fact_key)
    WHERE fact_status = 'active';
-- end migration 0008
