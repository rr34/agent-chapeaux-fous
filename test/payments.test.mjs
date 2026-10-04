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
  payments.getInvoice = (invoiceId) => ({ invoiceId, status: "prepared", display: "Ruby — $25.00" });

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
