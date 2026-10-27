import type { CalendarRoutine } from "../../types";
import { calendarEventTiming } from "./CalendarEventCard";
import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

export function CalendarRoutineCard(props: ObjectCardProps & {
  routine?: CalendarRoutine;
  timeZone?: string;
}) {
  const timing = props.routine ? calendarEventTiming(props.routine, props.timeZone) : null;
  return <SimpleObjectCard
    {...props}
    defaultExpanded={props.defaultExpanded ?? true}
    className={`calendar-routine-card${props.className ? ` ${props.className}` : ""}`}
    topEdge={timing ? <time className="calendar-event-time calendar-event-time--start" dateTime={props.routine!.startsAtUtc}>
      <strong>{timing.start}</strong><span>{props.routine!.isAllDay ? "All day" : "Start"}</span>
    </time> : props.topEdge}
    bottomEdge={timing?.end ? <time className="calendar-event-time calendar-event-time--end" dateTime={props.routine!.endsAtUtc!}>
      <strong>{timing.end}</strong><span>End</span>
    </time> : props.bottomEdge}
    stackEdges
    actions={[...(props.onEdit ? [{ key: "edit", label: "Edit", onClick: props.onEdit }] : []), ...(props.actions || [])]}
  />;
}
