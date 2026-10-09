import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

export function InvoiceCard(props: ObjectCardProps) {
  return <SimpleObjectCard
    {...props}
    className={`invoice-card${props.className ? ` ${props.className}` : ""}`}
    actions={[...(props.onEdit ? [{ key: "edit", label: "View invoice", onClick: props.onEdit }] : []), ...(props.actions || [])]}
  />;
}
