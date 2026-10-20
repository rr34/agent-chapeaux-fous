import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  durationMinutes, formatDurationClock, parseDurationClock, updateEventTiming,
} from "../../../public/event-date-time.js";
import { api } from "../api";
import { formatDisplayDate } from "../date-format";
import type { CalendarEvent, CalendarRoutine, Entity, LinkedTodo } from "../types";
import {
  ObjectSelectionControls, calendarEventIdentity, calendarRoutineIdentity, todoIdentity,
} from "./ObjectSelectionControls";
import {
  buildRecurrenceRule, RecurrenceEditor, recurrenceDraft, type RecurrenceDraft,
} from "./RecurrenceEditor";
import { CalendarEventCard, calendarEventCardObject } from "./object-cards/CalendarEventCard";
import { CalendarRoutineCard } from "./object-cards/CalendarRoutineCard";
import { TodoCard } from "./object-cards/TodoCard";

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

function newContactDraft(): ContactDraft {
  return {
    kind: "person",
    displayName: "",
    givenName: "",
    familyName: "",
    organizationName: "",
    status: "active",
    birthDate: "",
    notes: "",
    methods: [],
    tags: [],
  };
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
  contactId?: number;
  onClose: () => void;
  onChanged: Changed;
}) {
  const creating = contactId == null;
  const [contact, setContact] = useState<Entity | null>(null);
  const [draft, setDraft] = useState<ContactDraft | null>(() => creating ? newContactDraft() : null);
  const [loading, setLoading] = useState(!creating);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (contactId == null) return;
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
    if (!draft || (!creating && !contact)) return;
    setSaving(true);
    setError("");
    try {
      await api(creating ? "/api/contacts" : `/api/contacts/${contactId}`, {
        method: creating ? "POST" : "PATCH",
        body: JSON.stringify({ ...(!creating && contact ? { version: contact.version } : {}), ...draft }),
      });
      await onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return <EditorFrame title={creating ? "Add contact" : "Edit contact"} onClose={onClose}>
    <form onSubmit={(submitEvent) => void save(submitEvent)}>
      <header className="object-editor-heading"><div><p className="eyebrow">Contacts</p><h2>{creating ? "Add contact" : "Edit contact"}</h2></div><button className="button button--quiet" type="button" onClick={onClose}>Close</button></header>
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
      <footer className="object-editor-actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button><button className="button" disabled={!draft || saving}>{saving ? "Saving..." : creating ? "Add contact" : "Save contact"}</button></footer>
    </form>
  </EditorFrame>;
}

interface LibraryContentDraft {
  groupId: string;
  sequence: string;
  contentType: string;
  title: string;
  transcript: string;
  description: string;
  publishedAt: string;
  contentHost: string;
  contentStatus: string;
  contentUrl: string;
}

function libraryContentDraft(
  content: Entity | undefined,
  groups: Entity[],
  initialGroupId?: number,
): LibraryContentDraft {
  const requestedGroupId = content?.groupId ?? initialGroupId;
  const groupId = groups.some((group) => String(group.id) === String(requestedGroupId))
    ? String(requestedGroupId)
    : String(groups[0]?.id ?? "");
  return {
    groupId,
    sequence: content?.sequence == null ? "" : String(content.sequence),
    contentType: String(content?.contentType || "mobileUGC_tutorial"),
    title: String(content?.title || ""),
    transcript: String(content?.transcript || ""),
    description: String(content?.description || ""),
    publishedAt: localDateTimeValue(String(content?.publishedAtUtc || new Date().toISOString())),
    contentHost: String(content?.contentHost || "youtube"),
    contentStatus: String(content?.contentStatus || "active"),
    contentUrl: String(content?.contentUrl || ""),
  };
}

export function LibraryContentEditor({ content, groups, initialGroupId, onClose, onChanged }: {
  content?: Entity;
  groups: Entity[];
  initialGroupId?: number;
  onClose: () => void;
  onChanged: Changed;
}) {
  const creating = content == null;
  const [draft, setDraft] = useState(() => libraryContentDraft(content, groups, initialGroupId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selectedGroup = groups.find((group) => String(group.id) === draft.groupId);

  useEffect(() => {
    if (!groups.length || groups.some((group) => String(group.id) === draft.groupId)) return;
    setDraft((current) => ({ ...current, groupId: String(groups[0].id) }));
  }, [draft.groupId, groups]);

  const save = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...(!creating ? { version: String(content.version || "") } : {}),
        groupId: Number(draft.groupId),
        sequence: draft.sequence ? Number(draft.sequence) : null,
        contentType: draft.contentType,
        title: draft.title,
        transcript: draft.transcript || null,
        description: draft.description || null,
        publishedAtUtc: localDateTimeIso(draft.publishedAt),
        contentHost: draft.contentHost,
        contentStatus: draft.contentStatus,
        contentUrl: draft.contentUrl || null,
      };
      await api(creating ? "/api/content-items" : `/api/content-items/${Number(content.id)}`, {
        method: creating ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      });
      await onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  };

  return <EditorFrame title={creating ? "Add content" : "Edit content"} onClose={onClose}>
    <form onSubmit={(submitEvent) => void save(submitEvent)}>
      <header className="object-editor-heading"><div><p className="eyebrow">Library</p><h2>{creating ? "Add content" : "Edit content"}</h2></div><button className="button button--quiet" type="button" onClick={onClose}>Close</button></header>
      <label>Title<input autoFocus required maxLength={10_000} value={draft.title} onChange={(change) => setDraft({ ...draft, title: change.target.value })} /></label>
      <div className="object-editor-grid">
        <label>Group<select required value={draft.groupId} onChange={(change) => setDraft({ ...draft, groupId: change.target.value })}>
          {groups.map((group) => <option value={String(group.id)} key={String(group.id)}>{String(group.name || "Untitled group")}</option>)}
        </select></label>
        <label>Sequence<input type="number" min="1" step="1" value={draft.sequence} onChange={(change) => setDraft({ ...draft, sequence: change.target.value })} /><span className="field-hint">{selectedGroup?.usesSequence ? "Assigned the next unique number when left blank." : "Optional while automatic sequencing is disabled for this group."}</span></label>
        <label>Type<select value={draft.contentType} onChange={(change) => setDraft({ ...draft, contentType: change.target.value })}>
          <option value="mobileUGC_tutorial">Mobile UGC tutorial</option><option value="mobileUGC_ad">Mobile UGC ad</option><option value="webUGC_tutorial">Web UGC tutorial</option><option value="webUGC_ad">Web UGC ad</option><option value="video_ad">Video ad</option><option value="podcast">Podcast</option><option value="image">Image</option><option value="unknown">Unknown</option>
        </select></label>
        <label>Status<select value={draft.contentStatus} onChange={(change) => setDraft({ ...draft, contentStatus: change.target.value })}>
          <option value="active">Active</option><option value="queued">Queued</option><option value="obsolete">Obsolete</option><option value="unused">Unused</option>
        </select></label>
        <label>Host<select value={draft.contentHost} onChange={(change) => setDraft({ ...draft, contentHost: change.target.value })}>
          <option value="youtube">YouTube</option><option value="vimeo">Vimeo</option><option value="spotify">Spotify</option><option value="mytlomdotcom">mytlom.com</option><option value="none">None</option>
        </select></label>
        <label>Published<input required type="datetime-local" step="60" value={draft.publishedAt} onChange={(change) => setDraft({ ...draft, publishedAt: change.target.value })} /></label>
      </div>
      <label>URL<input type="url" maxLength={2048} placeholder="https://…" value={draft.contentUrl} onChange={(change) => setDraft({ ...draft, contentUrl: change.target.value })} /></label>
      <label>Description<textarea rows={5} value={draft.description} onChange={(change) => setDraft({ ...draft, description: change.target.value })} /></label>
      <label>Transcript<textarea rows={10} value={draft.transcript} onChange={(change) => setDraft({ ...draft, transcript: change.target.value })} /></label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {!groups.length && <p className="inline-error" role="alert">Create a library group before adding content.</p>}
      <footer className="object-editor-actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button><button className="button" disabled={saving || !groups.length}>{saving ? "Saving..." : creating ? "Add content" : "Save content"}</button></footer>
    </form>
  </EditorFrame>;
}

interface PhysicalItemDraft {
  groupId: string;
  name: string;
  description: string;
  personalNotes: string;
  quantity: string;
  location: string;
  condition: string;
  status: string;
  manufacturer: string;
  modelNumber: string;
  serialNumber: string;
  acquiredOn: string;
}

function physicalItemDraft(item: Entity | undefined, groups: Entity[], initialGroupId?: number): PhysicalItemDraft {
  const requestedGroupId = item?.groupId ?? initialGroupId;
  return {
    groupId: String(groups.some((group) => String(group.id) === String(requestedGroupId)) ? requestedGroupId : groups[0]?.id ?? ""),
    name: String(item?.name || ""),
    description: String(item?.description || ""),
    personalNotes: String(item?.personalNotes || ""),
    quantity: String(item?.quantity || 1),
    location: String(item?.location || ""),
    condition: String(item?.condition || "unknown"),
    status: String(item?.status || "active"),
    manufacturer: String(item?.manufacturer || ""),
    modelNumber: String(item?.modelNumber || ""),
    serialNumber: String(item?.serialNumber || ""),
    acquiredOn: String(item?.acquiredOn || "").slice(0, 10),
  };
}

export function PhysicalItemEditor({ item, groups, initialGroupId, onClose, onChanged }: {
  item?: Entity;
  groups: Entity[];
  initialGroupId?: number;
  onClose: () => void;
  onChanged: Changed;
}) {
  const creating = item == null;
  const [draft, setDraft] = useState(() => physicalItemDraft(item, groups, initialGroupId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!groups.length || groups.some((group) => String(group.id) === draft.groupId)) return;
    setDraft((current) => ({ ...current, groupId: String(groups[0].id) }));
  }, [draft.groupId, groups]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(creating ? "/api/physical-items" : `/api/physical-items/${Number(item.id)}`, {
        method: creating ? "POST" : "PATCH",
        body: JSON.stringify({
          ...(!creating ? { version: Number(item.version) } : {}),
          groupId: Number(draft.groupId), name: draft.name, description: draft.description || null,
          personalNotes: draft.personalNotes || null, quantity: Number(draft.quantity),
          location: draft.location || null, condition: draft.condition, status: draft.status,
          manufacturer: draft.manufacturer || null, modelNumber: draft.modelNumber || null,
          serialNumber: draft.serialNumber || null, acquiredOn: draft.acquiredOn || null,
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
  return <EditorFrame title={creating ? "Add thing" : "Edit thing"} onClose={onClose}>
    <form onSubmit={(event) => void save(event)}>
      <header className="object-editor-heading"><div><p className="eyebrow">Things</p><h2>{creating ? "Add physical item" : "Edit physical item"}</h2></div><button className="button button--quiet" type="button" onClick={onClose}>Close</button></header>
      <label>Name<input autoFocus required maxLength={500} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <div className="object-editor-grid">
        <label>Group<select required value={draft.groupId} onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}>{groups.map((group) => <option key={String(group.id)} value={String(group.id)}>{String(group.name || "Untitled group")}</option>)}</select></label>
        <label>Quantity<input required type="number" min="1" step="1" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></label>
        <label>Condition<select value={draft.condition} onChange={(event) => setDraft({ ...draft, condition: event.target.value })}><option value="unknown">Unknown</option><option value="new">New</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="broken">Broken</option></select></label>
        <label>Status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="active">Active</option><option value="loaned">Loaned</option><option value="lost">Lost</option><option value="disposed">Disposed</option><option value="archived">Archived</option></select></label>
        <label>Location<input maxLength={1000} value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} /></label>
        <label>Acquired<input type="date" value={draft.acquiredOn} onChange={(event) => setDraft({ ...draft, acquiredOn: event.target.value })} /></label>
        <label>Manufacturer<input maxLength={500} value={draft.manufacturer} onChange={(event) => setDraft({ ...draft, manufacturer: event.target.value })} /></label>
        <label>Model<input maxLength={500} value={draft.modelNumber} onChange={(event) => setDraft({ ...draft, modelNumber: event.target.value })} /></label>
      </div>
      <label>Serial number<input maxLength={1000} value={draft.serialNumber} onChange={(event) => setDraft({ ...draft, serialNumber: event.target.value })} /></label>
      <label>Description<textarea rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
      <label>Personal notes<textarea rows={5} value={draft.personalNotes} onChange={(event) => setDraft({ ...draft, personalNotes: event.target.value })} /></label>
      {!groups.length && <p className="inline-error" role="alert">Create a Things group before adding a physical item.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer className="object-editor-actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button><button className="button" disabled={saving || !groups.length}>{saving ? "Saving..." : creating ? "Add thing" : "Save thing"}</button></footer>
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
  isPoint: boolean;
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
    isPoint: !event.isAllDay && !endsAt,
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
    endsAt: "",
    duration: "",
    isPoint: true,
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
    if (!draft.isAllDay && !draft.isPoint && !draft.endsAt) {
      setError("Enter an end time or choose Point in time.");
      return;
    }
    if (!draft.isAllDay && !draft.isPoint && draft.duration && parseDurationClock(draft.duration) === null) {
      setError("Use duration HH:MM, for example 01:30.");
      return;
    }
    const timedMinutes = !draft.isAllDay && !draft.isPoint && draft.endsAt
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
          endsAtUtc: !draft.isAllDay && draft.isPoint ? null : localDateTimeIso(draft.endsAt),
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
        <label>Event title<input autoFocus required maxLength={500} value={draft.title} onChange={(change) => setDraft({ ...draft, title: change.target.value })} /></label>
        <div className="object-editor-checks">
          <label className="object-editor-check"><input type="checkbox" checked={draft.isAllDay} onChange={(change) => {
            const isAllDay = change.target.checked;
            const timing = !isAllDay
              ? updateEventTiming(draft, "start", draft.startsAt)
              : draft;
            setDraft({ ...draft, ...timing, isAllDay, isPoint: isAllDay ? false : !timing.endsAt });
          }} /><span>All day</span></label>
          {!draft.isAllDay && <label className="object-editor-check"><input type="checkbox" checked={draft.isPoint} onChange={(change) => {
            const isPoint = change.target.checked;
            if (isPoint) {
              setDraft({ ...draft, isPoint, endsAt: "", duration: "" });
              return;
            }
            const duration = draft.duration || "01:00";
            setDraft({
              ...draft,
              ...updateEventTiming({ ...draft, duration }, "start", draft.startsAt),
              isPoint,
            });
          }} /><span>Point in time <span className="field-hint">Start only</span></span></label>}
        </div>
        <div className={`object-editor-grid object-editor-timing${draft.isPoint ? " object-editor-timing--point" : draft.isAllDay ? " object-editor-timing--all-day" : ""}`}>
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
          {!draft.isAllDay && !draft.isPoint && <label><span>Duration <span className="field-hint">HH:MM</span></span><input className="duration-input" type="text" inputMode="numeric" autoComplete="off" placeholder="01:00" pattern="\d{1,4}:[0-5]\d" maxLength={7} aria-label="Event duration in hours and minutes" value={draft.duration} onChange={(change) => setDraft({ ...draft, ...updateEventTiming(draft, "duration", change.target.value) })} /></label>}
          {!draft.isPoint && <label>Ends<input type={draft.isAllDay ? "date" : "datetime-local"} min={draft.isAllDay ? undefined : draft.startsAt} value={draft.isAllDay ? draft.endsAt.slice(0, 10) : draft.endsAt} onChange={(change) => {
            const endsAt = draft.isAllDay && change.target.value ? change.target.value + "T00:00" : change.target.value;
            setDraft(draft.isAllDay
              ? { ...draft, endsAt }
              : { ...draft, ...updateEventTiming(draft, "end", endsAt) });
          }} /></label>}
        </div>
        <label>Location<input maxLength={1000} value={draft.location} onChange={(change) => setDraft({ ...draft, location: change.target.value })} /></label>
        <label>Notes (optional)<textarea rows={4} value={draft.description} onChange={(change) => setDraft({ ...draft, description: change.target.value })} /></label>
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

export function CalendarRoutineItem({ routine, onChanged }: {
  routine: CalendarRoutine;
  onChanged?: Changed;
}) {
  const [editing, setEditing] = useState(false);
  const id = Number(routine.id);
  const editable = Boolean(onChanged && Number.isSafeInteger(id) && id > 0);
  return <>
    <CalendarRoutineCard
      routine={routine}
      mode="compact"
      object={{
        id, type: "calendar.routine", label: "Calendar routine", display: routine.title,
        body: routine.description,
        attributes: [
          ...(routine.location ? [{ label: "Where", value: routine.location }] : []),
          { label: "Repeats", value: routine.recurrenceRule },
        ],
        badges: [routine.disabledAtUtc ? "Disabled" : "Active"],
      }}
      onEdit={editable ? () => setEditing(true) : undefined}
      controls={<ObjectSelectionControls identity={calendarRoutineIdentity(routine)} subject={`calendar routine ${routine.title}`} />}
    />
    {editing && onChanged && <CalendarRoutineEditor routineId={id} onClose={() => setEditing(false)} onChanged={onChanged} />}
  </>;
}

export function CalendarEventItem({ event, timeZone, defaultExpanded = false, onChanged }: {
  event: CalendarEvent;
  timeZone: string;
  defaultExpanded?: boolean;
  onChanged?: Changed;
}) {
  const [editing, setEditing] = useState(false);
  const eventId = Number(event.seriesId ?? event.id);
  const generatedReadOnly = Boolean(event.readOnly && !event.seriesId);
  const editable = Boolean(onChanged && Number.isSafeInteger(eventId) && eventId > 0 && !generatedReadOnly);
  const linkedTodos = (event.linkedTodos || []).filter(({ status }) => status !== "complete");
  const linkedTodoDetails = linkedTodos.length > 0 ? <ul className="timeline-event-linked-todos" aria-label={`To-dos linked to ${event.title}`}>
    {linkedTodos.map((todo) => <TodoItem
      todo={todo}
      variant="scheduled"
      onChanged={onChanged}
      key={todo.todoId}
    />)}
  </ul> : undefined;
  return <li>
    <CalendarEventCard
      event={{ ...event, linkedTodos }}
      timeZone={timeZone}
      linkedTodoDetails={linkedTodoDetails}
      mode="compact"
      defaultExpanded={defaultExpanded}
      object={calendarEventCardObject(event)}
      onEdit={editable ? () => setEditing(true) : undefined}
      controls={Number.isSafeInteger(eventId) && eventId > 0 ? <ObjectSelectionControls identity={calendarEventIdentity(event, timeZone)} subject={`calendar event ${event.title}`} /> : undefined}
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

export function TodoEditor({ todoId: id, suppliedGroups, initialGroupId, onClose, onChanged }: {
  todoId?: number;
  suppliedGroups?: Entity[];
  initialGroupId?: number;
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
    const todoRequest = id == null
      ? Promise.resolve({ todo: null })
      : api<{ todo: Entity }>(`/api/todos/${id}`);
    void Promise.all([todoRequest, groupRequest]).then(([todoBody, groupBody]) => {
      if (!active) return;
      const current = todoBody.todo;
      setTodo(current);
      setGroups(groupBody.groups);
      const selectedGroup = groupBody.groups.find((group) => Number(group.id) === initialGroupId)
        ?? groupBody.groups.find((group) => String(group.name).toLowerCase() === "inbox")
        ?? groupBody.groups[0];
      setDraft({
        text: String(current?.text || ""),
        planningPromptText: String(current?.planningPromptText || ""),
        groupId: String(current?.groupId || selectedGroup?.id || ""),
        sequence: current?.sequence == null ? "" : String(current.sequence),
        status: String(current?.status || "todo"),
        billableAmount: current?.billableAmountMinor == null ? "" : String(
          Number(current.billableAmountMinor) / (10 ** currencyDigits(String(current.billableCurrency || "USD"))),
        ),
        billableCurrency: String(current?.billableCurrency || "USD"),
      });
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : String(caught));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [id, initialGroupId, suppliedGroups]);

  const save = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault();
    if (!draft || (id != null && !todo)) return;
    setSaving(true);
    setError("");
    try {
      const price = billableMinorUnits(draft.billableAmount, draft.billableCurrency);
      await api(id == null ? "/api/todos" : `/api/todos/${id}`, {
        method: id == null ? "POST" : "PATCH",
        body: JSON.stringify({
          ...(todo ? { version: todo.version } : {}),
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

  const editorTitle = id == null ? "New to-do" : "Edit to-do";
  return <EditorFrame title={editorTitle} onClose={onClose}>
    <form onSubmit={(submitEvent) => void save(submitEvent)}>
      <header className="object-editor-heading"><div><p className="eyebrow">Personal to-do</p><h2>{editorTitle}</h2></div><button className="button button--quiet" type="button" onClick={onClose}>Close</button></header>
      {loading && <p className="object-editor-state">{id == null ? "Preparing new to-do..." : "Loading current to-do..."}</p>}
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
      <footer className="object-editor-actions"><button className="button button--quiet" type="button" onClick={onClose}>Cancel</button><button className="button" disabled={!draft || saving}>{saving ? "Saving..." : id == null ? "Add to-do" : "Save to-do"}</button></footer>
    </form>
  </EditorFrame>;
}

export function TodoItem({
  todo, groups, eventTitles, variant = "row", cardControls, onChanged,
}: {
  todo: Entity | LinkedTodo;
  groups?: Entity[];
  eventTitles?: string[];
  variant?: "row" | "scheduled";
  cardControls?: ReactNode;
  onChanged?: Changed;
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
  const sequence = todo.sequence != null ? String(todo.sequence) : null;

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

  const card = <TodoCard
    as={variant === "scheduled" ? "li" : "article"}
    mode={variant === "scheduled" ? "compact" : "full"}
    object={{
      id, type: "todos.personal_task", label: "To-do", display: text,
      attributes: [
        { label: "Status", value: status },
        ...(sequence ? [{ label: "Sequence", value: `#${sequence}` }] : []),
        ...(completedAtUtc ? [{ label: "Completed", value: formatDisplayDate(completedAtUtc, { includeTime: false }) }] : []),
        ...(billable ? [{ label: "Billable", value: billable }] : []),
        ...(eventTitles?.length ? [{ label: "For", value: eventTitles.join(", ") }] : []),
      ],
    }}
    leading={!editable ? <span className={`paper-checkbox ${complete ? "is-complete" : ""}`} aria-hidden="true">{complete ? "✓" : ""}</span> : undefined}
    onToggleComplete={editable ? () => void toggle() : undefined}
    onEdit={editable ? () => setEditing(true) : undefined}
    busy={updating}
    controls={<><ObjectSelectionControls identity={todoIdentity(todo)} subject={`task ${text}`} />{cardControls}</>}
    compactDetails={variant === "scheduled" && todo.relationshipKind
      ? <span className="timeline-linked-todo-relationship">{String(todo.relationshipKind).replaceAll("_", " ")}</span>
      : undefined}
    details={error ? <p className="inline-error todo-item-error" role="alert">{error}</p> : undefined}
  />;
  return <>
    {card}
    {editing && onChanged && <TodoEditor todoId={id} suppliedGroups={groups} onClose={() => setEditing(false)} onChanged={onChanged} />}
  </>;
}
