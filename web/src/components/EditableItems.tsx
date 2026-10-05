import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { api } from "../api";
import type { CalendarEvent, CalendarRoutine, Entity, LinkedTodo } from "../types";
import {
  AgentReferenceButton, calendarEventIdentity, calendarRoutineIdentity, todoIdentity,
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

interface CalendarRoutineDraft {
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  isAllDay: boolean;
  recurrenceRule: string;
  planningPromptText: string;
}

function calendarRoutineDraft(routine: CalendarRoutine): CalendarRoutineDraft {
  return {
    title: routine.title,
    description: routine.description || "",
    location: routine.location || "",
    startsAt: localDateTimeValue(routine.startsAtUtc),
    endsAt: localDateTimeValue(routine.endsAtUtc),
    timeZone: routine.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    isAllDay: routine.isAllDay,
    recurrenceRule: routine.recurrenceRule,
    planningPromptText: routine.planningPromptText || "",
  };
}

function CalendarRoutineEditor({ routineId, onClose, onChanged }: {
  routineId: number;
  onClose: () => void;
  onChanged: Changed;
}) {
  const [routine, setRoutine] = useState<CalendarRoutine | null>(null);
  const [draft, setDraft] = useState<CalendarRoutineDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ routine: CalendarRoutine | null }>(`/api/calendar-routines/${routineId}`).then(({ routine: current }) => {
      if (!current) throw new Error("Calendar routine not found.");
      if (!active) return;
      setRoutine(current);
      setDraft(calendarRoutineDraft(current));
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [routineId]);

  const save = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!routine || !draft) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/calendar-routines/${routineId}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: routine.version,
          title: draft.title,
          description: draft.description,
          location: draft.location,
          startsAtUtc: localDateTimeIso(draft.startsAt),
          endsAtUtc: localDateTimeIso(draft.endsAt),
          timeZone: draft.timeZone,
          isAllDay: draft.isAllDay,
          recurrenceRule: draft.recurrenceRule,
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

  return <EditorFrame title="Edit calendar routine" onClose={onClose}>
    <form onSubmit={(submitEvent) => void save(submitEvent)}>
      <header className="object-editor-heading"><div><p className="eyebrow">Routine</p><h2>Edit routine</h2></div><button className="button button--quiet" type="button" onClick={onClose}>Close</button></header>
      {loading && <p className="object-editor-state">Loading current routine...</p>}
      {draft && <>
        <p className="object-editor-note">Changes affect future generated events. Events already placed on the calendar stay unchanged.</p>
        <label>Title<input autoFocus required maxLength={500} value={draft.title} onChange={(change) => setDraft({ ...draft, title: change.target.value })} /></label>
        <label className="object-editor-check"><input type="checkbox" checked={draft.isAllDay} onChange={(change) => setDraft({ ...draft, isAllDay: change.target.checked })} /><span>All day</span></label>
        <div className="object-editor-grid">
          <label>First start<input required type={draft.isAllDay ? "date" : "datetime-local"} value={draft.isAllDay ? draft.startsAt.slice(0, 10) : draft.startsAt} onChange={(change) => setDraft({ ...draft, startsAt: draft.isAllDay ? change.target.value + "T00:00" : change.target.value })} /></label>
          <label>First end<input type={draft.isAllDay ? "date" : "datetime-local"} value={draft.isAllDay ? draft.endsAt.slice(0, 10) : draft.endsAt} onChange={(change) => setDraft({ ...draft, endsAt: draft.isAllDay && change.target.value ? change.target.value + "T00:00" : change.target.value })} /></label>
        </div>
        <label>Time zone<input required maxLength={100} value={draft.timeZone} onChange={(change) => setDraft({ ...draft, timeZone: change.target.value })} /></label>
        <label>Recurrence rule<textarea required rows={3} maxLength={2000} placeholder="FREQ=WEEKLY;BYDAY=MO" value={draft.recurrenceRule} onChange={(change) => setDraft({ ...draft, recurrenceRule: change.target.value })} /></label>
        <label>Location<input maxLength={1000} value={draft.location} onChange={(change) => setDraft({ ...draft, location: change.target.value })} /></label>
        <label>Description<textarea rows={4} maxLength={10_000} value={draft.description} onChange={(change) => setDraft({ ...draft, description: change.target.value })} /></label>
        <label>Planning prompt<textarea rows={3} maxLength={10_000} value={draft.planningPromptText} onChange={(change) => setDraft({ ...draft, planningPromptText: change.target.value })} /></label>
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="object-editor-actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button><button className="button" disabled={!draft || saving}>{saving ? "Saving..." : "Save routine"}</button></footer>
    </form>
  </EditorFrame>;
}

export function CalendarRoutineItem({ routine, timeLabel, onChanged, onReference }: {
  routine: CalendarRoutine;
  timeLabel: string;
  onChanged?: Changed;
  onReference?: AddAgentReference;
}) {
  const [editing, setEditing] = useState(false);
  const id = Number(routine.id);
  const editable = Boolean(onChanged && Number.isSafeInteger(id) && id > 0);
  const body = <><strong className="multiline-item-text">{routine.title}</strong>{routine.description && <p className="multiline-item-text">{routine.description}</p>}</>;
  return <article className="routine-agenda-item">
    {editable
      ? <button className="routine-item-content" type="button" onClick={() => setEditing(true)} title="Edit routine">{body}</button>
      : <div className="routine-item-content">{body}</div>}
    <div className="routine-agenda-actions">
      <span>{timeLabel}</span>
      {onReference && <AgentReferenceButton identity={calendarRoutineIdentity(routine)} subject={`calendar routine ${routine.title}`} onReference={onReference} />}
    </div>
    {editing && onChanged && <CalendarRoutineEditor routineId={id} onClose={() => setEditing(false)} onChanged={onChanged} />}
  </article>;
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
    <strong className="multiline-item-text">{event.title}</strong>
    {event.location && <span className="event-place">{event.location}</span>}
    {event.description && <p className="multiline-item-text">{event.description}</p>}
  </>;
  return <li>
    <time>{timeLabel}</time>
    <div className="timeline-event-item">
      {editable
        ? <button className="editable-object-content" type="button" onClick={() => setEditing(true)} title={event.seriesId ? "Edit this recurring event series" : "Edit event"}>{content}</button>
        : <div className="editable-object-content" title={generatedReadOnly ? "This event is managed by its source record" : undefined}>{content}</div>}
    </div>
    {onReference && Number.isSafeInteger(eventId) && eventId > 0 && <AgentReferenceButton identity={calendarEventIdentity(event, timeZone)} subject={`calendar event ${event.title}`} onReference={onReference} />}
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
  billableAmount: string;
  billableCurrency: string;
}

function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency })
      .resolvedOptions().maximumFractionDigits ?? 2;
  } catch { throw new Error("Billable currency must be a valid three-letter currency code."); }
}

function formatBillableAmount(amountMinor: unknown, currencyValue: unknown) {
  if (amountMinor == null || !currencyValue) return "";
  const currency = String(currencyValue).toUpperCase();
  const divisor = 10 ** currencyDigits(currency);
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amountMinor) / divisor);
}

function billableMinorUnits(amount: string, currencyValue: string) {
  if (!amount.trim()) return { billableAmountMinor: null, billableCurrency: null };
  const currency = currencyValue.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Billable currency must be a three-letter currency code.");
  const digits = currencyDigits(currency);
  const match = new RegExp(`^(?:0|[1-9]\\d*)(?:\\.(\\d{1,${digits}}))?$`).exec(amount.trim());
  if (!match) throw new Error(`Billable amount must be positive with at most ${digits} decimal places.`);
  const whole = Number(amount.trim().split(".")[0] ?? "0");
  const fraction = (match[1] || "").padEnd(digits, "0");
  const minor = whole * (10 ** digits) + Number(fraction || 0);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error("Billable amount must be greater than zero.");
  return { billableAmountMinor: minor, billableCurrency: currency };
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
        billableAmount: current.billableAmountMinor == null ? "" : String(
          Number(current.billableAmountMinor) / (10 ** currencyDigits(String(current.billableCurrency || "USD"))),
        ),
        billableCurrency: String(current.billableCurrency || "USD"),
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
      const price = billableMinorUnits(draft.billableAmount, draft.billableCurrency);
      await api(`/api/todos/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          version: todo.version,
          text: draft.text,
          planningPromptText: draft.planningPromptText,
          groupId: Number(draft.groupId),
          sequence: draft.sequence ? Number(draft.sequence) : null,
          status: draft.status,
          ...price,
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
        <div className="object-editor-grid">
          <label>Billable amount<input inputMode="decimal" placeholder="125.00" value={draft.billableAmount} onChange={(change) => setDraft({ ...draft, billableAmount: change.target.value })} /></label>
          <label>Currency<input maxLength={3} value={draft.billableCurrency} onChange={(change) => setDraft({ ...draft, billableCurrency: change.target.value.toUpperCase() })} /></label>
        </div>
        <small>Leave the amount blank to make this to-do non-billable. Invoices preserve a snapshot after preparation.</small>
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
  const billable = formatBillableAmount(
    "billableAmountMinor" in todo ? todo.billableAmountMinor : null,
    "billableCurrency" in todo ? todo.billableCurrency : null,
  );
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
    <strong className="multiline-item-text">{text}</strong>
    {variant === "row" && "sequence" in todo && todo.sequence != null && <small>#{String(todo.sequence)}</small>}
    {billable && <small>{billable} billable</small>}
    {eventTitles?.length ? <small className="multiline-item-text">For {eventTitles.join(", ")}</small> : null}
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
      {onReference && status !== "complete" && <AgentReferenceButton identity={todoIdentity(todo)} subject={`task ${text}`} onReference={onReference} />}
    </div>
    {error && <p className="inline-error todo-item-error" role="alert">{error}</p>}
    {editing && onChanged && <TodoEditor todoId={id} suppliedGroups={groups} onClose={() => setEditing(false)} onChanged={onChanged} />}
  </>;
  return variant === "scheduled"
    ? <li className={`scheduled-todo-card${complete ? " is-complete" : ""}`}>{itemContent}</li>
    : <article className={`todo-row ${complete ? "is-complete" : ""}`}>{itemContent}</article>;
}
