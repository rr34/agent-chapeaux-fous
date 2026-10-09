import { SimpleObjectCard } from "./SimpleObjectCard";
import { attributeValue, type ObjectCardProps } from "./types";

export function TodoCard(props: ObjectCardProps) {
  const status = attributeValue(props.object, "Status") || props.object.badges?.[0] || "todo";
  const complete = status === "complete";
  const object = {
    ...props.object,
    badges: [status.replaceAll("_", " ")],
    attributes: props.object.attributes?.map((attribute) => attribute.label === "Sequence"
      ? { ...attribute, value: attribute.value.startsWith("#") ? attribute.value : `#${attribute.value}` }
      : attribute),
  };
  const toggle = props.onToggleComplete ? <button
    className={`todo-check${complete ? "" : " todo-check--mark-complete"}`}
    type="button"
    disabled={props.busy}
    onClick={props.onToggleComplete}
    aria-label={`Mark ${props.object.display} ${complete ? "open" : "complete"}`}
  >{complete ? "✓" : <><span>Mark</span><span>complete</span></>}</button> : null;
  const leading = toggle || props.leading ? <div className="todo-domain-leading">{props.leading}{toggle}</div> : undefined;
  return <SimpleObjectCard
    {...props}
    object={object}
    className={`todo-card${complete ? " is-complete" : ""}${props.className ? ` ${props.className}` : ""}`}
    leading={leading}
    actions={[...(props.onEdit ? [{ key: "edit", label: "Edit", onClick: props.onEdit }] : []), ...(props.actions || [])]}
  />;
}
