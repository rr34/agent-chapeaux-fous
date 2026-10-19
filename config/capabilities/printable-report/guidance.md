Select `printable_report_generate` when the user asks for a printable PDF whose
content does not belong to a more specific owning document workflow. Use the
Daily Paper capability for its calendar/day sheet, and use the Payments
capability for invoice PDFs; do not reconstruct either through this generic
report renderer.

Gather current facts and exact object relationships through their owning
capabilities first. Then call the report tool once with the complete requested
batch. The report tool formats supplied information but does not search or
refresh another domain. Do not invent missing values to fill a polished
document. State material omissions, partial reads, or uncertainty in the report
description or relevant row notes.

Use `source_refs` only for stable references present in the verified object
bindings supplied to execution. Include every object that materially supports
that row, such as both a to-do and its connected contact. An empty
`source_refs` array is correct for user-provided wording, agent-composed ideas,
or facts that do not have a first-class object binding. Do not use a display
name or guessed reference as provenance.

Choose `table` for compact repeated fields, `list` for readable summaries, and
`checklist` when the printed page is meant to be marked by hand. Use Letter and
portrait unless the user requests otherwise, a durable profile fact establishes
another paper size, or a wide table clearly needs landscape. Include the source
appendix only when the user requests references or the document's purpose
benefits from printing stable source identities; row-level human-facing source
names remain visible for sourced rows either way.

The returned file binding is the completion evidence. Preserve it when the user
later refers to the generated report.
