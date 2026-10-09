import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

export function JournalEntryCard(props: ObjectCardProps) {
  return <SimpleObjectCard {...props} className={`journal-entry-card${props.className ? ` ${props.className}` : ""}`} />;
}
