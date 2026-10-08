export const maximumObjectReferences = 500;

export interface ComposerTextSelection {
  start: number;
  end: number;
}

export function insertObjectMentions(
  value: string,
  mentions: string[],
  selection: ComposerTextSelection | null,
) {
  const requestedStart = selection?.start ?? value.length;
  const requestedEnd = selection?.end ?? requestedStart;
  const start = Math.max(0, Math.min(value.length, Math.min(requestedStart, requestedEnd)));
  const end = Math.max(start, Math.min(value.length, Math.max(requestedStart, requestedEnd)));
  const before = value.slice(0, start);
  const after = value.slice(end);
  const leadingSpace = before && !/\s$/u.test(before) ? " " : "";
  const usesExistingSpace = /^[ \t]/u.test(after);
  const trailingSpace = usesExistingSpace ? "" : " ";
  const inserted = `${leadingSpace}${mentions.join(" ")}${trailingSpace}`;

  return {
    value: `${before}${inserted}${after}`,
    cursor: before.length + inserted.length + (usesExistingSpace ? 1 : 0),
  };
}

export function descriptiveObjectMention({
  display, label, id,
}: {
  display: string;
  label: string;
  id: number | string;
}) {
  const suffix = ` — ${label} #${String(id)}`;
  const maximumDisplayCharacters = Math.max(1, 499 - suffix.length);
  const boundedDisplay = display.length <= maximumDisplayCharacters
    ? display
    : `${display.slice(0, Math.max(1, maximumDisplayCharacters - 1)).trimEnd()}…`;
  return `@${boundedDisplay}${suffix}`;
}
