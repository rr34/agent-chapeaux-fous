const mutationToolNames = ["email_cleanup_apply", "email_bulk_update", "email_update"];
const receivedEventTypes = ["request.received", "voice.request.received"];
const responseEventTypes = ["assistant.response", "agent.turn.end"];

export function recentEmailCleanupReceipts(ledger, limit = 5) {
  const bounded = Math.min(10, Math.max(1, Number(limit) || 5));
  const turnIds = ledger.recentSuccessfulToolRequestIds(mutationToolNames, bounded);
  return turnIds.map((turnId) => {
    const events = ledger.trace(turnId);
    const request = events.find((event) => receivedEventTypes.includes(event.type));
    const response = [...events].reverse().find((event) => responseEventTypes.includes(event.type));
    const messagesById = new Map();
    for (const event of events.filter((item) => item.type === "tool.result" && item.status === "complete")) {
      const result = event.payload?.result;
      const messages = [
        ...(Array.isArray(result?.messages) ? result.messages : []),
        ...(Array.isArray(result?.list) ? result.list : []),
      ];
      for (const message of messages) {
        if (message?.id) messagesById.set(message.id, message);
      }
    }
    const operations = events
      .filter((event) => (
        event.type === "tool.result"
        && event.status === "complete"
        && mutationToolNames.includes(event.name)
      ))
      .map((resultEvent) => {
        const call = events.find((event) => (
          event.type === "tool.call"
          && event.operationId === resultEvent.operationId
          && event.name === resultEvent.name
        ));
        const args = call?.payload?.arguments ?? {};
        const result = resultEvent.payload?.result ?? {};
        const directMessages = Array.isArray(result.messages) ? result.messages : [];
        for (const message of directMessages) {
          if (message?.id) messagesById.set(message.id, message);
        }
        const emailIds = resultEvent.name === "email_cleanup_apply"
          ? directMessages.map(({ id }) => id)
          : resultEvent.name === "email_bulk_update"
            ? (result.emailIds ?? args.email_ids ?? [])
            : [args.email_id].filter(Boolean);
        const action = result.action
          ?? args.action
          ?? (args.destroy ? "permanent_destroy" : "update");
        return {
          tool: resultEvent.name,
          action,
          occurredAtUtc: resultEvent.occurredAtUtc,
          emailIds,
        };
      });
    const ids = [...new Set(operations.flatMap(({ emailIds }) => emailIds))];
    const messages = ids.map((id) => {
      const message = messagesById.get(id);
      return {
        id,
        threadId: message?.threadId ?? null,
        receivedAt: message?.receivedAt ?? null,
        from: message?.from ?? null,
        subject: message?.subject ?? null,
      };
    });
    return {
      requestId: turnId,
      requestedAtUtc: request?.occurredAtUtc ?? null,
      request: request?.content ?? null,
      response: response?.content ?? null,
      operationCount: operations.length,
      affectedCount: ids.length,
      operations,
      messages,
    };
  });
}

export function registerEmailReceiptTools(registry, ledger) {
  const emailRegistry = registry.withCapability?.("email") ?? registry;
  emailRegistry.register({
    name: "email_cleanup_receipt_list",
    description: "Recover exact recent email mutation receipts from Agent Slayer's durable tool ledger. Use this when the user asks which messages were just trashed, archived, updated, or deleted, especially when a prior response omitted or misstated them. Results reconstruct message ids and available sender, subject, and received time from the successful mutation and its same-request search or preview results.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { limit: { type: "integer", minimum: 1, maximum: 10 } },
      required: ["limit"],
    },
    async execute({ limit }) {
      const receipts = recentEmailCleanupReceipts(ledger, limit);
      return { count: receipts.length, receipts };
    },
  });
}
