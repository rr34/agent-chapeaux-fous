import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { api } from "../api";
import type { CalendarEvent, Entity, LinkedTodo } from "../types";
import {
  AgentReferenceButton, calendarEventIdentity, todoIdentity,
  type AddAgentReference,
} from "./AgentReferenceButton";

type Changed = () => void | Promise<void>;

function EditorFrame({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="object-editor-backdrop" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="object-editor" role="dialog" aria-modal="true" aria-label={title}>
      {children}
    </section>
  </div>;
}

function localDateTimeValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function localDateTimeIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}

interface CalendarDraft {
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  isAllDay: boolean;
  status: string;
  planningPromptText: string;
}

function calendarDraft(event: CalendarEvent): CalendarDraft {
  return {
    title: event.title,
    description: event.description || "",
    location: event.location || "",
    startsAt: localDateTimeValue(event.startsAtUtc),
    endsAt: localDateTimeValue(event.endsAtUtc),
    isAllDay: event.isAllDay,
    status: event.status || "active",
    planningPromptText: event.planningPromptText || "",
  };
}

function CalendarEventEditor({ eventId, recurring, onClose, onChanged }: {
  eventId: number;
  recurring: boolean;
  onClose: () => void;
  onChanged: Changed;
}) {
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [draft, setDraft] = useState<CalendarDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ event: CalendarEvent }>(`/api/calendar-events/${eventId}`).then(({ event: current }) => {
      if (!active) return;
      setEvent(current);
      setDraft(calendarDraft(current));
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [eventId]);

  const save = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!event || !draft) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/calendar-events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: event.version,
          title: draft.title,
          description: draft.description,
          location: draft.location,
          startsAtUtc: localDateTimeIso(draft.startsAt),
          endsAtUtc: localDateTimeIso(draft.endsAt),
          isAllDay: draft.isAllDay,
          status: draft.status,
          planningPromptText: draft.planningPromptText,
        }),
      });
      await onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return <EditorFrame title={recurring ? "Edit recurring event series" : "Edit calendar event"} onClose={onClose}>
    <form onSubmit={(submitEvent) => void save(submitEvent)}>
      <header className="object-editor-heading">
        <div><p className="eyebrow">Calendar</p><h2>{recurring ? "Edit recurring series" : "Edit event"}</h2></div>
        <button className="button button--quiet" type="button" onClick={onClose}>Close</button>
      </header>
      {loading && <p className="object-editor-state">Loading current event...</p>}
      {draft && <>
        {recurring && <p className="object-editor-note">This occurrence belongs to a recurring series. Changes apply to the whole series.</p>}
        <label>Title<input autoFocus required maxLength={500} value={draft.title} onChange={(change) => setDraft({ ...draft, title: change.target.value })} /></label>
        <label className="object-editor-check"><input type="checkbox" checked={draft.isAllDay} onChange={(change) => setDraft({ ...draft, isAllDay: change.target.checked })} /><span>All day</span></label>
        <div className="object-editor-grid">
          <label>Starts<input required type={draft.isAllDay ? "date" : "datetime-local"} value={draft.isAllDay ? draft.startsAt.slice(0, 10) : draft.startsAt} onChange={(change) => setDraft({ ...draft, startsAt: draft.isAllDay ? change.target.value + "T00:00" : change.target.value })} /></label>
          <label>Ends<input type={draft.isAllDay ? "date" : "datetime-local"} value={draft.isAllDay ? draft.endsAt.slice(0, 10) : draft.endsAt} onChange={(change) => setDraft({ ...draft, endsAt: draft.isAllDay && change.target.value ? change.target.value + "T00:00" : change.target.value })} /></label>
        </div>
        <label>Location<input maxLength={1000} value={draft.location} onChange={(change) => setDraft({ ...draft, location: change.target.value })} /></label>
        <label>Description<textarea rows={4} value={draft.description} onChange={(change) => setDraft({ ...draft, description: change.target.value })} /></label>
        <label>Planning prompt<textarea rows={3} maxLength={10_000} value={draft.planningPromptText} onChange={(change) => setDraft({ ...draft, planningPromptText: change.target.value })} /></label>
        <label>Status<select value={draft.status} onChange={(change) => setDraft({ ...draft, status: change.target.value })}><option value="active">Active</option><option value="archived">Archived</option></select></label>
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="object-editor-actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button><button className="button" disabled={!draft || saving}>{saving ? "Saving..." : "Save event"}</button></footer>
    </form>
  </EditorFrame>;
}

export function CalendarEventItem({ event, timeZone, timeLabel, onChanged, onReference }: {
  event: CalendarEvent;
  timeZone: string;
  timeLabel: string;
  onChanged?: Changed;
  onReference?: AddAgentReference;
}) {
  const [editing, setEditing] = useState(false);
  const eventId = Number(event.seriesId ?? event.id);
  const generatedReadOnly = Boolean(event.readOnly && !event.seriesId);
  const editable = Boolean(onChanged && Number.isSafeInteger(eventId) && eventId > 0 && !generatedReadOnly);
  const content = <>
    <strong>{event.title}</strong>
    {event.location && <span className="event-place">{event.location}</span>}
    {event.description && <p>{event.description}</p>}
  </>;
  return <li>
    <time>{timeLabel}</time>
    <div className="timeline-event-item">
      {editable
        ? <button className="editable-object-content" type="button" onClick={() => setEditing(true)} title={event.seriesId ? "Edit this recurring event series" : "Edit event"}>{content}</button>
        : <div className="editable-object-content" title={generatedReadOnly ? "This event is managed by its source record" : undefined}>{content}</div>}
    </div>
    {onReference && <AgentReferenceButton identity={calendarEventIdentity(event, timeZone)} subject={`calendar event ${event.title}`} onReference={onReference} />}
    {editing && onChanged && <CalendarEventEditor eventId={eventId} recurring={Boolean(event.seriesId)} onClose={() => setEditing(false)} onChanged={onChanged} />}
  </li>;
}

function todoId(todo: Entity | LinkedTodo) {
  return Number("todoId" in todo ? todo.todoId : todo.id);
}

function todoText(todo: Entity | LinkedTodo) {
  return String(("text" in todo && todo.text) || ("title" in todo && todo.title) || "Task");
}

function todoStatus(todo: Entity | LinkedTodo) {
  return String(todo.status || "todo");
}

interface TodoDraft {
  text: string;
  planningPromptText: string;
  groupId: string;
  sequence: string;
  status: string;
}

function TodoEditor({ todoId: id, suppliedGroups, onClose, onChanged }: {
  todoId: number;
  suppliedGroups?: Entity[];
  onClose: () => void;
  onChanged: Changed;
}) {
  const [todo, setTodo] = useState<Entity | null>(null);
  const [groups, setGroups] = useState<Entity[]>(suppliedGroups || []);
  const [draft, setDraft] = useState<TodoDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const groupRequest = suppliedGroups?.length
      ? Promise.resolve({ groups: suppliedGroups })
      : api<{ groups: Entity[] }>("/api/todo-groups");
    void Promise.all([api<{ todo: Entity }>(`/api/todos/${id}`), groupRequest]).then(([todoBody, groupBody]) => {
      if (!active) return;
      const current = todoBody.todo;
      setTodo(current);
      setGroups(groupBody.groups);
      setDraft({
        text: String(current.text || ""),
        planningPromptText: String(current.planningPromptText || ""),
        groupId: String(current.groupId || ""),
        sequence: current.sequence == null ? "" : String(current.sequence),
        status: String(current.status || "todo"),
      });
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [id, suppliedGroups]);

  const save = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!todo || !draft) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/todos/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: todo.version,
          text: draft.text,
          planningPromptText: draft.planningPromptText,
          groupId: Number(draft.groupId),
          sequence: draft.sequence ? Number(draft.sequence) : null,
          status: draft.status,
        }),
      });
      await onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return <EditorFrame title="Edit to-do" onClose={onClose}>
    <form onSubmit={(submitEvent) => void save(submitEvent)}>
      <header className="object-editor-heading"><div><p className="eyebrow">Personal to-do</p><h2>Edit to-do</h2></div><button className="button button--quiet" type="button" onClick={onClose}>Close</button></header>
      {loading && <p className="object-editor-state">Loading current to-do...</p>}
      {draft && <>
        <label>Task<textarea autoFocus required rows={4} maxLength={10_000} value={draft.text} onChange={(change) => setDraft({ ...draft, text: change.target.value })} /></label>
        <label>Planning prompt<textarea rows={3} maxLength={10_000} value={draft.planningPromptText} onChange={(change) => setDraft({ ...draft, planningPromptText: change.target.value })} /></label>
        <div className="object-editor-grid">
          <label>Group<select required value={draft.groupId} onChange={(change) => setDraft({ ...draft, groupId: change.target.value })}>{groups.map((group) => <option key={String(group.id)} value={String(group.id)}>{String(group.name)}</option>)}</select></label>
          <label>Sequence<input type="number" min={1} step={1} value={draft.sequence} onChange={(change) => setDraft({ ...draft, sequence: change.target.value })} /></label>
        </div>
        <label>Status<select value={draft.status} onChange={(change) => setDraft({ ...draft, status: change.target.value })}><option value="todo">To do</option><option value="complete">Complete</option><option value="ignore">Ignore</option><option value="archive">Archive</option><option value="ai_suggested">AI suggested</option></select></label>
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="object-editor-actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button><button className="button" disabled={!draft || saving}>{saving ? "Saving..." : "Save to-do"}</button></footer>
    </form>
  </EditorFrame>;
}

export function TodoItem({ todo, groups, eventTitles, variant = "row", onChanged, onReference }: {
  todo: Entity | LinkedTodo;
  groups?: Entity[];
  eventTitles?: string[];
  variant?: "row" | "scheduled";
  onChanged?: Changed;
  onReference?: AddAgentReference;
}) {
  const [editing, setEditing] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const id = todoId(todo);
  const text = todoText(todo);
  const status = todoStatus(todo);
  const complete = status === "complete";
  const editable = Boolean(onChanged && Number.isSafeInteger(id) && id > 0);

  const toggle = async () => {
    if (!onChanged || !editable) return;
    setUpdating(true);
    setError("");
    try {
      const { todo: current } = await api<{ todo: Entity }>(`/api/todos/${id}`);
      await api(`/api/todos/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: current.version,
          status: current.status === "complete" ? "todo" : "complete",
        }),
      });
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUpdating(false);
    }
  };

  const body = <>
    <strong>{text}</strong>
    {variant === "row" && "sequence" in todo && todo.sequence != null && <small>#{String(todo.sequence)}</small>}
    {eventTitles?.length ? <small>For {eventTitles.join(", ")}</small> : null}
  </>;
  const itemContent = <>
    {editable
      ? <button className="todo-check" type="button" disabled={updating} onClick={() => void toggle()} aria-label={`Mark ${text} ${complete ? "open" : "complete"}`}>{complete ? "✓" : ""}</button>
      : <span className={`paper-checkbox ${complete ? "is-complete" : ""}`} aria-hidden="true">{complete ? "✓" : ""}</span>}
    {editable
      ? <button className="todo-item-content" type="button" onClick={() => setEditing(true)} title="Edit to-do">{body}</button>
      : <div className="todo-item-content">{body}</div>}
    <div className="object-row-actions">
      {variant === "row" && <span className="pill">{status}</span>}
      {onReference && <AgentReferenceButton identity={todoIdentity(todo)} subject={`task ${text}`} onReference={onReference} />}
    </div>
    {error && <p className="inline-error todo-item-error" role="alert">{error}</p>}
    {editing && onChanged && <TodoEditor todoId={id} suppliedGroups={groups} onClose={() => setEditing(false)} onChanged={onChanged} />}
  </>;
  return variant === "scheduled"
    ? <li className={complete ? "is-complete" : ""}>{itemContent}</li>
    : <article className={`todo-row ${complete ? "is-complete" : ""}`}>{itemContent}</article>;
}
