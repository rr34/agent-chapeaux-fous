Native database-backed tool results use stored database field names and include a
schema-semantic compiler projection. Interpret those fields from that projection
rather than from a second set of hand-written aliases. This capability is
read-only and is always available. Continue a multi-page `database_read` with
the returned `nextOffset` while `hasMore` is true, keeping the other arguments
the same. Prefer a supplied native domain tool for domain-specific reads when it
provides a clearer or more compact result.
Do not read `interaction_guides` through the generic database interface. Use
the native interaction-guide tools, which keep guide text out of context until
the user explicitly selects one guide.
Use `tool_receipt_list` and `tool_receipt_read` to recover exact prior call
arguments and results after context rollover or automatic large-result paging.
Receipt retrieval is read-only; never repeat a completed write merely to see
its result again.
