import type {
  CalendarDay, CalendarEvent, DailyPaperModel, DailyPaperTodoGroup, LinkedTodo,
  ScheduledTracker, TodoEventLink,
} from "../types";
import { formatDisplayDate, formatDisplayTime, formatLocalDate } from "../date-format";
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

export function DayTimeline({ events, timeZone, onChanged }: {
  events: CalendarEvent[];
  timeZone: string;
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
        key={event.id}
      />)}
    </ol>
  );
}

export function ScheduledTodos({ todos, onChanged }: {
  todos: LinkedTodo[];
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

interface PrintableTodoCluster {
  key: string;
  kind: "Contact" | "Event" | "Other";
  label: string;
  eventId?: number | string;
  todos: LinkedTodo[];
}

interface PrintableTodoGroup {
  key: string;
  name: string;
  sortPosition: number;
  clusters: PrintableTodoCluster[];
}

const todoClusterRank = { Contact: 0, Event: 1, Other: 2 };

function orderedEventLinks(todo: LinkedTodo) {
  return [...(todo.eventLinks || [])].sort((left, right) => (
    left.startsAtUtc.localeCompare(right.startsAtUtc)
    || String(left.eventId).localeCompare(String(right.eventId))
  ));
}

function eventClusterLabel(event: TodoEventLink, timeZone: string) {
  const when = event.isAllDay ? "All day" : formatDisplayTime(event.startsAtUtc, timeZone);
  return `${when} · ${event.title}`;
}

function clusterCandidatesForTodo(todo: LinkedTodo, timeZone: string): Omit<PrintableTodoCluster, "todos">[] {
  const candidates: Omit<PrintableTodoCluster, "todos">[] = [];
  if (todo.relatedContact) candidates.push({
    key: `contact:${todo.relatedContact.contactId}`,
    kind: "Contact",
    label: todo.relatedContact.displayName,
  });
  candidates.push(...orderedEventLinks(todo).map((event) => ({
    key: `event:${String(event.eventId)}`, kind: "Event" as const,
    label: eventClusterLabel(event, timeZone), eventId: event.eventId,
  })));
  if (!todo.eventLinks?.length) candidates.push(...(todo.eventTitles || []).map((title) => ({
    key: `event-title:${title}`, kind: "Event" as const, label: title,
  })));
  if (!candidates.length) candidates.push({
    key: "other", kind: "Other", label: "No linked item",
  });
  return candidates;
}

function bestClusterForTodo(todo: LinkedTodo, timeZone: string, counts: Map<string, number>) {
  const candidates = clusterCandidatesForTodo(todo, timeZone);
  candidates.sort((left, right) => (
    Number(counts.get(right.key) || 0) - Number(counts.get(left.key) || 0)
    || todoClusterRank[left.kind] - todoClusterRank[right.kind]
    || left.label.localeCompare(right.label)
  ));
  return candidates[0];
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

function clusteredTodoGroups(groups: DailyPaperTodoGroup[], timeZone: string) {
  return groups
    .map((group) => ({
      key: `group:${group.id}`,
      name: group.name,
      sortPosition: group.sortPosition,
      todos: group.todos,
    }))
    .map((group): PrintableTodoGroup => {
      const counts = new Map<string, number>();
      for (const todo of group.todos) {
        for (const candidate of clusterCandidatesForTodo(todo, timeZone)) {
          counts.set(candidate.key, Number(counts.get(candidate.key) || 0) + 1);
        }
      }
      const clusters = new Map<string, PrintableTodoCluster>();
      for (const todo of group.todos) {
        const selected = bestClusterForTodo(todo, timeZone, counts);
        const cluster = clusters.get(selected.key) || { ...selected, todos: [] };
        cluster.todos.push(todo);
        clusters.set(selected.key, cluster);
      }
      return {
        key: group.key,
        name: group.name,
        sortPosition: group.sortPosition,
        clusters: [...clusters.values()]
          .sort((left, right) => {
            return todoClusterRank[left.kind] - todoClusterRank[right.kind]
              || left.label.localeCompare(right.label);
          })
          .map((cluster) => ({
            ...cluster,
            todos: cluster.todos.sort(compareTodoOrder),
          })),
      };
    });
}

function relationshipKindLabel(value: string | null) {
  return value ? value[0].toUpperCase() + value.slice(1) : null;
}

function remainingRelationshipLabels(todo: LinkedTodo, cluster: PrintableTodoCluster) {
  const labels: string[] = [];
  if (todo.relatedContact && cluster.key !== `contact:${todo.relatedContact.contactId}`) {
    labels.push(`Contact · ${todo.relatedContact.displayName}`);
  }
  const eventLinks = orderedEventLinks(todo);
  for (const event of eventLinks) {
    const relationship = relationshipKindLabel(event.relationshipKind);
    if (cluster.eventId != null && String(cluster.eventId) === String(event.eventId)) {
      if (relationship) labels.push(relationship);
      continue;
    }
    labels.push(["Event", event.title, relationship].filter(Boolean).join(" · "));
  }
  if (!eventLinks.length && cluster.kind !== "Event") {
    labels.push(...(todo.eventTitles || []).map((title) => `Event · ${title}`));
  }
  return labels;
}

function PrintableTodos({ groups, timeZone }: { groups: DailyPaperTodoGroup[]; timeZone: string }) {
  if (!groups.length) return <p className="paper-empty">No to-dos are attached to this day’s events.</p>;
  return <div className="paper-todo-groups">
    {clusteredTodoGroups(groups, timeZone).map((group) => <section className="paper-todo-group" key={group.key}>
      <h3>{group.name}</h3>
      {group.clusters.length ? <div className="paper-todo-clusters">
        {group.clusters.map((cluster) => <section className="paper-todo-cluster" key={cluster.key}>
          <header className="paper-todo-cluster-heading">
            <span>{cluster.kind}</span><strong className="multiline-item-text">{cluster.label}</strong>
          </header>
          <ul className="paper-todo-cards">
            {cluster.todos.map((todo) => {
              const relationshipLabels = remainingRelationshipLabels(todo, cluster);
              return <li className="scheduled-todo-card" key={todo.todoId} data-object-reference={todoPrintIdentifier(todo)}>
                <header>
                  <strong className="multiline-item-text">{todoTitle(todo)}</strong>
                  <span className="paper-todo-id">{todoPrintIdentifier(todo)}</span>
                </header>
                {relationshipLabels.length
                  ? <small className="paper-todo-relationships multiline-item-text">{relationshipLabels.join("; ")}</small>
                  : null}
                <div className="paper-handwriting-space" aria-label={`Blank writing area for ${todoPrintIdentifier(todo)}`}>
                  <span aria-hidden="true">&#123;</span>
                </div>
              </li>;
            })}
          </ul>
        </section>)}
      </div> : <div className="paper-todo-empty-lines" aria-label={`Blank checklist for ${group.name}`}>
        {Array.from({ length: 3 }, (_, index) => <span key={index} />)}
      </div>}
    </section>)}
  </div>;
}

export function DailyPaper({ model, preview = false }: { model: DailyPaperModel; preview?: boolean }) {
  const printableTodoCount = model.printableTodoGroups
    .reduce((count, group) => count + group.todos.length, 0);
  return (
    <div className="daily-paper-document">
    <article className={`daily-paper paper-${model.paperSize} ${preview ? "daily-paper--preview" : ""}`}>
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
            <span>03</span><h2>To-dos</h2><small>{printableTodoCount} item{printableTodoCount === 1 ? "" : "s"}</small>
          </header>
          <PrintableTodos groups={model.printableTodoGroups} timeZone={model.timeZone} />
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
