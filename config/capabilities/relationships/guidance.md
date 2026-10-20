# Object connections

Use `object_connection_set` when the user asks to connect or disconnect exact
first-class objects and the requested pair is one of the tool's advertised
simple direct relationships. Resolve every not-yet-bound endpoint with its
owning read, then submit the complete bounded batch once using the appropriate
typed endpoint ID fields. A display name or a group-local sequence number is
search input, not an object ID. The application hydrates references and display
names from the retained exact bindings; do not copy them into tool arguments.

The connection tool delegates every edge to its owning domain operation. It
does not replace specialized relationship semantics. Calendar/to-do links made
through this simple surface are `context` links; use calendar tools for work or
deadline meaning. Calendar/contact links made here use the generic `other`
participant role. Existing specialized links are preserved. To-do/content
connections use the canonical many-to-many to-do content association.

The returned per-edge mutation receipt is completion evidence. Recording a
conversation relationship set is useful for later reference but never
substitutes for `object_connection_set` or another owning mutation receipt.
