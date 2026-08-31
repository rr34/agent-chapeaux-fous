const frequencies = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
const weekdays = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
const ordinalPositions = new Set([-1, 1, 2, 3, 4, 5]);

function boundedInteger(value, label, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) {
    throw new Error(`${label} must be a whole number from 1 to ${maximum}`);
  }
  return number;
}

export function validateTimeZone(value, fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC") {
  const zone = value?.trim() || fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
  } catch {
    throw new Error("recurrence time_zone must be a valid IANA time zone");
  }
  return zone;
}

export function buildRecurrenceRule({
  frequency,
  interval = 1,
  weekdays: selectedWeekdays = [],
  month = null,
  month_day: monthDay = null,
  ordinal_weekday: ordinalWeekday = null,
  count = null,
  until_date: untilDate = null,
} = {}) {
  const normalizedFrequency = String(frequency || "").toUpperCase();
  if (!frequencies.has(normalizedFrequency)) {
    throw new Error("recurrence frequency must be daily, weekly, monthly, or yearly");
  }
  const normalizedInterval = boundedInteger(interval, "recurrence interval", 999);
  const parts = [`FREQ=${normalizedFrequency}`, `INTERVAL=${normalizedInterval}`];
  if (normalizedFrequency === "WEEKLY") {
    const normalizedWeekdays = [...new Set(selectedWeekdays.map((day) => String(day).toUpperCase()))];
    if (!normalizedWeekdays.length || normalizedWeekdays.some((day) => !weekdays.has(day))) {
      throw new Error("weekly recurrence requires at least one weekday from MO through SU");
    }
    parts.push(`BYDAY=${normalizedWeekdays.join(",")}`);
  }
  if (monthDay != null && ordinalWeekday != null) {
    throw new Error("recurrence can use a month day or an ordinal weekday, not both");
  }
  if ((monthDay != null || ordinalWeekday != null)
    && !["MONTHLY", "YEARLY"].includes(normalizedFrequency)) {
    throw new Error("month day patterns require monthly or yearly recurrence");
  }
  if (month != null) {
    const normalizedMonth = Number(month);
    if (normalizedFrequency !== "YEARLY" || !Number.isInteger(normalizedMonth)
      || normalizedMonth < 1 || normalizedMonth > 12) {
      throw new Error("recurrence month must be 1 through 12 and is valid only for yearly recurrence");
    }
    parts.push(`BYMONTH=${normalizedMonth}`);
  }
  if (normalizedFrequency === "YEARLY" && (monthDay != null || ordinalWeekday != null) && month == null) {
    throw new Error("yearly month-day patterns require recurrence month");
  }
  if (monthDay != null) {
    const normalizedMonthDay = Number(monthDay);
    if (!Number.isInteger(normalizedMonthDay) || normalizedMonthDay < 1 || normalizedMonthDay > 31) {
      throw new Error("recurrence month_day must be a whole number from 1 to 31");
    }
    parts.push(`BYMONTHDAY=${normalizedMonthDay}`);
  }
  if (ordinalWeekday != null) {
    const position = Number(ordinalWeekday.ordinal);
    const weekday = String(ordinalWeekday.weekday || "").toUpperCase();
    if (!ordinalPositions.has(position) || !weekdays.has(weekday)) {
      throw new Error("recurrence ordinal_weekday requires first through fifth or last and a weekday");
    }
    parts.push(`BYDAY=${weekday}`, `BYSETPOS=${position}`);
  }
  if (count != null && untilDate) throw new Error("recurrence can end by count or date, not both");
  if (count != null) parts.push(`COUNT=${boundedInteger(count, "recurrence count", 9999)}`);
  if (untilDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(untilDate)) {
      throw new Error("recurrence until_date must be YYYY-MM-DD");
    }
    const date = new Date(`${untilDate}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== untilDate) {
      throw new Error("recurrence until_date is not a real calendar date");
    }
    parts.push(`UNTIL=${untilDate.replaceAll("-", "")}T235959`);
  }
  return parts.join(";");
}

export const buildTodoRecurrenceRule = buildRecurrenceRule;

export const recurrenceSchema = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: {
    frequency: { type: "string", enum: ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] },
    interval: { type: "integer", minimum: 1, maximum: 999 },
    weekdays: {
      type: "array",
      items: { type: "string", enum: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] },
      uniqueItems: true,
    },
    month: { type: ["integer", "null"], minimum: 1, maximum: 12 },
    month_day: { type: ["integer", "null"], minimum: 1, maximum: 31 },
    ordinal_weekday: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: {
        ordinal: { type: "integer", enum: [1, 2, 3, 4, 5, -1] },
        weekday: { type: "string", enum: ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] },
      },
      required: ["ordinal", "weekday"],
    },
    count: { type: ["integer", "null"], minimum: 1, maximum: 9999 },
    until_date: { type: ["string", "null"], description: "Inclusive final date in YYYY-MM-DD format." },
    time_zone: { type: ["string", "null"], description: "IANA time zone, for example America/New_York." },
  },
  required: ["frequency", "interval", "weekdays", "count", "until_date", "time_zone"],
};

export const todoRecurrenceSchema = recurrenceSchema;
