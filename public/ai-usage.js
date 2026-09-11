const pricingKeys = ["inputPerMillion", "cachedInputPerMillion", "cacheWritePerMillion", "outputPerMillion"];

export function normalizePricing(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const pricing = {};
  for (const key of pricingKeys) {
    const raw = value[key];
    if (!["number", "string"].includes(typeof raw) || String(raw).trim() === "") return null;
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate < 0) return null;
    pricing[key] = rate;
  }
  return pricing;
}

export function aiEntryCost(entry, prices) {
  const pricing = normalizePricing(prices);
  if (!pricing || !entry) return null;
  if (entry.inputTokens == null || entry.outputTokens == null) return null;
  const input = Number(entry.inputTokens);
  const cached = Number(entry.cachedInputTokens ?? 0);
  const written = Number(entry.cacheWriteTokens ?? 0);
  const output = Number(entry.outputTokens);
  if (![input, cached, written, output].every(value => Number.isSafeInteger(value) && value >= 0)
    || cached + written > input) return null;
  // Cache reads/writes are subsets of input; reasoning is already in output.
  const cost = ((input - cached - written) * pricing.inputPerMillion
    + cached * pricing.cachedInputPerMillion
    + written * pricing.cacheWritePerMillion
    + output * pricing.outputPerMillion) / 1_000_000;
  return Number.isFinite(cost) ? cost : null;
}

export function uniqueUsageEntries(entries) {
  const unique = new Map();
  for (const entry of entries) {
    // A repeated join row is the same ledger usage event, not another charge.
    const key = entry.eventSeq == null ? entry : entry.eventSeq;
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

export function summarizeAiUsage(entries, pricing) {
  const selected = uniqueUsageEntries(entries);
  const costs = selected.map(entry => aiEntryCost(entry, pricing));
  return {
    tokens: selected.reduce((total, entry) => total + Number(entry.totalTokens || 0), 0),
    cost: normalizePricing(pricing) && costs.every(Number.isFinite)
      ? costs.reduce((total, cost) => total + cost, 0) : null,
  };
}

export function llmCallCountForUsage(usage, response = {}) {
  if (Number.isSafeInteger(usage?.modelCallCount) && usage.modelCallCount >= 0) return usage.modelCallCount;
  const calls = (response.protocolEvents ?? []).filter(event => event.type === "response.completed");
  return calls.length || null;
}

export function llmCallCountLabel(entries) {
  entries = uniqueUsageEntries(entries);
  if (entries.some(entry => !Number.isSafeInteger(entry.modelCallCount) || entry.modelCallCount < 0)) {
    return "LLM call count unavailable";
  }
  const count = entries.reduce((total, entry) => total + entry.modelCallCount, 0);
  return `${count.toLocaleString()} LLM call${count === 1 ? "" : "s"}`;
}

export function groupUsageByRequest(entries) {
  const groups = new Map();
  for (const entry of uniqueUsageEntries(entries).sort((a, b) => b.eventSeq - a.eventSeq)) {
    // Unlinked records must never be presented as a single request.
    const key = entry.requestId || `usage:${entry.eventSeq}`;
    if (!groups.has(key)) groups.set(key, { key, requestId: entry.requestId, entries: [] });
    groups.get(key).entries.unshift(entry);
  }
  return [...groups.values()];
}

export function usageFromTrace(events) {
  const responses = new Map();
  const entries = [];
  for (const event of [...events].sort((a, b) => a.eventSeq - b.eventSeq)) {
    const key = JSON.stringify([event.turnId, event.operationId]);
    if (event.type === "model.request") responses.delete(key);
    if (event.type === "model.response") responses.set(key, event);
    if (event.type !== "model.usage") continue;
    const response = responses.get(key);
    const payload = event.payload ?? {};
    entries.push({
      eventSeq: event.eventSeq,
      requestId: event.turnId,
      occurredAtUtc: event.occurredAtUtc,
      model: response?.actorName,
      transport: response?.payload?.transport ?? payload.provider,
      workflowStep: payload.workflowStep,
      reasoningEffort: payload.reasoningEffort,
      modelCallCount: llmCallCountForUsage(payload, response?.payload),
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      ...payload.tokenUsage,
      recordedEstimatedCostUsd: payload.estimatedCostUsd ?? null,
    });
  }
  return entries;
}
