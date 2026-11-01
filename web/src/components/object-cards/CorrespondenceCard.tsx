import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

export function CorrespondenceCard(props: ObjectCardProps) {
  return <SimpleObjectCard {...props} className={`correspondence-card${props.className ? ` ${props.className}` : ""}`} />;
}
