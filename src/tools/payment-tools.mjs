const toolDescriptions = Object.freeze({
  payment_stripe_status: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Read Stripe Connect configuration and the connected merchant account's current charge readiness.",
    actionClasses: ["READ"], effectClassifications: ["READ-ONLY"],
  },
  payment_stripe_connect_link: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Create a short-lived signed Stripe Connect authorization link when no merchant account is connected.",
    actionClasses: ["READ"], effectClassifications: ["READ-ONLY"],
  },
  payment_invoice_list: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Read native prepared and sent invoices with task-backed or manual line snapshots and observed Stripe status.",
    actionClasses: ["READ"], effectClassifications: ["READ-ONLY"],
  },
  payment_invoice_prepare: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Create a local invoice preview from to-dos with stored or explicit invoice prices, manual lines, or both and a payer contact, returning the exact final-confirmation handoff.",
    actionClasses: ["CREATE"], effectClassifications: ["MUTATING"],
  },
  payment_invoice_send: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Execute the exact confirmed prepared handoff by creating, finalizing, and emailing a Stripe-hosted invoice.",
    actionClasses: ["EXECUTE"], effectClassifications: ["MUTATING", "EXTERNAL"],
  },
});

const lineSchema = {
  type: "object", properties: {
    lineSource: { type: "string", enum: ["todo", "manual"] },
    personalTaskId: { type: ["integer", "null"] }, position: { type: "integer" },
    description: { type: "string" }, amountMinor: { type: "integer" },
  },
};

const invoiceSchema = {
  type: ["object", "null"],
  description: "One native invoice whose current line descriptions and prices snapshot selected to-dos, manual lines, or both. Prepared previews may be revised in the Payments UI; sending makes them immutable.",
  properties: {
    invoiceId: { type: "integer" }, ref: { type: "string" }, display: { type: "string" },
    payerContactId: { type: "integer" }, payerName: { type: "string" }, payerEmail: { type: "string" },
    status: { type: "string" }, currency: { type: "string" }, amountMinor: { type: "integer" },
    dueOn: { type: "string" }, paymentMethodPolicy: { type: "string" },
    description: { type: ["string", "null"] }, previewDigest: { type: "string" },
    preparationExpiresAtUtc: { type: "string" }, stripeInvoiceId: { type: ["string", "null"] },
    processorStatus: { type: ["string", "null"] }, hostedInvoiceUrl: { type: ["string", "null"] },
    amountPaidMinor: { type: "integer" }, createdAtUtc: { type: "string" },
    updatedAtUtc: { type: ["string", "null"] }, lines: { type: "array", items: lineSchema },
  },
};

const nativeContracts = Object.freeze({
  payment_invoice_list: { objectTypes: ["payments.invoice"] },
  payment_invoice_prepare: { inputRoles: {
    "/personal_task_ids/*": "invoice_line_source",
    "/todo_lines/*/personal_task_id": "invoice_line_source",
    "/contact_id": "payer",
  } },
  payment_invoice_send: { inputRoles: { "/invoice_id": "subject" } },
});

export function registerPaymentTools(registry, payments) {
  registry = registry.withCapability?.("payments", toolDescriptions, nativeContracts) ?? registry;

  registry.register({
    name: "payment_stripe_status",
    description: "Read Stripe Connect configuration and refresh the connected merchant account's ability to accept charges.",
    outputSchema: { type: "object", properties: { stripe: { type: "object" } } },
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { return { stripe: await payments.stripeStatus({ refresh: true }) }; },
  });

  registry.register({
    name: "payment_stripe_connect_link",
    description: "Create a short-lived signed Stripe Connect authorization URL for the user to open. This does not connect an account until Stripe redirects back successfully.",
    outputSchema: { type: "object", properties: { url: { type: "string" } } },
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() { return payments.beginOAuth(); },
  });

  registry.register({
    name: "payment_invoice_list",
    description: "List native invoice snapshots and their latest observed Stripe state, newest first.",
    outputSchema: { type: "object", properties: {
      count: { type: "integer" }, invoices: { type: "array", items: invoiceSchema },
    } },
    parameters: { type: "object", additionalProperties: false, properties: {
      limit: { type: "integer", minimum: 1, maximum: 500 },
    }, required: [] },
    async execute(input) {
      const invoices = payments.listInvoices(input);
      return { count: invoices.length, invoices };
    },
  });

  registry.register({
    name: "payment_invoice_prepare",
    confirmationHandoff: true,
    description: "Prepare a local invoice preview from exact to-dos using their stored prices or explicit invoice-only prices, explicit manual lines, or both and one payer contact. This does not contact the payer or change a to-do's stored price. The returned exact handoff requires a separate user confirmation before sending; a Payments UI revision invalidates that handoff.",
    outputSchema: { type: "object", properties: {
      contractVersion: { type: "integer" }, status: { type: "string" }, expiresAt: { type: "string" },
      invoice: invoiceSchema, nextAction: { type: "object" },
    } },
    parameters: { type: "object", additionalProperties: false, properties: {
      personal_task_ids: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true,
        items: { type: "integer", minimum: 1 } },
      todo_lines: { type: "array", minItems: 1, maxItems: 100, items: {
        type: "object", additionalProperties: false, properties: {
          personal_task_id: { type: "integer", minimum: 1 },
          amount_minor: { type: "integer", minimum: 1 },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
        }, required: ["personal_task_id", "amount_minor", "currency"],
      } },
      manual_lines: { type: "array", minItems: 1, maxItems: 100, items: {
        type: "object", additionalProperties: false, properties: {
          description: { type: "string", minLength: 1, maxLength: 1000 },
          amount_minor: { type: "integer", minimum: 1 },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
        }, required: ["description", "amount_minor", "currency"],
      } },
      contact_id: { type: "integer", minimum: 1 },
      due_on: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      payment_method_policy: { type: "string", enum: ["ach_only", "card_only", "card_and_ach"] },
      description: { type: ["string", "null"], maxLength: 1000 },
    }, required: ["contact_id", "due_on"], anyOf: [
      { required: ["personal_task_ids"] },
      { required: ["todo_lines"] },
      { required: ["manual_lines"] },
    ] },
    async execute(input, context) {
      return payments.prepareInvoice(input, { ...context, actorType: "tool", actorName: "payment_invoice_prepare" });
    },
  });

  registry.register({
    name: "payment_invoice_send",
    description: "Send one exact prepared invoice after the user approved its returned confirmation handoff. The preview digest must match; this externally emails the payer through Stripe.",
    outputSchema: { type: "object", properties: {
      status: { type: "string" }, idempotentReplay: { type: "boolean" }, invoice: invoiceSchema,
    } },
    parameters: { type: "object", additionalProperties: false, properties: {
      invoice_id: { type: "integer", minimum: 1 },
      preview_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
    }, required: ["invoice_id", "preview_digest"] },
    async execute(input, context) {
      return payments.sendInvoice(input, { ...context, actorType: "tool", actorName: "payment_invoice_send" });
    },
  });
}
