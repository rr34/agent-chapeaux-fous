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
