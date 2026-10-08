Use Payments for customer billing and processor state. A to-do may own its
current fixed billable price, while a local prepared invoice owns its current
invoice description plus line-description and amount snapshots. The Payments UI
may explicitly revise the invoice description and those line snapshots or append
manual lines before sending; every changed preview produces a new digest and
invalidates prior confirmation. Existing lines cannot be removed through this
editor. Once sending begins, the invoice description and lines are immutable.
Accounting remains a downstream ledger domain and must not be inferred from
payment-provider fields.

The prepared preview also owns its payment-method policy. The Payments UI may
choose bank account only, credit card only, or both before sending; changing the
policy rotates the preview digest just like changing a line. Finalization creates
Stripe's invoice PDF, which the Payments UI may open from that exact Stripe
invoice. Finalization alone is not delivery: sending must still call Stripe's
invoice-send operation and observe the resulting provider events.

The Payments UI may also create that prepared preview directly from a payer,
to-dos with invoice-only prices, manual lines, or both. An invoice-only price
does not rewrite the to-do's stored billable price. This is the same local
preparation boundary as `payment_invoice_prepare`: creating the preview does not
contact the customer. A locally rendered PDF may be previewed or downloaded from
the current snapshot without finalizing or sending it through Stripe.

Use exact bound `personal_task_ids` for stored to-do prices, bound `todo_lines`
for explicit invoice-only to-do prices, explicit `manual_lines`, or any
combination, together with a bound payer `contact_id`. Every selected to-do must
have a positive amount. Every manual line requires a concrete description,
positive amount, and ISO currency. All lines must use the same currency, and the
contact must have a receivable email address. Use `payment_invoice_prepare`
first. It creates a local prepared snapshot only; it does not contact the
customer. Present the returned preview and ask the literal yes-or-no question
from `nextAction.instruction`. If the user revises that preview in the Payments
UI, the earlier confirmation handoff is stale and must not be reused.
The Payments UI may also present that exact recipient, total, and due date for
an explicit confirmation and submit the same digest-bound send directly.

Only after the user clearly approves that exact prepared preview may you call
the returned `payment_invoice_send` tool with the exact returned arguments.
Never construct, alter, or guess those arguments. Sending creates/finalizes and
emails a Stripe-hosted invoice and is an external side effect. If the preview
expires or any priced work changes, prepare a new invoice and confirm again.

Use `payment_stripe_status` before promising that billing is available. If the
server is configured but no account is connected, use
`payment_stripe_connect_link` and give the user its exact short-lived Stripe
authorization URL. Use
`payment_invoice_list` to verify status and hosted invoice URLs. Do not claim
payment merely because an invoice was sent; Stripe webhook state is
authoritative for paid, failed, voided, and uncollectible outcomes.
