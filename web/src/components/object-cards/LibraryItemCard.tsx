import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

export function LibraryItemCard(props: ObjectCardProps) {
  return <SimpleObjectCard {...props} className={`library-item-card${props.className ? ` ${props.className}` : ""}`} />;
}
