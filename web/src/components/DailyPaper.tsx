import type {
  CalendarDay, CalendarEvent, DailyPaperModel, DailyPaperTodoGroup,
  LinkedTodo, ScheduledTracker,
} from "../types";
import { formatDisplayDate, formatDisplayTime, formatLocalDate } from "../date-format";
import { CalendarEventItem } from "./EditableItems";
import { matchesSearch, searchTerms } from "../search-filter";
import { compareSequenceValuesDescending } from "../sequence-order";

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
  showLinkedTodos = false,
  includeCompletedTodos = false,
}: {
  days: CalendarDay[];
  compact?: boolean;
  selectedDate?: string;
  onSelect?: (localDate: string) => void;
  ariaLabel?: string;
  id?: string;
  searchQuery?: string;
  showLinkedTodos?: boolean;
  includeCompletedTodos?: boolean;
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
                  {(compact || !event.isAllDay) && <time>{timeLabel(event, event.timeZone || "UTC").split("–")[0]}</time>}
                  <span className="calendar-chip-copy">
                    <span className="multiline-item-text">{event.title}</span>
                  </span>
                  {showLinkedTodos && (event.linkedTodos || []).some((todo) => includeCompletedTodos || todo.status !== "complete") && <span className="calendar-chip-todos">
                    {(event.linkedTodos || []).filter((todo) => includeCompletedTodos || todo.status !== "complete").map((todo) => <span className={todo.status === "complete" ? "is-complete" : ""} key={todo.todoId}>
                      <span aria-hidden="true">{todo.status === "complete" ? "☑" : "☐"}</span>
                      <span>{todoTitle(todo)}</span>
                    </span>)}
                  </span>}
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
  const sequenceDifference = compareSequenceValuesDescending(left.sequence, right.sequence);
  if (sequenceDifference !== 0) return sequenceDifference;
  return Number(left.sortPosition ?? Number.MAX_SAFE_INTEGER)
    - Number(right.sortPosition ?? Number.MAX_SAFE_INTEGER)
    || left.todoId - right.todoId;
}

function PrintablePinnedTodoGroups({ groups }: { groups: DailyPaperTodoGroup[] }) {
  if (!groups.length) return null;
  return <section className="paper-pinned-todos">
    <header className="paper-append-heading">
      <h3>Pinned to-do groups</h3>
      <small>Always on the weekly printout</small>
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

function PrintableScheduledTodos({ todos }: { todos: LinkedTodo[] }) {
  return <section className="paper-scheduled-todos">
    <header className="paper-append-heading">
      <h3>Scheduled this week</h3>
      <small>{todos.length} {todos.length === 1 ? "item" : "items"}</small>
    </header>
    {todos.length ? <ul className="paper-todo-cards">
      {[...todos].sort(compareTodoOrder).map((todo) => <PrintableTodoCard todo={todo} showRelationship key={todo.todoId} />)}
    </ul> : <div className="paper-todo-empty-lines" aria-label="Blank weekly checklist">
      {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
    </div>}
  </section>;
}

export function DailyPaper({ model, preview = false }: { model: DailyPaperModel; preview?: boolean }) {
  return (
    <div className="daily-paper-document">
    <article
      className={`daily-paper paper-week-page paper-${model.paperSize} ${preview ? "daily-paper--preview" : ""}`}
      contentEditable={preview}
      suppressContentEditableWarning
      title={preview ? "Editable print copy; changes are temporary" : undefined}
    >
      <header className="paper-masthead">
        <div>
          <p className="paper-kicker">Time v3 Agent · Weekly paper</p>
          <h1>{model.weekHeading}</h1>
        </div>
      </header>

      <CalendarGrid
        days={model.printCalendarDays}
        compact
        showLinkedTodos
        includeCompletedTodos={model.includeCompletedTodos}
        ariaLabel="Weekly printable calendar"
      />

      <section className="paper-section paper-weekly-todos">
        <header className="paper-section-heading">
          <span>01</span><h2>To-do lists</h2><small>Scheduled this week and pinned</small>
        </header>
        <PrintableScheduledTodos todos={model.scheduledTodos} />
        <PrintablePinnedTodoGroups groups={model.printableTodoGroups} />
      </section>

      <footer className="paper-footer">
        <span>Printed {formatDisplayDate(model.generatedAtUtc, { timeZone: model.timeZone })}</span>
        <span>{model.weekHeading}</span>
      </footer>
    </article>
    </div>
  );
}
