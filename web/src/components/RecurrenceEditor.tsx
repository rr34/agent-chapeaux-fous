const weekdays = [
  ["MO", "Mon"], ["TU", "Tue"], ["WE", "Wed"], ["TH", "Thu"],
  ["FR", "Fri"], ["SA", "Sat"], ["SU", "Sun"],
] as const;

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
type MonthPattern = "month-day" | "ordinal-weekday";
type Ending = "never" | "count" | "until";

export interface RecurrenceDraft {
  enabled: boolean;
  frequency: Frequency;
  interval: string;
  weekdays: string[];
  monthPattern: MonthPattern;
  monthDay: string;
  month: string;
  ordinal: string;
  ordinalWeekday: string;
  ending: Ending;
  count: string;
  until: string;
}

function ruleParts(rule?: string | null) {
  const parts: Record<string, string> = {};
  for (const segment of String(rule || "").replace(/^RRULE:/i, "").split(";")) {
    const separator = segment.indexOf("=");
    if (separator > 0) parts[segment.slice(0, separator).toUpperCase()] = segment.slice(separator + 1);
  }
  return parts;
}

function anchorParts(anchorDate?: string) {
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0")).join("-");
  const value = anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate) ? anchorDate : today;
  const date = new Date(`${value}T12:00:00`);
  return {
    day: String(date.getDate()),
    month: String(date.getMonth() + 1),
    weekday: ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][date.getDay()],
  };
}

export function recurrenceDraft(rule?: string | null, anchorDate?: string, required = false): RecurrenceDraft {
  const parts = ruleParts(rule);
  const anchor = anchorParts(anchorDate);
  const frequency = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(parts.FREQ)
    ? parts.FREQ as Frequency
    : "WEEKLY";
  const until = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL || "");
  return {
    enabled: required || Boolean(rule),
    frequency,
    interval: String(Math.max(1, Number(parts.INTERVAL) || 1)),
    weekdays: parts.BYDAY?.split(",").filter((day) => weekdays.some(([value]) => value === day))
      || (frequency === "WEEKLY" ? [anchor.weekday] : []),
    monthPattern: parts.BYSETPOS && parts.BYDAY ? "ordinal-weekday" : "month-day",
    monthDay: parts.BYMONTHDAY || anchor.day,
    month: parts.BYMONTH || anchor.month,
    ordinal: parts.BYSETPOS || "1",
    ordinalWeekday: parts.BYDAY?.split(",")[0] || anchor.weekday,
    ending: parts.COUNT ? "count" : parts.UNTIL ? "until" : "never",
    count: parts.COUNT || "10",
    until: until ? `${until[1]}-${until[2]}-${until[3]}` : "",
  };
}

export function buildRecurrenceRule(draft: RecurrenceDraft, required = false) {
  if (!required && !draft.enabled) return null;
  const interval = Number(draft.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) {
    throw new Error("Repeat interval must be a whole number from 1 to 999.");
  }
  const parts = [`FREQ=${draft.frequency}`, `INTERVAL=${interval}`];
  if (draft.frequency === "WEEKLY") {
    if (!draft.weekdays.length) throw new Error("Choose at least one weekday.");
    parts.push(`BYDAY=${draft.weekdays.join(",")}`);
  }
  if (["MONTHLY", "YEARLY"].includes(draft.frequency)) {
    if (draft.frequency === "YEARLY") {
      const month = Number(draft.month);
      if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("Choose a month.");
      parts.push(`BYMONTH=${month}`);
    }
    if (draft.monthPattern === "month-day") {
      const monthDay = Number(draft.monthDay);
      if (!Number.isInteger(monthDay) || monthDay < 1 || monthDay > 31) {
        throw new Error("Day of month must be a whole number from 1 to 31.");
      }
      parts.push(`BYMONTHDAY=${monthDay}`);
    } else {
      parts.push(`BYDAY=${draft.ordinalWeekday}`, `BYSETPOS=${draft.ordinal}`);
    }
  }
  if (draft.ending === "count") {
    const count = Number(draft.count);
    if (!Number.isInteger(count) || count < 1 || count > 9999) {
      throw new Error("Occurrences must be a whole number from 1 to 9999.");
    }
    parts.push(`COUNT=${count}`);
  } else if (draft.ending === "until") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.until)) throw new Error("Choose the last recurrence date.");
    parts.push(`UNTIL=${draft.until.replaceAll("-", "")}T235959`);
  }
  return parts.join(";");
}

export function describeRecurrence(draft: RecurrenceDraft, required = false) {
  if (!required && !draft.enabled) return "Does not repeat";
  try {
    const rule = buildRecurrenceRule(draft, required)!;
    const parts = ruleParts(rule);
    const interval = Number(parts.INTERVAL) || 1;
    const units: Record<Frequency, [string, string]> = {
      DAILY: ["day", "days"], WEEKLY: ["week", "weeks"],
      MONTHLY: ["month", "months"], YEARLY: ["year", "years"],
    };
    const [one, many] = units[draft.frequency];
    let label = interval === 1 ? `Every ${one}` : `Every ${interval} ${many}`;
    const weekdayLabels = Object.fromEntries(weekdays);
    if (parts.BYDAY && draft.frequency === "WEEKLY") {
      label += ` on ${parts.BYDAY.split(",").map((day) => weekdayLabels[day] || day).join(", ")}`;
    }
    if (parts.BYMONTHDAY) label += ` on day ${parts.BYMONTHDAY}`;
    if (parts.BYSETPOS && parts.BYDAY) {
      const ordinals: Record<string, string> = { "1": "first", "2": "second", "3": "third", "4": "fourth", "5": "fifth", "-1": "last" };
      label += ` on the ${ordinals[parts.BYSETPOS] || parts.BYSETPOS} ${weekdayLabels[parts.BYDAY] || parts.BYDAY}`;
    }
    if (parts.BYMONTH) label += ` in ${months[Number(parts.BYMONTH) - 1]}`;
    if (parts.COUNT) label += `, ${parts.COUNT} occurrences`;
    if (draft.ending === "until" && draft.until) label += `, through ${draft.until}`;
    return label;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function RecurrenceEditor({ value, onChange, required = false, showEnding = true }: {
  value: RecurrenceDraft;
  onChange: (value: RecurrenceDraft) => void;
  required?: boolean;
  showEnding?: boolean;
}) {
  const update = (change: Partial<RecurrenceDraft>) => onChange({ ...value, ...change });
  const active = required || value.enabled;
  const monthlyPattern = value.frequency === "MONTHLY" || value.frequency === "YEARLY";
  return <fieldset className="recurrence-editor">
    <legend>Repeat</legend>
    {!required && <label className="object-editor-check recurrence-toggle"><input type="checkbox" checked={value.enabled} onChange={(change) => update({ enabled: change.target.checked })} /><span>Repeat this event</span></label>}
    {active && <div className="recurrence-fields">
      <div className="recurrence-every"><span>Every</span><input aria-label="Repeat interval" type="number" min={1} max={999} step={1} required value={value.interval} onChange={(change) => update({ interval: change.target.value })} /><select aria-label="Repeat frequency" value={value.frequency} onChange={(change) => update({ frequency: change.target.value as Frequency })}><option value="DAILY">day(s)</option><option value="WEEKLY">week(s)</option><option value="MONTHLY">month(s)</option><option value="YEARLY">year(s)</option></select></div>
      {value.frequency === "WEEKLY" && <fieldset className="recurrence-weekdays"><legend>On</legend>{weekdays.map(([day, label]) => <label key={day}><input type="checkbox" checked={value.weekdays.includes(day)} onChange={(change) => update({ weekdays: change.target.checked ? [...value.weekdays, day] : value.weekdays.filter((current) => current !== day) })} />{label}</label>)}</fieldset>}
      {monthlyPattern && <div className="recurrence-pattern-fields">
        {value.frequency === "YEARLY" && <label>Month<select value={value.month} onChange={(change) => update({ month: change.target.value })}>{months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>}
        <label>Pattern<select value={value.monthPattern} onChange={(change) => update({ monthPattern: change.target.value as MonthPattern })}><option value="month-day">Day of the month</option><option value="ordinal-weekday">Weekday pattern</option></select></label>
        {value.monthPattern === "month-day"
          ? <label>Day<input type="number" min={1} max={31} step={1} required value={value.monthDay} onChange={(change) => update({ monthDay: change.target.value })} /></label>
          : <><label>Which<select value={value.ordinal} onChange={(change) => update({ ordinal: change.target.value })}><option value="1">First</option><option value="2">Second</option><option value="3">Third</option><option value="4">Fourth</option><option value="5">Fifth</option><option value="-1">Last</option></select></label><label>Weekday<select value={value.ordinalWeekday} onChange={(change) => update({ ordinalWeekday: change.target.value })}>{weekdays.map(([day, label]) => <option key={day} value={day}>{label}</option>)}</select></label></>}
      </div>}
      {showEnding && <div className="recurrence-ending"><label>Ends<select value={value.ending} onChange={(change) => update({ ending: change.target.value as Ending })}><option value="never">Never</option><option value="count">After a number of times</option><option value="until">On a date</option></select></label>{value.ending === "count" && <label>Occurrences<input type="number" min={1} max={9999} step={1} required value={value.count} onChange={(change) => update({ count: change.target.value })} /></label>}{value.ending === "until" && <label>Last date<input type="date" required value={value.until} onChange={(change) => update({ until: change.target.value })} /></label>}</div>}
      <p className="recurrence-summary">{describeRecurrence(value, required)}</p>
    </div>}
  </fieldset>;
}
