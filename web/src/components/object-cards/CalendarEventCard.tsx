import { formatDisplayTime } from "../../date-format";
import { SimpleObjectCard } from "./SimpleObjectCard";
import type { CalendarEvent } from "../../types";
import type { ObjectCardProps } from "./types";
import { MilestoneTimer } from "../MilestoneTimer";

function localDate(value: string, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value)).map(({ type, value: part }) => [type, part]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shortDate(value: string, timeZone: string, includeYear: boolean) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone, day: "numeric", month: "short", ...(includeYear ? { year: "numeric" } : {}),
  }).format(new Date(value));
}

export function calendarEventTiming(event: CalendarEvent, displayTimeZone?: string) {
  const timeZone = displayTimeZone || event.timeZone || "UTC";
  if (!event.endsAtUtc) {
    return {
      start: event.isAllDay ? shortDate(event.startsAtUtc, timeZone, false) : formatDisplayTime(event.startsAtUtc, timeZone),
      end: null,
      spansDays: false,
    };
  }
  const startDate = localDate(event.startsAtUtc, timeZone);
  const inclusiveEnd = event.isAllDay
    ? new Date(Math.max(Date.parse(event.startsAtUtc), Date.parse(event.endsAtUtc) - 1)).toISOString()
    : event.endsAtUtc;
  const endDate = localDate(inclusiveEnd, timeZone);
  const spansDays = startDate !== endDate;
  const crossesYear = startDate.slice(0, 4) !== endDate.slice(0, 4);
  if (event.isAllDay) return {
    start: shortDate(event.startsAtUtc, timeZone, crossesYear),
    end: spansDays ? shortDate(inclusiveEnd, timeZone, crossesYear) : null,
    spansDays,
  };
  const startTime = formatDisplayTime(event.startsAtUtc, timeZone);
  const endTime = formatDisplayTime(event.endsAtUtc, timeZone);
  return {
    start: spansDays ? `${shortDate(event.startsAtUtc, timeZone, crossesYear)} · ${startTime}` : startTime,
    end: spansDays ? `${shortDate(event.endsAtUtc, timeZone, crossesYear)} · ${endTime}` : endTime,
    spansDays,
  };
}

export function calendarEventCardObject(event: CalendarEvent): ObjectCardProps["object"] {
  return {
    id: event.seriesId ?? event.id,
    type: "calendar.event",
    label: "Calendar event",
    display: event.title,
    body: event.description,
    attributes: [
      ...(event.location ? [{ label: "Where", value: event.location }] : []),
      ...(event.status ? [{ label: "Status", value: event.status }] : []),
    ],
    badges: event.seriesId ? ["Recurring"] : [],
  };
}

export function CalendarEventCard(props: ObjectCardProps & {
  event?: CalendarEvent;
  timeZone?: string;
}) {
  const { event } = props;
  const timing = event ? calendarEventTiming(event, props.timeZone) : null;
  const linkedContacts = event?.linkedContacts || [];
  const eventDetails = event && (linkedContacts.length || event.milestoneMode)
    ? <div className="calendar-event-expanded-details">
      {event.milestoneMode && <section><h4>Milestone</h4><MilestoneTimer event={event} /></section>}
      {linkedContacts.length > 0 && <section>
        <h4>Contacts</h4>
        <ul>{linkedContacts.map((contact) => <li key={`${contact.contactId}-${contact.participantRole || "other"}`}>
          <strong>{contact.displayName}</strong>
          {contact.participantRole && <span>{contact.participantRole.replaceAll("_", " ")}</span>}
        </li>)}</ul>
      </section>}
    </div>
    : null;
  const details = eventDetails || props.details ? <>{eventDetails}{props.details}</> : undefined;
  return <SimpleObjectCard
    {...props}
    object={props.object}
    className={`calendar-event-card${props.className ? ` ${props.className}` : ""}`}
    topEdge={timing ? <time className="calendar-event-time calendar-event-time--start" dateTime={event!.startsAtUtc}>
      <strong>{timing.start}</strong><span>{event!.isAllDay ? "All day" : !event!.endsAtUtc ? "Time" : "Start"}</span>
    </time> : props.topEdge}
    bottomEdge={timing?.end ? <time className="calendar-event-time calendar-event-time--end" dateTime={event!.endsAtUtc!}>
      <strong>{timing.end}</strong><span>End</span>
    </time> : props.bottomEdge}
    details={details}
    detailsInContent
    stackEdges
    actions={[...(props.onEdit ? [{ key: "edit", label: "Edit", onClick: props.onEdit }] : []), ...(props.actions || [])]}
  />;
}
