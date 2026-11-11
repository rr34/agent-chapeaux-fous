import { useEffect, useState } from "react";
import type { CalendarEvent } from "../types";

function localDate(value: string, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dayDistance(anchor: string, now: Date, timeZone: string) {
  const [anchorYear, anchorMonth, anchorDay] = localDate(anchor, timeZone).split("-").map(Number);
  const [nowYear, nowMonth, nowDay] = localDate(now.toISOString(), timeZone).split("-").map(Number);
  return Math.round((Date.UTC(anchorYear, anchorMonth - 1, anchorDay) - Date.UTC(nowYear, nowMonth - 1, nowDay)) / 86_400_000);
}

export function MilestoneTimer({ event }: { event: CalendarEvent }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const anchor = event.effectiveAnchorUtc || (event.milestoneAnchor === "end" ? event.endsAtUtc : event.startsAtUtc);
  if (!anchor || !event.milestoneMode) return null;
  const difference = Date.parse(anchor) - now.getTime();
  const future = difference >= 0;
  const relation = event.milestoneMode === "countup"
    ? (future ? "begins in" : "since")
    : event.milestoneMode === "countdown"
      ? (future ? "remaining" : "elapsed by")
      : (future ? "remaining" : "since");
  if (event.isAllDay) {
    const days = Math.abs(dayDistance(anchor, now, event.timeZone || "UTC"));
    return <span className="milestone-timer"><strong>{days}</strong> {days === 1 ? "day" : "days"} <small>{relation}</small></span>;
  }
  let seconds = Math.floor(Math.abs(difference) / 1000);
  const days = Math.floor(seconds / 86_400); seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600); seconds %= 3_600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  return <span className="milestone-timer" aria-live="off">
    <strong>{String(days).padStart(2, "0")}</strong><small> days</small>
    <strong>{String(hours).padStart(2, "0")}</strong><small> hours</small>
    <strong>{String(minutes).padStart(2, "0")}</strong><small> minutes</small>
    <strong>{String(seconds).padStart(2, "0")}</strong><small> seconds · {relation}</small>
  </span>;
}
