Use `database_write` only for its explicit transitional allowlist: content
groups and content items, which do not yet have focused model mutation tools.
Every other native domain table, the activity ledger, files, and schema are
application-rejected even if a future table appears in SQLite. Read and inspect
the exact target rows first when a write could affect more than one row.
