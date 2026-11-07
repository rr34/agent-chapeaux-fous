Select `daily_paper_generate` when the user asks for a printable weekly planner
or weekly calendar PDF. The stable tool name is retained for compatibility; it
heads the document with the Monday-to-Sunday week containing the supplied date
and shows that week followed by the next week. Do not
reconstruct an equivalent document through generic reads.

The document automatically includes every active to-do group pinned to the
paper, all open tasks in those groups, and an empty writable section when a
pinned group has no open tasks. Each day's events retain their time labels, and
open linked to-dos sit directly beneath their event in both displayed weeks.
The full-width to-do section includes every distinct open to-do linked in the
headed week, followed by pinned groups with those current-week scheduled items
removed from the group lists.

Resolve relative dates such as “this week” in the user's IANA time zone and
pass any exact local date within that week. Exclude completed to-dos unless the
user asks to include them. Use `letter` unless the user requests A4 or a durable
profile fact establishes A4 as the preference.

If the user also requests calendar or to-do changes, perform those through their
owning capabilities first and generate the paper from the confirmed new state.
Preserve the returned file binding when the user later refers to the PDF.
