import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";
export function TodoGroupCard(props: ObjectCardProps) { return <SimpleObjectCard {...props} className={`todo-group-card${props.className ? ` ${props.className}` : ""}`} />; }
