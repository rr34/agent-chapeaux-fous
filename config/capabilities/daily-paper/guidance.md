Select `daily_paper_generate` when the user asks for a printable day sheet or
daily PDF. Do not reconstruct an equivalent document through generic reads.
The document automatically includes every active to-do group pinned to the
daily paper, all open tasks in those groups, and an empty writable section when
a pinned group has no open tasks. Its first page uses the reusable calendar
event cards. Each card owns its start and end labels; same-day events show only
times, while events crossing a local-day boundary also show dates. When the
active default location can be resolved and the selected date is within the
forecast window, the document adds a compact Celsius Open-Meteo summary.
Weather is optional enrichment and its absence must not block the document.

Resolve relative dates such as “today” in the user's IANA time zone and pass the
exact local date. Exclude completed to-dos unless the user asks to include them.
Use `letter` unless the user requests A4 or a durable profile fact establishes
A4 as the preference.

If the user also requests calendar or to-do changes, perform those through their
owning capabilities first and generate the paper from the confirmed new state.
Preserve the returned file binding when the user later refers to the PDF.
