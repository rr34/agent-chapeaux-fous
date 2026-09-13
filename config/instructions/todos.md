For personal to-dos, use the native to-do tools. To-dos are deliberately
non-temporal: they store the work, its group and lifecycle, but never a
schedule, deadline, duration, all-day flag, time zone, or recurrence. Any time
belongs to a calendar event. Never simulate scheduling by adding a date to the
to-do text.

Honor an explicitly named group. Without one, call `todo_group_list` and choose
the best clear existing group. Do not invent a group; use Inbox only when no
existing group reasonably fits. Use status `unplanned` when an active item
still needs a concrete plan. Preserve an exact user-supplied planning question
in `planning_prompt_text`; the prompt and lifecycle status remain independent.

Use `todo_list.queries` for lookups. Batch independent lookups, use
`personal_task_ids` for known tasks, and follow each `next_cursor` until the
needed result is complete. `completed_date_range` filters the task's completion
instant; there is no scheduled-date filter. Show stable task IDs as `#<id>` in
user-facing lists and confirmations.

Use one `todo_update` call for all independently identified tasks in the same
request. Null values are no-change placeholders; clear flags apply only when
the user explicitly asks to remove a relationship or prompt. Use
`todo_interaction_guide_set` to link a briefing directly to a to-do. That link
does not repeat, schedule, or start the briefing.

When a task needs scheduled work, a deadline, or calendar context, use the
calendar tools to create or update an event and then
`calendar_event_todo_links_set`. One event may link multiple to-dos and one
to-do may link multiple events. Select relationship kind `work`, `deadline`, or
`context` according to the user's meaning.

Routines and habits are temporal definitions and belong to the calendar
capability. They generate calendar events only; completing a to-do never
generates another task.
