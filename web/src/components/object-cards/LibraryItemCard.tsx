import { SimpleObjectCard } from "./SimpleObjectCard";
import { prominentObjectSequence } from "./ObjectCardSequence";
import type { ObjectCardProps } from "./types";

export function LibraryItemCard(props: ObjectCardProps) {
  const { object, marker: sequence } = prominentObjectSequence(props.object);
  const leading = sequence || props.leading
    ? <div className="library-item-card-leading">{sequence}{props.leading}</div>
    : undefined;
  return <SimpleObjectCard
    {...props}
    object={object}
    leading={leading}
    className={`library-item-card${props.className ? ` ${props.className}` : ""}`}
  />;
}
