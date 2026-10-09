import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

export function VideoScriptCard(props: ObjectCardProps) {
  return <SimpleObjectCard {...props} className={`video-script-card${props.className ? ` ${props.className}` : ""}`} />;
}
