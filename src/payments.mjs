import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { chromium } from "playwright-core";

const policies = new Set(["ach_only", "card_only", "card_and_ach"]);
const activeInvoiceStatuses = ["prepared", "sending", "open", "processing", "paid", "failed"];

export class PaymentInputError extends Error {
  constructor(message, statusCode = 400, code = "INVALID_PAYMENT_REQUEST") {
    super(message);
    this.name = "PaymentInputError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new PaymentInputError(`${label} must be a positive integer.`);
  return number;
}

function dateOnly(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new PaymentInputError("dueOn must be a YYYY-MM-DD date.");
  const parsed = new Date(`${text}T00:00:00.000Z`);
  const today = new Date().toISOString().slice(0, 10);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text || text < today) {
    throw new PaymentInputError("The invoice due date must be today or later.");
  }
  return text;
}

function paymentMethodTypes(policy) {
  if (policy === "card_only") return ["card"];
  if (policy === "card_and_ach") return ["us_bank_account", "card"];
  return ["us_bank_account"];
}

function paymentMethodLabel(policy) {
  if (policy === "card_only") return "credit cards only";
  if (policy === "card_and_ach") return "credit cards and bank accounts";
  if (policy === "ach_only") return "bank accounts only (no credit cards)";
  return "the selected payment methods";
}

function accountSummary(account) {
  const chargesEnabled = Boolean(account?.charges_enabled);
  const payoutsEnabled = Boolean(account?.payouts_enabled);
  const disabledReason = String(account?.requirements?.disabled_reason ?? "").trim() || null;
  const status = chargesEnabled && payoutsEnabled
    ? "enabled"
    : (disabledReason || account?.details_submitted) ? "restricted" : "pending";
  return {
    configured: true,
    connected: true,
    accountId: String(account.id),
    status,
    chargesEnabled,
    payoutsEnabled,
    detailsSubmitted: Boolean(account?.details_submitted),
    currentlyDue: Array.isArray(account?.requirements?.currently_due) ? account.requirements.currently_due : [],
    disabledReason,
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function formattedMoney(amountMinor, currency) {
  const resolved = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions();
  const divisor = 10 ** (resolved.maximumFractionDigits ?? 2);
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinor / divisor);
}

function escapedHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function invoicePdfHtml(invoice) {
  const lineRows = invoice.lines.map((line) => `<tr>
    <td>${escapedHtml(line.description)}</td>
    <td>${escapedHtml(formattedMoney(line.amountMinor, invoice.currency))}</td>
  </tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${invoice.invoiceId}</title>
  <style>
    @page { size: Letter; margin: .65in; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #20241f; font: 14px/1.45 Arial, sans-serif; }
    header { display: flex; justify-content: space-between; gap: 32px; padding-bottom: 26px; border-bottom: 2px solid #58634f; }
    h1 { margin: 0 0 4px; font: 700 34px/1.1 Georgia, serif; }
    .muted { color: #62695e; }
    .meta { min-width: 220px; display: grid; grid-template-columns: auto auto; gap: 5px 16px; }
    .meta strong { text-align: right; }
    .recipient { margin: 28px 0; }
    .recipient p { margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; }
    th { padding: 9px 10px; color: #62695e; border-bottom: 1px solid #abb2a5; font-size: 11px; letter-spacing: .08em; text-align: left; text-transform: uppercase; }
    td { padding: 13px 10px; border-bottom: 1px solid #dde1d8; vertical-align: top; }
    th:last-child, td:last-child { width: 150px; text-align: right; }
    .total { display: flex; justify-content: flex-end; gap: 30px; margin-top: 18px; font-size: 18px; }
    .description { margin-top: 28px; padding: 14px 16px; background: #f4f5f1; white-space: pre-wrap; }
    footer { margin-top: 36px; padding-top: 12px; color: #62695e; border-top: 1px solid #dde1d8; font-size: 11px; }
  </style></head><body>
    <header><div><h1>Invoice</h1><div class="muted">Preview prepared in TLOM</div></div>
      <div class="meta"><span>Invoice</span><strong>#${invoice.invoiceId}</strong><span>Due</span><strong>${escapedHtml(invoice.dueOn)}</strong><span>Currency</span><strong>${escapedHtml(invoice.currency)}</strong></div>
    </header>
    <section class="recipient"><strong>Bill to</strong><p>${escapedHtml(invoice.payerName)}</p><p class="muted">${escapedHtml(invoice.payerEmail)}</p></section>
    <table><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody>${lineRows}</tbody></table>
    <div class="total"><strong>Total</strong><strong>${escapedHtml(formattedMoney(invoice.amountMinor, invoice.currency))}</strong></div>
    ${invoice.description ? `<div class="description">${escapedHtml(invoice.description)}</div>` : ""}
    <footer>This is a preview. It has not been sent to the customer.</footer>
  </body></html>`;
}

async function defaultRenderInvoicePdf({ invoice, browserExecutable }) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
    });
    const page = await browser.newPage();
    await page.setContent(invoicePdfHtml(invoice), { waitUntil: "load" });
    return await page.pdf({ format: "Letter", printBackground: true, tagged: true, outline: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/executable doesn't exist|browserType\.launch|failed to launch (?:the )?(?:browser|chromium)/iu.test(message)) {
      throw new PaymentInputError(
        "The PDF browser is unavailable on the server. Run `npm run install:pdf-browser` in the deployed checkout, then restart the service.",
        503,
        "INVOICE_PDF_BROWSER_UNAVAILABLE",
      );
    }
    throw error;
  } finally {
    await browser?.close();
  }
}

function unixDateTime(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

function preparedInvoiceResult(invoice) {
  return {
    contractVersion: 1,
    status: "ready",
    expiresAt: invoice.preparationExpiresAtUtc,
    invoice,
    nextAction: {
      type: "request_user_confirmation",
      instruction: `Send ${formattedMoney(invoice.amountMinor, invoice.currency)} invoice to ${invoice.payerName} at ${invoice.payerEmail}, due ${invoice.dueOn}, accepting ${paymentMethodLabel(invoice.paymentMethodPolicy)}?`,
      onApproval: {
        tool: "payment_invoice_send",
        arguments: {
          invoice_id: invoice.invoiceId,
          preview_digest: invoice.previewDigest,
        },
      },
    },
  };
}

export class PaymentService {
  constructor({
    store,
    config,
    ledger = null,
    stripeFactory = (key) => new Stripe(key),
    renderInvoicePdf = defaultRenderInvoicePdf,
  }) {
    this.store = store;
    this.config = config;
    this.ledger = ledger;
    this.stripeFactory = stripeFactory;
    this.renderInvoicePdf = renderInvoicePdf;
  }

  recordActivity({ type, status = "complete", actorType = "service", actorName = "payments",
    turnId = null, operationId = null, name, contentText = null, payload = null,
    subjectType = null, subjectId = null }) {
    this.ledger?.append({ type, status, actorType, actorName, turnId, operationId,
      name, contentText, payload, subjectType, subjectId });
  }

  get database() {
    return this.store.requireReady();
  }

  configured() {
    return Boolean(
      this.config.stripeSecretKey?.startsWith("sk_")
      && this.config.stripeConnectClientId?.startsWith("ca_")
      && this.config.stripeConnectStateSecret
      && this.config.stripeConnectWebhookSecret?.startsWith("whsec_"),
    );
  }

  stripe() {
    if (!this.config.stripeSecretKey?.startsWith("sk_")) {
      throw new PaymentInputError("Stripe is not configured on this server.", 503, "STRIPE_NOT_CONFIGURED");
    }
    return this.stripeFactory(this.config.stripeSecretKey);
  }

  cachedAccount() {
    return this.database.prepare("SELECT * FROM payment_provider_accounts WHERE provider = 'stripe'").get() ?? null;
  }

  health() {
    const account = this.store.status.ready ? this.cachedAccount() : null;
    return {
      ready: this.configured() && Boolean(account?.charges_enabled),
      configured: this.configured(),
      connected: Boolean(account),
      chargesEnabled: Boolean(account?.charges_enabled),
      payoutsEnabled: Boolean(account?.payouts_enabled),
      status: account?.account_status ?? null,
      reason: !this.configured() ? "Stripe Connect environment settings are incomplete"
        : !account ? "No Stripe account is connected"
          : !account.charges_enabled ? "The connected Stripe account cannot accept charges yet" : null,
    };
  }

  saveAccount(summary) {
    this.database.prepare(`
      INSERT INTO payment_provider_accounts
        (provider, connected_account_id, account_status, charges_enabled, payouts_enabled,
         details_submitted, disabled_reason, connected_at_utc, last_synced_at_utc)
      VALUES ('stripe', ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
      ON DUPLICATE KEY UPDATE connected_account_id = VALUES(connected_account_id),
        account_status = VALUES(account_status), charges_enabled = VALUES(charges_enabled),
        payouts_enabled = VALUES(payouts_enabled), details_submitted = VALUES(details_submitted),
        disabled_reason = VALUES(disabled_reason), last_synced_at_utc = UTC_TIMESTAMP(3)
    `).run(
      summary.accountId, summary.status, summary.chargesEnabled ? 1 : 0,
      summary.payoutsEnabled ? 1 : 0, summary.detailsSubmitted ? 1 : 0, summary.disabledReason,
    );
  }

  async stripeStatus({ refresh = true } = {}) {
    const cached = this.cachedAccount();
    if (!this.configured()) return { ...this.health(), accountId: cached?.connected_account_id ?? null, currentlyDue: [] };
    if (!cached) return { configured: true, connected: false, accountId: null, status: null, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false, currentlyDue: [], disabledReason: null };
    if (!refresh) return { configured: true, connected: true, accountId: cached.connected_account_id, status: cached.account_status, chargesEnabled: Boolean(cached.charges_enabled), payoutsEnabled: Boolean(cached.payouts_enabled), detailsSubmitted: Boolean(cached.details_submitted), currentlyDue: [], disabledReason: cached.disabled_reason ?? null };
    const summary = accountSummary(await this.stripe().accounts.retrieve(cached.connected_account_id));
    this.saveAccount(summary);
    return summary;
  }

  signState() {
    if (!this.config.stripeConnectStateSecret) throw new PaymentInputError("Stripe OAuth state signing is not configured.", 503, "STRIPE_STATE_NOT_CONFIGURED");
    const payload = Buffer.from(JSON.stringify({ purpose: "stripe_connect", expiresAt: Date.now() + 10 * 60_000, nonce: randomUUID() })).toString("base64url");
    const signature = createHmac("sha256", this.config.stripeConnectStateSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  verifyState(state) {
    const [payload, supplied] = String(state ?? "").split(".");
    if (!payload || !supplied) throw new PaymentInputError("Invalid Stripe OAuth state.", 403, "INVALID_STRIPE_STATE");
    const expected = createHmac("sha256", this.config.stripeConnectStateSecret).update(payload).digest("base64url");
    const left = Buffer.from(supplied); const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) throw new PaymentInputError("Invalid Stripe OAuth state.", 403, "INVALID_STRIPE_STATE");
    let decoded;
    try { decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new PaymentInputError("Invalid Stripe OAuth state.", 403, "INVALID_STRIPE_STATE"); }
    if (decoded?.purpose !== "stripe_connect" || Number(decoded?.expiresAt) <= Date.now()) throw new PaymentInputError("Stripe OAuth state expired.", 400, "STRIPE_STATE_EXPIRED");
  }

  beginOAuth() {
    if (!this.config.stripeConnectClientId?.startsWith("ca_")) throw new PaymentInputError("Stripe Connect is not configured.", 503, "STRIPE_CONNECT_NOT_CONFIGURED");
    if (this.cachedAccount()) throw new PaymentInputError("A Stripe account is already connected.", 409, "STRIPE_ALREADY_CONNECTED");
    const url = new URL("https://connect.stripe.com/oauth/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.config.stripeConnectClientId);
    url.searchParams.set("scope", "read_write");
    url.searchParams.set("redirect_uri", new URL("/api/payments/stripe/oauth/callback", this.config.publicUrl).toString());
    url.searchParams.set("state", this.signState());
    return { url: url.toString() };
  }

  async finishOAuth({ code, state }) {
    this.verifyState(state);
    const oauthCode = String(code ?? "").trim();
    if (!oauthCode) throw new PaymentInputError("Stripe did not return an authorization code.");
    const token = await this.stripe().oauth.token({ grant_type: "authorization_code", code: oauthCode });
    const accountId = String(token?.stripe_user_id ?? "").trim();
    if (!accountId) throw new PaymentInputError("Stripe did not return a connected account.", 502, "STRIPE_ACCOUNT_MISSING");
    const summary = accountSummary(await this.stripe().accounts.retrieve(accountId));
    this.saveAccount(summary);
    this.recordActivity({
      type: "payment.stripe.connected", actorType: "external", actorName: "stripe",
      name: "Stripe account connected", contentText: accountId,
      payload: { account: summary }, subjectType: "stripe_account", subjectId: accountId,
    });
    return summary;
  }

  contact(contactId) {
    return this.database.prepare(`
      SELECT contact.contact_id, contact.display_name,
             (SELECT method.value FROM contact_methods method
               WHERE method.contact_id = contact.contact_id AND method.method_kind = 'email' AND method.can_receive = 1
               ORDER BY method.is_primary DESC, method.contact_method_id LIMIT 1) AS email
      FROM contacts contact WHERE contact.contact_id = ? AND contact.status = 'active'
    `).get(contactId) ?? null;
  }

  getInvoice(invoiceId) {
    const id = positiveInteger(invoiceId, "invoice_id");
    const row = this.database.prepare("SELECT * FROM payment_invoices WHERE payment_invoice_id = ?").get(id);
    if (!row) return null;
    const lines = this.database.prepare(`SELECT line_source, personal_task_id, line_position, description_snapshot, amount_minor_snapshot
      FROM payment_invoice_lines WHERE payment_invoice_id = ? ORDER BY line_position`).all(id);
    return {
      invoiceId: Number(row.payment_invoice_id), ref: `agent-slayer://payment-invoices/${Number(row.payment_invoice_id)}`,
      display: `${row.payer_name_snapshot} — ${formattedMoney(Number(row.amount_minor), row.currency)}`,
      payerContactId: Number(row.payer_contact_id), payerName: row.payer_name_snapshot, payerEmail: row.payer_email_snapshot,
      status: row.status, currency: row.currency, amountMinor: Number(row.amount_minor), dueOn: row.due_on,
      paymentMethodPolicy: row.payment_method_policy, description: row.description ?? null,
      previewDigest: row.preview_digest, preparationExpiresAtUtc: row.preparation_expires_at_utc,
      stripeInvoiceId: row.stripe_invoice_id ?? null, processorStatus: row.processor_status ?? null,
      hostedInvoiceUrl: row.hosted_invoice_url ?? null, amountPaidMinor: Number(row.amount_paid_minor),
      createdAtUtc: row.created_at_utc, updatedAtUtc: row.updated_at_utc,
      lines: lines.map((line) => ({
        lineSource: line.line_source,
        personalTaskId: line.personal_task_id == null ? null : Number(line.personal_task_id),
        position: Number(line.line_position),
        description: line.description_snapshot,
        amountMinor: Number(line.amount_minor_snapshot),
      })),
    };
  }

  listInvoices({ limit = 100 } = {}) {
    const bounded = Math.min(500, Math.max(1, Number(limit) || 100));
    return this.database.prepare("SELECT payment_invoice_id FROM payment_invoices ORDER BY payment_invoice_id DESC LIMIT ?").all(bounded)
      .map((row) => this.getInvoice(row.payment_invoice_id));
  }

  async prepareInvoice(input, activity = {}) {
    const pricedTaskIds = Array.isArray(input?.personal_task_ids) ? input.personal_task_ids.map((id) => positiveInteger(id, "personal_task_ids item")) : [];
    const explicitTodoLines = Array.isArray(input?.todo_lines) ? input.todo_lines.map((line, index) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) throw new PaymentInputError(`todo_lines item ${index + 1} must be an object.`);
      const currency = String(line.currency ?? "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new PaymentInputError(`todo_lines item ${index + 1} needs a three-letter currency.`);
      return {
        personalTaskId: positiveInteger(line.personal_task_id, `todo_lines item ${index + 1} personal_task_id`),
        amountMinor: positiveInteger(line.amount_minor, `todo_lines item ${index + 1} amount_minor`),
        currency,
      };
    }) : [];
    const taskIds = [...pricedTaskIds, ...explicitTodoLines.map((line) => line.personalTaskId)];
    if (taskIds.length > 100 || new Set(taskIds).size !== taskIds.length) throw new PaymentInputError("Select no more than 100 distinct to-dos.");
    const manualLines = Array.isArray(input?.manual_lines) ? input.manual_lines.map((line, index) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) throw new PaymentInputError(`manual_lines item ${index + 1} must be an object.`);
      const manualDescription = String(line.description ?? "").trim();
      if (!manualDescription || manualDescription.length > 1000) throw new PaymentInputError(`manual_lines item ${index + 1} needs a description of 1 to 1000 characters.`);
      const currency = String(line.currency ?? "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new PaymentInputError(`manual_lines item ${index + 1} needs a three-letter currency.`);
      return {
        lineSource: "manual",
        personalTaskId: null,
        description: manualDescription,
        amountMinor: positiveInteger(line.amount_minor, `manual_lines item ${index + 1} amount_minor`),
        currency,
      };
    }) : [];
    if (taskIds.length + manualLines.length < 1 || taskIds.length + manualLines.length > 100) {
      throw new PaymentInputError("Provide between 1 and 100 total to-do or manual invoice lines.");
    }
    const contactId = positiveInteger(input?.contact_id, "contact_id");
    const dueOn = dateOnly(input?.due_on);
    const policy = String(input?.payment_method_policy ?? "ach_only");
    if (!policies.has(policy)) throw new PaymentInputError("payment_method_policy is invalid.");
    const description = String(input?.description ?? "").trim().slice(0, 1000) || null;
    const contact = this.contact(contactId);
    if (!contact) throw new PaymentInputError("The selected active customer contact was not found.", 404, "CONTACT_NOT_FOUND");
    if (!String(contact.email ?? "").trim()) throw new PaymentInputError("The selected customer needs a receivable email address.", 409, "CUSTOMER_EMAIL_REQUIRED");
    const stripeStatus = await this.stripeStatus({ refresh: true });
    if (!stripeStatus.connected || !stripeStatus.chargesEnabled) throw new PaymentInputError("Connect and finish setting up Stripe before preparing an invoice.", 409, "STRIPE_CHARGES_NOT_ENABLED");
    const placeholders = taskIds.map(() => "?").join(",");
    this.database.exec("START TRANSACTION");
    try {
      const tasks = taskIds.length ? this.database.prepare(`SELECT personal_task_id, text, status, billable_amount_minor, billable_currency
        FROM todo_personal WHERE personal_task_id IN (${placeholders}) FOR UPDATE`).all(...taskIds) : [];
      if (tasks.length !== taskIds.length) throw new PaymentInputError("One or more selected to-dos no longer exist.", 404, "TODO_NOT_FOUND");
      const byId = new Map(tasks.map((task) => [Number(task.personal_task_id), task]));
      const pricedLines = pricedTaskIds.map((id) => byId.get(id));
      if (pricedLines.some((line) => !Number.isSafeInteger(Number(line.billable_amount_minor)) || Number(line.billable_amount_minor) <= 0 || !/^[A-Z]{3}$/.test(String(line.billable_currency ?? "")))) {
        throw new PaymentInputError("Every selected to-do must have a positive billable amount and currency.", 409, "TODO_PRICE_REQUIRED");
      }
      const currencies = new Set([
        ...pricedLines.map((line) => line.billable_currency),
        ...explicitTodoLines.map((line) => line.currency),
        ...manualLines.map((line) => line.currency),
      ]);
      if (currencies.size !== 1) throw new PaymentInputError("All invoice lines must use the same currency.", 409, "MIXED_CURRENCIES");
      const duplicate = taskIds.length ? this.database.prepare(`SELECT line.personal_task_id, invoice.payment_invoice_id, invoice.status
        FROM payment_invoice_lines line JOIN payment_invoices invoice USING (payment_invoice_id)
        WHERE line.personal_task_id IN (${placeholders})
          AND invoice.status IN (${activeInvoiceStatuses.map(() => "?").join(",")})
          AND NOT (invoice.status IN ('prepared','sending','failed')
            AND invoice.stripe_invoice_id IS NULL
            AND invoice.preparation_expires_at_utc <= UTC_TIMESTAMP(3))
        LIMIT 1 FOR UPDATE`).get(...taskIds, ...activeInvoiceStatuses) : null;
      if (duplicate) throw new PaymentInputError(`To-do ${duplicate.personal_task_id} is already on invoice ${duplicate.payment_invoice_id} (${duplicate.status}).`, 409, "TODO_ALREADY_INVOICED");
      const snapshots = [
        ...pricedLines.map((line) => ({
          lineSource: "todo", personalTaskId: Number(line.personal_task_id),
          description: String(line.text).slice(0, 1000), amountMinor: Number(line.billable_amount_minor),
        })),
        ...explicitTodoLines.map((line) => ({
          lineSource: "todo", personalTaskId: line.personalTaskId,
          description: String(byId.get(line.personalTaskId).text).slice(0, 1000),
          amountMinor: line.amountMinor,
        })),
        ...manualLines.map(({ currency: _currency, ...line }) => line),
      ].map((line, index) => ({ ...line, position: index + 1 }));
      const amountMinor = snapshots.reduce((sum, line) => sum + line.amountMinor, 0);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new PaymentInputError("The invoice total is outside the supported range.");
      const [currency] = currencies;
      const preview = { contactId, payerName: contact.display_name, payerEmail: contact.email, dueOn, policy, description, currency, amountMinor, lines: snapshots };
      const previewDigest = digest(preview);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
      const idempotencyKey = randomUUID();
      const result = this.database.prepare(`INSERT INTO payment_invoices
        (payer_contact_id,status,currency,amount_minor,due_on,payment_method_policy,description,payer_name_snapshot,payer_email_snapshot,
         preview_digest,preparation_expires_at_utc,local_idempotency_key,stripe_connected_account_id)
        VALUES (?, 'prepared', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(contactId, currency, amountMinor, dueOn, policy, description,
          contact.display_name, contact.email, previewDigest, expiresAt, idempotencyKey, stripeStatus.accountId);
      const invoiceId = Number(result.lastInsertRowid);
      const insert = this.database.prepare(`INSERT INTO payment_invoice_lines
        (payment_invoice_id,line_source,personal_task_id,line_position,description_snapshot,amount_minor_snapshot) VALUES (?,?,?,?,?,?)`);
      for (const line of snapshots) insert.run(invoiceId, line.lineSource, line.personalTaskId, line.position, line.description, line.amountMinor);
      this.database.exec("COMMIT");
      const invoice = this.getInvoice(invoiceId);
      this.recordActivity({
        type: "payment.invoice.prepared", status: invoice.status,
        actorType: activity.actorType ?? "user", actorName: activity.actorName ?? "payments",
        turnId: activity.requestId ?? null, operationId: activity.callId ?? null,
        name: "Invoice prepared", contentText: invoice.display, payload: { invoice },
        subjectType: "payment_invoice", subjectId: String(invoice.invoiceId),
      });
      return preparedInvoiceResult(invoice);
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  updatePreparedInvoice(invoiceIdValue, input, activity = {}) {
    const invoiceId = positiveInteger(invoiceIdValue, "invoice_id");
    const expectedDigest = String(input?.previewDigest ?? "").trim();
    const paymentMethodPolicy = String(input?.paymentMethodPolicy ?? "").trim();
    const descriptionSupplied = Object.prototype.hasOwnProperty.call(input ?? {}, "description");
    const suppliedDescription = descriptionSupplied ? String(input.description ?? "").trim() || null : null;
    if (!/^sha256:[0-9a-f]{64}$/.test(expectedDigest)) {
      throw new PaymentInputError("The current preview digest is required.", 400, "PREVIEW_DIGEST_REQUIRED");
    }
    if (!policies.has(paymentMethodPolicy)) {
      throw new PaymentInputError("Choose valid invoice payment methods.", 400, "INVALID_PAYMENT_METHOD_POLICY");
    }
    if (suppliedDescription && suppliedDescription.length > 1000) {
      throw new PaymentInputError("Invoice description must be at most 1000 characters.");
    }
    if (!Array.isArray(input?.lines) || input.lines.length < 1 || input.lines.length > 100) {
      throw new PaymentInputError("Provide between 1 and 100 invoice lines.");
    }
    const suppliedLines = input.lines.map((line, index) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) {
        throw new PaymentInputError(`Invoice line ${index + 1} must be an object.`);
      }
      const description = String(line.description ?? "").trim();
      if (!description || description.length > 1000) {
        throw new PaymentInputError(`Invoice line ${index + 1} needs a description of 1 to 1000 characters.`);
      }
      return {
        position: positiveInteger(line.position, `Invoice line ${index + 1} position`),
        description,
        amountMinor: positiveInteger(line.amountMinor, `Invoice line ${index + 1} amountMinor`),
      };
    });
    if (new Set(suppliedLines.map(({ position }) => position)).size !== suppliedLines.length) {
      throw new PaymentInputError("Invoice line positions must be distinct.");
    }

    this.database.exec("START TRANSACTION");
    try {
      const row = this.database.prepare(`SELECT * FROM payment_invoices
        WHERE payment_invoice_id = ? FOR UPDATE`).get(invoiceId);
      if (!row) throw new PaymentInputError("Prepared invoice not found.", 404, "INVOICE_NOT_FOUND");
      if (row.status !== "prepared" || row.stripe_invoice_id != null) {
        throw new PaymentInputError(
          "Only a local prepared invoice that has not reached Stripe can be edited.",
          409,
          "INVOICE_NOT_EDITABLE",
        );
      }
      if (Date.parse(row.preparation_expires_at_utc) <= Date.now()) {
        throw new PaymentInputError(
          "This invoice preview expired; prepare it again.",
          409,
          "PREVIEW_EXPIRED",
        );
      }
      if (row.preview_digest !== expectedDigest) {
        throw new PaymentInputError(
          "This invoice preview changed after it was opened. Reload it before saving.",
          409,
          "PREVIEW_MISMATCH",
        );
      }
      const existingLines = this.database.prepare(`SELECT line_source, personal_task_id,
          line_position, description_snapshot, amount_minor_snapshot
        FROM payment_invoice_lines WHERE payment_invoice_id = ?
        ORDER BY line_position FOR UPDATE`).all(invoiceId);
      const suppliedByPosition = new Map(suppliedLines.map((line) => [line.position, line]));
      if (existingLines.length > suppliedLines.length
        || existingLines.some((line) => !suppliedByPosition.has(Number(line.line_position)))) {
        throw new PaymentInputError(
          "Existing invoice lines cannot be removed. Reload the invoice before saving.",
          409,
          "INVOICE_LINE_SET_CHANGED",
        );
      }
      const existingByPosition = new Map(existingLines.map((line) => [Number(line.line_position), line]));
      const addedLines = suppliedLines
        .filter((line) => !existingByPosition.has(line.position))
        .sort((left, right) => left.position - right.position);
      const maximumExistingPosition = existingLines.reduce(
        (maximum, line) => Math.max(maximum, Number(line.line_position)),
        0,
      );
      if (addedLines.some((line, index) => line.position !== maximumExistingPosition + index + 1)) {
        throw new PaymentInputError(
          "New manual invoice lines must be appended after the existing lines.",
          400,
          "INVALID_INVOICE_LINE_POSITION",
        );
      }
      const snapshots = [...suppliedLines]
        .sort((left, right) => left.position - right.position)
        .map((supplied) => {
          const existing = existingByPosition.get(supplied.position);
          return {
            lineSource: existing?.line_source ?? "manual",
            personalTaskId: existing?.personal_task_id == null ? null : Number(existing.personal_task_id),
            position: supplied.position,
            description: supplied.description,
            amountMinor: supplied.amountMinor,
          };
        });
      const description = descriptionSupplied ? suppliedDescription : row.description ?? null;
      const changed = addedLines.length > 0 || existingLines.some((line) => {
        const supplied = suppliedByPosition.get(Number(line.line_position));
        return String(line.description_snapshot) !== supplied.description
          || Number(line.amount_minor_snapshot) !== supplied.amountMinor;
      }) || row.payment_method_policy !== paymentMethodPolicy
        || (row.description ?? null) !== description;
      if (!changed) {
        this.database.exec("COMMIT");
        return preparedInvoiceResult(this.getInvoice(invoiceId));
      }
      const amountMinor = snapshots.reduce((sum, line) => sum + line.amountMinor, 0);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new PaymentInputError("The invoice total is outside the supported range.");
      }
      const preview = {
        contactId: Number(row.payer_contact_id),
        payerName: row.payer_name_snapshot,
        payerEmail: row.payer_email_snapshot,
        dueOn: String(row.due_on),
        policy: paymentMethodPolicy,
        description,
        currency: row.currency,
        amountMinor,
        lines: snapshots,
      };
      const previewDigest = digest(preview);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
      const idempotencyKey = randomUUID();
      const updateLine = this.database.prepare(`UPDATE payment_invoice_lines
        SET description_snapshot = ?, amount_minor_snapshot = ?
        WHERE payment_invoice_id = ? AND line_position = ?`);
      const insertLine = this.database.prepare(`INSERT INTO payment_invoice_lines
        (payment_invoice_id,line_source,personal_task_id,line_position,description_snapshot,amount_minor_snapshot)
        VALUES (?,?,?,?,?,?)`);
      for (const line of snapshots) {
        if (existingByPosition.has(line.position)) {
          updateLine.run(line.description, line.amountMinor, invoiceId, line.position);
        } else {
          insertLine.run(
            invoiceId,
            "manual",
            null,
            line.position,
            line.description,
            line.amountMinor,
          );
        }
      }
      this.database.prepare(`UPDATE payment_invoices
        SET payment_method_policy = ?, description = ?, amount_minor = ?, preview_digest = ?, preparation_expires_at_utc = ?,
            local_idempotency_key = ?, updated_at_utc = UTC_TIMESTAMP(3)
        WHERE payment_invoice_id = ?`).run(
        paymentMethodPolicy,
        description,
        amountMinor,
        previewDigest,
        expiresAt,
        idempotencyKey,
        invoiceId,
      );
      this.database.exec("COMMIT");
      const invoice = this.getInvoice(invoiceId);
      this.recordActivity({
        type: "payment.invoice.preview_updated",
        status: invoice.status,
        actorType: activity.actorType ?? "user",
        actorName: activity.actorName ?? "payments",
        turnId: activity.requestId ?? null,
        operationId: activity.callId ?? null,
        name: "Invoice preview updated",
        contentText: invoice.display,
        payload: { invoice },
        subjectType: "payment_invoice",
        subjectId: String(invoice.invoiceId),
      });
      return preparedInvoiceResult(invoice);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async reusableCustomer(invoice, accountId) {
    const row = this.database.prepare(`SELECT stripe_customer_id FROM payment_invoices WHERE payer_contact_id = ?
      AND stripe_connected_account_id = ? AND stripe_customer_id IS NOT NULL ORDER BY payment_invoice_id DESC LIMIT 1`)
      .get(invoice.payerContactId, accountId);
    if (!row?.stripe_customer_id) return null;
    try {
      const customer = await this.stripe().customers.retrieve(row.stripe_customer_id, undefined, { stripeAccount: accountId });
      return customer?.deleted ? null : customer.id;
    } catch (error) { if (error?.code === "resource_missing") return null; throw error; }
  }

  async localInvoicePdf(invoiceIdValue) {
    const invoiceId = positiveInteger(invoiceIdValue, "invoice_id");
    const invoice = this.getInvoice(invoiceId);
    if (!invoice) throw new PaymentInputError("Invoice not found.", 404, "INVOICE_NOT_FOUND");
    const rendered = await this.renderInvoicePdf({
      invoice,
      browserExecutable: this.config.pdfBrowserExecutable,
    });
    const bytes = Buffer.from(rendered);
    if (!bytes.length) throw new PaymentInputError("The invoice PDF renderer returned an empty document.", 502, "INVOICE_PDF_EMPTY");
    return { invoiceId, filename: `invoice-${invoiceId}.pdf`, bytes };
  }

  async invoicePdf(invoiceIdValue) {
    const invoiceId = positiveInteger(invoiceIdValue, "invoice_id");
    const row = this.database.prepare(`SELECT stripe_connected_account_id, stripe_invoice_id
      FROM payment_invoices WHERE payment_invoice_id = ?`).get(invoiceId);
    if (!row) throw new PaymentInputError("Invoice not found.", 404, "INVOICE_NOT_FOUND");
    if (!row.stripe_connected_account_id || !row.stripe_invoice_id) {
      throw new PaymentInputError("Send the invoice before opening its PDF.", 409, "INVOICE_PDF_NOT_READY");
    }
    const stripeInvoice = await this.stripe().invoices.retrieve(
      row.stripe_invoice_id,
      undefined,
      { stripeAccount: row.stripe_connected_account_id },
    );
    const url = String(stripeInvoice?.invoice_pdf ?? "").trim();
    if (!url) throw new PaymentInputError("Stripe has not generated the invoice PDF yet.", 409, "INVOICE_PDF_NOT_READY");
    return { invoiceId, stripeInvoiceId: row.stripe_invoice_id, url };
  }

  async sendInvoice({ invoice_id: invoiceIdValue, preview_digest: previewDigest }, activity = {}) {
    const invoiceId = positiveInteger(invoiceIdValue, "invoice_id");
    let invoice = this.getInvoice(invoiceId);
    if (!invoice) throw new PaymentInputError("Prepared invoice not found.", 404, "INVOICE_NOT_FOUND");
    if (invoice.previewDigest !== previewDigest) throw new PaymentInputError("The confirmed preview does not match this invoice.", 409, "PREVIEW_MISMATCH");
    if (["open", "processing", "paid"].includes(invoice.status)) return { status: "complete", idempotentReplay: true, invoice };
    if (!["prepared", "failed", "sending"].includes(invoice.status)) throw new PaymentInputError(`Invoice ${invoiceId} cannot be sent from ${invoice.status}.`, 409, "INVOICE_STATE_CONFLICT");
    if (Date.parse(invoice.preparationExpiresAtUtc) <= Date.now() && !invoice.stripeInvoiceId) throw new PaymentInputError("This invoice preview expired; prepare it again.", 409, "PREVIEW_EXPIRED");
    const account = await this.stripeStatus({ refresh: true });
    if (!account.chargesEnabled) throw new PaymentInputError("The connected Stripe account cannot accept charges.", 409, "STRIPE_CHARGES_NOT_ENABLED");
    const stripe = this.stripe();
    const accountId = account.accountId;
    const dbRow = this.database.prepare("SELECT local_idempotency_key,stripe_customer_id,stripe_invoice_id FROM payment_invoices WHERE payment_invoice_id=?").get(invoiceId);
    this.database.prepare("UPDATE payment_invoices SET status='sending', updated_at_utc=UTC_TIMESTAMP(3) WHERE payment_invoice_id=?").run(invoiceId);
    try {
      let customerId = dbRow.stripe_customer_id || await this.reusableCustomer(invoice, accountId);
      if (!customerId) {
        const customer = await stripe.customers.create({ email: invoice.payerEmail, name: invoice.payerName,
          metadata: { agent_slayer_contact_id: String(invoice.payerContactId) } },
        { stripeAccount: accountId, idempotencyKey: `slayer-invoice-${dbRow.local_idempotency_key}-customer` });
        customerId = customer.id;
      }
      let stripeInvoice = null;
      if (dbRow.stripe_invoice_id) {
        try { stripeInvoice = await stripe.invoices.retrieve(dbRow.stripe_invoice_id, undefined, { stripeAccount: accountId }); }
        catch (error) { if (error?.code !== "resource_missing") throw error; }
      }
      if (!stripeInvoice) {
        const today = new Date().toISOString().slice(0, 10);
        const daysUntilDue = Math.max(0, Math.round((Date.parse(`${invoice.dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
        stripeInvoice = await stripe.invoices.create({ customer: customerId, collection_method: "send_invoice", days_until_due: daysUntilDue,
          description: invoice.description || `Payment for ${invoice.lines.length} invoice item${invoice.lines.length === 1 ? "" : "s"}`,
          payment_settings: { payment_method_types: paymentMethodTypes(invoice.paymentMethodPolicy) },
          metadata: { agent_slayer_invoice_id: String(invoiceId) } },
        { stripeAccount: accountId, idempotencyKey: `slayer-invoice-${dbRow.local_idempotency_key}-create` });
        this.database.prepare(`UPDATE payment_invoices SET stripe_connected_account_id=?,stripe_customer_id=?,stripe_invoice_id=?,processor_status=?,updated_at_utc=UTC_TIMESTAMP(3)
          WHERE payment_invoice_id=?`).run(accountId, customerId, stripeInvoice.id, stripeInvoice.status ?? "draft", invoiceId);
      }
      if (String(stripeInvoice.status ?? "draft") === "draft") {
        for (const line of invoice.lines) await stripe.invoiceItems.create({ customer: customerId, invoice: stripeInvoice.id,
          amount: line.amountMinor, currency: invoice.currency.toLowerCase(), description: line.description,
          metadata: {
            agent_slayer_invoice_id: String(invoiceId),
            agent_slayer_line_source: line.lineSource,
            ...(line.personalTaskId == null ? {} : { agent_slayer_todo_id: String(line.personalTaskId) }),
          } },
        { stripeAccount: accountId, idempotencyKey: `slayer-invoice-${dbRow.local_idempotency_key}-line-${line.position}` });
        stripeInvoice = await stripe.invoices.finalizeInvoice(stripeInvoice.id, {}, { stripeAccount: accountId, idempotencyKey: `slayer-invoice-${dbRow.local_idempotency_key}-finalize` });
      }
      const sent = await stripe.invoices.sendInvoice(
        stripeInvoice.id,
        {},
        { stripeAccount: accountId, idempotencyKey: `slayer-invoice-${dbRow.local_idempotency_key}-send` },
      );
      this.database.prepare(`UPDATE payment_invoices SET status='open',stripe_customer_id=?,stripe_invoice_id=?,processor_status=?,hosted_invoice_url=?,
        opened_at_utc=COALESCE(opened_at_utc,UTC_TIMESTAMP(3)),failure_code=NULL,failure_message=NULL,updated_at_utc=UTC_TIMESTAMP(3) WHERE payment_invoice_id=?`)
        .run(customerId, sent.id, sent.status ?? "open", sent.hosted_invoice_url ?? null, invoiceId);
      invoice = this.getInvoice(invoiceId);
      this.recordActivity({
        type: "payment.invoice.sent", status: invoice.status,
        actorType: activity.actorType ?? "user", actorName: activity.actorName ?? "payments",
        turnId: activity.requestId ?? null, operationId: activity.callId ?? null,
        name: "Stripe invoice sent", contentText: invoice.display, payload: { invoice },
        subjectType: "payment_invoice", subjectId: String(invoice.invoiceId),
      });
      return { status: "complete", idempotentReplay: false, invoice };
    } catch (error) {
      this.database.prepare(`UPDATE payment_invoices SET status='failed',failure_code=?,failure_message=?,failed_at_utc=UTC_TIMESTAMP(3),updated_at_utc=UTC_TIMESTAMP(3)
        WHERE payment_invoice_id=?`).run(String(error?.code ?? "STRIPE_INVOICE_FAILED").slice(0,128), String(error?.message ?? "Stripe invoice send failed.").slice(0,500), invoiceId);
      throw error;
    }
  }

  processInvoiceEvent(accountId, invoice, eventType) {
    const invoiceId = String(invoice?.id ?? "");
    if (!accountId || !invoiceId) return;
    let status = "open";
    if (["invoice.paid", "invoice.payment_succeeded"].includes(eventType)) status = "paid";
    else if (eventType === "invoice.payment_failed") status = "failed";
    else if (eventType === "invoice.voided") status = "voided";
    else if (eventType === "invoice.marked_uncollectible") status = "uncollectible";
    const result = this.database.prepare(`UPDATE payment_invoices SET status=CASE WHEN status IN ('paid','voided','uncollectible') AND ? IN ('open','failed') THEN status ELSE ? END,
      amount_paid_minor=GREATEST(amount_paid_minor,?),processor_status=?,hosted_invoice_url=COALESCE(?,hosted_invoice_url),
      stripe_payment_intent_id=COALESCE(?,stripe_payment_intent_id),stripe_charge_id=COALESCE(?,stripe_charge_id),
      paid_at_utc=CASE WHEN ?='paid' THEN COALESCE(paid_at_utc,?,UTC_TIMESTAMP(3)) ELSE paid_at_utc END,
      failed_at_utc=CASE WHEN ?='failed' THEN UTC_TIMESTAMP(3) ELSE failed_at_utc END,
      voided_at_utc=CASE WHEN ?='voided' THEN UTC_TIMESTAMP(3) ELSE voided_at_utc END,updated_at_utc=UTC_TIMESTAMP(3)
      WHERE stripe_connected_account_id=? AND stripe_invoice_id=?`).run(status,status,Number(invoice?.amount_paid ?? 0),String(invoice?.status ?? eventType).slice(0,64),
        invoice?.hosted_invoice_url ?? null, typeof invoice?.payment_intent === "string" ? invoice.payment_intent : invoice?.payment_intent?.id ?? null,
        typeof invoice?.charge === "string" ? invoice.charge : invoice?.charge?.id ?? null,status,unixDateTime(invoice?.status_transitions?.paid_at),status,status,accountId,invoiceId);
    if (result.changes > 0) this.recordActivity({
      type: "payment.invoice.provider_updated", status, actorType: "external", actorName: "stripe",
      name: `Stripe ${eventType}`, contentText: invoiceId,
      payload: { eventType, accountId, stripeInvoiceId: invoiceId, status },
      subjectType: "stripe_invoice", subjectId: invoiceId,
    });
  }

  async handleWebhook(rawBody, signature) {
    if (!this.config.stripeConnectWebhookSecret?.startsWith("whsec_")) throw new PaymentInputError("Stripe webhook is not configured.", 503, "STRIPE_WEBHOOK_NOT_CONFIGURED");
    let event;
    try { event = this.stripe().webhooks.constructEvent(rawBody, signature, this.config.stripeConnectWebhookSecret); }
    catch { throw new PaymentInputError("Invalid Stripe webhook signature.", 400, "INVALID_STRIPE_SIGNATURE"); }
    const supported = new Set(["invoice.finalized","invoice.sent","invoice.paid","invoice.payment_succeeded","invoice.payment_failed","invoice.voided","invoice.marked_uncollectible"]);
    if (supported.has(event.type)) this.processInvoiceEvent(String(event.account ?? ""), event.data.object, event.type);
    return { received: true };
  }
}
