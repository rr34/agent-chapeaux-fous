Use `global_search` when the user asks to discover information across multiple
application-owned domains or does not know where something was stored. Choose
only the scopes relevant to the request. Use `terms` for ordinary discovery,
`phrase` for adjacent words in order, and `near` when the words should occur
within `max_distance` tokens. Providers retain their native matching behavior
and report the mode they actually applied; never imply that a provider used
phrase or proximity matching when its result reports a fallback or another
mode. Treat `partial=true`, provider errors, non-exhaustive results, and
warnings literally. A zero-hit partial search does not prove that no matching
data exists.

Global results are compact discovery references. After identifying a result,
use the domain-specific capability for rich filters, complete native fields, or
any follow-up action. Search never authorizes or performs a write.
