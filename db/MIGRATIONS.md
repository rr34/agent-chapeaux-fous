# Chapeaux Fous MariaDB migrations

`migrations.sql` is the incremental migration ledger. Add each migration block
directly below its header, newest first. The runner validates that layout and
applies pending blocks oldest first. The fresh-install schema remains separate
in `mariadb/0001-baseline.sql` and must always describe the latest schema.

`database_meta.schema_version` is the durable completion marker. The runner
updates it only after every SQL statement in a block and the migration's
integrity checks succeed. Applied blocks remain in the ledger and are skipped
on later runs. Versions are immutable after application, and pending versions
must be sequential with no gaps.

Every block must use these exact boundary markers:

```sql
-- migration 0032: short-description
-- writer downtime: required or not required; explain why.
-- locking: describe metadata locks, table rebuilds, or long-running work.
-- recovery: explain how to inspect, resume, or restore after partial commit.

-- SQL statements

-- end migration 0032
```

MariaDB DDL can implicitly commit, so a failed multi-statement migration is not
automatically rolled back. Order additive work first, populate and validate
data before stricter constraints, make safe replay explicit, and keep database
writers stopped after a failure until the committed state has been inspected.

## Production operator sequence

Run the migration only after creating and testing a current recoverable dump.
The confirmation variables are assertions by the operator; the script does not
create a backup or stop the service itself.

```bash
cd /home/nate/code/agent-chapeaux-fous

systemctl --user stop agent-slayer.service

# Create a current mariadb-dump and prove it can be restored before continuing.

export SLAYER_MIGRATION_BACKUP_CONFIRMED=1
export SLAYER_MIGRATION_WRITERS_STOPPED=1
npm run db:migrate
unset SLAYER_MIGRATION_BACKUP_CONFIRMED SLAYER_MIGRATION_WRITERS_STOPPED

npm run db:verify
npm test

systemctl --user start agent-slayer.service
systemctl --user status agent-slayer.service --no-pager
```

Do not restart the service when migration or verification fails. If no
migrations are pending, `npm run db:migrate` is a read-only integrity check and
does not require the confirmation variables.

## Version 37: Correspondence join tables

Adds `todo_correspondence_join` and `calendar_events_correspondence_join`.
Each stores the two linked IDs as a composite primary key and `created_at_utc`,
with a reverse message lookup index and cascading foreign keys on both IDs.
Deleting a parent removes its links, never the other parent. Calendar links
refer to the event record (the whole series for recurring events).

This migration adds empty tables without copying or importing messages. Linking
UI and model tools are separate work; the tables do not make provider emails
or text messages available as local correspondence automatically. Generic
database write permissions remain unchanged.

The application requires schema version 37. After preparing a verified backup,
apply the migration with `SLAYER_MIGRATION_BACKUP_CONFIRMED=1` and run
`npm run db:verify`. This block does not require writer downtime; earlier pending
blocks may still require it. Replay retains existing links and validates the
table definitions before advancing the schema version.

## Version 35: Native database comments

This migration moves storage descriptions into MariaDB table and column
comments. It repeats the version 34 column definitions with COMMENT clauses;
rows, constraints, indexes, defaults, and generated expressions are preserved.
It requires writer downtime and uses ALGORITHM=INSTANT to refuse a table rebuild.
Generated-column descriptions remain SQL source comments: modifying those
columns even for a comment can require a table rebuild.
If the algorithm is refused, inspect the actual column definitions for drift;
do not remove the guard to force the migration through. Rerunning after a partial
DDL commit safely sets the same comments again. Restore prior comments from the
backup if their previous text must be recovered.

The matching application requires schema version 35 and removes the schema
compiler dependency and generated semantic file. Pull the application, install
its locked dependencies, apply migrations, and run `npm run db:verify` before
starting it. There is no semantic synchronization step. If a previous server
sync left the formerly tracked JSON locally modified, preserve that file outside
the checkout or stash it before pulling; inspect any local authored notes before
discarding the saved copy. Do not reapply old generated mechanics after upgrade.

Table/column comments in the baseline and migration ledger own storage prose.
Longer notes and view descriptions are SQL source comments. Tool execution
instructions and input/output schemas own model-facing behavior and meanings.
Legacy keyword and synonym notes are retained beside the SQL definitions;
compiler fingerprints, timestamps, and routing weights are intentionally retired.

The comment migration uses MariaDB [COMMENT clauses and ALTER TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/alter/alter-table); column definitions must be retained when using MODIFY.

## Version 34: Contact tag join table

Version 34 renames `record_tags` to `contacts_tags_join` and drops `record_links`
with its contents. The rename preserves every tag assignment, timestamp, column,
index, and foreign key. It retains `record_type` and `record_id`; converting
those legacy columns into a contact foreign key is a separate schema change.
The existing index and constraint names also remain intact.

Apply this migration and the matching application during approved writer
downtime using the operator sequence above. The application requires schema
version 34. Verify before starting writers.
If the rename commits before the migration finishes, rerunning skips that
rename and completes the drop. An existing destination is never overwritten.

## Version 33: Remove unused notes

Version 33 drops the standalone `notes` table and its contents. Personal writing
uses the existing Journal feature and `journal_entries.content_text`. Journal
entries, trackers, contact notes, and historical activity receipts are unchanged.
That application version requires schema version 33.

This block does not require writer downtime because no application feature
reads or writes `notes`. Create and test a recoverable backup as above, then run
`npm run db:migrate` with `SLAYER_MIGRATION_BACKUP_CONFIRMED=1`, run `npm run db:verify`. Do not assert that writers were
stopped when applying this block online. Earlier pending migrations may still
require the downtime described in their own blocks.

The drop is replayable if it commits before the version marker advances.
Recovering discarded notes requires restoring them from the verified backup.

## Version 32: Journal

Version 32 renames the personal journal tables, primary-key columns, tracker
group reference, indexes, constraints, and triggers. It retains existing entry
and tracker IDs, content, timestamps, import provenance, and source-event links.
Historical activity receipts remain literal records of the tools originally
called and are not rewritten.

Deploy this migration and the matching Journal application together during the
approved writer downtime. That application version requires schema version 32
and uses
`journal_add`, `journal_import`, `journal_list`, `journal_update`,
`journal.active_trackers`, `/api/journal-trackers`, and `/api/journal-entries`.
Verify the migrated database before starting the application.

If an earlier attempt stopped with `log_entries_event` and
`log_entries_tracker` still present on `journal_entries`, keep writers stopped
and rerun migration 0032 with the corrected ledger. It explicitly drops both
legacy and replacement foreign keys before recreating the replacements in
separate statements, addressing [MariaDB MDEV-32270](https://jira.mariadb.org/browse/MDEV-32270).
The runner records version 32 only after integrity checks pass; do not advance
the version manually. Then run `db:verify`
before starting the application.

Trigger bodies use prepared SQL so the ledger retains complete compound
statements with the existing statement splitter. This is supported by the
MariaDB 10.11 baseline target; see the [MariaDB PREPARE documentation](https://mariadb.com/docs/server/reference/sql-statements/prepared-statements/prepare-statement).
