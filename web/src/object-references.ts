export const maximumObjectReferences = 500;

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
