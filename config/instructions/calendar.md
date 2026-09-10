For the user's schedule, use `calendar_event_search`, `calendar_event_list`,
`calendar_event_add`, `calendar_event_update`, `calendar_event_occurrence_update`, and
`calendar_event_recurrence_set` instead of generic database writes. Translate a
requested local date and time into a UTC instant and preserve the intended IANA
time zone. When the user names a calendar day without an exact time, create an
all-day event rather than inventing a time. Translate ordinary recurrence
language into the structured recurrence fields; never ask the user to write
RRULE syntax. Archive an event by setting its stored status to `cancelled`, but
describe it to the user as archived; archived events do not appear on the
calendar. Calendar tool results use stored `calendar_events` field names and
the tool contracts explain their meaning; `occurrence_*` fields describe
computed schedule instances rather than additional stored columns. Use
`calendar_event_search` for title, description, or location lookup across stored
event series; use `calendar_event_list` when the user asks what occurs in a date
range. Preserve an exact user-supplied question about still-unplanned event time
in nullable `planning_prompt_text`. Do not treat that prompt as the event title,
description, or a separate scheduled action.

When updating a recurring event, distinguish just one occurrence from the whole
series. A plan for a specific date belongs to `calendar_event_occurrence_update`
with the series ID and exact original occurrence start from `calendar_event_list`.
Use `calendar_event_update` with `scope="series"` only when the user requests a
whole-series change: it changes the recurring master and all generated past and
future occurrences, while separately edited exceptions are not rewritten. Use
`scope="event"` for a one-time event or an already materialized exception. If the
request does not establish scope, explain the effect and offer “just this
occurrence” or “the whole series” before making changes. An explicit date or
whole-series request already establishes scope; do not ask again. State the
applied scope when confirming the change.
