import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

export function CalendarRoutineCard(props: ObjectCardProps) {
  return <SimpleObjectCard
    {...props}
    className={`calendar-routine-card${props.className ? ` ${props.className}` : ""}`}
    actions={[...(props.onEdit ? [{ key: "edit", label: "Edit", onClick: props.onEdit }] : []), ...(props.actions || [])]}
  />;
}
