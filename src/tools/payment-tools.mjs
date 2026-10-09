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
    summary: "Read native invoices with task-backed or manual line snapshots, their paid or unpaid payment status, and any observed Stripe lifecycle state.",
    actionClasses: ["READ"], effectClassifications: ["READ-ONLY"],
  },
  payment_invoice_prepare: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Immediately create an editable local invoice draft from one or more to-do or manual lines, then report what remains. Never ask first for prices, payer, or due date; they may be left blank. A send-ready draft returns the exact final-confirmation handoff.",
    actionClasses: ["CREATE"], effectClassifications: ["MUTATING"],
  },
  payment_invoice_update: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Revise one exact editable local invoice draft without changing its referenced to-dos; update its description, payer, due date, payment methods, line snapshots, or appended manual lines.",
    actionClasses: ["UPDATE"], effectClassifications: ["MUTATING"],
  },
  payment_invoice_payment_status_set: {
    protocol: "agent-slayer.tool-description", version: 1,
    summary: "Mark one exact native invoice paid or unpaid; Stripe-backed invoices keep Stripe-owned payment truth.",
    actionClasses: ["UPDATE"], effectClassifications: ["MUTATING"],
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
    description: { type: "string" }, amountMinor: { type: "integer", minimum: 0 },
  },
};

const invoiceSchema = {
  type: ["object", "null"],
  description: "One native invoice whose current line descriptions and prices snapshot selected to-dos, manual lines, or both. Prepared previews may be revised in the Payments UI or with payment_invoice_update; sending makes them immutable.",
  properties: {
    invoiceId: { type: "integer" }, ref: { type: "string" }, display: { type: "string" },
    payerContactId: { type: ["integer", "null"] }, payerName: { type: ["string", "null"] }, payerEmail: { type: ["string", "null"] },
    status: { type: "string", description: "Internal invoice delivery lifecycle, not the two-state payment status." },
    paymentStatus: { type: "string", enum: ["unpaid", "paid"] },
    paymentStatusManagedBy: { type: "string", enum: ["native", "stripe"] },
    currency: { type: "string" }, amountMinor: { type: "integer" },
    dueOn: { type: ["string", "null"] }, paymentMethodPolicy: { type: "string" },
    description: { type: ["string", "null"] }, previewDigest: { type: "string" },
    preparationExpiresAtUtc: { type: "string" }, stripeInvoiceId: { type: ["string", "null"] },
    processorStatus: { type: ["string", "null"] }, hostedInvoiceUrl: { type: ["string", "null"] },
    amountPaidMinor: { type: "integer" }, createdAtUtc: { type: "string" },
    updatedAtUtc: { type: ["string", "null"] }, lines: { type: "array", items: lineSchema },
  },
};

const preparedInvoiceResultSchema = { type: "object", properties: {
  contractVersion: { type: "integer" }, status: { type: "string" }, expiresAt: { type: "string" },
  invoice: invoiceSchema, missingFields: { type: "array", items: { type: "string" } },
  nextAction: { type: ["object", "null"] },
} };

const nativeContracts = Object.freeze({
  payment_invoice_list: { objectTypes: ["payments.invoice"] },
  payment_invoice_prepare: { inputRoles: {
    "/personal_task_ids/*": "invoice_line_source",
    "/todo_lines/*/personal_task_id": "invoice_line_source",
    "/contact_id": "payer",
  } },
  payment_invoice_update: {
    inputRoles: { "/invoice_id": "subject", "/contact_id": "payer" },
  },
  payment_invoice_payment_status_set: { inputRoles: { "/invoice_id": "subject" } },
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
    description: "Immediately create an editable local invoice draft with at least one exact to-do or manual line. Do not ask for line prices, payer, or due date before calling this tool: those fields may be omitted and completed later in Payments. Zero-dollar lines are valid for explicitly documenting work that was not charged, but the invoice total must be positive before sending. Return the created draft and report missingFields afterward. This does not require Stripe, contact the payer, or change a to-do's stored price. Only a send-ready result includes an exact confirmation handoff.",
    outputSchema: preparedInvoiceResultSchema,
    parameters: { type: "object", additionalProperties: false, properties: {
      personal_task_ids: { type: "array", minItems: 1, maxItems: 100, uniqueItems: true,
        items: { type: "integer", minimum: 1 } },
      todo_lines: { type: "array", minItems: 1, maxItems: 100, items: {
        type: "object", additionalProperties: false, properties: {
          personal_task_id: { type: "integer", minimum: 1 },
          amount_minor: { type: "integer", minimum: 0 },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
        }, required: ["personal_task_id"],
      } },
      manual_lines: { type: "array", minItems: 1, maxItems: 100, items: {
        type: "object", additionalProperties: false, properties: {
          description: { type: "string", minLength: 1, maxLength: 1000 },
          amount_minor: { type: "integer", minimum: 0 },
          currency: { type: "string", pattern: "^[A-Z]{3}$" },
        }, required: ["description"],
      } },
      contact_id: { type: "integer", minimum: 1 },
      due_on: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      currency: { type: "string", pattern: "^[A-Z]{3}$" },
      payment_method_policy: { type: "string", enum: ["ach_only", "card_only", "card_and_ach"] },
      description: { type: ["string", "null"], maxLength: 1000 },
    }, required: [], anyOf: [
      { required: ["personal_task_ids"] },
      { required: ["todo_lines"] },
      { required: ["manual_lines"] },
    ] },
    async execute(input, context) {
      return payments.prepareInvoice(input, { ...context, actorType: "tool", actorName: "payment_invoice_prepare" });
    },
  });

  registry.register({
    name: "payment_invoice_update",
    confirmationHandoff: true,
    description: "Update one exact local prepared invoice while leaving its referenced to-dos unchanged. Use payment_invoice_list first and pass its current preview_digest. Supply only intended header changes and line updates; unchanged line text and prices are preserved. line_updates addresses existing invoice snapshots by position, and manual_lines appends new independent lines. An amount_minor of zero is a valid no-charge line. This never finalizes, sends, emails, or changes a to-do.",
    outputSchema: preparedInvoiceResultSchema,
    parameters: { type: "object", additionalProperties: false, properties: {
      invoice_id: { type: "integer", minimum: 1 },
      preview_digest: { type: "string", pattern: "^sha256:[0-9a-f]{64}$" },
      description: { type: ["string", "null"], maxLength: 1000 },
      contact_id: { type: ["integer", "null"], minimum: 1 },
      due_on: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      payment_method_policy: { type: "string", enum: ["ach_only", "card_only", "card_and_ach"] },
      line_updates: { type: "array", minItems: 1, maxItems: 100, items: {
        type: "object", additionalProperties: false, properties: {
          position: { type: "integer", minimum: 1 },
          description: { type: "string", minLength: 1, maxLength: 1000 },
          amount_minor: { type: "integer", minimum: 0 },
        }, required: ["position"], anyOf: [
          { required: ["description"] }, { required: ["amount_minor"] },
        ],
      } },
      manual_lines: { type: "array", minItems: 1, maxItems: 100, items: {
        type: "object", additionalProperties: false, properties: {
          description: { type: "string", minLength: 1, maxLength: 1000 },
          amount_minor: { type: "integer", minimum: 0 },
        }, required: ["description"],
      } },
    }, required: ["invoice_id", "preview_digest"], anyOf: [
      { required: ["description"] }, { required: ["contact_id"] }, { required: ["due_on"] },
      { required: ["payment_method_policy"] }, { required: ["line_updates"] },
      { required: ["manual_lines"] },
    ] },
    async execute(input, context) {
      return payments.patchPreparedInvoice(input.invoice_id, input, {
        ...context, actorType: "tool", actorName: "payment_invoice_update",
      });
    },
  });

  registry.register({
    name: "payment_invoice_payment_status_set",
    description: "Mark one exact native invoice paid or unpaid. Use payment_invoice_list first to identify the invoice. This changes only the native two-state payment status and records an activity entry; it does not send, email, charge, refund, or modify invoice contents. If the invoice has reached Stripe, an already-matching status is an idempotent no-op and a conflicting change is rejected because Stripe remains authoritative.",
    outputSchema: { type: "object", properties: {
      status: { type: "string" }, idempotentReplay: { type: "boolean" }, invoice: invoiceSchema,
    } },
    parameters: { type: "object", additionalProperties: false, properties: {
      invoice_id: { type: "integer", minimum: 1 },
      payment_status: { type: "string", enum: ["unpaid", "paid"] },
    }, required: ["invoice_id", "payment_status"] },
    async execute(input, context) {
      return payments.setNativePaymentStatus(input.invoice_id, input.payment_status, {
        ...context, actorType: "tool", actorName: "payment_invoice_payment_status_set",
      });
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
