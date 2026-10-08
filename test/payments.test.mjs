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
    manual_lines: [{ description: "Help moving", amount_minor: 2500, currency: "USD" }],
  }, schema), null);
  assert.equal(schemaProblem({
    ...base,
    personal_task_ids: [11],
    manual_lines: [{ description: "Materials", amount_minor: 1250, currency: "USD" }],
  }, schema), null);
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
  assert.match(schemaProblem({
    contact_id: 7,
    manual_lines: [{ description: "Help moving", amount_minor: 2500, currency: "USD" }],
  }, schema), /due_on is required/u);
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
    payerName: "Ruby",
    payerEmail: "ruby@example.test",
    currency: "USD",
    amountMinor: 2500,
    dueOn: "2099-01-02",
    previewDigest: writes.invoice[8],
    preparationExpiresAtUtc: writes.invoice[9],
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
    payerName: "Ruby",
    payerEmail: "ruby@example.test",
    status: "prepared",
    currency: "USD",
    amountMinor: writes.invoice[0],
    dueOn: "2099-01-02",
    previewDigest: writes.invoice[1],
    preparationExpiresAtUtc: writes.invoice[2],
  });

  const result = payments.updatePreparedInvoice(91, {
    previewDigest: oldDigest,
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
  assert.equal(writes.invoice[0], 8000);
  assert.match(writes.invoice[1], /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(writes.invoice[1], oldDigest);
  assert.equal(writes.invoice[4], 91);
  assert.deepEqual(result.nextAction.onApproval.arguments, {
    invoice_id: 91,
    preview_digest: writes.invoice[1],
  });
  assert.equal(activities[0].type, "payment.invoice.preview_updated");
});

test("saving an unchanged prepared invoice preserves its digest and confirmation", () => {
  const previewDigest = `sha256:${"b".repeat(64)}`;
  const transactions = [];
  const invoice = {
    invoiceId: 92, status: "prepared", display: "Ruby — $25.00", payerName: "Ruby",
    payerEmail: "ruby@example.test", currency: "USD", amountMinor: 2500,
    dueOn: "2099-01-02", previewDigest, preparationExpiresAtUtc: "2099-01-01T00:00:00.000Z",
  };
  const database = {
    exec(sql) { transactions.push(sql); },
    prepare(sql) {
      if (/SELECT \* FROM payment_invoices/u.test(sql)) return { get: () => ({
        status: "prepared", stripe_invoice_id: null, preview_digest: previewDigest,
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

test("invoice revision rejects stale, expired, and non-editable previews before changing lines", () => {
  const requestedDigest = `sha256:${"c".repeat(64)}`;
  for (const [row, code] of [
    [{ status: "prepared", stripe_invoice_id: null, preview_digest: `sha256:${"d".repeat(64)}` }, "PREVIEW_MISMATCH"],
    [{ status: "prepared", stripe_invoice_id: null, preview_digest: requestedDigest,
      preparation_expires_at_utc: "2000-01-01T00:00:00.000Z" }, "PREVIEW_EXPIRED"],
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

    assert.throws(() => payments.updatePreparedInvoice(94, { previewDigest, lines }),
      (error) => error instanceof PaymentInputError && error.code === code);
    assert.deepEqual(transactions, ["START TRANSACTION", "ROLLBACK"]);
  }
});
