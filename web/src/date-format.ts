const shortWeekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const shortMonths = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function localParts(localDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day
  ) return null;
  return {
    year,
    month,
    day,
    weekday: shortWeekdays[date.getUTCDay()],
    monthName: shortMonths[month - 1],
  };
}

export function formatLocalDate(localDate: string, fallback = "—") {
  const parts = localParts(localDate);
  if (!parts) return fallback;
  return `${parts.weekday}, ${parts.day} ${parts.monthName} ${parts.year}`;
}

export function formatLocalDateRange(startDate: string, endDate: string, fallback = "—") {
  const start = localParts(startDate);
  const end = localParts(endDate);
  if (!start || !end) return fallback;
  const startDay = String(start.day);
  const endDay = String(end.day);
  if (startDate === endDate) return formatLocalDate(startDate, fallback);
  if (start.year === end.year && start.month === end.month) {
    return `${startDay}-${endDay} ${start.monthName} ${start.year}`;
  }
  if (start.year === end.year) {
    return `${startDay} ${start.monthName} - ${endDay} ${end.monthName} ${start.year}`;
  }
  return `${startDay} ${start.monthName} ${start.year} - ${endDay} ${end.monthName} ${end.year}`;
}

export function formatDisplayTime(value: string | number | Date, timeZone?: string, fallback = "—") {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...(timeZone ? { timeZone } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value || "";
  return `${part("hour")}:${part("minute")}`;
}

export function formatDisplayDate(
  value: string | number | Date,
  { includeTime = true, timeZone, fallback = "—" }: {
    includeTime?: boolean;
    timeZone?: string;
    fallback?: string;
  } = {},
) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  const parts = new Intl.DateTimeFormat("en-GB", {
    ...(timeZone ? { timeZone } : {}),
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value || "";
  const label = `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
  return includeTime ? `${label} at ${formatDisplayTime(date, timeZone, fallback)}` : label;
}
