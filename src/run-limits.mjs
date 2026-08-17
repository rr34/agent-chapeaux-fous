const maximumToolCalls = 10_000;
const minimumRunTimeoutMs = 1_000;
const maximumRunTimeoutMs = 24 * 60 * 60 * 1000;

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function normalizeRunLimits(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw inputError("runLimits must be an object or null");
  }
  const unexpected = Object.keys(value).filter((key) => !["maxToolCalls", "timeoutMs"].includes(key));
  if (unexpected.length) throw inputError(`Unexpected runLimits field: ${unexpected[0]}`);
  if (!Object.hasOwn(value, "maxToolCalls") || !Object.hasOwn(value, "timeoutMs")) {
    throw inputError("runLimits must include maxToolCalls and timeoutMs");
  }
  const maxToolCalls = value.maxToolCalls;
  if (maxToolCalls !== null && (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 1 || maxToolCalls > maximumToolCalls)) {
    throw inputError(`maxToolCalls must be null or an integer from 1 through ${maximumToolCalls}`);
  }
  const timeoutMs = value.timeoutMs;
  if (timeoutMs !== null && (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < minimumRunTimeoutMs
    || timeoutMs > maximumRunTimeoutMs
  )) {
    throw inputError("timeoutMs must be null or an integer from 1000 through 86400000");
  }
  return { maxToolCalls, timeoutMs };
}
