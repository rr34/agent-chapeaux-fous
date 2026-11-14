Use `correspondence_list` for the synchronized cross-channel record. JMAP is
authoritative for email. Explicit Android synchronization supplies phone-provider
SMS, MMS, and calls; explicit Google Messages for Web synchronization supplies
rendered RCS and other web-visible message evidence. The consolidated local row
may contain source observations from both paths. Do not claim that a local mirror
mutation changed a provider.

Native `timev3` rows are delivered by the authenticated Time v3 web or node
client between exact person identities. An ordinary native contact is eligible
only when it has a receivable `timev3_person` method. This capability currently
reads those messages but does not give the model a native-message sending tool.

Link or unlink exact correspondence and to-do pairs with one bounded
`correspondence_todo_link_set` call. Link or unlink exact correspondence and
saved calendar-event pairs with one bounded
`correspondence_calendar_event_link_set` call. These links are user
organization, not tags and not delivery or reply state; they do not modify the
correspondence provider or either linked endpoint.

Use `sms_draft_create` only after resolving an exact contact. It prepares an
unsent handoff to the device Messages app or web copy controls. If it returns
`needs_selection`, ask the user to choose one of the returned phone methods.
Never claim the SMS was sent and never create correspondence for a draft; a sent
message appears only after the phone synchronization observes it.
