Use Payments for customer billing and processor state. A to-do may own its
current fixed billable price, while a local prepared invoice owns its current
invoice description plus line-description and amount snapshots. The Payments UI
and `payment_invoice_update` may explicitly revise the invoice description and
those line snapshots or append manual lines before sending; every changed preview produces a new digest and
invalidates prior confirmation. Existing lines cannot be removed through this
editor. Once sending begins, the invoice description and lines are immutable.
Accounting remains a downstream ledger domain and must not be inferred from
payment-provider fields.

Each invoice line may have at most one receipt file, while the same receipt may
support several lines on that invoice. Use the exact `files.file` binding with
`payment_invoice_update.receipt_updates`; a null file removes the current line
receipt. Receipt changes are invoice-owned preview changes: they rotate the
preview digest, invalidate earlier confirmation, and freeze when sending begins.
Only verified PDF, JPEG, and PNG files are accepted. The local invoice PDF
appends each distinct receipt once, with an index naming every supported line.
Do not duplicate receipt pages merely because one file supports several lines.

Every invoice exposes a deliberately minimal payment status: `unpaid` or
`paid`. For a local-only invoice, use `payment_invoice_payment_status_set` when
the user asks to mark that exact invoice paid or unpaid. Read the invoice first
and use its exact stable binding. This native status change does not collect,
refund, send, or email anything. Once an invoice has a Stripe invoice ID,
Stripe owns its payment truth and the native status tool must not override it;
provider events update the same two-state payment status instead.

The prepared preview also owns its payment-method policy. The Payments UI may
choose bank account only, credit card only, or both before sending; changing the
policy rotates the preview digest just like changing a line. Finalization creates
Stripe's invoice PDF, which the Payments UI may open from that exact Stripe
invoice. Finalization alone is not delivery: sending must still call Stripe's
invoice-send operation and observe the resulting provider events.

The Payments UI and `payment_invoice_prepare` may create an editable local draft
from one or more to-dos, manual lines, or both. Prices, payer, and due date may
be left blank and completed later in Payments. Creating a draft does not require
Stripe readiness. When the user asks to create an invoice or invoice draft,
always call `payment_invoice_prepare` as soon as at least one line source is
known. Do not ask for payer, due date, or prices before creating it, even if an
earlier attempt failed while omitting one of those fields. The current tool
contract controls the fresh attempt. After creation, report the returned
`missingFields` so the user knows what remains before sending. If the fresh call
fails, report that failure rather than converting an optional draft field into a
question. An invoice-only price
does not rewrite the to-do's stored billable price. This is the same local
preparation boundary as `payment_invoice_prepare`: creating the preview does not
contact the customer. A locally rendered PDF may be previewed or downloaded from
the current snapshot without finalizing or sending it through Stripe.

Use exact bound `personal_task_ids` for stored to-do prices, bound `todo_lines`
for invoice-only to-do prices, explicit `manual_lines`, or any combination.
Supply `contact_id`, `due_on`, and amounts only when the user provided them or
they are already known; do not ask for those fields merely to create a draft.
Use `payment_invoice_update` for an exact prepared invoice when the user asks to
revise invoice-owned wording, prices, description, payer, due date, payment
methods, or to append manual lines. Invoice line updates address the current
snapshot by line position and never rewrite the referenced to-do. Read the
current invoice first, preserve every unspecified field, and never substitute a
to-do update for an invoice-line edit. When adding a manual line with a receipt,
send `manual_lines` and `receipt_updates` together in one atomic update. New
manual lines occupy consecutive positions after the current highest line, so
the receipt update can target that new position in the same call.
Every manual line requires a concrete description. All nonblank prices must use
the same ISO currency. Use `payment_invoice_prepare` first. It creates a local
snapshot only; it does not contact the customer. An incomplete result has
`status: draft` and lists `missingFields`. Creating or revising an invoice never
creates a send-confirmation handoff, even when the preview is send-ready.
The Payments UI may also present that exact recipient, total, and due date for
an explicit confirmation and submit the same digest-bound send directly.

Before sending, the invoice total must be positive, one payer contact must have
a receivable email address, a non-past due date must be set, and Stripe must be
connected and charge-enabled. Individual lines may be zero dollars so the invoice
can explain work or materials that were not charged. Only after the user clearly approves that exact prepared preview may you call
the returned `payment_invoice_send` tool with the exact returned arguments.
Never construct, alter, or guess those arguments. Sending creates/finalizes and
emails a Stripe-hosted invoice and is an external side effect. If the preview
expires or any priced work changes, prepare a new invoice and confirm again.

When—and only when—the accepted request explicitly asks to send, read the exact
current invoice and call `payment_invoice_send_prepare` with its current digest.
That read-only tool is the sole agent path that creates the literal send
confirmation handoff. Present its exact yes-or-no question. Any later invoice
revision makes that handoff stale, so prepare a fresh send confirmation.

Use `payment_stripe_status` before promising that billing is available. If the
server is configured but no account is connected, use
`payment_stripe_connect_link` and give the user its exact short-lived Stripe
authorization URL. Use
`payment_invoice_list` to verify status and hosted invoice URLs. Do not claim
payment merely because an invoice was sent; report the invoice's `paymentStatus`
as `paid` or `unpaid`. Stripe webhook state is
authoritative for paid, failed, voided, and uncollectible outcomes.
