# Time v3 Identity database initialization

The identity database is separate from the Agent application database. Nate
applies every live identity schema change manually. Application startup never
creates, drops, or alters identity tables.

For the currently empty `timev3_identity` database, initialize version 1 only
after replacing the password that appeared in chat and confirming a recoverable
server backup:

```bash
mariadb \
  --host=localhost \
  --user=timev3_auth_user \
  --password \
  timev3_identity < db/identity/0001-baseline.sql

npm run identity:verify
```

Do not apply `db/mariadb/0001-baseline.sql` to this database. That schema owns
Agent data and belongs only in the configured `MARIADB_NAME` database.
