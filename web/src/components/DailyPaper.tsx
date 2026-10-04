import type { CalendarDay, CalendarEvent, DailyPaperModel, LinkedTodo } from "../types";
import { formatDisplayDate, formatDisplayTime, formatLocalDate } from "../date-format";
import {
  AgentReferenceButton, calendarEventIdentity, todoIdentity,
  type AddAgentReference,
} from "./AgentReferenceButton";

function timeLabel(event: CalendarEvent, timeZone: string) {
  if (event.isAllDay) return "All day";
  const start = formatDisplayTime(event.startsAtUtc, timeZone);
  return event.endsAtUtc ? `${start}–${formatDisplayTime(event.endsAtUtc, timeZone)}` : start;
}

export function CalendarGrid({
  days,
  compact = false,
  selectedDate,
  onSelect,
  ariaLabel = "Two-week calendar",
}: {
  days: CalendarDay[];
  compact?: boolean;
  selectedDate?: string;
  onSelect?: (localDate: string) => void;
  ariaLabel?: string;
}) {
  const eventLimit = compact ? 3 : 8;
  return (
    <section className={`two-week-grid ${compact ? "two-week-grid--compact" : ""}`} aria-label={ariaLabel}>
      <div className="weekdays" aria-hidden="true">
        {days.slice(0, 7).map((day) => <span key={day.weekday}>{day.weekday}</span>)}
      </div>
      <div className="calendar-cells">
        {days.map((day) => {
          const isSelected = selectedDate ? day.localDate === selectedDate : day.isToday;
          const contents = <>
            <span className="calendar-cell-header">
              <strong>{day.dayNumber}</strong>
              <span>{day.month}</span>
            </span>
            <span className="calendar-cell-events">
              {day.events.slice(0, eventLimit).map((event) => (
                <span className="calendar-chip" key={`${day.localDate}-${event.id}-${event.startsAtUtc}`}>
                  {!event.isAllDay && <time>{timeLabel(event, event.timeZone || "UTC").split("–")[0]}</time>}
                  <span>{event.title}</span>
                </span>
              ))}
              {day.events.length > eventLimit && <small>+{day.events.length - eventLimit} more</small>}
            </span>
          </>;
          const className = `calendar-cell ${isSelected ? "is-selected" : ""} ${day.isOutsideRange ? "is-outside-range" : ""}`;
          return onSelect ? (
            <button
              type="button"
              className={className}
              key={day.localDate}
              onClick={() => onSelect(day.localDate)}
              aria-label={formatLocalDate(day.localDate)}
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

export function DayTimeline({ events, timeZone, onReference }: {
  events: CalendarEvent[];
  timeZone: string;
  onReference?: AddAgentReference;
}) {
  if (!events.length) return <p className="paper-empty">No events scheduled. The day is yours.</p>;
  return (
    <ol className="timeline-list">
      {events.map((event) => (
        <li key={event.id}>
          <time>{timeLabel(event, timeZone)}</time>
          <div>
            <strong>{event.title}</strong>
            {event.location && <span className="event-place">{event.location}</span>}
            {event.description && <p>{event.description}</p>}
          </div>
          {onReference && <AgentReferenceButton
            identity={calendarEventIdentity(event, timeZone)}
            subject={`calendar event ${event.title}`}
            onReference={onReference}
          />}
        </li>
      ))}
    </ol>
  );
}

export function ScheduledTodos({ todos, onReference }: {
  todos: LinkedTodo[];
  onReference?: AddAgentReference;
}) {
  if (!todos.length) return <p className="paper-empty">No to-dos are attached to this day’s events.</p>;
  return (
    <ul className="paper-todos">
      {todos.map((todo) => (
        <li key={todo.todoId}>
          <span className="paper-checkbox" aria-hidden="true" />
          <div>
            <strong>{todo.title}</strong>
            {todo.eventTitles?.length ? <small>For {todo.eventTitles.join(", ")}</small> : null}
          </div>
          {onReference && <AgentReferenceButton
            identity={todoIdentity(todo)}
            subject={`task ${todo.title}`}
            onReference={onReference}
          />}
        </li>
      ))}
    </ul>
  );
}

export function DailyPaper({ model, preview = false }: { model: DailyPaperModel; preview?: boolean }) {
  return (
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
        <section className="paper-section paper-timeline">
          <header className="paper-section-heading">
            <span>01</span><h2>Today’s timeline</h2><small>{model.timeZone.replaceAll("_", " ")}</small>
          </header>
          <DayTimeline events={model.todayEvents} timeZone={model.timeZone} />
        </section>

        <section className="paper-section paper-tasks">
          <header className="paper-section-heading">
            <span>02</span><h2>Scheduled to-dos</h2><small>{model.scheduledTodos.length} item{model.scheduledTodos.length === 1 ? "" : "s"}</small>
          </header>
          <ScheduledTodos todos={model.scheduledTodos} />
        </section>
      </div>

      <section className="paper-section paper-notes">
        <header className="paper-section-heading">
          <span>03</span><h2>Notes, ideas & the rest of the day</h2><small>Make it yours</small>
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
  );
}
