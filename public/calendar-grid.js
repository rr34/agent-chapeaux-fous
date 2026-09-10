export function addCalendarDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

export function mondayOnOrBefore(value) {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  return addCalendarDays(date, -((date.getDay() + 6) % 7));
}

export function sixWeekMonthDates(value) {
  const first = new Date(value.getFullYear(), value.getMonth(), 1);
  const start = mondayOnOrBefore(first);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(start, index));
}

export function routinePatternSection(recurrenceRule) {
  const frequency = /(?:^|[;:])FREQ=([^;\r\n]+)/i.exec(recurrenceRule ?? "")?.[1].toUpperCase();
  return ["DAILY", "WEEKLY"].includes(frequency) ? "weekly" : "monthly";
}

// Collapse dated previews into a weekday pattern, keeping the source day for
// cross-midnight time labels when the user opens a weekday's routine details.
export function weeklyRoutinePattern(occurrences, previewDates) {
  const days = Array.from({ length: 7 }, () => new Map());
  for (const occurrence of occurrences) {
    if (routinePatternSection(occurrence.recurrenceRule) !== "weekly") continue;
    const end = occurrence.durationMinutes > 0
      ? new Date(new Date(occurrence.scheduledAtUtc).getTime() + occurrence.durationMinutes * 60_000).toISOString()
      : null;
    for (const day of previewDates) {
      if (!occursDuringCalendarDay(occurrence.scheduledAtUtc, end, day)) continue;
      const bucket = days[(day.getDay() + 6) % 7];
      const start = new Date(occurrence.scheduledAtUtc);
      const dayOffset = (Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
        - Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())) / 86_400_000;
      const slot = `${occurrence.routineId}:${dayOffset}:${start.getHours()}:${start.getMinutes()}:${start.getSeconds()}`;
      if (!bucket.has(slot)) {
        bucket.set(slot, { ...occurrence, patternDay: day });
      }
    }
  }
  return days.map(day => [...day.values()].sort((left, right) => (
    Number(right.isAllDay) - Number(left.isAllDay)
    || (new Date(left.scheduledAtUtc) - left.patternDay) - (new Date(right.scheduledAtUtc) - right.patternDay)
    || left.routineId - right.routineId
  )));
}

export function dateSequence(from, to) {
  const dates = [];
  for (let date = new Date(from); date < to; date = addCalendarDays(date, 1)) {
    dates.push(new Date(date));
  }
  return dates;
}

export function occursDuringCalendarDay(startsAt, endsAt, day) {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = addCalendarDays(dayStart, 1).getTime();
  const dayStartMs = dayStart.getTime();
  const start = new Date(startsAt).getTime();
  const parsedEnd = endsAt ? new Date(endsAt).getTime() : start;
  const end = Number.isFinite(parsedEnd) ? parsedEnd : start;
  return Number.isFinite(start)
    && start < dayEnd
    && (end > dayStartMs || (start >= dayStartMs && start < dayEnd));
}

export function calendarDayTimeRangeLabel(startsAt, endsAt, day, formatTime) {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = addCalendarDays(new Date(dayStart), 1).getTime();
  const start = new Date(startsAt).getTime();
  const end = endsAt ? new Date(endsAt).getTime() : Number.NaN;
  if (!Number.isFinite(start) || start >= dayEnd) return "";

  const startsToday = start >= dayStart;
  const hasDuration = Number.isFinite(end) && end > start;
  if (!hasDuration) return startsToday ? formatTime(new Date(start)) : "";
  if (end <= dayStart) return "";

  const endsToday = end < dayEnd;
  if (startsToday && endsToday) return `${formatTime(new Date(start))}–${formatTime(new Date(end))}`;
  if (startsToday) return `${formatTime(new Date(start))}–`;
  if (endsToday) return `–${formatTime(new Date(end))}`;
  return "Continues";
}

export function calendarEventCellItem(event) {
  return {
    className: ["day-event", event.isAllDay ? "all-day" : "", event.status].filter(Boolean).join(" "),
    text: event.title,
  };
}

export function scheduledTodoCellItem(todo, { highlighted = false } = {}) {
  const routine = todo.routinePublicationMode === "calendar" ? todo.routineText : null;
  const plan = routine && todo.text !== routine ? ` — ${todo.text}` : "";
  return {
    className: highlighted ? "day-todo routine-published" : "day-todo",
    text: `${routine ?? todo.text}${plan}`,
    ...(highlighted ? { title: "Newly added from your routine" } : {}),
  };
}

export function calendarGridCellContents(items, maximumRows = 8) {
  const rowLimit = Math.max(1, Math.floor(maximumRows));
  if (items.length <= rowLimit) return { items, hiddenCount: 0 };
  const visibleItems = items.slice(0, rowLimit - 1);
  return { items: visibleItems, hiddenCount: items.length - visibleItems.length };
}

export function renderCalendarGrid({
  container,
  dates,
  selectedKey,
  todayKey,
  keyForDate,
  labelForDate,
  itemsForDate,
  onSelect,
  showMonthMarkers = false,
  representativeMonth = null,
  disabled = false,
  dayLabelForDate = (date) => String(date.getDate()),
  maximumRows = 8,
}) {
  container.replaceChildren();
  for (const date of dates) {
    const key = keyForDate(date);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    const showsMonth = showMonthMarkers && (date === dates[0] || date.getDate() === 1);
    button.classList.toggle("has-month-marker", showsMonth);
    button.classList.toggle("today", key === todayKey);
    button.classList.toggle("selected", key === selectedKey);
    button.classList.toggle(
      "outside-representative-month",
      representativeMonth != null && date.getMonth() !== representativeMonth,
    );
    button.setAttribute("aria-label", labelForDate(date));
    if (showsMonth) {
      const marker = document.createElement("span");
      marker.className = "calendar-month-marker";
      marker.textContent = new Intl.DateTimeFormat(undefined, { month: "long" }).format(date);
      marker.setAttribute("aria-hidden", "true");
      button.append(marker);
    }
    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = dayLabelForDate(date);
    button.append(number);
    const items = document.createElement("span");
    items.className = "day-items";
    const contents = calendarGridCellContents(itemsForDate(date), maximumRows);
    for (const item of contents.items) {
      const row = document.createElement("span");
      row.className = item.className;
      row.textContent = item.text;
      if (item.title) row.title = item.title;
      items.append(row);
    }
    if (contents.hiddenCount > 0) {
      const more = document.createElement("span");
      more.className = "day-more";
      more.textContent = `+${contents.hiddenCount} more`;
      items.append(more);
    }
    button.append(items);
    button.disabled = disabled;
    button.addEventListener("click", () => onSelect(new Date(date)));
    container.append(button);
  }
}
