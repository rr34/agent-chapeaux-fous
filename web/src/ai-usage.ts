export const aiPricingStorageKey = "agent-slayer-ai-pricing";

export type AiPricing = {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  cacheWritePerMillion: number;
  outputPerMillion: number;
};

export type AiPricingBook = Record<string, AiPricing>;

export type AiUsageCostInput = {
  serviceTier?: string | null;
  usageByServiceTier?: Array<{
    serviceTier?: string | null;
    tokenUsage?: Partial<AiUsageCostInput> | null;
  }> | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  cacheWriteTokens?: number | null;
  outputTokens?: number | null;
};

const pricingKeys = [
  "inputPerMillion", "cachedInputPerMillion", "cacheWritePerMillion", "outputPerMillion",
] as const;

export function normalizeAiPricing(value: unknown): AiPricing | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const result = {} as AiPricing;
  for (const key of pricingKeys) {
    const raw = candidate[key];
    if ((typeof raw !== "number" && typeof raw !== "string") || String(raw).trim() === "") return null;
    const rate = Number(raw);
    if (!Number.isFinite(rate) || rate < 0) return null;
    result[key] = rate;
  }
  return result;
}

export function normalizeAiPricingBook(value: unknown): AiPricingBook {
  const legacy = normalizeAiPricing(value);
  if (legacy) return { default: legacy, unrecorded: legacy };
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const book: AiPricingBook = {};
  for (const [tier, candidate] of Object.entries(value)) {
    if (!tier.trim() || tier.length > 128) continue;
    const pricing = normalizeAiPricing(candidate);
    if (pricing) book[tier] = pricing;
  }
  return book;
}

export function loadAiPricing(): AiPricingBook {
  try {
    return normalizeAiPricingBook(JSON.parse(localStorage.getItem(aiPricingStorageKey) || "null"));
  } catch {
    return {};
  }
}

export function pricingForServiceTier(book: AiPricingBook, serviceTier?: string | null) {
  return book[serviceTier || "unrecorded"] ?? null;
}

function tokenUsageCost(entry: AiUsageCostInput, pricing: AiPricing | null) {
  if (!pricing || entry.inputTokens == null || entry.outputTokens == null) return null;
  const input = Number(entry.inputTokens);
  const cached = Number(entry.cachedInputTokens ?? 0);
  const written = Number(entry.cacheWriteTokens ?? 0);
  const output = Number(entry.outputTokens);
  if (![input, cached, written, output].every((value) => Number.isSafeInteger(value) && value >= 0)
    || cached + written > input) return null;
  const cost = ((input - cached - written) * pricing.inputPerMillion
    + cached * pricing.cachedInputPerMillion
    + written * pricing.cacheWritePerMillion
    + output * pricing.outputPerMillion) / 1_000_000;
  return Number.isFinite(cost) ? cost : null;
}

export function aiUsageCost(entry: AiUsageCostInput, book: AiPricingBook) {
  const parts = Array.isArray(entry.usageByServiceTier) && entry.usageByServiceTier.length
    ? entry.usageByServiceTier
    : [{ serviceTier: entry.serviceTier, tokenUsage: entry }];
  let total = 0;
  for (const part of parts) {
    const cost = tokenUsageCost(part.tokenUsage ?? {}, pricingForServiceTier(book, part.serviceTier));
    if (cost == null || !Number.isFinite(cost)) return null;
    total += cost;
  }
  return total;
}
