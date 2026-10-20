import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

export function PhysicalItemCard(props: ObjectCardProps) {
  return <SimpleObjectCard
    {...props}
    className={`physical-item-card${props.className ? ` ${props.className}` : ""}`}
    actions={[...(props.onEdit ? [{ key: "edit", label: "Edit", onClick: props.onEdit }] : []), ...(props.actions || [])]}
  />;
}
