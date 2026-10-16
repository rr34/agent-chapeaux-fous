import type {
  CalendarDay, CalendarEvent, DailyPaperModel, DailyPaperTodoGroup, DailyPaperWeatherPoint,
  LinkedTodo, ScheduledTracker,
} from "../types";
import type { CSSProperties } from "react";
import { formatDisplayDate, formatDisplayTime, formatLocalDate } from "../date-format";
import { CalendarEventItem } from "./EditableItems";
import { matchesSearch, searchTerms } from "../search-filter";

function timeLabel(event: CalendarEvent, timeZone: string) {
  if (event.isAllDay) return "All day";
  const start = formatDisplayTime(event.startsAtUtc, timeZone);
  return event.endsAtUtc ? `${start}–${formatDisplayTime(event.endsAtUtc, timeZone)}` : start;
}

function calendarRangeMarkerLabel(localDate: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: "long", timeZone: "UTC" }).format(date);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${monthLabel} (week ${week})`;
}

export function CalendarGrid({
  days,
  compact = false,
  selectedDate,
  onSelect,
  ariaLabel = "Two-week calendar",
  id,
  searchQuery = "",
}: {
  days: CalendarDay[];
  compact?: boolean;
  selectedDate?: string;
  onSelect?: (localDate: string) => void;
  ariaLabel?: string;
  id?: string;
  searchQuery?: string;
}) {
  const eventLimit = 8;
  const isSearching = searchTerms(searchQuery).length > 0;
  const rangeMarkerLabel = !compact && days[0] ? calendarRangeMarkerLabel(days[0].localDate) : null;
  return (
    <section id={id} className={`two-week-grid ${compact ? "two-week-grid--compact" : ""} ${isSearching ? "is-searching" : ""}`} aria-label={ariaLabel}>
      <div className="weekdays" aria-hidden="true">
        {days.slice(0, 7).map((day) => <span key={day.weekday}>{day.weekday}</span>)}
      </div>
      <div className="calendar-cells">
        {days.map((day, index) => {
          const isSelected = selectedDate ? day.localDate === selectedDate : day.isToday;
          const orderedEvents = isSearching
            ? [...day.events].sort((left, right) => Number(matchesSearch(right, searchQuery)) - Number(matchesSearch(left, searchQuery)))
            : day.events;
          const visibleEvents = orderedEvents.slice(0, compact ? 3 : eventLimit);
          const contents = <>
            {index === 0 && rangeMarkerLabel && <span className="calendar-range-marker" aria-hidden="true">{rangeMarkerLabel}</span>}
            <span className="calendar-cell-header">
              <strong>{day.dayNumber}</strong>
              <span>{day.month}</span>
            </span>
            <span className="calendar-cell-events">
              {visibleEvents.map((event) => (
                <span className={`calendar-chip ${isSearching && matchesSearch(event, searchQuery) ? "is-search-match" : ""}`} key={`${day.localDate}-${event.id}-${event.startsAtUtc}`}>
                  {!event.isAllDay && <time>{timeLabel(event, event.timeZone || "UTC").split("–")[0]}</time>}
                  <span className="multiline-item-text">{event.title}</span>
                </span>
              ))}
              {day.events.length > visibleEvents.length && <small>+{day.events.length - visibleEvents.length} more</small>}
            </span>
          </>;
          const className = `calendar-cell ${index === 0 && rangeMarkerLabel ? "has-range-marker" : ""} ${isSelected ? "is-selected" : ""} ${day.isOutsideRange ? "is-outside-range" : ""}`;
          return onSelect ? (
            <button
              type="button"
              className={className}
              key={day.localDate}
              onClick={() => onSelect(day.localDate)}
              aria-label={`${formatLocalDate(day.localDate)}${index === 0 && rangeMarkerLabel ? `, ${rangeMarkerLabel}` : ""}`}
              aria-pressed={isSelected}
            >
              {contents}
            </button>
          ) : <article className={className} key={day.localDate}>{contents}</article>;
        })}
      </div>
    </section>
  );
}

export function DayTimeline({ events, timeZone, defaultExpanded = false, onChanged }: {
  events: CalendarEvent[];
  timeZone: string;
  defaultExpanded?: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  if (!events.length) return <p className="paper-empty">No events scheduled. The day is yours.</p>;
  return (
    <ol className="timeline-list">
      {events.map((event) => <CalendarEventItem
        event={event}
        timeZone={timeZone}
        timeLabel={timeLabel(event, timeZone)}
        defaultExpanded={defaultExpanded}
        onChanged={onChanged}
        key={event.id}
      />)}
    </ol>
  );
}

function todoTitle(todo: LinkedTodo) {
  return todo.text || todo.title || "Task";
}

function relationshipKindLabel(value?: string | null) {
  return value ? value[0].toUpperCase() + value.slice(1) : null;
}

function PrintableTodoCard({ todo, showRelationship = false }: {
  todo: LinkedTodo;
  showRelationship?: boolean;
}) {
  const details = [
    showRelationship ? relationshipKindLabel(todo.relationshipKind) : null,
    todo.relatedContact ? `Contact · ${todo.relatedContact.displayName}` : null,
  ].filter(Boolean);
  return <li className="paper-todo-card">
    <span className="paper-todo-check" aria-hidden="true">{todo.status === "complete" ? "✓" : ""}</span>
    <div>
      <header className={details.length ? "has-details" : undefined}>
        <strong className="multiline-item-text">{todoTitle(todo)}</strong>
        {details.length > 0 && <small className="paper-todo-relationships">{details.join(" · ")}</small>}
      </header>
      <div className="paper-handwriting-space" aria-label={`Blank writing area for ${todoTitle(todo)}`}>
        <span aria-hidden="true">&#123;</span>
      </div>
    </div>
  </li>;
}

const TIMELINE_START_MINUTE = 5 * 60;
const TIMELINE_END_MINUTE = 23 * 60;
const TIMELINE_MINUTES = TIMELINE_END_MINUTE - TIMELINE_START_MINUTE;
const TIMELINE_HOURS = Array.from({ length: 19 }, (_, index) => index + 5);

function localInstantParts(value: string, timeZone: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minute: Number(values.hour) * 60 + Number(values.minute),
  };
}

function eventMinute(value: string, date: string, timeZone: string, boundary: "start" | "end") {
  const local = localInstantParts(value, timeZone);
  if (local.date < date) return 0;
  if (local.date > date) return 24 * 60;
  return local.minute || (boundary === "end" && local.date > date ? 24 * 60 : 0);
}

function timelinePercent(minute: number) {
  return ((minute - TIMELINE_START_MINUTE) / TIMELINE_MINUTES) * 100;
}

type PositionedEvent = {
  event: CalendarEvent;
  start: number;
  end: number;
  lane: number;
  laneCount: number;
  labelMinute: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  isPoint: boolean;
};

function positionedTimelineEvents(events: CalendarEvent[], date: string, timeZone: string) {
  const allDay = events.filter((event) => event.isAllDay);
  const timed = events.filter((event) => !event.isAllDay).map((event) => {
    const start = eventMinute(event.startsAtUtc, date, timeZone, "start");
    const hasEnd = Boolean(event.endsAtUtc);
    const rawEnd = hasEnd ? eventMinute(event.endsAtUtc!, date, timeZone, "end") : start;
    const end = Math.max(start, rawEnd);
    return { event, start, end, isPoint: !hasEnd || end === start };
  }).sort((left, right) => left.start - right.start || left.end - right.end);
  const before = timed.filter(({ end, isPoint }) => isPoint ? end < TIMELINE_START_MINUTE : end <= TIMELINE_START_MINUTE);
  const after = timed.filter(({ start }) => start >= TIMELINE_END_MINUTE);
  const visible: PositionedEvent[] = timed.filter(({ start, end, isPoint }) => (
    isPoint
      ? start >= TIMELINE_START_MINUTE && start < TIMELINE_END_MINUTE
      : start < TIMELINE_END_MINUTE && end > TIMELINE_START_MINUTE
  )).map((item) => ({
    ...item,
    continuesBefore: item.start < TIMELINE_START_MINUTE,
    continuesAfter: item.end > TIMELINE_END_MINUTE,
    start: Math.max(TIMELINE_START_MINUTE, item.start),
    end: Math.min(TIMELINE_END_MINUTE, item.end),
    lane: 0,
    laneCount: 1,
    labelMinute: Math.max(TIMELINE_START_MINUTE, item.start),
  }));

  const laneEnds: number[] = [];
  for (const item of visible) {
    const lane = laneEnds.findIndex((end) => end <= item.start);
    item.lane = lane < 0 ? laneEnds.length : lane;
    laneEnds[item.lane] = item.isPoint ? item.start + 1 : item.end;
  }
  const laneCount = Math.max(1, laneEnds.length);
  const labelGap = visible.length <= 1
    ? 0
    : Math.max(18, Math.min(45, (TIMELINE_MINUTES - 24) / (visible.length - 1)));
  let labelCursor = TIMELINE_START_MINUTE;
  for (const item of visible) {
    item.labelMinute = Math.max(item.start, labelCursor);
    labelCursor = item.labelMinute + labelGap;
  }
  const overflow = visible.length ? Math.max(0, visible.at(-1)!.labelMinute - (TIMELINE_END_MINUTE - 20)) : 0;
  if (overflow) {
    for (const item of visible) item.labelMinute -= overflow;
  }
  let floor = TIMELINE_START_MINUTE;
  for (const item of visible) {
    item.labelMinute = Math.max(floor, item.labelMinute);
    floor = item.labelMinute + labelGap;
    item.laneCount = laneCount;
  }
  return { allDay, before, after, visible };
}

function weatherSymbol(code: number) {
  if (code === 0) return "☀";
  if (code <= 2) return "◐";
  if (code === 3) return "☁";
  if ([45, 48].includes(code)) return "≋";
  if (code >= 71 && code <= 77 || code >= 85 && code <= 86) return "❄";
  if (code >= 95) return "ϟ";
  return "☂";
}

function WeatherPoint({ point, unit }: {
  point: DailyPaperWeatherPoint;
  unit: "fahrenheit" | "celsius";
}) {
  const style = { "--timeline-position": `${timelinePercent(point.hour * 60)}%` } as CSSProperties;
  const temperature = Math.round(point.temperature);
  const precipitation = Math.round(point.precipitationProbability);
  const unitLabel = unit === "fahrenheit" ? "Fahrenheit" : "Celsius";
  return <div
    aria-label={`${temperature} degrees ${unitLabel}, ${precipitation}% chance of precipitation`}
    className="paper-weather-point"
    style={style}
  >
    <span aria-hidden="true">{weatherSymbol(point.weatherCode)}</span>
    <strong>{temperature}°</strong>
    <small>{precipitation}%</small>
  </div>;
}

function OutsideTimelineEvents({ label, events, timeZone }: {
  label: string;
  events: Array<{ event: CalendarEvent }>;
  timeZone: string;
}) {
  return <div className={`paper-outside-events${events.length ? "" : " is-empty"}`}>
    <span>{label}</span>
    {events.map(({ event }) => <p key={`${event.id}-${event.startsAtUtc}`}>
      <time>{timeLabel(event, timeZone)}</time><strong>{event.title}</strong>
    </p>)}
  </div>;
}

function PrintableFixedTimeline({ events, date, timeZone, weather }: {
  events: CalendarEvent[];
  date: string;
  timeZone: string;
  weather: DailyPaperModel["weather"];
}) {
  const positioned = positionedTimelineEvents(events, date, timeZone);
  return <div className="paper-fixed-timeline">
    <div className="paper-timeline-edge paper-timeline-edge--top">
      <div className={`paper-all-day-events${positioned.allDay.length ? "" : " is-empty"}`}>
        <span>All day</span>
        {positioned.allDay.map((event) => <strong key={`${event.id}-${event.startsAtUtc}`}>{event.title}</strong>)}
      </div>
      <OutsideTimelineEvents label="Before 05:00" events={positioned.before} timeZone={timeZone} />
    </div>
    <div className="paper-time-scale" aria-label="Daily timeline from 05:00 through 23:00">
      {TIMELINE_HOURS.map((hour) => <div
        className="paper-hour-rule"
        style={{ "--timeline-position": `${timelinePercent(hour * 60)}%` } as CSSProperties}
        key={hour}
      ><time>{String(hour).padStart(2, "0")}:00</time><span /></div>)}
      <div className="paper-duration-layer">
        {positioned.visible.map((item) => {
          const bracketStyle = {
            "--event-top": `${timelinePercent(item.start)}%`,
            "--event-height": `${Math.max(0, timelinePercent(item.end) - timelinePercent(item.start))}%`,
            "--event-lane": item.lane,
            "--event-lanes": item.laneCount,
          } as CSSProperties;
          const labelStyle = {
            "--event-label-top": `${timelinePercent(item.labelMinute)}%`,
          } as CSSProperties;
          return <div className="paper-positioned-event" aria-label={`${timeLabel(item.event, timeZone)}, ${item.event.title}`} key={`${item.event.id}-${item.event.startsAtUtc}`}>
            <span className={`paper-event-bracket${item.isPoint ? " is-point" : ""}${item.continuesBefore ? " continues-before" : ""}${item.continuesAfter ? " continues-after" : ""}`} style={bracketStyle} aria-hidden="true" />
            <span className="paper-event-label" style={labelStyle}>
              <time>{timeLabel(item.event, timeZone)}</time>
              <strong className="multiline-item-text">{item.event.title}</strong>
              {item.event.location && <small className="multiline-item-text">{item.event.location}</small>}
            </span>
          </div>;
        })}
      </div>
      <aside className="paper-weather-gutter" aria-label="Weather forecast">
        {weather?.status === "available" ? weather.points.map((point) => (
          <WeatherPoint point={point} unit={weather.temperatureUnit} key={point.time} />
        )) : weather?.status === "unavailable" ? <small className="paper-weather-unavailable">Weather unavailable</small> : null}
      </aside>
    </div>
    <div className="paper-timeline-edge paper-timeline-edge--bottom">
      <OutsideTimelineEvents label="23:00 and later" events={positioned.after} timeZone={timeZone} />
    </div>
  </div>;
}

function PrintableEventDetails({ events, timeZone, includeCompletedTodos }: {
  events: CalendarEvent[];
  timeZone: string;
  includeCompletedTodos: boolean;
}) {
  if (!events.length) return <p className="paper-empty">No event details for this day.</p>;
  return <ol className="timeline-list paper-event-details">
    {events.map((event) => {
      const linkedTodos = (event.linkedTodos || [])
        .filter((todo) => includeCompletedTodos || todo.status !== "complete");
      return <li key={`${event.id}-${event.startsAtUtc}`}>
        <time>{timeLabel(event, timeZone)}</time>
        <article className={`paper-event-card${event.description ? " has-description" : ""}${event.location ? " has-location" : ""}${linkedTodos.length ? " has-linked-todos" : ""}`}>
          <strong className="multiline-item-text">{event.title}</strong>
          {event.description && <p className="paper-event-description">{event.description}</p>}
          {event.location && <small className="paper-event-location">{event.location}</small>}
          {linkedTodos.length > 0 && <ul className="paper-event-todos" aria-label={`To-dos linked to ${event.title}`}>
            {linkedTodos.map((todo) => <PrintableTodoCard todo={todo} showRelationship key={todo.todoId} />)}
          </ul>}
        </article>
      </li>;
    })}
  </ol>;
}

function trackerCadenceLabel(tracker: ScheduledTracker) {
  if (tracker.frequency === "scheduled") return "Scheduled";
  if (tracker.interval === 1) return tracker.frequency[0].toUpperCase() + tracker.frequency.slice(1);
  const units = { daily: "days", weekly: "weeks", monthly: "months", yearly: "years" };
  return `Every ${tracker.interval} ${units[tracker.frequency]}`;
}

export function ScheduledTrackers({ trackers }: { trackers: ScheduledTracker[] }) {
  if (!trackers.length) return <p className="paper-empty">No tracker logs scheduled for this day.</p>;
  return <ul className="paper-trackers">
    {trackers.map((tracker) => <li className={`tracker-card${tracker.logged ? " is-logged" : ""}`} key={tracker.trackerId}>
      <span className="paper-tracker-check" aria-label={tracker.logged ? "Logged" : "Not logged"}>{tracker.logged ? "✓" : ""}</span>
      <span className="paper-tracker-text">
        <strong className="multiline-item-text">{tracker.name}</strong>
        <small>{trackerCadenceLabel(tracker)} · {tracker.groupName} · {tracker.unit}</small>
      </span>
    </li>)}
  </ul>;
}

function compareTodoOrder(left: LinkedTodo, right: LinkedTodo) {
  const leftHasSequence = left.sequence != null;
  const rightHasSequence = right.sequence != null;
  if (leftHasSequence !== rightHasSequence) return leftHasSequence ? -1 : 1;
  if (leftHasSequence && rightHasSequence && left.sequence !== right.sequence) {
    return Number(right.sequence) - Number(left.sequence);
  }
  return Number(left.sortPosition ?? Number.MAX_SAFE_INTEGER)
    - Number(right.sortPosition ?? Number.MAX_SAFE_INTEGER)
    || left.todoId - right.todoId;
}

function PrintablePinnedTodoGroups({ groups }: { groups: DailyPaperTodoGroup[] }) {
  if (!groups.length) return null;
  return <section className="paper-pinned-todos">
    <header className="paper-append-heading">
      <h3>Pinned to-do groups</h3>
      <small>Appended after today’s calendar</small>
    </header>
    <div className="paper-todo-groups">{groups.map((group) => <section className="paper-todo-group" key={group.id}>
      <h3>{group.name}</h3>
      {group.todos.length ? <ul className="paper-todo-cards">
        {[...group.todos].sort(compareTodoOrder).map((todo) => <PrintableTodoCard todo={todo} key={todo.todoId} />)}
      </ul> : <div className="paper-todo-empty-lines" aria-label={`Blank checklist for ${group.name}`}>
        {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
      </div>}
    </section>)}</div>
  </section>;
}

export function DailyPaper({ model, preview = false }: { model: DailyPaperModel; preview?: boolean }) {
  const availableWeather = model.weather?.status === "available" ? model.weather : null;
  return (
    <div className="daily-paper-document">
    <article className={`daily-paper paper-plan-page paper-${model.paperSize} ${preview ? "daily-paper--preview" : ""}`}>
      <header className="paper-masthead">
        <div>
          <p className="paper-kicker">Time v3 Agent · Daily paper</p>
          <h1>{model.heading}</h1>
        </div>
        <div className="paper-range">
          <span>Two weeks</span>
          <strong>{model.rangeHeading}</strong>
        </div>
      </header>

      <CalendarGrid days={model.calendarDays} compact />

      <section className="paper-section paper-today paper-timeline-page-section">
        <header className="paper-section-heading">
          <span>01</span><h2>Today’s timeline</h2><small>05:00–23:00 · {model.timeZone.replaceAll("_", " ")}</small>
        </header>
        <PrintableFixedTimeline
          events={model.todayEvents}
          date={model.date}
          timeZone={model.timeZone}
          weather={model.weather}
        />
      </section>

      <footer className="paper-footer">
        <span>{availableWeather
          ? <>Weather: <a href={availableWeather.attributionUrl}>{availableWeather.provider}</a> · {availableWeather.location}</>
          : `Printed ${formatDisplayDate(model.generatedAtUtc, { timeZone: model.timeZone })}`}</span>
        <span>For {formatLocalDate(model.date)}</span>
      </footer>
    </article>

    <article className={`daily-paper paper-details-page paper-${model.paperSize} ${preview ? "daily-paper--preview" : ""}`}>
      <header className="paper-details-masthead">
        <div><p className="paper-kicker">Daily paper · Details</p><h1>{model.heading}</h1></div>
        <small>Times, notes, linked work, trackers, and pinned groups</small>
      </header>

      <section className="paper-section paper-today-details">
        <header className="paper-section-heading">
          <span>02</span><h2>Today’s details</h2><small>{model.todayEvents.length} event{model.todayEvents.length === 1 ? "" : "s"}</small>
        </header>
        <PrintableEventDetails
          events={model.todayEvents}
          timeZone={model.timeZone}
          includeCompletedTodos={model.includeCompletedTodos}
        />
        {model.scheduledTrackers.length > 0 && <section className="paper-today-trackers">
          <header className="paper-append-heading"><h3>Trackers</h3><small>{model.scheduledTrackers.length} scheduled</small></header>
          <ScheduledTrackers trackers={model.scheduledTrackers} />
        </section>}
        <PrintablePinnedTodoGroups groups={model.printableTodoGroups} />
      </section>

      <section className="paper-section paper-notes">
        <header className="paper-section-heading">
          <span>03</span><h2>Notes</h2><small>Make it yours</small>
        </header>
        <div className="writing-lines" aria-label="Blank ruled writing area">
          {Array.from({ length: 9 }, (_, index) => <span key={index} />)}
        </div>
      </section>

      <footer className="paper-footer">
        <span>Printed {formatDisplayDate(model.generatedAtUtc, { timeZone: model.timeZone })}</span>
        <span>For {formatLocalDate(model.date)}</span>
      </footer>
    </article>
    </div>
  );
}
