export function groupUsageByRequest(entries) {
  const groups = new Map();
  for (const entry of [...entries].sort((a, b) => b.eventSeq - a.eventSeq)) {
    // Unlinked records must never be presented as a single request.
    const key = entry.requestId || `usage:${entry.eventSeq}`;
    if (!groups.has(key)) groups.set(key, { key, requestId: entry.requestId, entries: [] });
    groups.get(key).entries.unshift(entry);
  }
  return [...groups.values()];
}

export function usageFromTrace(events) {
  const responses = new Map(events.filter((event) => event.type === "model.response")
    .map((event) => [event.operationId, event]));
  return events.filter((event) => event.type === "model.usage").map((event) => {
    const response = responses.get(event.operationId);
    const payload = event.payload ?? {};
    return {
      eventSeq: event.eventSeq,
      requestId: event.turnId,
      occurredAtUtc: event.occurredAtUtc,
      model: response?.actorName,
      transport: response?.payload?.transport ?? payload.provider,
      workflowStep: payload.workflowStep,
      reasoningEffort: payload.reasoningEffort,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      ...payload.tokenUsage,
      recordedEstimatedCostUsd: payload.estimatedCostUsd ?? null,
    };
  }).sort((a, b) => a.eventSeq - b.eventSeq);
}
