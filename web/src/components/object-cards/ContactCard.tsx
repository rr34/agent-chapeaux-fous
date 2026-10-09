import { SimpleObjectCard } from "./SimpleObjectCard";
import { attributeValue, type ObjectCardProps } from "./types";

export function ContactCard(props: ObjectCardProps) {
  const { object, onEdit } = props;
  const status = attributeValue(object, "Status") || object.badges?.find((badge) => ["inactive", "blocked", "deceased"].includes(badge));
  const inactive = Boolean(status && status !== "active");
  const actions = [
    ...(onEdit ? [{ key: "edit", label: "Edit", onClick: onEdit }] : []),
    ...(object.links || []).map((link) => ({ key: `${link.label}-${link.href}`, label: link.label, href: link.href })),
    ...(props.actions || []),
  ];
  return <SimpleObjectCard
    {...props}
    className={`contact-card${inactive ? " is-inactive" : ""}${props.className ? ` ${props.className}` : ""}`}
    leading={<div className="contact-monogram" aria-hidden="true">{object.display.slice(0, 2).toUpperCase()}</div>}
    actions={actions}
  />;
}
