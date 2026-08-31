const weekdays = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

const weekdayPattern = weekdays.join("|");
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function dateParts(localDate) {
  if (!localDatePattern.test(String(localDate ?? ""))) return null;
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return { year, month, day, date };
}

export function weekdayForLocalDate(localDate) {
  const parsed = dateParts(localDate);
  return parsed ? weekdays[parsed.date.getUTCDay()] : null;
}

function formatLocalParts(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  return Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
}

export function localCalendarSnapshot(now = new Date(), timeZone = "UTC", upcomingDayCount = 8) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Current time must be a valid Date");
  if (!validTimeZone(timeZone)) throw new Error(`Unknown time zone: ${timeZone}`);
  const parts = formatLocalParts(now, timeZone);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const start = dateParts(localDate).date;
  const upcomingDates = Array.from({ length: Math.min(14, Math.max(1, upcomingDayCount)) }, (_, offset) => {
    const date = new Date(start.getTime() + (offset * 86_400_000));
    const dateText = date.toISOString().slice(0, 10);
    return {
      offsetDays: offset,
      localDate: dateText,
      weekday: weekdays[date.getUTCDay()],
      relative: offset === 0 ? "today" : offset === 1 ? "tomorrow" : null,
    };
  });
  return {
    utcDateTime: now.toISOString(),
    timeZone,
    localDate,
    localWeekday: parts.weekday,
    localTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    upcomingDates,
  };
}

export function localDateForInstant(value, timeZone) {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error(`Invalid UTC date-time: ${value}`);
  if (!validTimeZone(timeZone)) throw new Error(`Unknown time zone: ${timeZone}`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const selected = Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value: part }) => [type, part]));
  return `${selected.year}-${selected.month}-${selected.day}`;
}

export function timeZoneFromProfileFacts(facts = []) {
  for (const fact of facts) {
    if (fact?.factType !== "time_zone") continue;
    const candidates = String(fact.text ?? "").match(/\b(?:[A-Za-z_+-]+\/)+[A-Za-z_+-]+\b/g) ?? [];
    const selected = candidates.find(validTimeZone);
    if (selected) return selected;
  }
  return "UTC";
}

function stringEntries(value, path = "brief", entries = []) {
  if (typeof value === "string") entries.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((item, index) => stringEntries(item, `${path}[${index}]`, entries));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) stringEntries(item, `${path}.${key}`, entries);
  }
  return entries;
}

function explicitWeekdayDatePairs(text) {
  const pairs = [];
  const weekdayFirst = new RegExp(`\\b(${weekdayPattern})\\b\\s*(?:(?:,|on|is)\\s*|\\(\\s*)?\\b(\\d{4}-\\d{2}-\\d{2})\\b`, "giu");
  const dateFirst = new RegExp(`\\b(\\d{4}-\\d{2}-\\d{2})\\b\\s*(?:(?:,|is)\\s*|\\(\\s*)\\b(${weekdayPattern})\\b`, "giu");
  for (const match of text.matchAll(weekdayFirst)) pairs.push({ weekday: match[1], localDate: match[2] });
  for (const match of text.matchAll(dateFirst)) pairs.push({ weekday: match[2], localDate: match[1] });
  return pairs;
}

export function temporalConsistencyFindings(brief, {
  requestText = "",
  requestEventSeq = null,
} = {}) {
  const findings = [];
  const resolutions = Array.isArray(brief?.temporalResolutions) ? brief.temporalResolutions : [];
  for (const [index, resolution] of resolutions.entries()) {
    const actualWeekday = weekdayForLocalDate(resolution.localDate);
    if (!actualWeekday) {
      findings.push({
        code: "invalid_local_date",
        path: `brief.temporalResolutions[${index}].localDate`,
        message: `${resolution.localDate} is not a valid local calendar date`,
      });
    } else if (actualWeekday.toLowerCase() !== String(resolution.weekday).toLowerCase()) {
      findings.push({
        code: "weekday_date_mismatch",
        path: `brief.temporalResolutions[${index}]`,
        message: `${resolution.localDate} is ${actualWeekday}, not ${resolution.weekday}`,
        expectedWeekday: actualWeekday,
        claimedWeekday: resolution.weekday,
        localDate: resolution.localDate,
      });
    }
    if (!validTimeZone(resolution.timeZone)) {
      findings.push({
        code: "invalid_time_zone",
        path: `brief.temporalResolutions[${index}].timeZone`,
        message: `${resolution.timeZone} is not a valid IANA time zone`,
      });
    }
  }

  for (const entry of stringEntries(brief)) {
    for (const pair of explicitWeekdayDatePairs(entry.text)) {
      const actualWeekday = weekdayForLocalDate(pair.localDate);
      if (actualWeekday && actualWeekday.toLowerCase() !== pair.weekday.toLowerCase()) {
        findings.push({
          code: "weekday_date_mismatch",
          path: entry.path,
          message: `${pair.localDate} is ${actualWeekday}, not ${pair.weekday}`,
          expectedWeekday: actualWeekday,
          claimedWeekday: pair.weekday,
          localDate: pair.localDate,
        });
      }
    }
  }

  if (brief?.responseMode === "act" && Number.isSafeInteger(requestEventSeq)) {
    const requestedWeekdays = weekdays.filter((weekday) => (
      new RegExp(`\\b${weekday}\\b`, "iu").test(requestText)
    ));
    for (const weekday of requestedWeekdays) {
      const grounded = resolutions.some((resolution) => (
        String(resolution.weekday).toLowerCase() === weekday.toLowerCase()
        && Array.isArray(resolution.sourceEventSeqs)
        && resolution.sourceEventSeqs.includes(requestEventSeq)
      ));
      if (!grounded) {
        findings.push({
          code: "missing_weekday_resolution",
          path: "brief.temporalResolutions",
          message: `The action request names ${weekday}, but no source-referenced local date resolves it`,
          claimedWeekday: weekday,
        });
      }
    }
  }

  return [...new Map(findings.map((finding) => [
    `${finding.code}:${finding.path}:${finding.localDate ?? ""}:${finding.claimedWeekday ?? ""}`,
    finding,
  ])).values()];
}

export function temporalRepairContext(brief, findings) {
  return [
    "# Deterministic temporal validation rejected the candidate TurnBrief",
    "Return a complete replacement TurnBrief. Correct every finding using the literal current local calendar and source conversation above. Do not preserve an invalid date merely because it appeared in the rejected candidate.",
    "",
    "## Rejected candidate",
    JSON.stringify(brief, null, 2),
    "",
    "## Application findings",
    JSON.stringify(findings, null, 2),
  ].join("\n");
}
