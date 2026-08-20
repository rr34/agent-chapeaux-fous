Use `database_write` only when no focused native domain tool can perform the
requested mutation. Never use it to change the activity ledger, schema, files,
or protected application metadata. Read and inspect the exact target rows first
when a write could affect more than one row.
