import assert from "node:assert/strict";
import test from "node:test";
import { PaymentInputError, PaymentService } from "../src/payments.mjs";
import { registerPaymentTools } from "../src/tools/payment-tools.mjs";
import { schemaProblem, ToolRegistry } from "../src/tools/registry.mjs";

function service() {
  const database = {
    prepare(sql) {
      assert.match(sql, /payment_provider_accounts/u);
      return { get: () => null };
    },
  };
  return new PaymentService({
    store: { status: { ready: true }, requireReady: () => database },
    config: {
      publicUrl: "https://slayer.example.test/",
      stripeSecretKey: "sk_test_example",
      stripeConnectClientId: "ca_example",
      stripeConnectStateSecret: "separate-state-secret",
      stripeConnectWebhookSecret: "whsec_example",
    },
  });
}

test("Stripe Connect links bind a short-lived signed callback state", () => {
  const payments = service();
  const authorization = new URL(payments.beginOAuth().url);
  assert.equal(authorization.origin, "https://connect.stripe.com");
  assert.equal(authorization.searchParams.get("client_id"), "ca_example");
  assert.equal(
    authorization.searchParams.get("redirect_uri"),
    "https://slayer.example.test/api/payments/stripe/oauth/callback",
  );
  const state = authorization.searchParams.get("state");
  assert.doesNotThrow(() => payments.verifyState(state));
  assert.throws(
    () => payments.verifyState(`${state}tampered`),
    (error) => error instanceof PaymentInputError && error.code === "INVALID_STRIPE_STATE",
  );
});

test("Stripe readiness stays unavailable until a connected account is stored", () => {
  const payments = service();
  assert.deepEqual(payments.health(), {
    ready: false,
    configured: true,
    connected: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    status: null,
    reason: "No Stripe account is connected",
  });
});

test("invoice history is loaded newest first", () => {
  const database = {
    prepare(sql) {
      assert.match(sql, /ORDER BY payment_invoice_id DESC LIMIT \?/u);
      return { all: (limit) => {
        assert.equal(limit, 3);
        return [{ payment_invoice_id: 9 }, { payment_invoice_id: 7 }, { payment_invoice_id: 2 }];
      } };
    },
  };
  const payments = new PaymentService({
    store: { status: { ready: true }, requireReady: () => database },
    config: {},
  });
  payments.getInvoice = (invoiceId) => ({ invoiceId });

  assert.deepEqual(payments.listInvoices({ limit: 3 }), [
    { invoiceId: 9 },
    { invoiceId: 7 },
    { invoiceId: 2 },
  ]);
});

test("invoice preparation accepts task-backed, manual, and mixed line sources", () => {
  const registry = new ToolRegistry();
  registerPaymentTools(registry, {});
  const schema = registry.get("payment_invoice_prepare").parameters;
  const base = { contact_id: 7, due_on: "2030-01-02" };

  assert.equal(schemaProblem({ ...base, personal_task_ids: [11] }, schema), null);
  assert.equal(schemaProblem({
    ...base,
    todo_lines: [{ personal_task_id: 12, amount_minor: 3000, currency: "USD" }],
  }, schema), null);
  assert.equal(schemaProblem({
    ...base,
    manual_lines: [{ description: "Help moving", amount_minor: 2500, currency: "USD" }],
  }, schema), null);
  assert.equal(schemaProblem({
    ...base,
    personal_task_ids: [11],
    manual_lines: [{ description: "Materials", amount_minor: 1250, currency: "USD" }],
  }, schema), null);
});

test("invoice preparation tells the model to create before reporting optional missing fields", () => {
  const registry = new ToolRegistry();
  registerPaymentTools(registry, {});
  const definition = registry.get("payment_invoice_prepare");
  assert.match(definition.description, /Immediately create an editable local invoice draft/);
  assert.match(definition.description, /Do not ask for line prices, payer, or due date before calling this tool/);
  assert.match(definition.description, /report missingFields afterward/);
});

test("invoice update is a bound snapshot edit that cannot send or rewrite to-dos", async () => {
  const calls = [];
  const registry = new ToolRegistry();
  registerPaymentTools(registry, {
    patchPreparedInvoice(invoiceId, input, activity) {
      calls.push({ invoiceId, input, activity });
      return { status: "draft", invoice: { invoiceId }, missingFields: ["line_prices"] };
    },
  });
  const definition = registry.get("payment_invoice_update");
  const input = {
    invoice_id: 3,
    preview_digest: `sha256:${"a".repeat(64)}`,
    description: "5423 Garden Ridge",
    line_updates: [{ position: 1, description: "Install anti-tip device" }],
  };

  assert.equal(schemaProblem(input, definition.parameters), null);
  assert.match(schemaProblem({
    invoice_id: 3, preview_digest: input.preview_digest,
  }, definition.parameters), /does not match any allowed schema/u);
  assert.match(definition.description, /leaving its referenced to-dos unchanged/u);
  assert.match(definition.description, /never finalizes, sends, emails, or changes a to-do/u);
  assert.equal(definition.confirmationHandoff, true);
  assert.deepEqual(await definition.execute(input, { requestId: "request-1" }), {
    status: "draft", invoice: { invoiceId: 3 }, missingFields: ["line_prices"],
  });
  assert.deepEqual(calls, [{
    invoiceId: 3,
    input,
    activity: { requestId: "request-1", actorType: "tool", actorName: "payment_invoice_update" },
  }]);
});

test("partial invoice patches preserve unspecified snapshot text and prices", () => {
  const payments = new PaymentService({
    store: { status: { ready: true }, requireReady() { throw new Error("database should not be read directly"); } },
    config: {},
  });
  payments.getInvoice = () => ({
    invoiceId: 3,
    paymentMethodPolicy: "ach_only",
    lines: [
      { position: 1, description: "Install anti-tip device — 5423 Garden Ridge", amountMinor: 0 },
      { position: 2, description: "Replace doorbell — 5423 Garden Ridge", amountMinor: 2500 },
    ],
  });
  let forwarded;
  payments.updatePreparedInvoice = (invoiceId, input, activity) => {
    forwarded = { invoiceId, input, activity };
    return { invoice: { invoiceId } };
  };

  const activity = { actorType: "tool", actorName: "payment_invoice_update" };
  assert.deepEqual(payments.patchPreparedInvoice(3, {
    preview_digest: `sha256:${"b".repeat(64)}`,
    description: "5423 Garden Ridge",
    line_updates: [{ position: 1, description: "Install anti-tip device" }],
    manual_lines: [{ description: "Materials" }],
  }, activity), { invoice: { invoiceId: 3 } });
  assert.deepEqual(forwarded, {
    invoiceId: 3,
    input: {
      previewDigest: `sha256:${"b".repeat(64)}`,
      paymentMethodPolicy: "ach_only",
      description: "5423 Garden Ridge",
      lines: [
        { position: 1, description: "Install anti-tip device", amountMinor: 0 },
        { position: 2, description: "Replace doorbell — 5423 Garden Ridge", amountMinor: 2500 },
        { position: 3, description: "Materials", amountMinor: 0 },
      ],
    },
    activity,
  });
  assert.throws(() => payments.patchPreparedInvoice(3, {
    preview_digest: `sha256:${"b".repeat(64)}`,
    line_updates: [{ position: 9, description: "Unknown" }],
  }), (error) => error instanceof PaymentInputError && error.code === "INVOICE_LINE_NOT_FOUND");
});

test("invoice preparation accepts an invoice-only price for an otherwise unpriced to-do", async () => {
  const writes = { transactions: [], lines: [] };
  const database = {
    exec(sql) { writes.transactions.push(sql); },
    prepare(sql) {
      if (/FROM todo_personal/u.test(sql)) return { all: () => [{
        personal_task_id: 12, text: "Unpriced task", status: "todo",
        billable_amount_minor: null, billable_currency: null,
      }] };
      if (/SELECT line\.personal_task_id/u.test(sql)) return { get: () => null };
      if (/INSERT INTO payment_invoices/u.test(sql)) return {
        run(...values) { writes.invoice = values; return { lastInsertRowid: 92 }; },
      };
      if (/INSERT INTO payment_invoice_lines/u.test(sql)) return {
        run(...values) { writes.lines.push(values); },
      };
      throw new Error(`Unexpected SQL in explicit to-do price preparation: ${sql}`);
    },
  };
  const payments = new PaymentService({
    store: { status: { ready: true }, requireReady: () => database },
    config: {},
  });
  payments.contact = () => ({ contact_id: 7, display_name: "Ruby", email: "ruby@example.test" });
  payments.stripeStatus = async () => ({ connected: true, chargesEnabled: true, accountId: "acct_123" });
  payments.getInvoice = (invoiceId) => ({
    invoiceId, status: "prepared", display: "Ruby — $30.00", payerContactId: 7, payerName: "Ruby",
    payerEmail: "ruby@example.test", currency: "USD", amountMinor: 3000,
    dueOn: "2099-01-02", previewDigest: writes.invoice[8],
    preparationExpiresAtUtc: writes.invoice[9], lines: [{ amountMinor: 3000 }],
  });

  await payments.prepareInvoice({
    contact_id: 7,
    due_on: "2099-01-02",
    todo_lines: [{ personal_task_id: 12, amount_minor: 3000, currency: "USD" }],
  });

  assert.deepEqual(writes.transactions, ["START TRANSACTION", "COMMIT"]);
  assert.deepEqual(writes.lines, [[92, "todo", 12, 1, "Unpriced task", 3000]]);
  assert.equal(writes.invoice[1], "USD");
  assert.equal(writes.invoice[2], 3000);
});

test("invoice preparation requires a line source and fully validates manual lines", () => {
  const registry = new ToolRegistry();
  registerPaymentTools(registry, {});
  const schema = registry.get("payment_invoice_prepare").parameters;
  const base = { contact_id: 7, due_on: "2030-01-02" };

  assert.match(schemaProblem(base, schema), /does not match any allowed schema/u);
  assert.match(schemaProblem({
    ...base,
    manual_lines: [{ description: "Help moving", amount_minor: 2500, currency: "usd" }],
  }, schema), /invalid format/u);
  assert.equal(schemaProblem({
    manual_lines: [{ description: "Help moving" }],
  }, schema), null);
});

test("invoice preparation creates an editable unpriced draft without payer, due date, or Stripe", async () => {
  const writes = { transactions: [], lines: [], invoice: null };
  const database = {
    exec(sql) { writes.transactions.push(sql); },
    prepare(sql) {
      if (/FROM todo_personal/u.test(sql)) return { all: () => [{
        personal_task_id: 398, text: "Install oven anti-tip device", status: "complete",
        billable_amount_minor: null, billable_currency: null,
      }] };
      if (/SELECT line\.personal_task_id/u.test(sql)) return { get: () => null };
      if (/INSERT INTO payment_invoices/u.test(sql)) return {
        run(...values) { writes.invoice = values; return { lastInsertRowid: 93 }; },
      };
      if (/INSERT INTO payment_invoice_lines/u.test(sql)) return {
        run(...values) { writes.lines.push(values); },
      };
      throw new Error(`Unexpected SQL in unpriced draft preparation: ${sql}`);
    },
  };
  const payments = new PaymentService({
    store: { status: { ready: true }, requireReady: () => database },
    config: {},
  });
  payments.contact = () => { throw new Error("A payer lookup is not allowed for a payer-free draft."); };
  payments.stripeStatus = async () => { throw new Error("Stripe is not required for a local draft."); };
  payments.getInvoice = (invoiceId) => ({
    invoiceId, status: "prepared", display: "Payer not set — not priced",
    payerContactId: null, payerName: null, payerEmail: null, currency: "USD", amountMinor: 0,
    dueOn: null, previewDigest: writes.invoice[8], preparationExpiresAtUtc: writes.invoice[9],
    lines: [{ position: 1, amountMinor: 0 }],
  });

  const result = await payments.prepareInvoice({ personal_task_ids: [398] });

  assert.deepEqual(writes.transactions, ["START TRANSACTION", "COMMIT"]);
  assert.deepEqual(writes.lines, [[93, "todo", 398, 1, "Install oven anti-tip device", 0]]);
  assert.equal(writes.invoice[0], null);
  assert.equal(writes.invoice[1], "USD");
  assert.equal(writes.invoice[2], 0);
  assert.equal(writes.invoice[3], null);
  assert.equal(writes.invoice[11], null);
  assert.equal(result.status, "draft");
  assert.deepEqual(result.missingFields, ["payer", "due_date", "line_prices"]);
  assert.equal(result.nextAction, null);
});

test("manual-only preparation stores an explicit source with no task foreign key", async () => {
  const writes = { transactions: [], lines: [] };
  const database = {
    exec(sql) { writes.transactions.push(sql); },
    prepare(sql) {
      if (/INSERT INTO payment_invoices/u.test(sql)) return {
        run(...values) {
          writes.invoice = values;
          return { lastInsertRowid: 91 };
        },
      };
      if (/INSERT INTO payment_invoice_lines/u.test(sql)) return {
        run(...values) { writes.lines.push(values); },
      };
      throw new Error(`Unexpected SQL in manual-only preparation: ${sql}`);
    },
  };
  const payments = new PaymentService({
    store: { status: { ready: true }, requireReady: () => database },
    config: {},
  });
  payments.contact = () => ({ contact_id: 7, display_name: "Ruby", email: "ruby@example.test" });
  payments.stripeStatus = async () => ({ connected: true, chargesEnabled: true, accountId: "acct_123" });
  payments.getInvoice = (invoiceId) => ({
    invoiceId,
    status: "prepared",
    display: "Ruby — $25.00",
    payerContactId: 7,
    payerName: "Ruby",
    payerEmail: "ruby@example.test",
    currency: "USD",
    amountMinor: 2500,
    dueOn: "2099-01-02",
    previewDigest: writes.invoice[8],
    preparationExpiresAtUtc: writes.invoice[9],
    lines: [{ amountMinor: 2500 }],
  });

  const result = await payments.prepareInvoice({
    contact_id: 7,
    due_on: "2099-01-02",
    manual_lines: [{ description: "  Help moving  ", amount_minor: 2500, currency: "usd" }],
  });

  assert.deepEqual(writes.transactions, ["START TRANSACTION", "COMMIT"]);
  assert.equal(writes.invoice[1], "USD");
  assert.equal(writes.invoice[2], 2500);
  assert.deepEqual(writes.lines, [[91, "manual", null, 1, "Help moving", 2500]]);
  assert.equal(result.invoice.invoiceId, 91);
  assert.deepEqual(result.nextAction.onApproval.arguments, {
    invoice_id: 91,
    preview_digest: writes.invoice[8],
  });
});

test("a prepared local invoice can atomically revise existing lines, append a manual line, and invalidate its old digest", () => {
  const oldDigest = `sha256:${"a".repeat(64)}`;
  const writes = { transactions: [], lines: [], insertedLines: [], invoice: null };
  const row = {
    payment_invoice_id: 91,
    payer_contact_id: 7,
    status: "prepared",
    currency: "USD",
    amount_minor: 5000,
    due_on: "2099-01-02",
    payment_method_policy: "card_and_ach",
    description: null,
    payer_name_snapshot: "Ruby",
    payer_email_snapshot: "ruby@example.test",
    preview_digest: oldDigest,
    stripe_invoice_id: null,
  };
  const existingLines = [{
    line_source: "todo", personal_task_id: 11, line_position: 1,
    description_snapshot: "First task", amount_minor_snapshot: 2500,
  }, {
    line_source: "manual", personal_task_id: null, line_position: 2,
    description_snapshot: "Materials", amount_minor_snapshot: 2500,
  }];
  const database = {
    exec(sql) { writes.transactions.push(sql); },
    prepare(sql) {
      if (/SELECT \* FROM payment_invoices/u.test(sql)) return { get: () => row };
      if (/SELECT line_source, personal_task_id/u.test(sql)) return { all: () => existingLines };
      if (/UPDATE payment_invoice_lines/u.test(sql)) return {
        run(...values) { writes.lines.push(values); return { changes: 1 }; },
      };
      if (/INSERT INTO payment_invoice_lines/u.test(sql)) return {
        run(...values) { writes.insertedLines.push(values); return { changes: 1 }; },
      };
      if (/UPDATE payment_invoices/u.test(sql)) return {
        run(...values) { writes.invoice = values; return { changes: 1 }; },
      };
      throw new Error(`Unexpected SQL in invoice revision: ${sql}`);
    },
  };
  const activities = [];
  const payments = new PaymentService({
    store: { status: { ready: true }, requireReady: () => database },
    config: {},
    ledger: { append(activity) { activities.push(activity); } },
  });
  payments.getInvoice = (invoiceId) => ({
    invoiceId,
    display: "Ruby — $80.00",
    payerContactId: 7,
    payerName: "Ruby",
    payerEmail: "ruby@example.test",
    status: "prepared",
    currency: "USD",
    amountMinor: writes.invoice[6],
    dueOn: "2099-01-02",
    paymentMethodPolicy: writes.invoice[4],
    description: writes.invoice[5],
    previewDigest: writes.invoice[7],
    preparationExpiresAtUtc: writes.invoice[8],
    lines: [{ amountMinor: 4000 }, { amountMinor: 3000 }, { amountMinor: 1000 }],
  });

  const result = payments.updatePreparedInvoice(91, {
    previewDigest: oldDigest,
    paymentMethodPolicy: "ach_only",
    description: "Updated project scope",
    lines: [{ position: 1, description: "First task revised", amountMinor: 4000 },
      { position: 2, description: "Materials revised", amountMinor: 3000 },
      { position: 3, description: "Delivery", amountMinor: 1000 }],
  }, { actorType: "user", actorName: "payments_page" });

  assert.deepEqual(writes.transactions, ["START TRANSACTION", "COMMIT"]);
  assert.deepEqual(writes.lines, [
    ["First task revised", 4000, 91, 1],
    ["Materials revised", 3000, 91, 2],
  ]);
  assert.deepEqual(writes.insertedLines, [[91, "manual", null, 3, "Delivery", 1000]]);
  assert.equal(writes.invoice[4], "ach_only");
  assert.equal(writes.invoice[5], "Updated project scope");
  assert.equal(writes.invoice[6], 8000);
  assert.match(writes.invoice[7], /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(writes.invoice[7], oldDigest);
  assert.equal(writes.invoice[10], 91);
  assert.deepEqual(result.nextAction.onApproval.arguments, {
    invoice_id: 91,
    preview_digest: writes.invoice[7],
  });
  assert.equal(activities[0].type, "payment.invoice.preview_updated");
});

test("saving an unchanged prepared invoice preserves its digest and confirmation", () => {
  const previewDigest = `sha256:${"b".repeat(64)}`;
  const transactions = [];
  const invoice = {
    invoiceId: 92, status: "prepared", display: "Ruby — $25.00", payerContactId: 7, payerName: "Ruby",
    payerEmail: "ruby@example.test", currency: "USD", amountMinor: 2500,
    paymentMethodPolicy: "ach_only",
    dueOn: "2099-01-02", previewDigest, preparationExpiresAtUtc: "2099-01-01T00:00:00.000Z",
    lines: [{ amountMinor: 2500 }],
  };
  const database = {
    exec(sql) { transactions.push(sql); },
    prepare(sql) {
      if (/SELECT \* FROM payment_invoices/u.test(sql)) return { get: () => ({
        status: "prepared", stripe_invoice_id: null, preview_digest: previewDigest,
        payment_method_policy: "ach_only",
      }) };
      if (/SELECT line_source, personal_task_id/u.test(sql)) return { all: () => [{
        line_source: "manual", personal_task_id: null, line_position: 1,
        description_snapshot: "Help moving", amount_minor_snapshot: 2500,
      }] };
      throw new Error(`An unchanged invoice must not be written: ${sql}`);
    },
  };
  const activities = [];
  const payments = new PaymentService({
    store: { status: { ready: true }, requireReady: () => database },
    config: {},
    ledger: { append(activity) { activities.push(activity); } },
  });
  payments.getInvoice = () => invoice;

  const result = payments.updatePreparedInvoice(92, {
    previewDigest,
    paymentMethodPolicy: "ach_only",
    lines: [{ position: 1, description: "Help moving", amountMinor: 2500 }],
  });

  assert.deepEqual(transactions, ["START TRANSACTION", "COMMIT"]);
  assert.equal(result.invoice.previewDigest, previewDigest);
  assert.deepEqual(result.nextAction.onApproval.arguments, {
    invoice_id: 92,
    preview_digest: previewDigest,
  });
  assert.deepEqual(activities, []);
});

test("invoice revision rejects stale and non-editable previews before changing lines", () => {
  const requestedDigest = `sha256:${"c".repeat(64)}`;
  for (const [row, code] of [
    [{ status: "prepared", stripe_invoice_id: null, preview_digest: `sha256:${"d".repeat(64)}` }, "PREVIEW_MISMATCH"],
    [{ status: "open", stripe_invoice_id: "in_123", preview_digest: requestedDigest }, "INVOICE_NOT_EDITABLE"],
  ]) {
    const transactions = [];
    const database = {
      exec(sql) { transactions.push(sql); },
      prepare(sql) {
        if (/SELECT \* FROM payment_invoices/u.test(sql)) return { get: () => row };
        throw new Error(`Rejected invoice must not reach line writes: ${sql}`);
      },
    };
    const payments = new PaymentService({
      store: { status: { ready: true }, requireReady: () => database },
      config: {},
    });

    assert.throws(() => payments.updatePreparedInvoice(93, {
      previewDigest: requestedDigest,
      paymentMethodPolicy: "ach_only",
      lines: [{ position: 1, description: "Help moving", amountMinor: 2500 }],
    }), (error) => error instanceof PaymentInputError && error.code === code);
    assert.deepEqual(transactions, ["START TRANSACTION", "ROLLBACK"]);
  }
});

test("new invoice lines must be appended without removing existing lines", () => {
  const previewDigest = `sha256:${"e".repeat(64)}`;
  const row = {
    status: "prepared", stripe_invoice_id: null, preview_digest: previewDigest,
    preparation_expires_at_utc: "2099-01-01T00:00:00.000Z",
  };
  const existingLines = [
    { line_source: "manual", personal_task_id: null, line_position: 1,
      description_snapshot: "First", amount_minor_snapshot: 1000 },
    { line_source: "manual", personal_task_id: null, line_position: 2,
      description_snapshot: "Second", amount_minor_snapshot: 2000 },
  ];
  for (const [lines, code] of [
    [[{ position: 1, description: "First", amountMinor: 1000 }], "INVOICE_LINE_SET_CHANGED"],
    [[{ position: 1, description: "First", amountMinor: 1000 },
      { position: 2, description: "Second", amountMinor: 2000 },
      { position: 4, description: "Skipped", amountMinor: 3000 }], "INVALID_INVOICE_LINE_POSITION"],
  ]) {
    const transactions = [];
    const database = {
      exec(sql) { transactions.push(sql); },
      prepare(sql) {
        if (/SELECT \* FROM payment_invoices/u.test(sql)) return { get: () => row };
        if (/SELECT line_source, personal_task_id/u.test(sql)) return { all: () => existingLines };
        throw new Error(`Invalid line set must not be written: ${sql}`);
      },
    };
    const payments = new PaymentService({
      store: { status: { ready: true }, requireReady: () => database },
      config: {},
    });

    assert.throws(() => payments.updatePreparedInvoice(94, {
      previewDigest, paymentMethodPolicy: "ach_only", lines,
    }),
      (error) => error instanceof PaymentInputError && error.code === code);
    assert.deepEqual(transactions, ["START TRANSACTION", "ROLLBACK"]);
  }
});

test("sending rejects an incomplete draft before contacting Stripe", async () => {
  const previewDigest = `sha256:${"f".repeat(64)}`;
  const payments = new PaymentService({
    store: { status: { ready: true }, requireReady: () => ({}) },
    config: {},
  });
  payments.getInvoice = () => ({
    invoiceId: 95, status: "prepared", previewDigest,
    payerContactId: null, payerName: null, payerEmail: null, dueOn: null,
    currency: "USD", amountMinor: 0, lines: [{ amountMinor: 0 }],
  });
  payments.stripeStatus = async () => { throw new Error("Stripe must not be called for an incomplete draft."); };

  await assert.rejects(
    payments.sendInvoice({ invoice_id: 95, preview_digest: previewDigest }),
    (error) => error instanceof PaymentInputError && error.code === "INVOICE_DRAFT_INCOMPLETE",
  );
});

test("sending always calls Stripe send after finalization changes the invoice to open", async () => {
  const previewDigest = `sha256:${"f".repeat(64)}`;
  const stripeCalls = [];
  let localStatus = "prepared";
  let stripeInvoiceId = null;
  const database = {
    prepare(sql) {
      if (/SELECT local_idempotency_key,stripe_customer_id,stripe_invoice_id/u.test(sql)) return {
        get: () => ({ local_idempotency_key: "local-key", stripe_customer_id: "cus_123", stripe_invoice_id: null }),
      };
      if (/SET status='sending'/u.test(sql)) return { run() { localStatus = "sending"; } };
      if (/SET stripe_connected_account_id=/u.test(sql)) return {
        run(_accountId, _customerId, invoiceId) { stripeInvoiceId = invoiceId; },
      };
      if (/SET status='open'/u.test(sql)) return { run() { localStatus = "open"; } };
      if (/SET status='failed'/u.test(sql)) return { run() { localStatus = "failed"; } };
      throw new Error(`Unexpected SQL while sending invoice: ${sql}`);
    },
  };
  const stripe = {
    invoices: {
      async create(input) {
        stripeCalls.push(["create", input.payment_settings.payment_method_types]);
        return { id: "in_123", status: "draft" };
      },
      async finalizeInvoice(invoiceId) {
        stripeCalls.push(["finalize", invoiceId]);
        return { id: invoiceId, status: "open", invoice_pdf: "https://stripe.example/invoice.pdf" };
      },
      async sendInvoice(invoiceId) {
        stripeCalls.push(["send", invoiceId]);
        return { id: invoiceId, status: "open", hosted_invoice_url: "https://stripe.example/invoice" };
      },
    },
    invoiceItems: { async create(input) { stripeCalls.push(["line", input.amount]); } },
  };
  const payments = new PaymentService({
    store: { status: { ready: true }, requireReady: () => database },
    config: { stripeSecretKey: "sk_test_example" },
    stripeFactory: () => stripe,
  });
  payments.stripeStatus = async () => ({ chargesEnabled: true, accountId: "acct_123" });
  payments.getInvoice = (invoiceId) => ({
    invoiceId,
    display: "Ruby — $25.00",
    payerContactId: 7,
    payerName: "Ruby",
    payerEmail: "ruby@example.test",
    status: localStatus,
    currency: "USD",
    amountMinor: 2500,
    dueOn: "2099-01-02",
    paymentMethodPolicy: "card_and_ach",
    previewDigest,
    preparationExpiresAtUtc: "2099-01-01T00:00:00.000Z",
    stripeInvoiceId,
    lines: [{ position: 1, lineSource: "manual", personalTaskId: null,
      description: "Help moving", amountMinor: 2500 }],
  });

  const result = await payments.sendInvoice({ invoice_id: 95, preview_digest: previewDigest });

  assert.deepEqual(stripeCalls, [
    ["create", ["us_bank_account", "card"]],
    ["line", 2500],
    ["finalize", "in_123"],
    ["send", "in_123"],
  ]);
  assert.equal(result.invoice.status, "open");
  assert.equal(result.idempotentReplay, false);
});

test("an invoice PDF is read from its exact connected Stripe invoice", async () => {
  const database = {
    prepare(sql) {
      assert.match(sql, /SELECT stripe_connected_account_id, stripe_invoice_id/u);
      return { get: () => ({ stripe_connected_account_id: "acct_123", stripe_invoice_id: "in_123" }) };
    },
  };
  const calls = [];
  const payments = new PaymentService({
    store: { status: { ready: true }, requireReady: () => database },
    config: { stripeSecretKey: "sk_test_example" },
    stripeFactory: () => ({ invoices: {
      async retrieve(invoiceId, _parameters, options) {
        calls.push([invoiceId, options]);
        return { invoice_pdf: "https://stripe.example/invoice.pdf" };
      },
    } }),
  });

  assert.deepEqual(await payments.invoicePdf(95), {
    invoiceId: 95,
    stripeInvoiceId: "in_123",
    url: "https://stripe.example/invoice.pdf",
  });
  assert.deepEqual(calls, [["in_123", { stripeAccount: "acct_123" }]]);
});

test("a local invoice PDF renders the exact current snapshot without Stripe", async () => {
  const invoice = {
    invoiceId: 96, payerName: "Ruby", payerEmail: "ruby@example.test", dueOn: "2099-01-02",
    currency: "USD", amountMinor: 3000, description: null,
    lines: [{ description: "Unpriced task", amountMinor: 3000 }],
  };
  const calls = [];
  const payments = new PaymentService({
    store: { status: { ready: true }, requireReady: () => ({}) },
    config: { pdfBrowserExecutable: "/configured/chromium" },
    renderInvoicePdf: async (input) => { calls.push(input); return Buffer.from("pdf bytes"); },
  });
  payments.getInvoice = (invoiceId) => invoiceId === 96 ? invoice : null;

  const result = await payments.localInvoicePdf(96);

  assert.equal(result.invoiceId, 96);
  assert.equal(result.filename, "invoice-96.pdf");
  assert.deepEqual(result.bytes, Buffer.from("pdf bytes"));
  assert.deepEqual(calls, [{ invoice, browserExecutable: "/configured/chromium" }]);
});
