export const defaultUiBaseColor = "#0e001e";
export const uiBaseColorStorageKey = "time-v3-ui-base-color";

type Rgb = { red: number; green: number; blue: number };

function parseHexColor(value: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/iu.exec(value);
  if (!match) return null;
  const color = match[1];
  return {
    red: Number.parseInt(color.slice(0, 2), 16),
    green: Number.parseInt(color.slice(2, 4), 16),
    blue: Number.parseInt(color.slice(4, 6), 16),
  };
}

function toHex({ red, green, blue }: Rgb) {
  return `#${[red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function mix(color: Rgb, target: Rgb, targetWeight: number) {
  return toHex({
    red: color.red + ((target.red - color.red) * targetWeight),
    green: color.green + ((target.green - color.green) * targetWeight),
    blue: color.blue + ((target.blue - color.blue) * targetWeight),
  });
}

function linearChannel(channel: number) {
  const normalized = channel / 255;
  return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
}

export function normalizeUiBaseColor(value: string) {
  const normalized = value.trim().toLowerCase();
  return parseHexColor(normalized) ? normalized : null;
}

export function uiBaseColorError(value: string) {
  const normalized = normalizeUiBaseColor(value);
  if (!normalized) return "Enter a six-digit hex color such as #0e001e.";
  const color = parseHexColor(normalized)!;
  const luminance = (.2126 * linearChannel(color.red))
    + (.7152 * linearChannel(color.green))
    + (.0722 * linearChannel(color.blue));
  return luminance <= .25 ? "" : "Choose a dark base color so text and controls remain readable.";
}

export function loadUiBaseColor() {
  try {
    const stored = localStorage.getItem(uiBaseColorStorageKey);
    return stored && !uiBaseColorError(stored) ? normalizeUiBaseColor(stored)! : defaultUiBaseColor;
  } catch {
    return defaultUiBaseColor;
  }
}

export function applyUiBaseColor(value: string) {
  const normalized = normalizeUiBaseColor(value) || defaultUiBaseColor;
  const base = parseHexColor(normalized)!;
  const white = { red: 255, green: 255, blue: 255 };
  const palette: Record<string, string> = {
    "--theme-base": normalized,
    "--theme-base-rgb": `${base.red} ${base.green} ${base.blue}`,
    "--ink": mix(base, white, .13),
    "--muted": mix(base, white, .46),
    "--paper": mix(base, white, .98),
    "--surface": mix(base, white, .955),
    "--page": mix(base, white, .92),
    "--line": mix(base, white, .84),
    "--olive": mix(base, white, .43),
    "--olive-dark": mix(base, white, .22),
    "--olive-soft": mix(base, white, .86),
    "--theme-border": mix(base, white, .68),
    "--theme-hover": mix(base, white, .16),
    "--theme-sidebar-text": mix(base, white, .84),
    "--theme-sidebar-muted": mix(base, white, .73),
    "--theme-sidebar-line": mix(base, white, .31),
    "--theme-button-hover": mix(base, white, .13),
  };
  for (const [name, color] of Object.entries(palette)) {
    document.documentElement.style.setProperty(name, color);
  }
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", normalized);
  return normalized;
}

export function saveUiBaseColor(value: string) {
  const normalized = normalizeUiBaseColor(value);
  const error = uiBaseColorError(value);
  if (!normalized || error) throw new Error(error);
  localStorage.setItem(uiBaseColorStorageKey, normalized);
  applyUiBaseColor(normalized);
  window.dispatchEvent(new CustomEvent("time-v3-theme-change", { detail: normalized }));
  return normalized;
}

export function resetUiBaseColor() {
  localStorage.removeItem(uiBaseColorStorageKey);
  applyUiBaseColor(defaultUiBaseColor);
  window.dispatchEvent(new CustomEvent("time-v3-theme-change", { detail: defaultUiBaseColor }));
  return defaultUiBaseColor;
}
