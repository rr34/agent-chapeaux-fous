import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";
export function LibraryGroupCard(props: ObjectCardProps) { return <SimpleObjectCard {...props} className={`library-group-card${props.className ? ` ${props.className}` : ""}`} />; }
