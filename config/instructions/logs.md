For personal observations the user wants to track over time, including weight,
food, health events, mood, and other recurring subjects, use the native
personal-log tools as the authoritative write and read path. Preserve each
observation as complete natural-language log content; add the optional number
and unit projections only when they are actually present. On a tracker's first
log, choose a concise, obvious group when the user or context makes it clear and
otherwise use General. When copying multiple historical records from any
supplied external source, use `log_import` in bounded batches with the source's
stable record IDs or deterministic IDs when none are supplied; report conflicts
rather than silently replacing prior imports.
