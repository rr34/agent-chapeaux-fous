import { useMemo, useState } from "react";
import { api } from "../api";
import { formatDisplayTime, formatLocalDate } from "../date-format";
import { localToday, useApi } from "../hooks";
import type {
  CalendarDay,
  CalendarEvent,
  CalendarRoutine,
  CalendarRoutineGeneration,
  CalendarRoutineOccurrence,
  CalendarRoutinePreview,
} from "../types";
import { CalendarGrid } from "./DailyPaper";
import { CalendarRoutineItem } from "./EditableItems";
import { ErrorState, Loading } from "./State";
import { type AddAgentReference } from "./AgentReferenceButton";
import { SectionFilter } from "./SectionFilter";
import { matchesSearch } from "../search-filter";

function localDateKey(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
}

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

function routineMonthDates(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const firstMonday = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(firstMonday, index));
}

function routineFrequency(recurrenceRule: string) {
  return /(?:^|[;:])FREQ=([^;\r\n]+)/i.exec(recurrenceRule)?.[1]?.toUpperCase() || "";
}

function occursDuringDay(occurrence: CalendarRoutineOccurrence, day: Date) {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = addDays(startOfDay(day), 1).getTime();
  const start = new Date(occurrence.startsAtUtc).getTime();
  const parsedEnd = occurrence.endsAtUtc ? new Date(occurrence.endsAtUtc).getTime() : start;
  const end = Number.isFinite(parsedEnd) ? parsedEnd : start;
  return Number.isFinite(start) && start < dayEnd
    && (end > dayStart || (start >= dayStart && start < dayEnd));
}

function occurrenceEvent(occurrence: CalendarRoutineOccurrence, routines: Map<number, CalendarRoutine>): CalendarEvent {
  return {
    id: occurrence.routineId,
    title: occurrence.title,
    description: routines.get(occurrence.routineId)?.description,
    startsAtUtc: occurrence.startsAtUtc,
    endsAtUtc: occurrence.endsAtUtc,
    timeZone: occurrence.timeZone,
    isAllDay: occurrence.isAllDay,
  };
}

function calendarDay(date: Date, events: CalendarEvent[], representativeMonth?: number): CalendarDay {
  return {
    localDate: localDateKey(date),
    weekday: new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date),
    dayNumber: date.getDate(),
    month: new Intl.DateTimeFormat(undefined, { month: "short" }).format(date),
    isToday: localDateKey(date) === localToday(),
    isOutsideRange: representativeMonth != null && date.getMonth() !== representativeMonth,
    events,
  };
}

function weeklyRoutineDays(
  weekDates: Date[],
  previewDates: Date[],
  occurrences: CalendarRoutineOccurrence[],
  routines: Map<number, CalendarRoutine>,
) {
  return weekDates.map((weekDate) => {
    const matches = new Map<number, CalendarRoutineOccurrence>();
    for (const previewDate of previewDates) {
      if (previewDate.getDay() !== weekDate.getDay()) continue;
      for (const occurrence of occurrences) {
        if (!["DAILY", "WEEKLY"].includes(routineFrequency(occurrence.recurrenceRule))) continue;
        if (occursDuringDay(occurrence, previewDate) && !matches.has(occurrence.routineId)) {
          matches.set(occurrence.routineId, occurrence);
        }
      }
    }
    return calendarDay(weekDate, [...matches.values()].map((occurrence) => occurrenceEvent(occurrence, routines)));
  });
}

function monthlyRoutineDays(
  dates: Date[],
  occurrences: CalendarRoutineOccurrence[],
  routines: Map<number, CalendarRoutine>,
  representativeMonth: number,
) {
  return dates.map((date) => calendarDay(date, occurrences
    .filter((occurrence) => !["DAILY", "WEEKLY"].includes(routineFrequency(occurrence.recurrenceRule)))
    .filter((occurrence) => occursDuringDay(occurrence, date))
    .map((occurrence) => occurrenceEvent(occurrence, routines)), representativeMonth));
}

function recurrenceLabel(rule: string) {
  const frequency = routineFrequency(rule);
  if (!frequency) return "Recurring";
  const interval = Number(/(?:^|;)INTERVAL=(\d+)/i.exec(rule)?.[1] || 1);
  const name = frequency.toLowerCase().replace(/ly$/, "");
  return interval === 1 ? `${name[0].toUpperCase()}${name.slice(1)}ly` : `Every ${interval} ${name}s`;
}

function RoutineAgenda({ day, routines, query, onChanged, onReference }: {
  day?: CalendarDay;
  routines: Map<number, CalendarRoutine>;
  query: string;
  onChanged: () => void | Promise<void>;
  onReference: AddAgentReference;
}) {
  if (!day) return null;
  const visibleEvents = day.events.filter((event) => matchesSearch(routines.get(Number(event.id)), query));
  if (!visibleEvents.length) return <p className="routine-empty">{query.trim() ? "No routines on this day match the filter." : "No routines on this day."}</p>;
  return <div className="routine-agenda" aria-label={`Routines for ${formatLocalDate(day.localDate)}`}>
    {visibleEvents.map((event) => {
      const routine = routines.get(Number(event.id));
      if (!routine) return null;
      const timeLabel = `${event.isAllDay ? "All day" : formatDisplayTime(event.startsAtUtc, event.timeZone || undefined)} · ${recurrenceLabel(routine.recurrenceRule)}`;
      return <CalendarRoutineItem key={`${event.id}-${event.startsAtUtc}`} routine={routine} timeLabel={timeLabel} onChanged={onChanged} onReference={onReference} />;
    })}
  </div>;
}

export function RoutineScreen({ onGenerated, onReference }: {
  onGenerated: (message: string) => void;
  onReference: AddAgentReference;
}) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const monthDates = useMemo(() => routineMonthDates(today), [today]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(today), index)), [today]);
  const previewStart = monthDates[0];
  const previewEnd = addDays(monthDates.at(-1)!, 1);
  const previewUrl = `/api/calendar-routines/preview?from=${encodeURIComponent(previewStart.toISOString())}&to=${encodeURIComponent(previewEnd.toISOString())}`;
  const { data, error, loading, reload } = useApi<CalendarRoutinePreview>(previewUrl);
  const [selectedWeekday, setSelectedWeekday] = useState(localDateKey(today));
  const [selectedMonthDate, setSelectedMonthDate] = useState(localDateKey(today));
  const [generating, setGenerating] = useState<"current" | "next" | null>(null);
  const [generationError, setGenerationError] = useState<unknown>(null);
  const [filterQuery, setFilterQuery] = useState("");
  const routineMap = useMemo(() => new Map((data?.routines || []).map((routine) => [routine.id, routine])), [data]);
  const weeklyDays = useMemo(
    () => weeklyRoutineDays(weekDates, monthDates, data?.occurrences || [], routineMap),
    [data, monthDates, routineMap, weekDates],
  );
  const monthlyDays = useMemo(
    () => monthlyRoutineDays(monthDates, data?.occurrences || [], routineMap, today.getMonth()),
    [data, monthDates, routineMap, today],
  );
  const publish = async (range: "current" | "next") => {
    const currentWeekStart = startOfWeek(new Date());
    const from = range === "current" ? startOfDay(new Date()) : addDays(currentWeekStart, 7);
    const to = range === "current" ? addDays(currentWeekStart, 7) : addDays(currentWeekStart, 14);
    setGenerationError(null);
    setGenerating(range);
    try {
      const result = await api<CalendarRoutineGeneration>("/api/calendar-routines/generate", {
        method: "POST",
        body: JSON.stringify({ from: from.toISOString(), to: to.toISOString() }),
      });
      const existing = result.existingCount
        ? ` ${result.existingCount} ${result.existingCount === 1 ? "event was" : "events were"} already present.`
        : "";
      const moved = result.movedTodoCount
        ? ` Moved ${result.movedTodoCount} unfinished ${result.movedTodoCount === 1 ? "to-do" : "to-dos"} forward.`
        : "";
      onGenerated(`Created ${result.createdCount} calendar ${result.createdCount === 1 ? "event" : "events"}.${existing}${moved}`);
    } catch (caught) {
      setGenerationError(caught);
    } finally {
      setGenerating(null);
    }
  };
  const selectedWeeklyDay = weeklyDays.find((day) => day.localDate === selectedWeekday);
  const selectedMonthlyDay = monthlyDays.find((day) => day.localDate === selectedMonthDate);
  const monthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(today);
  const matchingRoutineCount = (data?.routines || []).filter((routine) => matchesSearch(routine, filterQuery)).length;
  return <>
    <header className="page-heading"><div><p className="eyebrow">Reusable rhythms</p><h1>Routine</h1><p>Your daily and weekly rhythm, followed by routines tied to the month.</p></div></header>
    <SectionFilter query={filterQuery} onChange={setFilterQuery} count={matchingRoutineCount} noun="routine" />
    <section className="surface routine-publish-panel">
      <div><p className="eyebrow">Populate the calendar</p><h2>Generate concrete events</h2><p>Choose a bounded week. Existing routine events will not be duplicated.</p></div>
      <div className="routine-publish-actions">
        <button className="button button--quiet" disabled={generating !== null} onClick={() => void publish("current")}>{generating === "current" ? "Generating…" : "Rest of this week"}</button>
        <button className="button" disabled={generating !== null} onClick={() => void publish("next")}>{generating === "next" ? "Generating…" : "Next week"}</button>
      </div>
    </section>
    {generationError && <ErrorState error={generationError} dismiss={() => setGenerationError(null)} />}
    {loading && <Loading label="Laying out routines" />}
    {error && <ErrorState error={error} retry={reload} />}
    {data && <div className="routine-calendars">
      <section className="surface routine-calendar-section">
        <div className="section-title"><div><p className="eyebrow">Reusable week</p><h2>Weekly &amp; daily</h2><p>Select a weekday, then click a routine to edit it.</p></div></div>
        <div className="routine-calendar-scroll"><CalendarGrid days={weeklyDays} selectedDate={selectedWeekday} onSelect={setSelectedWeekday} ariaLabel="Weekly routine calendar, Monday through Sunday" searchQuery={filterQuery} /></div>
        <RoutineAgenda day={selectedWeeklyDay} routines={routineMap} query={filterQuery} onChanged={reload} onReference={onReference} />
      </section>
      <section className="surface routine-calendar-section">
        <div className="section-title"><div><p className="eyebrow">Month pattern</p><h2>{monthName}</h2><p>Monthly and yearly routines. Daily and weekly patterns appear above.</p></div></div>
        <div className="routine-calendar-scroll"><CalendarGrid days={monthlyDays} selectedDate={selectedMonthDate} onSelect={setSelectedMonthDate} ariaLabel={`Monthly routine calendar for ${monthName}`} searchQuery={filterQuery} /></div>
        <RoutineAgenda day={selectedMonthlyDay} routines={routineMap} query={filterQuery} onChanged={reload} onReference={onReference} />
      </section>
    </div>}
  </>;
}
