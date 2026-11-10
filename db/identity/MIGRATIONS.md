# Time v3 Identity database initialization

The identity database is separate from the Agent application database. Nate
applies every live identity schema change manually. Application startup never
creates, drops, or alters identity tables.

For an empty `timev3_identity` database, initialize version 1 and immediately
upgrade it to the current version, but only after replacing the password that
appeared in chat and confirming a recoverable server backup:

```bash
mariadb \
  --host=localhost \
  --user=timev3_auth_user \
  --password \
  timev3_identity < db/identity/0001-baseline.sql

SLAYER_MIGRATION_BACKUP_CONFIRMED=1 \
SLAYER_MIGRATION_WRITERS_STOPPED=1 \
npm run identity:migrate

npm run identity:verify
```

To upgrade an existing version-1 identity database, stop the Agent service so
there are no identity writers, retain a recoverable database backup, and run
the `identity:migrate` command above. Restart only after
`npm run identity:verify` succeeds. Identity migrations live newest-first in
the single `db/identity/migrations.sql` ledger and are applied oldest-first.
Migration 2 deliberately stops if a person is shared by multiple accounts or
has no account mapping; do not discard or guess ownership if that guard fails.

Do not apply `db/mariadb/0001-baseline.sql` to this database. That schema owns
Agent data and belongs only in the configured `MARIADB_NAME` database.
