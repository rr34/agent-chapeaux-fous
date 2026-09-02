const dayMilliseconds = 86_400_000;

export class TodoScheduleInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "TodoScheduleInputError";
    this.statusCode = 400;
  }
}

function calendarDateParts(value, label) {
  if (typeof value !== "string") throw new TodoScheduleInputError(`${label} must be YYYY-MM-DD.`);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TodoScheduleInputError(`${label} must be YYYY-MM-DD.`);
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const represented = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (represented.toISOString().slice(0, 10) !== value) {
    throw new TodoScheduleInputError(`${label} must be a valid calendar date.`);
  }
  return parts;
}

function validatedTimeZone(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TodoScheduleInputError("timeZone is required.");
  }
  const zone = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
  } catch {
    throw new TodoScheduleInputError("timeZone must be a valid IANA time zone.");
  }
  return zone;
}

function zonedParts(date, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts
    .filter(({ type }) => type !== "literal")
    .map(({ type, value }) => [type, Number(value)]));
}

function zonedPartsToUtc(parts, zone) {
  const desired = Date.UTC(
    parts.year, parts.month - 1, parts.day,
    parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, parts.millisecond ?? 0,
  );
  let candidate = desired;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(new Date(candidate), zone);
    const represented = Date.UTC(
      actual.year, actual.month - 1, actual.day,
      actual.hour, actual.minute, actual.second,
    );
    const correction = desired - represented;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}

export function localDateUtcBounds({ localDate: localDateValue, timeZone: timeZoneValue }) {
  const localDate = calendarDateParts(localDateValue, "localDate");
  const timeZone = validatedTimeZone(timeZoneValue);
  const nextDate = new Date(
    Date.UTC(localDate.year, localDate.month - 1, localDate.day) + dayMilliseconds,
  );
  const nextLocalDate = {
    year: nextDate.getUTCFullYear(),
    month: nextDate.getUTCMonth() + 1,
    day: nextDate.getUTCDate(),
  };
  return {
    localDate: localDateValue,
    timeZone,
    startsAtUtc: zonedPartsToUtc(localDate, timeZone).toISOString(),
    endsAtUtc: zonedPartsToUtc(nextLocalDate, timeZone).toISOString(),
  };
}

export function moveOverdueTodosToToday(database, {
  localDate: localDateValue,
  timeZone: timeZoneValue,
  updatedAtUtc = new Date().toISOString(),
}) {
  const localDate = calendarDateParts(localDateValue, "localDate");
  const timeZone = validatedTimeZone(timeZoneValue);
  const todayStartUtc = zonedPartsToUtc(localDate, timeZone).toISOString();
  // Routine schedules share personal_tasks with ordinary work. Protect both
  // directly linked occurrences and Routine-calendar publications from a
  // general backlog roll-forward.
  const rows = database.prepare(`
    SELECT task.personal_task_id, task.scheduled_at_utc, task.due_at_utc
    FROM personal_tasks AS task
    JOIN todo_groups AS todo_group USING (todo_group_id)
    WHERE task.status IN ('todo', 'ai_suggested')
      AND task.scheduled_at_utc IS NOT NULL
      AND task.scheduled_at_utc < ?
      AND todo_group.name <> 'Routine' COLLATE NOCASE
      AND task.todo_routine_id IS NULL
      AND (task.source IS NULL OR task.source <> 'routine_publish' COLLATE NOCASE)
    ORDER BY task.personal_task_id
  `).all(todayStartUtc);

  const targetDayNumber = Date.UTC(localDate.year, localDate.month - 1, localDate.day) / dayMilliseconds;
  const moves = rows.map((row) => {
    const scheduledDate = new Date(row.scheduled_at_utc);
    const scheduled = zonedParts(scheduledDate, timeZone);
    const scheduledDayNumber = Date.UTC(scheduled.year, scheduled.month - 1, scheduled.day) / dayMilliseconds;
    const dayDifference = targetDayNumber - scheduledDayNumber;
    const scheduledAtUtc = zonedPartsToUtc({
      ...scheduled,
      ...localDate,
      millisecond: scheduledDate.getUTCMilliseconds(),
    }, timeZone).toISOString();
    let dueAtUtc = row.due_at_utc;
    if (row.due_at_utc) {
      const dueDate = new Date(row.due_at_utc);
      const due = zonedParts(dueDate, timeZone);
      const shiftedDueDate = new Date(
        Date.UTC(due.year, due.month - 1, due.day) + dayDifference * dayMilliseconds,
      );
      dueAtUtc = zonedPartsToUtc({
        ...due,
        year: shiftedDueDate.getUTCFullYear(),
        month: shiftedDueDate.getUTCMonth() + 1,
        day: shiftedDueDate.getUTCDate(),
        millisecond: dueDate.getUTCMilliseconds(),
      }, timeZone).toISOString();
    }
    return {
      id: Number(row.personal_task_id),
      previousScheduledAtUtc: row.scheduled_at_utc,
      scheduledAtUtc,
      previousDueAtUtc: row.due_at_utc,
      dueAtUtc,
    };
  });

  const update = database.prepare(`
    UPDATE personal_tasks
    SET scheduled_at_utc = ?, due_at_utc = ?, updated_at_utc = ?
    WHERE personal_task_id = ?
  `);
  for (const move of moves) update.run(move.scheduledAtUtc, move.dueAtUtc, updatedAtUtc, move.id);
  return { localDate: localDateValue, timeZone, moves };
}
