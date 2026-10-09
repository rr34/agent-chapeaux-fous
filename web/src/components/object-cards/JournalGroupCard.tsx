import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";
export function JournalGroupCard(props: ObjectCardProps) { return <SimpleObjectCard {...props} className={`journal-group-card${props.className ? ` ${props.className}` : ""}`} />; }
