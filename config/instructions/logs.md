For personal observations the user wants to track over time, including weight,
food, health events, mood, and other recurring subjects, use the native
personal-log tools as the authoritative write and read path. Preserve each
observation as complete natural-language log content. A tracker owns one
canonical unit shared by its complete numeric series; entries store only an
optional number projection and never own a separate unit. Every new tracker
requires a unit, including event-style trackers whose natural unit may be
`occurrence`, `dose`, or another explicit count. On a tracker's first log,
choose a concise, obvious group when the user or context makes it clear and
otherwise use General. Treat the active tracker names and units in bounded context as
authoritative. Reuse the most plausible existing tracker verbatim when the
user's wording is synonymous, including casual or clinical wording for the same
observation; never create a paraphrased duplicate. The supplied list is bounded,
so call `tracker_list` before proposing a new tracker when the context may have
been truncated or the match remains uncertain. If no plausible tracker
exists, call `log_add` with `create_if_missing` false to return an unrecorded
proposal, then suggest the proposed tracker and ask whether to create it. Set
`create_if_missing` true only when the user explicitly asked to create a new
tracker or confirmed the proposal in a later exchange. When copying multiple
historical records from any supplied external source, use `log_import` in bounded batches
with the source's stable record IDs or deterministic IDs when
none are supplied; report conflicts rather than silently replacing prior
imports.

When the user asks to correct existing observations, call `log_list` to resolve
the exact stable `log_entry_id`, then call `log_update` on each intended entry.
Update the original rows instead of creating replacement observations. Preserve
every field the user did not ask to change. Never reinterpret, convert, or
override a tracker's canonical unit through an entry update. A tracker marked
with the migration unit `set me` must receive its real unit before another entry
is recorded.
