import type { CalendarEvent, Entity, LinkedTodo, RequestRecord, SelectedObjectCandidate } from "../types";
import { formatDisplayDate, formatDisplayTime } from "../date-format";
import { ObjectNetworkButton } from "./ObjectNetworkButton";

export type AddAgentReference = (identity: SelectedObjectCandidate, subject: string) => void;

function concise(value: unknown, maximum = 200) {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1).trimEnd()}…`;
}

function referenceCode(fields: Record<string, unknown>) {
  return `Reference code: ${Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("; ")}`;
}

function stableReference(collection: string, id: unknown) {
  return `agent-slayer://${collection}/${encodeURIComponent(String(id))}`;
}

function nativeReference({
  type, source, id, collection, label, display, detail,
}: {
  type: string;
  source: string;
  id: unknown;
  collection: string;
  label: string;
  display: unknown;
  detail: string;
}): SelectedObjectCandidate {
  const normalizedId = typeof id === "number" ? id : String(id);
  const title = concise(display, 160);
  return {
    mention: `@${title}`,
    type,
    source,
    id: normalizedId,
    ref: stableReference(collection, normalizedId),
    display: title,
    label,
    detail,
  };
}

export function AgentReferenceButton({ identity, subject, onReference }: {
  identity: SelectedObjectCandidate;
  subject: string;
  onReference: AddAgentReference;
}) {
  const label = `Reference ${subject} in Agent`;
  return <span className="object-reference-actions">
    <ObjectNetworkButton identity={identity} subject={subject} onReference={onReference} />
    <button
      className="agent-reference-button"
      type="button"
      title={label}
      aria-label={label}
      onClick={() => onReference(identity, subject)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 19c0-4.4-3.6-8-8-8H4" />
        <path d="m9 6-5 5 5 5" />
      </svg>
    </button>
  </span>;
}

export function exchangeIdentity(request: RequestRecord) {
  const display = `Exchange ${request.requestId.slice(0, 8)}`;
  const detail = [
    `Exchange: ${concise(request.request || "Agent conversation")}`,
    referenceCode({ request_id: request.requestId }),
  ].join("\n");
  return {
    ...nativeReference({
      type: "agent.exchange", source: "native:agent-ledger", id: request.requestId,
      collection: "requests", label: "Exchange", display, detail,
    }),
    referencedRequestId: request.requestId,
  };
}

export function calendarEventIdentity(event: CalendarEvent, timeZone?: string) {
  const eventId = event.seriesId ?? event.id;
  const numericEventId = Number(eventId);
  const codes: Record<string, unknown> = {
    calendar_event_id: numericEventId,
    ref: stableReference("calendar-events", numericEventId),
  };
  if (event.isGeneratedOccurrence) codes.occurrence_starts_at_utc = event.startsAtUtc;
  if (event.contactId != null) {
    codes.contact_id = event.contactId;
    codes.contact_ref = stableReference("contacts", event.contactId);
  }
  const zone = event.timeZone || timeZone || "UTC";
  const when = event.isAllDay
    ? formatDisplayDate(event.startsAtUtc, { includeTime: false, timeZone: zone })
    : event.endsAtUtc
      ? `${formatDisplayTime(event.startsAtUtc, zone)}–${formatDisplayTime(event.endsAtUtc, zone)}`
      : formatDisplayTime(event.startsAtUtc, zone);
  const detail = [
    `Calendar event: ${concise(event.title)}`,
    `When: ${when}`,
    event.location ? `Where: ${concise(event.location, 120)}` : null,
    referenceCode(codes),
  ].filter(Boolean).join("\n");
  return nativeReference({
    type: "calendar.event", source: "native:calendar", id: numericEventId,
    collection: "calendar-events", label: "Calendar event", display: event.title, detail,
  });
}

export function todoIdentity(todo: Entity | LinkedTodo) {
  const id = "todoId" in todo ? todo.todoId : todo.id;
  const title = "title" in todo && todo.title ? todo.title : String((todo as Entity).text || "Task");
  const groupName = "groupName" in todo ? todo.groupName : null;
  const detail = [
    `Task: ${concise(title)}`,
    groupName ? `Group: ${concise(groupName, 80)}` : null,
    referenceCode({ personal_task_id: id, ref: stableReference("todos", id) }),
  ].filter(Boolean).join("\n");
  return nativeReference({
    type: "todos.personal_task", source: "native:todos", id,
    collection: "todos", label: "To-do", display: title, detail,
  });
}

export function contactIdentity(contact: Entity) {
  const name = String(contact.displayName || contact.name || "Contact");
  const detail = [
    `Contact: ${concise(name)}`,
    contact.organizationName ? `Organization: ${concise(contact.organizationName, 120)}` : null,
    referenceCode({ contact_id: contact.id, ref: stableReference("contacts", contact.id) }),
  ].filter(Boolean).join("\n");
  return nativeReference({
    type: "contacts.contact", source: "native:contacts", id: contact.id,
    collection: "contacts", label: "Contact", display: name, detail,
  });
}

export type GenericObjectKind = "content" | "video-scripts" | "files";

const genericReferenceConfig: Record<GenericObjectKind, {
  label: string; idKey: string; collection: string; type: string; source: string;
}> = {
  content: {
    label: "Library item", idKey: "content_id", collection: "content-items",
    type: "video.content_item", source: "native:video",
  },
  "video-scripts": {
    label: "Video script", idKey: "video_script_id", collection: "video-scripts",
    type: "video.script", source: "native:video",
  },
  files: {
    label: "File", idKey: "file_id", collection: "files",
    type: "files.file", source: "native:files",
  },
};

export function genericEntityIdentity(kind: GenericObjectKind, entity: Entity) {
  const config = genericReferenceConfig[kind];
  const id = entity.id ?? entity.fileId;
  const title = entity.title || entity.name || entity.originalFilename || `${config.label} ${id}`;
  const detail = [
    `${config.label}: ${concise(title)}`,
    entity.groupName ? `Group: ${concise(entity.groupName, 80)}` : null,
    referenceCode({ [config.idKey]: id, ref: stableReference(config.collection, id) }),
  ].filter(Boolean).join("\n");
  return nativeReference({
    type: config.type, source: config.source, id, collection: config.collection,
    label: config.label, display: title, detail,
  });
}

export function journalTrackerIdentity(tracker: Entity) {
  const name = tracker.name || tracker.title || `Tracker ${tracker.id}`;
  const detail = [
    `Journal tracker: ${concise(name)}`,
    tracker.groupName ? `Group: ${concise(tracker.groupName, 80)}` : null,
    referenceCode({ tracker_id: tracker.id, ref: stableReference("journal-trackers", tracker.id) }),
  ].filter(Boolean).join("\n");
  return nativeReference({
    type: "journal.tracker", source: "native:journal", id: tracker.id,
    collection: "journal-trackers", label: "Journal tracker", display: name, detail,
  });
}

export function journalEntryIdentity(entry: Entity) {
  const content = entry.contentText || entry.text || entry.numberValue || "Journal entry";
  const detail = [
    `Journal entry: ${concise(content)}`,
    entry.trackerName ? `Tracker: ${concise(entry.trackerName, 120)}` : null,
    referenceCode({ journal_entry_id: entry.id, ref: stableReference("journal-entries", entry.id) }),
  ].filter(Boolean).join("\n");
  return nativeReference({
    type: "journal.entry", source: "native:journal", id: entry.id,
    collection: "journal-entries", label: "Journal entry", display: content, detail,
  });
}

export function calendarRoutineIdentity(routine: Entity) {
  const title = routine.title || routine.name || `Calendar routine ${routine.id}`;
  const detail = [
    `Calendar routine: ${concise(title)}`,
    referenceCode({ calendar_routine_id: routine.id, routine_ref: stableReference("calendar-routines", routine.id) }),
  ].join("\n");
  return nativeReference({
    type: "calendar.routine", source: "native:calendar", id: routine.id,
    collection: "calendar-routines", label: "Calendar routine", display: title, detail,
  });
}
