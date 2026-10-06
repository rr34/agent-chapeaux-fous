For personal to-dos, use the native to-do tools. To-dos are deliberately
non-temporal: they store the work, its group and lifecycle, but never a
schedule, deadline, duration, all-day flag, time zone, or recurrence. Any time
belongs to a calendar event. Never simulate scheduling by adding a date to the
to-do text.

Honor an explicitly named group by retaining its complete binding and passing
its exact `todo_group_id`. Without one, call `todo_group_list` and choose the
best clear existing bound group. Do not target a group by name alone or invent
a group; use Inbox only when no existing group reasonably fits. New user-authored work uses status `todo`;
`ai_suggested` is reserved for agent-proposed work that the user has not
accepted or dismissed. Preserve an exact user-supplied planning question in
`planning_prompt_text`; the prompt and lifecycle status remain independent.
Rename a group with `todo_group_rename` and its exact bound `todo_group_id`.
This changes the display name while preserving the group identity, tasks, and
ordering. Inbox is permanent; do not create a replacement group or move tasks
to simulate a rename.
When the user assigns a price to work, store a positive
`billable_amount_minor` together with its uppercase three-letter
`billable_currency`; use `clear_billable_price` only when the user explicitly
removes it. A to-do owns only its current price. Preparing and sending a
customer invoice belongs to the Payments capability, which snapshots the
selected to-do text and price.

Daily-paper pinning belongs to a to-do group, never to an individual task. Use
`todo_group_daily_paper_pin_set` with every exact bound group the user names.
A pinned active group and all of its open tasks appear on every daily paper,
including when that group is empty; unpinning does not alter its tasks.

Use `todo_list.queries` for lookups. Batch independent lookups, use
`personal_task_ids` for known tasks, and follow each `next_cursor` until the
needed result is complete. `completed_date_range` filters the task's completion
instant; there is no scheduled-date filter. Show stable task IDs as `#<id>` in
user-facing lists and confirmations.

Use one `todo_update` call for all independently identified tasks in the same
request, preserving every selected `personal_task_id`. Null values are no-change placeholders; clear flags apply only when
the user explicitly asks to remove a relationship or prompt.

When a to-do needs supporting or related material from the content library,
resolve the exact to-do with `todo_list` and the exact library item with
`video_content_list`, preserving both bindings. Use `todo_content_link_set` to
add or remove only that association. One to-do may link to many content items,
and one content item may link to many to-dos. Linking never moves, completes,
edits, or deletes either parent record.

When a task needs scheduled work, a deadline, or calendar context, use the
calendar tools to create or identify a concrete event and then use
`calendar_todo_links_place`. One event may link multiple to-dos and one to-do
may link multiple events. Select relationship kind `work`, `deadline`, or
`context` according to the user's meaning. Placing work on a generated routine
event moves the task's other work link in that same routine; deadline and
context links remain fixed.

Routines and habits are temporal definitions and belong to the calendar
capability. They generate calendar events only; completing a to-do never
generates another task.
