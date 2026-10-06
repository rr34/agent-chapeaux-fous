import type { CalendarDay, CalendarEvent, DailyPaperModel, LinkedTodo, ScheduledTracker } from "../types";
import { formatDisplayDate, formatDisplayTime, formatLocalDate } from "../date-format";
import { type AddAgentReference } from "./AgentReferenceButton";
import { CalendarEventItem, TodoItem } from "./EditableItems";
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
          const visibleEvents = compact ? orderedEvents : orderedEvents.slice(0, eventLimit);
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
              {!compact && day.events.length > eventLimit && <small>+{day.events.length - eventLimit} more</small>}
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

export function DayTimeline({ events, timeZone, onReference, onChanged }: {
  events: CalendarEvent[];
  timeZone: string;
  onReference?: AddAgentReference;
  onChanged?: () => void | Promise<void>;
}) {
  if (!events.length) return <p className="paper-empty">No events scheduled. The day is yours.</p>;
  return (
    <ol className="timeline-list">
      {events.map((event) => <CalendarEventItem
        event={event}
        timeZone={timeZone}
        timeLabel={timeLabel(event, timeZone)}
        onChanged={onChanged}
        onReference={onReference}
        key={event.id}
      />)}
    </ol>
  );
}

export function ScheduledTodos({ todos, onReference, onChanged }: {
  todos: LinkedTodo[];
  onReference?: AddAgentReference;
  onChanged?: () => void | Promise<void>;
}) {
  if (!todos.length) return <p className="paper-empty">No to-dos are attached to this day’s events.</p>;
  return (
    <ul className="paper-todos">
      {todos.map((todo) => <TodoItem
        todo={todo}
        eventTitles={todo.eventTitles}
        variant="scheduled"
        onChanged={onChanged}
        onReference={onReference}
        key={todo.todoId}
      />)}
    </ul>
  );
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

function todoTitle(todo: LinkedTodo) {
  return todo.text || todo.title || "Task";
}

function todoPrintIdentifier(todo: LinkedTodo) {
  return `personal_task_id:${todo.todoId}`;
}

function PrintableTodos({ todos }: { todos: LinkedTodo[] }) {
  if (!todos.length) return <p className="paper-empty">No to-dos are attached to this day’s events.</p>;
  return <ul className="paper-todo-cards">
    {todos.map((todo) => <li className="scheduled-todo-card" key={todo.todoId} data-object-reference={todoPrintIdentifier(todo)}>
      <header>
        <strong className="multiline-item-text">{todoTitle(todo)}</strong>
        <span className="paper-todo-id">{todoPrintIdentifier(todo)}</span>
      </header>
      {todo.eventTitles?.length
        ? <small className="multiline-item-text">For {todo.eventTitles.join(", ")}</small>
        : null}
      <div className="paper-handwriting-space" aria-label={`Blank writing area for ${todoPrintIdentifier(todo)}`}>
        <span aria-hidden="true">&#123;</span>
      </div>
    </li>)}
  </ul>;
}

export function DailyPaper({ model, preview = false }: { model: DailyPaperModel; preview?: boolean }) {
  return (
    <div className="daily-paper-document">
    <article className={`daily-paper paper-${model.paperSize} ${preview ? "daily-paper--preview" : ""}`}>
      <header className="paper-masthead">
        <div>
          <p className="paper-kicker">Chapeaux Fous · Daily paper</p>
          <h1>{model.heading}</h1>
        </div>
        <div className="paper-range">
          <span>Two weeks</span>
          <strong>{model.rangeHeading}</strong>
        </div>
      </header>

      <CalendarGrid days={model.calendarDays} compact />

      <div className="paper-day-columns">
        <div className="paper-day-left">
          <section className="paper-section paper-timeline">
            <header className="paper-section-heading">
              <span>01</span><h2>Today’s timeline</h2><small>{model.timeZone.replaceAll("_", " ")}</small>
            </header>
            <DayTimeline events={model.todayEvents} timeZone={model.timeZone} />
          </section>
          <section className="paper-section paper-tracker-section">
            <header className="paper-section-heading">
              <span>02</span><h2>Trackers</h2><small>{model.scheduledTrackers.length} scheduled</small>
            </header>
            <ScheduledTrackers trackers={model.scheduledTrackers} />
          </section>
        </div>

        <section className="paper-section paper-tasks">
          <header className="paper-section-heading">
            <span>03</span><h2>Scheduled to-dos</h2><small>{model.scheduledTodos.length} item{model.scheduledTodos.length === 1 ? "" : "s"}</small>
          </header>
          <PrintableTodos todos={model.scheduledTodos} />
        </section>
      </div>

      <section className="paper-section paper-notes">
        <header className="paper-section-heading">
          <span>04</span><h2>Notes</h2><small>Make it yours</small>
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
