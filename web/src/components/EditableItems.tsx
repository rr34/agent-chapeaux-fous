import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  durationMinutes, formatDurationClock, parseDurationClock, updateEventTiming,
} from "../../../public/event-date-time.js";
import { api } from "../api";
import { formatDisplayDate } from "../date-format";
import type { CalendarEvent, CalendarRoutine, Entity, LinkedTodo } from "../types";
import {
  AgentReferenceButton, calendarEventIdentity, calendarRoutineIdentity, todoIdentity,
  type AddAgentReference,
} from "./AgentReferenceButton";
import {
  buildRecurrenceRule, RecurrenceEditor, recurrenceDraft, type RecurrenceDraft,
} from "./RecurrenceEditor";
import { FirstClassObjectCard } from "./FirstClassObjectCard";

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

interface ContactMethodDraft {
  id?: number;
  kind: string;
  label: string;
  value: string;
  isPrimary: boolean;
  canReceive: boolean;
}

interface ContactDraft {
  kind: string;
  displayName: string;
  givenName: string;
  familyName: string;
  organizationName: string;
  status: string;
  birthDate: string;
  notes: string;
  methods: ContactMethodDraft[];
  tags: string[];
}

function contactDraft(contact: Entity): ContactDraft {
  return {
    kind: String(contact.kind || "person"),
    displayName: String(contact.displayName || ""),
    givenName: String(contact.givenName || ""),
    familyName: String(contact.familyName || ""),
    organizationName: String(contact.organizationName || ""),
    status: String(contact.status || "active"),
    birthDate: String(contact.birthDate || ""),
    notes: String(contact.notes || ""),
    methods: ((contact.methods as Entity[] | undefined) || []).map((method) => ({
      ...(method.id == null ? {} : { id: Number(method.id) }),
      kind: String(method.kind || "other"),
      label: String(method.label || ""),
      value: String(method.value || ""),
      isPrimary: Boolean(method.isPrimary),
      canReceive: method.canReceive !== false,
    })),
    tags: ((contact.tags as string[] | undefined) || []).map(String),
  };
}

export function ContactEditor({ contactId, onClose, onChanged }: {
  contactId: number;
  onClose: () => void;
  onChanged: Changed;
}) {
  const [contact, setContact] = useState<Entity | null>(null);
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void api<{ contact: Entity }>(`/api/contacts/${contactId}`).then(({ contact: current }) => {
      if (!active) return;
      setContact(current);
      setDraft(contactDraft(current));
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [contactId]);

  const updateMethod = (index: number, update: Partial<ContactMethodDraft>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      methods: draft.methods.map((method, methodIndex) => methodIndex === index ? { ...method, ...update } : method),
    });
  };

  const save = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!contact || !draft) return;
    setSaving(true);
    setError("");
    try {
      await api(`/api/contacts/${contactId}`, {
        method: "PATCH",
        body: JSON.stringify({ version: contact.version, ...draft }),
      });
      await onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return <EditorFrame title="Edit contact" onClose={onClose}>
    <form onSubmit={(submitEvent) => void save(submitEvent)}>
      <header className="object-editor-heading"><div><p className="eyebrow">Contacts</p><h2>Edit contact</h2></div><button className="button button--quiet" type="button" onClick={onClose}>Close</button></header>
      {loading && <p className="object-editor-state">Loading current contact...</p>}
      {draft && <>
        <div className="object-editor-grid">
          <label>Name<input autoFocus required maxLength={500} value={draft.displayName} onChange={(change) => setDraft({ ...draft, displayName: change.target.value })} /></label>
          <label>Type<select value={draft.kind} onChange={(change) => setDraft({ ...draft, kind: change.target.value })}><option value="person">Person</option><option value="organization">Organization</option><option value="service">Service</option></select></label>
        </div>
        <div className="object-editor-grid">
          <label>Given name<input maxLength={500} value={draft.givenName} onChange={(change) => setDraft({ ...draft, givenName: change.target.value })} /></label>
          <label>Family name<input maxLength={500} value={draft.familyName} onChange={(change) => setDraft({ ...draft, familyName: change.target.value })} /></label>
        </div>
        <div className="object-editor-grid">
          <label>Organization<input maxLength={500} value={draft.organizationName} onChange={(change) => setDraft({ ...draft, organizationName: change.target.value })} /></label>
          <label>Birthday<input maxLength={10} placeholder="YYYY-MM-DD or --MM-DD" value={draft.birthDate} onChange={(change) => setDraft({ ...draft, birthDate: change.target.value })} /></label>
        </div>
        <section className="contact-editor-section" aria-labelledby="contact-methods-heading">
          <div className="contact-editor-section-heading"><h3 id="contact-methods-heading">Contact details</h3><button className="button button--quiet" type="button" disabled={draft.methods.length >= 100} onClick={() => setDraft({ ...draft, methods: [...draft.methods, { kind: "email", label: "", value: "", isPrimary: false, canReceive: true }] })}>Add detail</button></div>
          {!draft.methods.length && <p className="contact-empty">No contact details yet.</p>}
          {draft.methods.map((method, index) => <div className="contact-editor-method" key={method.id ?? `new-${index}`}>
            <label>Type<select value={method.kind} onChange={(change) => updateMethod(index, { kind: change.target.value })}><option value="email">Email</option><option value="phone">Phone</option><option value="postal_address">Postal address</option><option value="handle">Handle</option><option value="url">URL</option><option value="other">Other</option></select></label>
            <label>Label<input maxLength={100} placeholder="Work, mobile…" value={method.label} onChange={(change) => updateMethod(index, { label: change.target.value })} /></label>
            <label className="contact-editor-method-value">Value<input required maxLength={2000} value={method.value} onChange={(change) => updateMethod(index, { value: change.target.value })} /></label>
            <label className="object-editor-check"><input type="checkbox" checked={method.isPrimary} onChange={(change) => updateMethod(index, { isPrimary: change.target.checked })} /><span>Primary</span></label>
            <label className="object-editor-check"><input type="checkbox" checked={method.canReceive} onChange={(change) => updateMethod(index, { canReceive: change.target.checked })} /><span>Can receive</span></label>
            <button className="button button--quiet contact-editor-remove" type="button" onClick={() => setDraft({ ...draft, methods: draft.methods.filter((_, methodIndex) => methodIndex !== index) })}>Remove</button>
          </div>)}
        </section>
        <section className="contact-editor-section" aria-labelledby="contact-tags-heading">
          <div className="contact-editor-section-heading"><h3 id="contact-tags-heading">Tags</h3><button className="button button--quiet" type="button" disabled={draft.tags.length >= 50} onClick={() => setDraft({ ...draft, tags: [...draft.tags, ""] })}>Add tag</button></div>
          {!draft.tags.length && <p className="contact-empty">No tags yet.</p>}
          <div className="contact-editor-tags">{draft.tags.map((tag, index) => <div key={index}><input required maxLength={100} aria-label={`Tag ${index + 1}`} value={tag} onChange={(change) => setDraft({ ...draft, tags: draft.tags.map((current, tagIndex) => tagIndex === index ? change.target.value : current) })} /><button className="button button--quiet" type="button" aria-label={`Remove tag ${tag || index + 1}`} onClick={() => setDraft({ ...draft, tags: draft.tags.filter((_, tagIndex) => tagIndex !== index) })}>Remove</button></div>)}</div>
        </section>
        <label>Notes<textarea rows={4} maxLength={10_000} value={draft.notes} onChange={(change) => setDraft({ ...draft, notes: change.target.value })} /></label>
        <label>Status<select value={draft.status} onChange={(change) => setDraft({ ...draft, status: change.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option><option value="blocked">Blocked</option><option value="deceased">Deceased</option></select></label>
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="object-editor-actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button><button className="button" disabled={!draft || saving}>{saving ? "Saving..." : "Save contact"}</button></footer>
    </form>
  </EditorFrame>;
}

interface CalendarDraft {
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string;
  duration: string;
  isAllDay: boolean;
  status: string;
  planningPromptText: string;
  timeZone: string;
  recurrence: RecurrenceDraft;
}

function calendarDraft(event: CalendarEvent): CalendarDraft {
  const startsAt = localDateTimeValue(event.startsAtUtc);
  const endsAt = localDateTimeValue(event.endsAtUtc);
  return {
    title: event.title,
    description: event.description || "",
    location: event.location || "",
    startsAt,
    endsAt,
    duration: formatDurationClock(durationMinutes(startsAt, endsAt)),
    isAllDay: event.isAllDay,
    status: event.status || "active",
    planningPromptText: event.planningPromptText || "",
    timeZone: event.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    recurrence: recurrenceDraft(event.recurrenceRule, localDateTimeValue(event.startsAtUtc).slice(0, 10)),
  };
}

function newCalendarDraft(initialDate?: string): CalendarDraft {
  const localToday = localDateTimeValue(new Date().toISOString()).slice(0, 10);
  const date = initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate)
    ? initialDate
    : localToday;
  return {
    title: "",
    description: "",
    location: "",
    startsAt: `${date}T09:00`,
    endsAt: `${date}T10:00`,
    duration: "01:00",
    isAllDay: false,
    status: "active",
    planningPromptText: "",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    recurrence: recurrenceDraft(null, date),
  };
}

export function CalendarEventEditor({ eventId, recurring = false, initialDate, onClose, onChanged }: {
  eventId?: number;
  recurring?: boolean;
  initialDate?: string;
  onClose: () => void;
  onChanged: Changed;
}) {
  const creating = eventId == null;
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [draft, setDraft] = useState<CalendarDraft | null>(() => creating ? newCalendarDraft(initialDate) : null);
  const [loading, setLoading] = useState(!creating);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (eventId == null) return;
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
    if (!draft || (!creating && !event)) return;
    if (!draft.isAllDay && draft.duration && parseDurationClock(draft.duration) === null) {
      setError("Use duration HH:MM, for example 01:30.");
      return;
    }
    const timedMinutes = !draft.isAllDay && draft.endsAt
      ? durationMinutes(draft.startsAt, draft.endsAt)
      : null;
    if (timedMinutes !== null && timedMinutes <= 0) {
      setError("End must be after start.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api(creating ? "/api/calendar-events" : `/api/calendar-events/${eventId}`, {
        method: creating ? "POST" : "PATCH",
        body: JSON.stringify({
          ...(!creating && event ? { version: event.version } : {}),
          title: draft.title,
          description: draft.description,
          location: draft.location,
          startsAtUtc: localDateTimeIso(draft.startsAt),
          endsAtUtc: localDateTimeIso(draft.endsAt),
          isAllDay: draft.isAllDay,
          status: draft.status,
          planningPromptText: draft.planningPromptText,
          timeZone: draft.timeZone,
          recurrenceRule: buildRecurrenceRule(draft.recurrence),
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

  const isRecurring = recurring || Boolean(event?.recurrenceRule);
  return <EditorFrame title={creating ? "Add calendar event" : isRecurring ? "Edit recurring event series" : "Edit calendar event"} onClose={onClose}>
    <form onSubmit={(submitEvent) => void save(submitEvent)}>
      <header className="object-editor-heading">
        <div><p className="eyebrow">Calendar</p><h2>{creating ? "Add event" : isRecurring ? "Edit recurring series" : "Edit event"}</h2></div>
        <button className="button button--quiet" type="button" onClick={onClose}>Close</button>
      </header>
      {loading && <p className="object-editor-state">Loading current event...</p>}
      {draft && <>
        {isRecurring && !creating && <p className="object-editor-note">This occurrence belongs to a recurring series. Changes apply to the whole series.</p>}
        <label>Title<input autoFocus required maxLength={500} value={draft.title} onChange={(change) => setDraft({ ...draft, title: change.target.value })} /></label>
        <label className="object-editor-check"><input type="checkbox" checked={draft.isAllDay} onChange={(change) => {
          const isAllDay = change.target.checked;
          const timing = !isAllDay
            ? updateEventTiming(draft, "start", draft.startsAt)
            : draft;
          setDraft({ ...draft, ...timing, isAllDay });
        }} /><span>All day</span></label>
        <div className="object-editor-grid object-editor-timing">
          <label>Starts<input required type={draft.isAllDay ? "date" : "datetime-local"} value={draft.isAllDay ? draft.startsAt.slice(0, 10) : draft.startsAt} onChange={(change) => {
            const startsAt = draft.isAllDay ? change.target.value + "T00:00" : change.target.value;
            const timing = draft.isAllDay
              ? { startsAt }
              : updateEventTiming(draft, "start", startsAt);
            setDraft({
              ...draft,
              ...timing,
              ...(!draft.recurrence.enabled ? { recurrence: recurrenceDraft(null, startsAt.slice(0, 10)) } : {}),
            });
          }} /></label>
          {!draft.isAllDay && <label><span>Duration <span className="field-hint">HH:MM</span></span><input className="duration-input" type="text" inputMode="numeric" autoComplete="off" placeholder="01:00" pattern="\d{1,4}:[0-5]\d" maxLength={7} aria-label="Event duration in hours and minutes" value={draft.duration} onChange={(change) => setDraft({ ...draft, ...updateEventTiming(draft, "duration", change.target.value) })} /></label>}
          <label>Ends<input type={draft.isAllDay ? "date" : "datetime-local"} min={draft.isAllDay ? undefined : draft.startsAt} value={draft.isAllDay ? draft.endsAt.slice(0, 10) : draft.endsAt} onChange={(change) => {
            const endsAt = draft.isAllDay && change.target.value ? change.target.value + "T00:00" : change.target.value;
            setDraft(draft.isAllDay
              ? { ...draft, endsAt }
              : { ...draft, ...updateEventTiming(draft, "end", endsAt) });
          }} /></label>
        </div>
        <label>Location<input maxLength={1000} value={draft.location} onChange={(change) => setDraft({ ...draft, location: change.target.value })} /></label>
        <label>Description<textarea rows={4} value={draft.description} onChange={(change) => setDraft({ ...draft, description: change.target.value })} /></label>
        <label>Planning prompt<textarea rows={3} maxLength={10_000} value={draft.planningPromptText} onChange={(change) => setDraft({ ...draft, planningPromptText: change.target.value })} /></label>
        <RecurrenceEditor value={draft.recurrence} onChange={(recurrence) => setDraft({ ...draft, recurrence })} />
        <label>Status<select value={draft.status} onChange={(change) => setDraft({ ...draft, status: change.target.value })}><option value="active">Active</option><option value="archived">Archived</option></select></label>
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="object-editor-actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button><button className="button" disabled={!draft || saving}>{saving ? "Saving..." : creating ? "Add event" : "Save event"}</button></footer>
    </form>
  </EditorFrame>;
}

interface CalendarRoutineDraft {
  title: string;
  description: string;
  location: string;
  anchorDate: string;
  startTime: string;
  endTime: string;
  timeZone: string;
  isAllDay: boolean;
  recurrence: RecurrenceDraft;
  planningPromptText: string;
}

function calendarRoutineDraft(routine: CalendarRoutine): CalendarRoutineDraft {
  const startsAt = localDateTimeValue(routine.startsAtUtc);
  const endsAt = localDateTimeValue(routine.endsAtUtc);
  return {
    title: routine.title,
    description: routine.description || "",
    location: routine.location || "",
    anchorDate: startsAt.slice(0, 10),
    startTime: startsAt.slice(11, 16) || "09:00",
    endTime: endsAt.slice(11, 16),
    timeZone: routine.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    isAllDay: routine.isAllDay,
    recurrence: recurrenceDraft(routine.recurrenceRule, startsAt.slice(0, 10), true),
    planningPromptText: routine.planningPromptText || "",
  };
}

function newCalendarRoutineDraft(): CalendarRoutineDraft {
  const anchorDate = localDateTimeValue(new Date().toISOString()).slice(0, 10);
  return {
    title: "",
    description: "",
    location: "",
    anchorDate,
    startTime: "09:00",
    endTime: "10:00",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    isAllDay: false,
    recurrence: recurrenceDraft("FREQ=WEEKLY", anchorDate, true),
    planningPromptText: "",
  };
}

function routineStartIso(draft: CalendarRoutineDraft) {
  return localDateTimeIso(`${draft.anchorDate}T${draft.isAllDay ? "00:00" : draft.startTime}`);
}

function routineEndIso(draft: CalendarRoutineDraft) {
  if (draft.isAllDay) {
    const end = new Date(`${draft.anchorDate}T00:00`);
    end.setDate(end.getDate() + 1);
    return end.toISOString();
  }
  if (!draft.endTime) return null;
  const end = new Date(`${draft.anchorDate}T${draft.endTime}`);
  if (draft.endTime <= draft.startTime) end.setDate(end.getDate() + 1);
  return end.toISOString();
}

export function CalendarRoutineEditor({ routineId, onClose, onChanged }: {
  routineId?: number;
  onClose: () => void;
  onChanged: Changed;
}) {
  const creating = routineId == null;
  const [routine, setRoutine] = useState<CalendarRoutine | null>(null);
  const [draft, setDraft] = useState<CalendarRoutineDraft | null>(() => creating ? newCalendarRoutineDraft() : null);
  const [loading, setLoading] = useState(!creating);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (routineId == null) return;
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
    if (!draft || (!creating && !routine)) return;
    setSaving(true);
    setError("");
    try {
      await api(creating ? "/api/calendar-routines" : `/api/calendar-routines/${routineId}`, {
        method: creating ? "POST" : "PATCH",
        body: JSON.stringify({
          ...(!creating && routine ? { version: routine.version } : {}),
          title: draft.title,
          description: draft.description,
          location: draft.location,
          startsAtUtc: routineStartIso(draft),
          endsAtUtc: routineEndIso(draft),
          timeZone: draft.timeZone,
          isAllDay: draft.isAllDay,
          recurrenceRule: buildRecurrenceRule(draft.recurrence, true),
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

  const deleteRoutine = async () => {
    if (creating || routineId == null || !routine) return;
    if (!window.confirm(`Delete “${routine.title}” routine? Existing calendar events will stay, but no new events can be generated from this routine.`)) return;
    setDeleting(true);
    setError("");
    try {
      await api(`/api/calendar-routines/${routineId}`, {
        method: "PATCH",
        body: JSON.stringify({ version: routine.version, disabled: true }),
      });
      await onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeleting(false);
    }
  };

  return <EditorFrame title={creating ? "Add calendar routine" : "Edit calendar routine"} onClose={onClose}>
    <form onSubmit={(submitEvent) => void save(submitEvent)}>
      <header className="object-editor-heading"><div><p className="eyebrow">Routine</p><h2>{creating ? "Add routine" : "Edit routine"}</h2></div><button className="button button--quiet" type="button" onClick={onClose}>Close</button></header>
      {loading && <p className="object-editor-state">Loading current routine...</p>}
      {draft && <>
        <p className="object-editor-note">{creating ? "Set the time and repeat pattern. You can generate calendar events after saving." : "Changes affect future generated events. Events already placed on the calendar stay unchanged."}</p>
        <label>Title<input autoFocus required maxLength={500} value={draft.title} onChange={(change) => setDraft({ ...draft, title: change.target.value })} /></label>
        <label className="object-editor-check"><input type="checkbox" checked={draft.isAllDay} onChange={(change) => setDraft({ ...draft, isAllDay: change.target.checked })} /><span>All day</span></label>
        {!draft.isAllDay && <div className="object-editor-grid">
          <label>Starts at<input required type="time" value={draft.startTime} onChange={(change) => setDraft({ ...draft, startTime: change.target.value })} /></label>
          <label>Ends at<input type="time" value={draft.endTime} onChange={(change) => setDraft({ ...draft, endTime: change.target.value })} /></label>
        </div>}
        <label>Time zone<input required maxLength={100} value={draft.timeZone} onChange={(change) => setDraft({ ...draft, timeZone: change.target.value })} /></label>
        <label>Location<input maxLength={1000} value={draft.location} onChange={(change) => setDraft({ ...draft, location: change.target.value })} /></label>
        <label>Description<textarea rows={4} maxLength={10_000} value={draft.description} onChange={(change) => setDraft({ ...draft, description: change.target.value })} /></label>
        <label>Planning prompt<textarea rows={3} maxLength={10_000} value={draft.planningPromptText} onChange={(change) => setDraft({ ...draft, planningPromptText: change.target.value })} /></label>
        <RecurrenceEditor required showEnding={false} value={draft.recurrence} onChange={(recurrence) => setDraft({ ...draft, recurrence })} />
      </>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="object-editor-actions">
        {!creating && <button className="button button--danger" type="button" disabled={!routine || saving || deleting} onClick={() => void deleteRoutine()}>{deleting ? "Deleting..." : "Delete routine"}</button>}
        <button className="button button--quiet" type="button" disabled={saving || deleting} onClick={onClose}>Cancel</button>
        <button className="button" disabled={!draft || saving || deleting}>{saving ? "Saving..." : creating ? "Add routine" : "Save routine"}</button>
      </footer>
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
  return <>
    <FirstClassObjectCard
      mode="compact"
      className="routine-agenda-item"
      object={{
        type: "calendar.routine", label: "Calendar routine", display: routine.title,
        body: routine.description,
        attributes: [
          { label: "When", value: timeLabel },
          ...(routine.location ? [{ label: "Where", value: routine.location }] : []),
          { label: "Repeats", value: routine.recurrenceRule },
        ],
        badges: [routine.disabledAtUtc ? "Disabled" : "Active"],
      }}
      onOpen={editable ? () => setEditing(true) : undefined}
      openLabel="Edit routine"
      controls={onReference ? <AgentReferenceButton identity={calendarRoutineIdentity(routine)} subject={`calendar routine ${routine.title}`} onReference={onReference} /> : undefined}
    />
    {editing && onChanged && <CalendarRoutineEditor routineId={id} onClose={() => setEditing(false)} onChanged={onChanged} />}
  </>;
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
  return <li>
    <time>{timeLabel}</time>
    <FirstClassObjectCard
      mode="compact"
      className="timeline-event-item"
      object={{
        type: "calendar.event", label: "Calendar event", display: event.title,
        body: event.description,
        attributes: [
          ...(event.location ? [{ label: "Where", value: event.location }] : []),
          ...(event.status ? [{ label: "Status", value: event.status }] : []),
        ],
        badges: event.seriesId ? ["Recurring"] : [],
      }}
      onOpen={editable ? () => setEditing(true) : undefined}
      openLabel={event.seriesId ? "Edit this recurring event series" : generatedReadOnly ? "This event is managed by its source record" : "Edit event"}
      controls={onReference && Number.isSafeInteger(eventId) && eventId > 0 ? <AgentReferenceButton identity={calendarEventIdentity(event, timeZone)} subject={`calendar event ${event.title}`} onReference={onReference} /> : undefined}
    />
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

export async function toggleTodoCompletion(id: number) {
  const { todo: current } = await api<{ todo: Entity }>(`/api/todos/${id}`);
  await api(`/api/todos/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      version: current.version,
      status: current.status === "complete" ? "todo" : "complete",
    }),
  });
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

export function TodoEditor({ todoId: id, suppliedGroups, onClose, onChanged }: {
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

export function TodoItem({
  todo, groups, eventTitles, variant = "row", onChanged, onReference,
  selected = false, onSelectionChange,
}: {
  todo: Entity | LinkedTodo;
  groups?: Entity[];
  eventTitles?: string[];
  variant?: "row" | "scheduled";
  onChanged?: Changed;
  onReference?: AddAgentReference;
  selected?: boolean;
  onSelectionChange?: (selected: boolean) => void;
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
  const completedAtUtc = complete && typeof todo.completedAtUtc === "string" ? todo.completedAtUtc : null;
  const editable = Boolean(onChanged && Number.isSafeInteger(id) && id > 0);
  const sequence = variant === "row" && todo.sequence != null ? String(todo.sequence) : null;

  const toggle = async () => {
    if (!onChanged || !editable) return;
    setUpdating(true);
    setError("");
    try {
      await toggleTodoCompletion(id);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setUpdating(false);
    }
  };

  const leading = <>
    {onSelectionChange && <input
      className="todo-select"
      type="checkbox"
      checked={selected}
      onChange={(event) => onSelectionChange(event.target.checked)}
      aria-label={`Select ${text} for Agent reference`}
    />}
    {editable
      ? <button className={`todo-check${complete ? "" : " todo-check--mark-complete"}`} type="button" disabled={updating} onClick={() => void toggle()} aria-label={`Mark ${text} ${complete ? "open" : "complete"}`}>{complete ? "✓" : <><span>Mark</span><span>complete</span></>}</button>
      : <span className={`paper-checkbox ${complete ? "is-complete" : ""}`} aria-hidden="true">{complete ? "✓" : ""}</span>}
    {sequence && <span className="todo-sequence" aria-label={`Sequence ${sequence}`}>#{sequence}</span>}
  </>;
  const card = <FirstClassObjectCard
    as={variant === "scheduled" ? "li" : "article"}
    mode={variant === "scheduled" ? "compact" : "full"}
    className={`${variant === "scheduled" ? "scheduled-todo-card" : "todo-object-card"}${complete ? " is-complete" : ""}${onSelectionChange ? " is-selectable" : ""}`}
    object={{
      type: "todos.personal_task", label: "To-do", display: text,
      attributes: [
        ...(completedAtUtc ? [{ label: "Completed", value: formatDisplayDate(completedAtUtc, { includeTime: false }) }] : []),
        ...(billable ? [{ label: "Billable", value: billable }] : []),
        ...(eventTitles?.length ? [{ label: "For", value: eventTitles.join(", ") }] : []),
      ],
      badges: variant === "row" ? [status.replaceAll("_", " ")] : [],
    }}
    leading={<div className="todo-card-leading">{leading}</div>}
    onOpen={editable ? () => setEditing(true) : undefined}
    openLabel="Edit to-do"
    controls={onReference ? <AgentReferenceButton identity={todoIdentity(todo)} subject={`task ${text}`} onReference={onReference} /> : undefined}
    details={error ? <p className="inline-error todo-item-error" role="alert">{error}</p> : undefined}
  />;
  return <>
    {card}
    {editing && onChanged && <TodoEditor todoId={id} suppliedGroups={groups} onClose={() => setEditing(false)} onChanged={onChanged} />}
  </>;
}
