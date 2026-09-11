export const defaultCatchUpSettings = {
  logsEnabled: true, logsDay: "today", logsDate: "",
  planEnabled: true, planDay: "friday", planDate: "",
  todosEnabled: true, todosTime: "now", todosBefore: "",
  eventsEnabled: false, eventsTime: "now", eventsBefore: "", lookbackDays: 7,
};
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const localDate = (now, timeZone) => new Intl.DateTimeFormat("en-CA", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
}).format(now);
function selectedDate(mode, value, today) {
  let days = 0;
  if (mode === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`))
      || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("Choose a valid calendar date.");
    return value;
  }
  if (mode === "yesterday") days = -1;
  else if (mode === "tomorrow") days = 1;
  else if (weekdays.includes(mode)) days = (weekdays.indexOf(mode) - new Date(`${today}T12:00:00Z`).getUTCDay() + 7) % 7;
  else if (mode !== "today") throw new Error("Choose a day for catch-up.");
  return new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
function selectedInstant(mode, value, now) {
  if (mode === "now") return now.toISOString();
  if (mode !== "custom" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a valid cutoff date and time.");
  const date = new Date(value);
  const pad = value => String(value).padStart(2, "0");
  const roundTrip = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (!Number.isFinite(date.getTime()) || roundTrip !== value) throw new Error("That local date and time does not exist. Choose another cutoff.");
  return date.toISOString();
}
export function catchUpScopeFromSettings(settings, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const today = localDate(now, timeZone);
  const scope = {
    time_zone: timeZone,
    logs_date: settings.logsEnabled ? selectedDate(settings.logsDay, settings.logsDate, today) : null,
    plan_through_date: settings.planEnabled ? selectedDate(settings.planDay, settings.planDate, today) : null,
    todos_before_utc: settings.todosEnabled ? selectedInstant(settings.todosTime, settings.todosBefore, now) : null,
    events_before_utc: settings.eventsEnabled ? selectedInstant(settings.eventsTime, settings.eventsBefore, now) : null,
    lookback_days: Number(settings.lookbackDays),
  };
  if (![scope.logs_date, scope.plan_through_date, scope.todos_before_utc, scope.events_before_utc].some(Boolean)) throw new Error("Choose at least one catch-up category.");
  if (scope.logs_date > today) throw new Error("Choose today or a past day for journal logs.");
  if (scope.plan_through_date && scope.plan_through_date < today) throw new Error("Choose today or a future day for planning.");
  if (!Number.isInteger(scope.lookback_days) || scope.lookback_days < 0 || scope.lookback_days > 31) throw new Error("Past-event lookback must be between 0 and 31 days.");
  return scope;
}
export function catchUpRequestText(scope) {
  return [
    "Start catch-up with these selections. Generate and refresh the matching questions, and keep these selections for my follow-up answers:",
    `Time zone: ${scope.time_zone}.`,
    scope.logs_date ? `Complete journal logs for ${scope.logs_date}, even if that day is not over. Include unscheduled trackers for that day and scheduled trackers for their period containing that date. Record my answers for that selected day.` : "Journal logs: disabled.",
    scope.plan_through_date ? `Plan upcoming events with unresolved planning prompts through the end of ${scope.plan_through_date}. Planning and event follow-up are separate.` : "Event planning: disabled.",
    scope.todos_before_utc ? `Review unfinished to-dos with deadlines strictly before ${scope.todos_before_utc}. Use deadlines, not scheduled times.` : "To-do review: disabled.",
    scope.events_before_utc ? `Review past events ended by ${scope.events_before_utc}, looking back ${scope.lookback_days} days from that cutoff's local day. Do not review events that have not ended.` : "Past-event review: disabled.",
    "Ask one question at a time and wait for my answer. Update the actual records as I answer, then continue within these selections until there are no eligible questions left or I ask to pause. Start with the first question now.",
  ].join("\n");
}
