function normalizedSearchText(value: unknown) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

export function searchTerms(query: string) {
  return [...new Set(normalizedSearchText(query).match(/[\p{L}\p{N}]+/gu) || [])];
}

function collectSearchValues(value: unknown, values: string[], seen: Set<object>) {
  if (value == null) return;
  if (typeof value !== "object") {
    values.push(normalizedSearchText(value));
    return;
  }
  if (seen.has(value)) return;
  seen.add(value);
  for (const nestedValue of Array.isArray(value) ? value : Object.values(value)) {
    collectSearchValues(nestedValue, values, seen);
  }
}

export function matchesSearch(value: unknown, query: string) {
  const terms = searchTerms(query);
  if (!terms.length) return true;
  const values: string[] = [];
  collectSearchValues(value, values, new Set());
  const searchableText = values.join(" ");
  return terms.every((term) => searchableText.includes(term));
}
