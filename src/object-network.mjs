import { nativeFirstClassObjectTypes } from "./native-object-types.mjs";
import { OrganizerInputError } from "./organizer-store.mjs";

const maximumConnections = 100;
const supportedTypes = new Set([
  "contacts.contact", "todos.todo_group", "todos.personal_task", "payments.invoice",
  "journal.group", "journal.tracker", "journal.entry", "calendar.event",
  "calendar.routine", "files.file", "profile.fact", "catch_up.question",
  "video.script", "video.content_group", "video.content_item",
]);
const definitions = new Map(nativeFirstClassObjectTypes
  .filter(({ id }) => supportedTypes.has(id))
  .map((definition) => [definition.id, definition]));

const connectableTypes = Object.freeze({
  "contacts.contact": ["todos.personal_task", "calendar.event"],
  "todos.personal_task": ["contacts.contact", "calendar.event", "video.content_item"],
  "calendar.event": ["contacts.contact", "todos.personal_task"],
  "video.content_item": ["todos.personal_task"],
});

function positiveId(value, label = "object id") {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new OrganizerInputError(`${label} must be a positive integer.`);
  }
  return parsed;
}

function compact(value, maximum = 500) {
  const result = String(value ?? "").replace(/\s+/gu, " ").trim();
  return result ? result.slice(0, maximum) : null;
}

function attribute(label, value) {
  const normalized = value == null ? "" : String(value).trim();
  return normalized ? { label, value: normalized } : null;
}

function exactIdentity(value, label = "object") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OrganizerInputError(`${label} identity is required.`);
  }
  const definition = definitions.get(value.type);
  if (!definition) throw new OrganizerInputError(`${label} type is not available in the object network.`);
  const id = positiveId(value.id, `${label} id`);
  const ref = `${definition.refPrefix}${encodeURIComponent(String(id))}`;
  if (value.source !== definition.source || value.ref !== ref) {
    throw new OrganizerInputError(`${label} identity does not match its owning source and stable reference.`);
  }
  return { type: definition.id, source: definition.source, id, ref };
}

function pair(left, right) {
  const values = [left, right].sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
  return { key: values.map(({ type }) => type).join("|"), left: values[0], right: values[1] };
}

function edge(type, id, kind, removable = false) {
  return { type, id: Number(id), kind, removable };
}

function money(minor, currency) {
  if (minor == null || !currency) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor) / 100);
}

function contactLinks(methods) {
  return methods.flatMap((method) => {
    const value = String(method.value ?? "").trim();
    if (!value) return [];
    const suffix = method.label ? ` ${method.label}` : "";
    if (method.method_kind === "phone") return [
      { label: `Call${suffix}`, href: `tel:${value}` },
      { label: `Text${suffix}`, href: `sms:${value}` },
    ];
    if (method.method_kind === "email") return [{ label: `Email${suffix}`, href: `mailto:${value}` }];
    if (method.method_kind === "url" && /^https?:\/\//iu.test(value)) {
      return [{ label: `Open${suffix}`, href: value }];
    }
    return [];
  });
}

export class ObjectNetworkService {
  constructor({ database, organizer, registry }) {
    this.database = database;
    this.organizer = organizer;
    this.registry = registry;
  }

  #card(definition, id, display, { body = null, attributes = [], links = [] } = {}) {
    return {
      type: definition.id,
      source: definition.source,
      id: Number(id),
      ref: `${definition.refPrefix}${encodeURIComponent(String(id))}`,
      display: compact(display, 500),
      label: definition.title,
      respondable: Boolean(definition.searchType),
      body: compact(body, 10_000),
      attributes: attributes.filter(Boolean),
      links,
    };
  }

  #readObject(identity) {
    const { type, id } = identity;
    const definition = definitions.get(type);
    let row;
    if (type === "contacts.contact") {
      row = this.database.prepare(`SELECT contact_id, display_name, contact_kind, organization_name,
        status, birth_date, notes FROM contacts WHERE contact_id = ?`).get(id);
      if (!row) return null;
      const methods = this.database.prepare(`SELECT method_kind, label, value FROM contact_methods
        WHERE contact_id = ? ORDER BY is_primary DESC, contact_method_id`).all(id);
      const methodSummary = methods
        .map((method) => [method.label, method.value].filter(Boolean).join(": ")).join(" · ");
      return this.#card(definition, id, row.display_name, { body: row.notes, attributes: [
        attribute("Kind", row.contact_kind), attribute("Organization", row.organization_name),
        attribute("Status", row.status), attribute("Birthday", row.birth_date),
        attribute("Contact", methodSummary),
      ], links: contactLinks(methods) });
    }
    if (type === "todos.todo_group") {
      row = this.database.prepare(`SELECT todo_group_id, name, uses_sequence, daily_paper_pinned,
        archived_at_utc FROM todo_groups WHERE todo_group_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.name, { attributes: [
        attribute("Numbered", row.uses_sequence ? "Yes" : "No"),
        attribute("Daily paper", row.daily_paper_pinned ? "Pinned" : null),
        attribute("Status", row.archived_at_utc ? "Archived" : "Active"),
      ] });
    }
    if (type === "todos.personal_task") {
      row = this.database.prepare(`SELECT personal_task_id, text, status, sequence,
        planning_prompt_text, billable_amount_minor, billable_currency
        FROM todo_personal WHERE personal_task_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.text, { attributes: [
        attribute("Status", row.status), attribute("Sequence", row.sequence),
        attribute("Billable", money(row.billable_amount_minor, row.billable_currency)),
        attribute("Planning prompt", row.planning_prompt_text),
      ] });
    }
    if (type === "payments.invoice") {
      row = this.database.prepare(`SELECT payment_invoice_id, status, currency, amount_minor,
        due_on, description FROM payment_invoices WHERE payment_invoice_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, `Invoice ${id} · ${money(row.amount_minor, row.currency)}`, {
        body: row.description, attributes: [attribute("Status", row.status), attribute("Due", row.due_on)],
      });
    }
    if (type === "journal.group") {
      row = this.database.prepare(`SELECT journal_group_id, name, archived_at_utc
        FROM journal1_groups WHERE journal_group_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.name, { attributes: [
        attribute("Status", row.archived_at_utc ? "Archived" : "Active"),
      ] });
    }
    if (type === "journal.tracker") {
      row = this.database.prepare(`SELECT tracker_id, name, unit, asking_starts_at_utc,
        asking_recurrence_rule, archived_at_utc FROM journal2_trackers WHERE tracker_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.name, { attributes: [
        attribute("Unit", row.unit), attribute("Schedule", row.asking_recurrence_rule),
        attribute("Starts", row.asking_starts_at_utc),
        attribute("Status", row.archived_at_utc ? "Archived" : "Active"),
      ] });
    }
    if (type === "journal.entry") {
      row = this.database.prepare(`SELECT journal_entry_id, content_text, occurred_at_utc,
        number_value FROM journal3_entries WHERE journal_entry_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.content_text, { attributes: [
        attribute("Occurred", row.occurred_at_utc), attribute("Value", row.number_value),
      ] });
    }
    if (type === "calendar.event") {
      row = this.database.prepare(`SELECT calendar_event_id, title, description, location_text,
        starts_at_utc, ends_at_utc, time_zone, is_all_day, status, recurrence_rule
        FROM calendar_events WHERE calendar_event_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.title, { body: row.description, attributes: [
        attribute("Starts", row.starts_at_utc), attribute("Ends", row.ends_at_utc),
        attribute("Time zone", row.time_zone), attribute("Where", row.location_text),
        attribute("Status", row.status), attribute("Repeats", row.recurrence_rule),
      ] });
    }
    if (type === "calendar.routine") {
      row = this.database.prepare(`SELECT calendar_routine_id, title, description, location_text,
        first_starts_at_utc, first_ends_at_utc, time_zone, recurrence_rule, disabled_at_utc
        FROM calendar_routines WHERE calendar_routine_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.title, { body: row.description, attributes: [
        attribute("Starts", row.first_starts_at_utc), attribute("Ends", row.first_ends_at_utc),
        attribute("Time zone", row.time_zone), attribute("Where", row.location_text),
        attribute("Repeats", row.recurrence_rule),
        attribute("Status", row.disabled_at_utc ? "Disabled" : "Active"),
      ] });
    }
    if (type === "files.file") {
      row = this.database.prepare(`SELECT file_id, COALESCE(title, original_filename) AS display,
        description, original_filename, media_kind, mime_type, byte_size
        FROM files WHERE file_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.display, { body: row.description, attributes: [
        attribute("Filename", row.original_filename), attribute("Kind", row.media_kind),
        attribute("Type", row.mime_type), attribute("Bytes", row.byte_size),
      ] });
    }
    if (type === "profile.fact") {
      row = this.database.prepare(`SELECT profile_fact_id, fact_text, fact_type, fact_status
        FROM profile_facts WHERE profile_fact_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.fact_text, { attributes: [
        attribute("Kind", row.fact_type), attribute("Status", row.fact_status),
      ] });
    }
    if (type === "catch_up.question") {
      row = this.database.prepare(`SELECT question_id, question_text, calendar_event_id, tracker_id,
        due_at_utc, ask_after, resolved_at, comment FROM catch_up_questions WHERE question_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.question_text, { body: row.comment, attributes: [
        attribute("Kind", row.calendar_event_id ? "Event review" : "Journal"), attribute("Due", row.due_at_utc),
        attribute("Ask after", row.ask_after), attribute("Resolved", row.resolved_at),
      ] });
    }
    if (type === "video.script") {
      row = this.database.prepare(`SELECT video_script_id, title, status, version
        FROM video_scripts WHERE video_script_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.title, { attributes: [
        attribute("Status", row.status), attribute("Version", row.version),
      ] });
    }
    if (type === "video.content_group") {
      row = this.database.prepare(`SELECT content_group_id, name, sort_position, archived_at_utc
        FROM content_groups WHERE content_group_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.name, { attributes: [
        attribute("Position", row.sort_position),
        attribute("Status", row.archived_at_utc ? "Archived" : "Active"),
      ] });
    }
    if (type === "video.content_item") {
      row = this.database.prepare(`SELECT content_id, title, description, sequence, content_type,
        content_status, content_host, content_url, relationship_to_user, personal_notes
        FROM content_items WHERE content_id = ?`).get(id);
      if (!row) return null;
      return this.#card(definition, id, row.title, { body: row.description || row.personal_notes, attributes: [
        attribute("Status", row.content_status), attribute("Type", row.content_type),
        attribute("Sequence", row.sequence), attribute("Host", row.content_host),
        attribute("URL", row.content_url), attribute("Ownership", row.relationship_to_user),
      ] });
    }
    return null;
  }

  #connections(identity) {
    const { type, id } = identity;
    const read = (sql, ...parameters) => this.database.prepare(sql).all(...parameters);
    if (type === "contacts.contact") return [
      ...read(`SELECT personal_task_id AS id FROM todo_personal WHERE related_contact_id = ?
        ORDER BY personal_task_id DESC LIMIT 101`, id).map((row) => edge("todos.personal_task", row.id, "todo-contact", true)),
      ...read(`SELECT calendar_event_id AS id,
          MIN(participant_role = 'other') AS only_other,
          MAX(participant_role <> 'other') AS has_named_role
        FROM calendar_event_contacts_join WHERE contact_id = ? GROUP BY calendar_event_id
        ORDER BY calendar_event_id DESC LIMIT 101`, id).map((row) => edge("calendar.event", row.id, "event-contact", !row.has_named_role && Boolean(row.only_other))),
      ...read(`SELECT payment_invoice_id AS id FROM payment_invoices WHERE payer_contact_id = ?
        ORDER BY payment_invoice_id DESC LIMIT 101`, id).map((row) => edge("payments.invoice", row.id, "invoice-payer")),
    ];
    if (type === "todos.todo_group") return read(`SELECT personal_task_id AS id FROM todo_personal
      WHERE todo_group_id = ? ORDER BY sort_position, personal_task_id LIMIT 101`, id)
      .map((row) => edge("todos.personal_task", row.id, "todo-group"));
    if (type === "todos.personal_task") {
      const task = this.database.prepare(`SELECT todo_group_id, related_contact_id
        FROM todo_personal WHERE personal_task_id = ?`).get(id);
      return task ? [edge("todos.todo_group", task.todo_group_id, "todo-group"),
        ...(task.related_contact_id ? [edge("contacts.contact", task.related_contact_id, "todo-contact", true)] : []),
        ...read(`SELECT calendar_event_id AS id, relationship_kind FROM calendar_events_todo_join
          WHERE personal_task_id = ? ORDER BY calendar_event_id DESC LIMIT 101`, id)
          .map((row) => edge("calendar.event", row.id, "todo-event", row.relationship_kind === "context")),
        ...read(`SELECT content_id AS id FROM todo_content_join WHERE personal_task_id = ?
          ORDER BY content_id DESC LIMIT 101`, id).map((row) => edge("video.content_item", row.id, "todo-content", true)),
        ...read(`SELECT payment_invoice_id AS id FROM payment_invoice_lines WHERE personal_task_id = ?
          ORDER BY payment_invoice_id DESC LIMIT 101`, id).map((row) => edge("payments.invoice", row.id, "invoice-line")),
      ] : [];
    }
    if (type === "payments.invoice") {
      const invoice = this.database.prepare(`SELECT payer_contact_id FROM payment_invoices
        WHERE payment_invoice_id = ?`).get(id);
      return invoice ? [edge("contacts.contact", invoice.payer_contact_id, "invoice-payer"),
        ...read(`SELECT personal_task_id AS id FROM payment_invoice_lines
          WHERE payment_invoice_id = ? AND personal_task_id IS NOT NULL ORDER BY line_position LIMIT 101`, id)
          .map((row) => edge("todos.personal_task", row.id, "invoice-line")),
        ...read(`SELECT DISTINCT receipt.file_id AS id FROM payment_invoice_line_receipts receipt
          JOIN payment_invoice_lines line USING (payment_invoice_line_id)
          WHERE line.payment_invoice_id = ? ORDER BY receipt.file_id LIMIT 101`, id)
          .map((row) => edge("files.file", row.id, "invoice-line-receipt"))] : [];
    }
    if (type === "journal.group") return read(`SELECT tracker_id AS id FROM journal2_trackers
      WHERE journal_group_id = ? ORDER BY name, tracker_id LIMIT 101`, id)
      .map((row) => edge("journal.tracker", row.id, "journal-group"));
    if (type === "journal.tracker") {
      const tracker = this.database.prepare(`SELECT journal_group_id FROM journal2_trackers
        WHERE tracker_id = ?`).get(id);
      return tracker ? [edge("journal.group", tracker.journal_group_id, "journal-group"),
        ...read(`SELECT journal_entry_id AS id FROM journal3_entries WHERE tracker_id = ?
          ORDER BY occurred_at_utc DESC, journal_entry_id DESC LIMIT 101`, id)
          .map((row) => edge("journal.entry", row.id, "tracker-entry")),
        ...read(`SELECT question_id AS id FROM catch_up_questions WHERE tracker_id = ?
          ORDER BY due_at_utc DESC, question_id DESC LIMIT 101`, id)
          .map((row) => edge("catch_up.question", row.id, "tracker-question"))] : [];
    }
    if (type === "journal.entry") {
      const entry = this.database.prepare(`SELECT tracker_id FROM journal3_entries
        WHERE journal_entry_id = ?`).get(id);
      return entry ? [edge("journal.tracker", entry.tracker_id, "tracker-entry")] : [];
    }
    if (type === "calendar.event") {
      const event = this.database.prepare(`SELECT calendar_routine_id FROM calendar_events
        WHERE calendar_event_id = ?`).get(id);
      return event ? [
        ...(event.calendar_routine_id ? [edge("calendar.routine", event.calendar_routine_id, "routine-event")] : []),
        ...read(`SELECT personal_task_id AS id, relationship_kind FROM calendar_events_todo_join
          WHERE calendar_event_id = ? ORDER BY personal_task_id LIMIT 101`, id)
          .map((row) => edge("todos.personal_task", row.id, "todo-event", row.relationship_kind === "context")),
        ...read(`SELECT contact_id AS id,
            MIN(participant_role = 'other') AS only_other,
            MAX(participant_role <> 'other') AS has_named_role
          FROM calendar_event_contacts_join WHERE calendar_event_id = ? GROUP BY contact_id
          ORDER BY contact_id LIMIT 101`, id)
          .map((row) => edge("contacts.contact", row.id, "event-contact", !row.has_named_role && Boolean(row.only_other))),
        ...read(`SELECT question_id AS id FROM catch_up_questions WHERE calendar_event_id = ?
          ORDER BY due_at_utc DESC, question_id DESC LIMIT 101`, id)
          .map((row) => edge("catch_up.question", row.id, "event-question")),
      ] : [];
    }
    if (type === "calendar.routine") return read(`SELECT calendar_event_id AS id FROM calendar_events
      WHERE calendar_routine_id = ? ORDER BY starts_at_utc DESC, calendar_event_id DESC LIMIT 101`, id)
      .map((row) => edge("calendar.event", row.id, "routine-event"));
    if (type === "files.file") return [
      ...read(`SELECT content_id AS id FROM content_items
        WHERE primary_file_id = ? ORDER BY content_id DESC LIMIT 101`, id)
        .map((row) => edge("video.content_item", row.id, "content-file")),
      ...read(`SELECT DISTINCT line.payment_invoice_id AS id FROM payment_invoice_line_receipts receipt
        JOIN payment_invoice_lines line USING (payment_invoice_line_id)
        WHERE receipt.file_id = ? ORDER BY line.payment_invoice_id DESC LIMIT 101`, id)
        .map((row) => edge("payments.invoice", row.id, "invoice-line-receipt")),
    ];
    if (type === "catch_up.question") {
      const question = this.database.prepare(`SELECT calendar_event_id, tracker_id FROM catch_up_questions
        WHERE question_id = ?`).get(id);
      return question ? [
        ...(question.calendar_event_id ? [edge("calendar.event", question.calendar_event_id, "event-question")] : []),
        ...(question.tracker_id ? [edge("journal.tracker", question.tracker_id, "tracker-question")] : []),
      ] : [];
    }
    if (type === "video.script") return read(`SELECT DISTINCT content_id AS id FROM video_jobs
      WHERE video_script_id = ? AND content_id IS NOT NULL ORDER BY content_id DESC LIMIT 101`, id)
      .map((row) => edge("video.content_item", row.id, "script-content"));
    if (type === "video.content_group") return read(`SELECT content_id AS id FROM content_items
      WHERE content_group_id = ? ORDER BY sequence IS NULL, sequence, content_id LIMIT 101`, id)
      .map((row) => edge("video.content_item", row.id, "content-group"));
    if (type === "video.content_item") {
      const content = this.database.prepare(`SELECT content_group_id, primary_file_id FROM content_items
        WHERE content_id = ?`).get(id);
      return content ? [edge("video.content_group", content.content_group_id, "content-group"),
        ...(content.primary_file_id ? [edge("files.file", content.primary_file_id, "content-file")] : []),
        ...read(`SELECT personal_task_id AS id FROM todo_content_join WHERE content_id = ?
          ORDER BY personal_task_id DESC LIMIT 101`, id).map((row) => edge("todos.personal_task", row.id, "todo-content", true)),
        ...read(`SELECT DISTINCT video_script_id AS id FROM video_jobs
          WHERE content_id = ? AND video_script_id IS NOT NULL ORDER BY video_script_id DESC LIMIT 101`, id)
          .map((row) => edge("video.script", row.id, "script-content"))] : [];
    }
    return [];
  }

  graph(rawIdentity) {
    const identity = exactIdentity(rawIdentity);
    const focus = this.#readObject(identity);
    if (!focus) throw new OrganizerInputError("Object not found.", 404);
    const deduplicated = new Map();
    for (const connection of this.#connections(identity)) {
      const key = `${connection.type}:${connection.id}`;
      const previous = deduplicated.get(key);
      deduplicated.set(key, previous
        ? { ...previous, removable: previous.removable && connection.removable }
        : connection);
    }
    const all = [...deduplicated.values()];
    const connections = all.slice(0, maximumConnections).flatMap((connection) => {
      const object = this.#readObject(exactIdentity({
        type: connection.type,
        source: definitions.get(connection.type)?.source,
        id: connection.id,
        ref: `${definitions.get(connection.type)?.refPrefix}${connection.id}`,
      }));
      return object ? [{ object, removable: connection.removable }] : [];
    });
    return {
      focus,
      connections,
      connectableTypes: connectableTypes[focus.type] ?? [],
      truncated: all.length > maximumConnections,
    };
  }

  async setConnection({ from, to, linked }, context = {}) {
    if (typeof linked !== "boolean") throw new OrganizerInputError("linked must be a boolean.");
    const first = exactIdentity(from, "from object");
    const second = exactIdentity(to, "to object");
    if (first.ref === second.ref) throw new OrganizerInputError("An object cannot connect to itself.");
    if (!this.#readObject(first) || !this.#readObject(second)) {
      throw new OrganizerInputError("One of the selected objects no longer exists.", 404);
    }
    const selected = pair(first, second);
    if (selected.key === "contacts.contact|todos.personal_task") {
      const contact = selected.left.type === "contacts.contact" ? selected.left : selected.right;
      const todo = selected.left.type === "todos.personal_task" ? selected.left : selected.right;
      const current = this.organizer.getTodo(todo.id);
      if (linked && current.relatedContactId && Number(current.relatedContactId) !== contact.id) {
        throw new OrganizerInputError("That to-do is already connected to another contact. Disconnect it first.", 409);
      }
      if (!linked && Number(current.relatedContactId) !== contact.id) {
        throw new OrganizerInputError("That exact contact connection does not exist.", 404);
      }
      this.organizer.updateTodo(todo.id, {
        version: current.version,
        relatedContactId: linked ? contact.id : null,
      });
    } else if (selected.key === "calendar.event|todos.personal_task") {
      const event = selected.left.type === "calendar.event" ? selected.left : selected.right;
      const todo = selected.left.type === "todos.personal_task" ? selected.left : selected.right;
      const existing = this.database.prepare(`SELECT relationship_kind FROM calendar_events_todo_join
        WHERE calendar_event_id = ? AND personal_task_id = ?`).get(event.id, todo.id);
      if (linked && !existing) {
        this.organizer.placeTodoCalendarLinks({ placements: [{
          todoId: todo.id, eventId: event.id, relationshipKind: "context",
        }] }, context);
      } else if (!linked) {
        if (!existing) throw new OrganizerInputError("That exact calendar connection does not exist.", 404);
        if (existing.relationship_kind !== "context") {
          throw new OrganizerInputError("Open the calendar event to change a work or deadline relationship.", 409);
        }
        this.organizer.removeTodoCalendarLink(todo.id, event.id, context);
      }
    } else if (selected.key === "contacts.contact|calendar.event") {
      const contact = selected.left.type === "contacts.contact" ? selected.left : selected.right;
      const event = selected.left.type === "calendar.event" ? selected.left : selected.right;
      const namedRole = this.database.prepare(`SELECT participant_role FROM calendar_event_contacts_join
        WHERE calendar_event_id = ? AND contact_id = ? AND participant_role <> 'other' LIMIT 1`)
        .get(event.id, contact.id);
      if (linked && namedRole) return this.graph(first);
      this.organizer.changeCalendarEventContactLink(event.id, {
        contactId: contact.id, participantRole: "other", linked,
      }, context);
    } else if (selected.key === "todos.personal_task|video.content_item") {
      const todo = selected.left.type === "todos.personal_task" ? selected.left : selected.right;
      const content = selected.left.type === "video.content_item" ? selected.left : selected.right;
      await this.registry.execute("todo_content_link_set", {
        personal_task_id: todo.id, content_id: content.id, linked,
      }, { ...context, channel: context.channel ?? "web" });
    } else {
      throw new OrganizerInputError("Those object types do not have a simple direct connection.", 409);
    }
    return this.graph(first);
  }
}
