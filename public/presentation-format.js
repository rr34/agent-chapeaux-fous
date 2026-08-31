const shortWeekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const shortMonths = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const monthNumbers = new Map([
  ["jan", 1], ["january", 1], ["feb", 2], ["february", 2],
  ["mar", 3], ["march", 3], ["apr", 4], ["april", 4],
  ["may", 5], ["jun", 6], ["june", 6], ["jul", 7], ["july", 7],
  ["aug", 8], ["august", 8], ["sep", 9], ["sept", 9], ["september", 9],
  ["oct", 10], ["october", 10], ["nov", 11], ["november", 11],
  ["dec", 12], ["december", 12],
]);

const weekdayNamePattern = [
  "Mon(?:day)?", "Tue(?:sday)?", "Wed(?:nesday)?", "Thu(?:rsday)?",
  "Fri(?:day)?", "Sat(?:urday)?", "Sun(?:day)?",
].join("|");
const monthNamePattern = [
  "Jan(?:uary)?", "Feb(?:ruary)?", "Mar(?:ch)?", "Apr(?:il)?", "May",
  "Jun(?:e)?", "Jul(?:y)?", "Aug(?:ust)?", "Sep(?:t(?:ember)?|tember)?",
  "Oct(?:ober)?", "Nov(?:ember)?", "Dec(?:ember)?",
].join("|");

function validCalendarParts(yearValue, monthValue, dayValue) {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isSafeInteger(year) || year < 1 || year > 9999
    || !Number.isSafeInteger(month) || month < 1 || month > 12
    || !Number.isSafeInteger(day) || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) return null;
  return { year, month, day, date };
}

function calendarLabel(yearValue, monthValue, dayValue) {
  const parsed = validCalendarParts(yearValue, monthValue, dayValue);
  if (!parsed) return null;
  return `${shortWeekdays[parsed.date.getUTCDay()]}, ${String(parsed.day).padStart(2, "0")} ${shortMonths[parsed.month - 1]} ${String(parsed.year).padStart(4, "0")}`;
}

export function formatDisplayTime(value, { timeZone = null, fallback = "—" } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    ...(timeZone ? { timeZone } : {}),
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type) => timeParts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}`;
}

export function formatDisplayDate(value, {
  includeTime = true, fallback = "—", timeZone = null,
} = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  const dateParts = new Intl.DateTimeFormat("en-GB", {
    ...(timeZone ? { timeZone } : {}),
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  }).formatToParts(date);
  const part = (type) => dateParts.find((candidate) => candidate.type === type)?.value ?? "";
  const dateLabel = `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
  if (!includeTime) return dateLabel;
  return `${dateLabel} at ${formatDisplayTime(date, { timeZone, fallback })}`;
}

export function formatLocalDate(value, { fallback = "—" } = {}) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  return match ? calendarLabel(match[1], match[2], match[3]) ?? fallback : fallback;
}

function replaceProseDates(text) {
  const dayFirst = new RegExp(
    `(?<![\\w/.-])(?:(?:${weekdayNamePattern})\\s*,?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNamePattern})\\s+(\\d{4})(?![\\w/-])`,
    "giu",
  );
  const monthFirst = new RegExp(
    `(?<![\\w/.-])(?:(?:${weekdayNamePattern})\\s*,?\\s+)?(${monthNamePattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s+(\\d{4})(?![\\w/-])`,
    "giu",
  );
  const isoDate = new RegExp(
    `(?<![\\w/.-])(?:(?:${weekdayNamePattern})\\s*,?\\s+)?(\\d{4})-(\\d{2})-(\\d{2})(?![Tt]\\d|[\\w/-])`,
    "giu",
  );
  return text
    .replace(dayFirst, (original, day, monthName, year) => {
      const month = monthNumbers.get(String(monthName).toLowerCase());
      return calendarLabel(year, month, day) ?? original;
    })
    .replace(monthFirst, (original, monthName, day, year) => {
      const month = monthNumbers.get(String(monthName).toLowerCase());
      return calendarLabel(year, month, day) ?? original;
    })
    .replace(isoDate, (original, year, month, day) => (
      calendarLabel(year, month, day) ?? original
    ));
}

function replaceOutsideInlineCodeAndUrls(line) {
  const protectedSpan = /`+[^`\n]*`+|"(?:\\.|[^"\\])*"|(?:https?:\/\/|mailto:)[^\s<>)]+/giu;
  let cursor = 0;
  let output = "";
  for (const match of line.matchAll(protectedSpan)) {
    output += replaceProseDates(line.slice(cursor, match.index));
    output += match[0];
    cursor = match.index + match[0].length;
  }
  return output + replaceProseDates(line.slice(cursor));
}

// This is deliberately a presentation-only boundary. Machine representations
// in fenced/inline code, URLs, filenames, and ISO timestamps remain literal.
export function formatUserFacingDates(value) {
  const lines = String(value ?? "").split("\n");
  let fence = null;
  return lines.map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
    if (fence) {
      if (marker?.[0] === fence.character && marker.length >= fence.length) fence = null;
      return line;
    }
    if (marker) {
      fence = { character: marker[0], length: marker.length };
      return line;
    }
    return replaceOutsideInlineCodeAndUrls(line);
  }).join("\n");
}
