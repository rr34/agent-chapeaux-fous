import type { CalendarEvent, Entity, LinkedTodo, RequestRecord } from "../types";
import { formatDisplayDate, formatDisplayTime } from "../date-format";

export type AddAgentReference = (identity: string, subject: string) => void;

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

export function AgentReferenceButton({ identity, subject, onReference }: {
  identity: string;
  subject: string;
  onReference: AddAgentReference;
}) {
  const label = `Reference ${subject} in Agent`;
  return <button
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
  </button>;
}

export function exchangeIdentity(request: RequestRecord) {
  return [
    `Exchange: ${concise(request.request || "Agent conversation")}`,
    referenceCode({ request_id: request.requestId }),
  ].join("\n");
}

export function calendarEventIdentity(event: CalendarEvent, timeZone?: string) {
  const eventId = event.seriesId ?? event.id;
  const numericEventId = Number(eventId);
  const codes: Record<string, unknown> = Number.isSafeInteger(numericEventId) && numericEventId > 0
    ? {
        calendar_event_id: numericEventId,
        ref: stableReference("calendar-events", numericEventId),
      }
    : { calendar_occurrence_id: eventId };
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
  return [
    `Calendar event: ${concise(event.title)}`,
    `When: ${when}`,
    event.location ? `Where: ${concise(event.location, 120)}` : null,
    referenceCode(codes),
  ].filter(Boolean).join("\n");
}

export function todoIdentity(todo: Entity | LinkedTodo) {
  const id = "todoId" in todo ? todo.todoId : todo.id;
  const title = "title" in todo && todo.title ? todo.title : String((todo as Entity).text || "Task");
  const groupName = "groupName" in todo ? todo.groupName : null;
  return [
    `Task: ${concise(title)}`,
    groupName ? `Group: ${concise(groupName, 80)}` : null,
    referenceCode({ personal_task_id: id, ref: stableReference("todos", id) }),
  ].filter(Boolean).join("\n");
}

export function contactIdentity(contact: Entity) {
  const name = String(contact.displayName || contact.name || "Contact");
  return [
    `Contact: ${concise(name)}`,
    contact.organizationName ? `Organization: ${concise(contact.organizationName, 120)}` : null,
    referenceCode({ contact_id: contact.id, ref: stableReference("contacts", contact.id) }),
  ].filter(Boolean).join("\n");
}

export type GenericObjectKind = "content" | "video-scripts" | "files" | "interactions";

const genericReferenceConfig: Record<GenericObjectKind, { label: string; idKey: string; collection: string }> = {
  content: { label: "Library item", idKey: "content_id", collection: "content-items" },
  "video-scripts": { label: "Video script", idKey: "video_script_id", collection: "video-scripts" },
  files: { label: "File", idKey: "file_id", collection: "files" },
  interactions: { label: "Briefing", idKey: "interaction_guide_id", collection: "interaction-guides" },
};

export function genericEntityIdentity(kind: GenericObjectKind, entity: Entity) {
  const config = genericReferenceConfig[kind];
  const id = entity.id ?? entity.fileId;
  const title = entity.title || entity.name || entity.originalFilename || `${config.label} ${id}`;
  return [
    `${config.label}: ${concise(title)}`,
    entity.groupName ? `Group: ${concise(entity.groupName, 80)}` : null,
    referenceCode({ [config.idKey]: id, ref: stableReference(config.collection, id) }),
  ].filter(Boolean).join("\n");
}

export function journalTrackerIdentity(tracker: Entity) {
  const name = tracker.name || tracker.title || `Tracker ${tracker.id}`;
  return [
    `Journal tracker: ${concise(name)}`,
    tracker.groupName ? `Group: ${concise(tracker.groupName, 80)}` : null,
    referenceCode({ tracker_id: tracker.id, ref: stableReference("journal-trackers", tracker.id) }),
  ].filter(Boolean).join("\n");
}

export function journalEntryIdentity(entry: Entity) {
  const content = entry.contentText || entry.text || entry.numberValue || "Journal entry";
  return [
    `Journal entry: ${concise(content)}`,
    entry.trackerName ? `Tracker: ${concise(entry.trackerName, 120)}` : null,
    referenceCode({ journal_entry_id: entry.id, ref: stableReference("journal-entries", entry.id) }),
  ].filter(Boolean).join("\n");
}

export function calendarRoutineIdentity(routine: Entity) {
  const title = routine.title || routine.name || `Calendar routine ${routine.id}`;
  return [
    `Calendar routine: ${concise(title)}`,
    referenceCode({ calendar_routine_id: routine.id, routine_ref: stableReference("calendar-routines", routine.id) }),
  ].join("\n");
}
