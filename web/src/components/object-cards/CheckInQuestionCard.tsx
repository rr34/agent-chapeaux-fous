import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";
export function CheckInQuestionCard(props: ObjectCardProps) { return <SimpleObjectCard {...props} className={`check-in-question-card${props.className ? ` ${props.className}` : ""}`} />; }
