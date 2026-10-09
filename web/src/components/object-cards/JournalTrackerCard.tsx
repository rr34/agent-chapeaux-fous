import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

export function JournalTrackerCard(props: ObjectCardProps) {
  return <SimpleObjectCard {...props} className={`journal-tracker-card${props.className ? ` ${props.className}` : ""}`} />;
}
