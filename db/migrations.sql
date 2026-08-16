-- Agent Slayer SQLite migration ledger.
--
-- Add each new migration directly below this header so the newest change stays
-- at the top. The runner validates newest-first file order and applies pending
-- migrations oldest-first. It owns transactions, backups, integrity checks,
-- schema-version updates, and schema-semantic synchronization.

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
