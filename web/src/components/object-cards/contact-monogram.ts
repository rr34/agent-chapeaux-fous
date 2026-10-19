export function contactMonogram(displayName: string) {
  const nameParts = displayName.trim().split(/\s+/u).filter(Boolean);
  if (nameParts.length === 0) return "";

  if (nameParts.length === 1) {
    return Array.from(nameParts[0]).slice(0, 2).join("").toUpperCase();
  }

  const firstInitial = Array.from(nameParts[0])[0] ?? "";
  const lastInitial = Array.from(nameParts.at(-1) ?? "")[0] ?? "";
  return `${firstInitial}${lastInitial}`.toUpperCase();
}
