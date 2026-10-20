function sequenceNumber(value: unknown) {
  if (value == null || value === "") return null;
  const sequence = Number(value);
  return Number.isFinite(sequence) ? sequence : null;
}

/**
 * Shared display ordering for user-facing sequence numbers.
 * Numbered items precede unnumbered items, with the newest/highest number first.
 */
export function compareSequenceValuesDescending(leftValue: unknown, rightValue: unknown) {
  const left = sequenceNumber(leftValue);
  const right = sequenceNumber(rightValue);
  if (left === null || right === null) {
    if (left === right) return 0;
    return left === null ? 1 : -1;
  }
  return right - left;
}
