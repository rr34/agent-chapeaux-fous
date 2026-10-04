import type { CalendarDay, CalendarEvent, DailyPaperModel, LinkedTodo } from "../types";

function timeLabel(event: CalendarEvent, timeZone: string) {
  if (event.isAllDay) return "All day";
  const format = (value: string) => new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", timeZone,
  }).format(new Date(value));
  const start = format(event.startsAtUtc);
  return event.endsAtUtc ? `${start}–${format(event.endsAtUtc)}` : start;
}

export function CalendarGrid({ days, compact = false }: { days: CalendarDay[]; compact?: boolean }) {
  return (
    <section className={`two-week-grid ${compact ? "two-week-grid--compact" : ""}`} aria-label="Two-week calendar">
      <div className="weekdays" aria-hidden="true">
        {days.slice(0, 7).map((day) => <span key={day.weekday}>{day.weekday}</span>)}
      </div>
      <div className="calendar-cells">
        {days.map((day) => (
          <article className={`calendar-cell ${day.isToday ? "is-selected" : ""}`} key={day.localDate}>
            <header>
              <span>{day.month}</span>
              <strong>{day.dayNumber}</strong>
            </header>
            <div className="calendar-cell-events">
              {day.events.slice(0, compact ? 3 : 5).map((event) => (
                <div className="calendar-chip" key={`${day.localDate}-${event.id}`}>
                  {!event.isAllDay && <time>{timeLabel(event, event.timeZone || "UTC").split("–")[0]}</time>}
                  <span>{event.title}</span>
                </div>
              ))}
              {day.events.length > (compact ? 3 : 5) && <small>+{day.events.length - (compact ? 3 : 5)} more</small>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function DayTimeline({ events, timeZone }: { events: CalendarEvent[]; timeZone: string }) {
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
        </li>
      ))}
    </ol>
  );
}

export function ScheduledTodos({ todos }: { todos: LinkedTodo[] }) {
  if (!todos.length) return <p className="paper-empty">No to-dos are attached to today’s events.</p>;
  return (
    <ul className="paper-todos">
      {todos.map((todo) => (
        <li key={todo.todoId}>
          <span className="paper-checkbox" aria-hidden="true" />
          <div>
            <strong>{todo.title}</strong>
            {todo.eventTitles?.length ? <small>For {todo.eventTitles.join(", ")}</small> : null}
          </div>
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
        <span>Printed {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(model.generatedAtUtc))}</span>
        <span>{model.date}</span>
      </footer>
    </article>
  );
}
