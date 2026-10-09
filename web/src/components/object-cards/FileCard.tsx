import { SimpleObjectCard } from "./SimpleObjectCard";
import type { ObjectCardProps } from "./types";

export function FileCard(props: ObjectCardProps) {
  return <SimpleObjectCard
    {...props}
    className={`file-card${props.className ? ` ${props.className}` : ""}`}
    actions={[...(props.onDownload ? [{ key: "download", label: "Download", onClick: props.onDownload }] : []), ...(props.actions || [])]}
  />;
}
