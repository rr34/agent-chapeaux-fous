import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";
export function ProfileFactCard(props: ObjectCardProps) { return <SimpleObjectCard {...props} className={`profile-fact-card${props.className ? ` ${props.className}` : ""}`} />; }
