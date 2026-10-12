import type { ReactNode } from "react";
import { SimpleObjectCard } from "./SimpleObjectCard";
import type { CalendarEvent } from "../../types";
import type { ObjectCardProps } from "./types";

const planningLabels: Record<string, string> = {
  needs_planning: "Needs planning",
  deferred: "Planning deferred",
  planned: "Planned",
};

export function CalendarEventCard(props: ObjectCardProps & {
  event?: CalendarEvent;
  linkedTodoDetails?: ReactNode;
}) {
  const { event } = props;
  const planningLabel = event?.planningState ? planningLabels[event.planningState] : null;
  const linkedTodos = event?.linkedTodos || [];
  const linkedContacts = event?.linkedContacts || [];
  const todoCountLabel = linkedTodos.length
    ? `${linkedTodos.length} linked ${linkedTodos.length === 1 ? "to-do" : "to-dos"}`
    : null;
  const eventDetails = event && (event.planningPromptText || linkedContacts.length || linkedTodos.length)
    ? <div className="calendar-event-expanded-details">
      {linkedContacts.length > 0 && <section>
        <h4>Contacts</h4>
        <ul>{linkedContacts.map((contact) => <li key={`${contact.contactId}-${contact.participantRole || "other"}`}>
          <strong>{contact.displayName}</strong>
          {contact.participantRole && <span>{contact.participantRole.replaceAll("_", " ")}</span>}
        </li>)}</ul>
      </section>}
      {linkedTodos.length > 0 && <section>
        <h4>{todoCountLabel}</h4>
        {props.linkedTodoDetails || <ul>{linkedTodos.map((todo) => <li className={todo.status === "complete" ? "is-complete" : ""} key={todo.todoId}>
          <span aria-hidden="true">{todo.status === "complete" ? "☑" : "☐"}</span>
          <strong>{todo.text || todo.title || "Task"}</strong>
          {todo.relationshipKind && <span>{todo.relationshipKind.replaceAll("_", " ")}</span>}
        </li>)}</ul>}
      </section>}
      {event.planningPromptText && <section>
        <h4>Planning prompt</h4>
        <p>{event.planningPromptText}</p>
      </section>}
    </div>
    : null;
  const compactDetails = planningLabel || todoCountLabel
    ? <>
      {planningLabel && <span className={`pill calendar-planning-state ${event?.planningState || ""}`}>{planningLabel}</span>}
      {todoCountLabel && <span className="calendar-event-todo-count">{todoCountLabel}</span>}
    </>
    : null;
  const details = eventDetails || props.details ? <>{eventDetails}{props.details}</> : undefined;
  return <SimpleObjectCard
    {...props}
    object={{
      ...props.object,
      badges: [...(planningLabel ? [planningLabel] : []), ...(props.object.badges || [])],
    }}
    className={`calendar-event-card${props.className ? ` ${props.className}` : ""}`}
    compactDetails={compactDetails}
    details={details}
    actions={[...(props.onEdit ? [{ key: "edit", label: "Edit", onClick: props.onEdit }] : []), ...(props.actions || [])]}
  />;
}
