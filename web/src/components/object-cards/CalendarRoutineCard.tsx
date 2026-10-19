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
    className={`calendar-routine-card${props.className ? ` ${props.className}` : ""}`}
    topEdge={timing ? <time className="calendar-event-time calendar-event-time--start" dateTime={props.routine!.startsAtUtc}>
      <span>Start</span><strong>{timing.start}</strong>
    </time> : props.topEdge}
    bottomEdge={timing?.end ? <time className="calendar-event-time calendar-event-time--end" dateTime={props.routine!.endsAtUtc!}>
      <span>End</span><strong>{timing.end}</strong>
    </time> : props.bottomEdge}
    actions={[...(props.onEdit ? [{ key: "edit", label: "Edit", onClick: props.onEdit }] : []), ...(props.actions || [])]}
  />;
}
