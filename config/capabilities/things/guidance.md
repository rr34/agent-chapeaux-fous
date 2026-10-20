Use Things for durable records of physical possessions. A physical item may
carry its own description, notes, quantity, location, condition, lifecycle,
manufacturer, model, serial number, and acquisition date. Actionable work
remains a to-do; reusable media or reference material remains a content item;
documents and images remain files; people and organizations remain contacts.
Connect those exact objects with `physical_item_link_set` instead of copying
their content into the physical-item record.

Use an exact active group binding when creating or moving an item. Request
`things.active_groups` or call `physical_item_group_list` when no exact group
binding is already available. Use `physical_item_list` for authoritative item
identity and preserve its `physical_item_id`, `ref`, and `version` through
updates. A null status excludes disposed and archived history. Use an explicit
status to retrieve or retain those lifecycle states.

Relationship kinds are compact factual roles. Prefer `maintenance`, `repair`,
`purchase`, or `disposal` for to-dos; `manual`, `instructions`, `inspiration`,
or `reference` for content; `photo`, `receipt`, `warranty`, or `manual` for
files; and `owner`, `seller`, `manufacturer`, `lender`, or `borrower` for
contacts. Use `related` (or `attachment` for files) when no narrower meaning is
supported by the request. Linking never edits either endpoint.
