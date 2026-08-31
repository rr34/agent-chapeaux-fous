import {
  combineLocalDateTime,
  durationMinutes,
  formatDurationClock,
  formatDurationMinutes,
  parseDurationClock,
  shiftLocalDateTime,
  splitLocalDateTime,
} from "./event-date-time.js";

export function createTimingEditor({
  startDate,
  startTime,
  endDate,
  endTime,
  durationInput,
  durationField,
  summary,
  allDayInput,
  onChange = () => {},
}) {
  let syncing = false;

  const allDay = () => Boolean(allDayInput.checked);
  const localValue = (dateInput, timeInput) => (
    allDay() ? dateInput.value : combineLocalDateTime(dateInput.value, timeInput.value)
  );
  const startValue = () => localValue(startDate, startTime);
  const endValue = () => localValue(endDate, endTime);
  const parsedDuration = () => parseDurationClock(durationInput.value);

  function setDateTime(dateInput, timeInput, value) {
    const parts = splitLocalDateTime(value);
    dateInput.value = parts.date;
    timeInput.value = parts.time;
  }

  function setEndFromDuration(minutes) {
    const shifted = shiftLocalDateTime(startDate.value, startTime.value, minutes);
    if (!shifted) return;
    endDate.value = shifted.date;
    endTime.value = shifted.time;
  }

  function setValidity(message = "") {
    endDate.setCustomValidity(message);
    endTime.setCustomValidity(message);
    durationInput.setCustomValidity(message);
  }

  function renderSummary() {
    setValidity();
    if (allDay()) {
      summary.textContent = "All day";
      return;
    }
    if (durationInput.value && parsedDuration() === null) {
      const message = "Use duration HH:MM, for example 01:30.";
      durationInput.setCustomValidity(message);
      summary.textContent = message;
      return;
    }
    const start = startValue();
    const end = endValue();
    const hasEndPart = Boolean(endDate.value || endTime.value);
    if (!start) {
      summary.textContent = "Enter a date and 24-hour start time (HH:MM).";
      return;
    }
    if (!end) {
      if (hasEndPart) {
        const message = "Enter both an end date and a 24-hour time (HH:MM).";
        (endDate.value ? endTime : endDate).setCustomValidity(message);
        summary.textContent = message;
      } else {
        summary.textContent = "No planned end or duration";
      }
      return;
    }
    const minutes = durationMinutes(start, end);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      const message = "End must be after start.";
      endDate.setCustomValidity(message);
      summary.textContent = message;
      return;
    }
    summary.textContent = formatDurationMinutes(minutes);
  }

  function applyAllDay() {
    const value = allDay();
    for (const input of [startTime, endTime]) {
      input.hidden = value;
      input.disabled = value;
    }
    durationField.hidden = value;
    durationInput.disabled = value;
    if (!value) {
      if (!startTime.value) startTime.value = "09:00";
      if (!endTime.value && endDate.value) endTime.value = "10:00";
      if (parsedDuration() && startValue()) setEndFromDuration(parsedDuration());
    }
    renderSummary();
  }

  function changed(source) {
    if (syncing) return;
    syncing = true;
    if (!allDay()) {
      if (source === "duration") {
        const minutes = parsedDuration();
        if (!durationInput.value) {
          endDate.value = "";
          endTime.value = "";
        } else if (minutes && startValue()) {
          setEndFromDuration(minutes);
        }
      } else if (source === "end") {
        const start = startValue();
        const end = endValue();
        if (!endDate.value && !endTime.value) durationInput.value = "";
        else if (start && end) {
          const minutes = durationMinutes(start, end);
          if (minutes > 0) durationInput.value = formatDurationClock(minutes);
        }
      } else if (source === "start") {
        const minutes = parsedDuration();
        if (minutes) setEndFromDuration(minutes);
      }
    }
    renderSummary();
    syncing = false;
    onChange(source);
  }

  for (const input of [startDate, startTime]) input.addEventListener("input", () => changed("start"));
  for (const input of [endDate, endTime]) input.addEventListener("input", () => changed("end"));
  durationInput.addEventListener("input", () => changed("duration"));
  allDayInput.addEventListener("change", () => {
    applyAllDay();
    onChange("all-day");
  });

  return {
    load({ start = null, end = null, duration = null, isAllDay = false } = {}) {
      syncing = true;
      allDayInput.checked = Boolean(isAllDay);
      setDateTime(startDate, startTime, start);
      setDateTime(endDate, endTime, end);
      let minutes = Number.isSafeInteger(duration) && duration > 0 ? duration : null;
      if (minutes === null && start && end && !isAllDay) {
        minutes = durationMinutes(start, end);
      }
      durationInput.value = formatDurationClock(minutes);
      if (!end && minutes && start && !isAllDay) setEndFromDuration(minutes);
      applyAllDay();
      syncing = false;
    },
    values() {
      const start = startValue();
      const end = endValue();
      const inferredDuration = start && end ? durationMinutes(start, end) : null;
      return {
        start,
        end,
        duration: allDay() ? null : (parsedDuration() ?? (inferredDuration > 0 ? inferredDuration : null)),
        isAllDay: allDay(),
      };
    },
    clear() {
      syncing = true;
      startDate.value = "";
      startTime.value = "";
      endDate.value = "";
      endTime.value = "";
      durationInput.value = "";
      allDayInput.checked = false;
      applyAllDay();
      syncing = false;
    },
    refresh: renderSummary,
  };
}
