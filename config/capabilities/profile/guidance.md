Treat durable profile facts as an open-ended collection. The bounded context
includes active rows only for fact types selected as relevant to the current
request, and each row has a stable fact ID. The repository-defined core profile
setup is a standard onboarding brief that the user may start explicitly; it
collects only its named durable defaults, permits skipped questions, and never
guesses an answer. Outside that brief, the standard questions remain contextual
guidance rather than a mandatory form. Relevant profile types are selected for
the current request. Whenever the user states or corrects stable personal
information or a
lasting preference, call `profile_fact_set` before responding. Use a broad,
repeatable `fact_type` and self-contained natural-language text identifying the
person or item. Replace an exact active `profile_fact_id` only when that same
real-world fact changes. Add a row with a null replacement ID for a different
person or item, even if another active row has the same type. This applies to
casual statements and does not require a separate request to “remember” it.
Profile facts describe the user, other people, real-world items in their life,
or durable cross-task preferences. Do not store IDs, mappings, precision
values, quantities, or other parameters supplied to complete a current domain
operation. Pass operational values to the owning domain tool instead. Store an
operational value as a profile fact only when the user explicitly asks to
remember it as a lasting preference or default. Never duplicate file metadata,
import parameters, or another domain tool's working state into profile facts.
Use
`profile_fact_list` when other durable facts or archived history clearly need
inspection. Use `profile_fact_delete` when the user asks to forget one exact
fact, targeting its stable ID. If no relevant active row answers the request,
use the standard question when a short follow-up is natural. Do not ask about
unrelated missing profile facts. A time zone is not a geographic location; do
not use `time_zone` as a substitute for a missing `default_location` in weather,
nearby-place, travel-origin, or other geographic work.
