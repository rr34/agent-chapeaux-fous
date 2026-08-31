const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function combineLocalDateTime(dateValue, timeValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue) || !timePattern.test(timeValue)) return "";
  return `${dateValue}T${timeValue}`;
}

export function splitLocalDateTime(value) {
  if (!value) return { date: "", time: "" };
  const local = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(local.getTime())) return { date: "", time: "" };
  const twoDigits = (part) => String(part).padStart(2, "0");
  return {
    date: `${local.getFullYear()}-${twoDigits(local.getMonth() + 1)}-${twoDigits(local.getDate())}`,
    time: `${twoDigits(local.getHours())}:${twoDigits(local.getMinutes())}`,
  };
}

export function shiftLocalDateTime(dateValue, timeValue, minutes) {
  const combined = combineLocalDateTime(dateValue, timeValue);
  if (!combined) return null;
  const shifted = new Date(combined);
  if (!Number.isFinite(shifted.getTime())) return null;
  shifted.setMinutes(shifted.getMinutes() + minutes);
  return splitLocalDateTime(shifted);
}

export function durationMinutes(startValue, endValue) {
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export function formatDurationMinutes(totalMinutes) {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0) return "";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (hours) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes || !parts.length) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  return parts.join(" ");
}

export function parseDurationClock(value) {
  const match = /^(\d{1,4}):([0-5]\d)$/.exec(String(value || "").trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
}

export function formatDurationClock(totalMinutes) {
  if (!Number.isSafeInteger(totalMinutes) || totalMinutes <= 0) return "";
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}
