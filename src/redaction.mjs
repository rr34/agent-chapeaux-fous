const secretKey = /(?:authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|cookie)/i;
const bearer = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const likelyApiKey = /\b(?:sk|pat)_[A-Za-z0-9_-]{16,}\b/g;

export function redactText(value) {
  if (typeof value !== "string") return value;
  return value.replace(bearer, "Bearer [REDACTED]").replace(likelyApiKey, "[REDACTED]");
}

export function redactValue(value, key = "", ancestors = new WeakSet()) {
  if (secretKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value);
  if (typeof value === "bigint") return value.toString();
  if (value == null || typeof value !== "object") return value;
  if (ancestors.has(value)) return "[CIRCULAR]";
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => redactValue(item, "", ancestors));
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => (
        [childKey, redactValue(child, childKey, ancestors)]
      )),
    );
  } finally {
    ancestors.delete(value);
  }
}

export function safeJson(value) {
  return JSON.stringify(redactValue(value));
}
