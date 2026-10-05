import { FormEvent, useEffect, useState } from "react";
import { api } from "../api";
import { localToday } from "../hooks";
import type { Entity } from "../types";

type TrackerFrequency = "off" | "daily" | "weekly" | "monthly";

const weekdayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function value(entity: Entity, key: string) {
  const current = entity[key];
  return current == null ? "" : String(current);
}

function savedFrequency(tracker: Entity): TrackerFrequency {
  const frequency = /(?:^|[;:])FREQ=(DAILY|WEEKLY|MONTHLY)(?:;|$)/i
    .exec(value(tracker, "askingRecurrenceRule"))?.[1].toLowerCase();
  return frequency === "daily" || frequency === "weekly" || frequency === "monthly"
    ? frequency
    : "off";
}

function startDate(tracker: Entity, timeZone: string) {
  const instant = value(tracker, "askingStartsAtUtc");
  if (!instant) return localToday(timeZone);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function weekdayForDate(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  return weekdayCodes[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

export function TrackerSchedule({ tracker, onChanged }: {
  tracker: Entity;
  onChanged: () => void | Promise<void>;
}) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [frequency, setFrequency] = useState<TrackerFrequency>(() => savedFrequency(tracker));
  const [startsOn, setStartsOn] = useState(() => startDate(tracker, timeZone));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const trackerId = Number(tracker.id);
  const trackerName = value(tracker, "name") || `Tracker ${trackerId}`;

  useEffect(() => {
    setFrequency(savedFrequency(tracker));
    setStartsOn(startDate(tracker, timeZone));
  }, [tracker.askingRecurrenceRule, tracker.askingStartsAtUtc, timeZone]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const recurrence = frequency === "off" ? null : {
        frequency: frequency.toUpperCase(),
        interval: 1,
        weekdays: frequency === "weekly" ? [weekdayForDate(startsOn)] : [],
        count: null,
        until_date: null,
        time_zone: timeZone,
      };
      await api(`/api/journal-trackers/${trackerId}/schedule`, {
        method: "PATCH",
        body: JSON.stringify({
          starts_at_utc: recurrence ? new Date(`${startsOn}T00:00:00`).toISOString() : null,
          recurrence,
        }),
      });
      setMessage("Saved");
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return <form className="tracker-schedule" onSubmit={(event) => void save(event)}>
    <label>
      Log
      <select
        aria-label={`Logging cadence for ${trackerName}`}
        value={frequency}
        onChange={(event) => setFrequency(event.target.value as TrackerFrequency)}
      >
        <option value="off">Not scheduled</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
    </label>
    {frequency !== "off" && <label>
      Starts
      <input type="date" required value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
    </label>}
    <button className="button button--quiet" type="submit" disabled={saving}>
      {saving ? "Saving…" : "Save"}
    </button>
    {message && <small className="tracker-schedule-message" role="status">{message}</small>}
  </form>;
}
