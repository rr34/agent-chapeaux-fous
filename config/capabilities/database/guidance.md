Native database-backed tool results use stored database field names. Interpret
inputs and results using the owning tool's published contracts. Use
`database_schema` when live column definitions, relationships, or MariaDB
comments are needed to understand a generic read. This capability is
read-only and is always available. Continue a multi-page `database_read` with
the returned `nextOffset` while `hasMore` is true, keeping the other arguments
the same. Use `database_aggregate` for current counts and comparisons that can
be expressed over one table or view. Resolve named objects first, keep equality
filters exact, use a `presence` dimension for missing-versus-present questions,
and claim complete totals only when `exhaustive` is true. Prefer a supplied native domain tool for domain-specific reads when it
provides a clearer or more compact result. Once a successful owning-domain read
returns the facts needed for the request, do not use `database_schema`,
`database_read`, `database_aggregate`, or `tool_receipt_read` to rediscover,
validate, recount, or reinterpret those same facts. Use a generic database read
only for a specific required field, relationship, or aggregate absent from the
owning tool's contract or current result. When live schema is genuinely needed,
target the relevant `objectName`; do not request the full schema catalog by
default.
Use `tool_receipt_list` and `tool_receipt_read` to recover exact prior call
arguments and results after context rollover or automatic large-result paging.
Receipt retrieval is read-only; never repeat a completed write merely to see
its result again.
