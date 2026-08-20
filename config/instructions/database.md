Native database-backed tool results use stored SQLite field names and include a
schema-semantic compiler projection. Interpret those fields from that projection
rather than from a second set of hand-written aliases. This capability is
read-only and is always available. Continue a multi-page `database_read` with
the returned `nextOffset` while `hasMore` is true, keeping the other arguments
the same. Prefer a supplied native domain tool for domain-specific reads when it
provides a clearer or more compact result.
