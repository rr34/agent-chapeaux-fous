import { nativeFirstClassObjectTypes } from "./native-object-types.mjs";
import { objectRelationshipTypeByName, objectRelationshipTypes } from "./object-relationships.mjs";
import { OrganizerInputError } from "./organizer-store.mjs";

const maximumConnections = 100;
const supportedTypes = new Set([
  "contacts.contact", "todos.todo_group", "todos.personal_task", "payments.invoice",
  "journal.group", "journal.tracker", "journal.entry", "calendar.event",
  "calendar.routine", "files.file", "profile.fact", "correspondence.item",
  "video.script", "video.content_group", "video.content_item",
  "things.physical_item_group", "things.physical_item",
]);
const definitions = new Map(nativeFirstClassObjectTypes
  .filter(({ id }) => supportedTypes.has(id))
  .map((definition) => [definition.id, definition]));

const objectReaderSql = Object.freeze({
  "contacts.contact": ["contact_id", `SELECT contact_id, display_name, contact_kind, organization_name,
    status, birth_date, notes FROM contacts`],
  "todos.todo_group": ["todo_group_id", `SELECT todo_group_id, name, uses_sequence, daily_paper_pinned,
    archived_at_utc FROM todo_groups`],
  "todos.personal_task": ["personal_task_id", `SELECT personal_task_id, text, status, sequence,
    billable_amount_minor, billable_currency FROM todo_personal`],
  "things.physical_item_group": ["physical_item_group_id", `SELECT physical_item_group_id, name,
    sort_position, archived_at_utc FROM physical_item_groups`],
  "things.physical_item": ["physical_item_id", `SELECT physical_item_id, name, description, personal_notes,
    quantity, location_text, item_condition, status, manufacturer, model_number,
    serial_number, acquired_on FROM physical_items`],
  "payments.invoice": ["payment_invoice_id", `SELECT payment_invoice_id, status, currency, amount_minor,
    due_on, description FROM payment_invoices`],
  "journal.group": ["journal_group_id", "SELECT journal_group_id, name, archived_at_utc FROM journal1_groups"],
  "journal.tracker": ["tracker_id", `SELECT tracker_id, name, unit, asking_starts_at_utc,
    asking_recurrence_rule, archived_at_utc FROM journal2_trackers`],
  "journal.entry": ["journal_entry_id", `SELECT journal_entry_id, content_text, occurred_at_utc,
    number_value FROM journal3_entries`],
  "calendar.event": ["calendar_event_id", `SELECT calendar_event_id, title, description, location_text,
    starts_at_utc, ends_at_utc, time_zone, is_all_day, status, recurrence_rule FROM calendar_events`],
  "calendar.routine": ["calendar_routine_id", `SELECT calendar_routine_id, title, description, location_text,
    first_starts_at_utc, first_ends_at_utc, time_zone, recurrence_rule, disabled_at_utc FROM calendar_routines`],
  "files.file": ["file_id", `SELECT file_id, COALESCE(title, original_filename) AS display,
    description, original_filename, media_kind, mime_type, byte_size FROM files`],
  "profile.fact": ["profile_fact_id", "SELECT profile_fact_id, fact_text, fact_type, fact_status FROM profile_facts"],
  "correspondence.item": ["correspondence_id", `SELECT correspondence_id, medium, direction, subject, body,
    delivery_status, call_disposition, occurred_at_utc FROM correspondence`],
  "video.script": ["video_script_id", "SELECT video_script_id, title, status, version FROM video_scripts"],
  "video.content_group": ["content_group_id", `SELECT content_group_id, name, sort_position,
    archived_at_utc FROM content_groups`],
  "video.content_item": ["content_id", `SELECT content_id, title, description, sequence, content_type,
    content_status, content_host, content_url, relationship_to_user, personal_notes FROM content_items`],
});

const connectableTypes = Object.freeze({
  "contacts.contact": ["todos.personal_task", "calendar.event", "things.physical_item"],
  "todos.personal_task": ["contacts.contact", "calendar.event", "video.content_item", "things.physical_item", "correspondence.item"],
  "calendar.event": ["contacts.contact", "todos.personal_task", "correspondence.item"],
  "video.content_item": ["todos.personal_task", "things.physical_item"],
  "files.file": ["things.physical_item"],
  "things.physical_item": ["contacts.contact", "todos.personal_task", "video.content_item", "files.file"],
  "correspondence.item": ["todos.personal_task", "calendar.event"],
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
  constructor({ database, organizer, registry, physicalItems }) {
    this.database = database;
    this.organizer = organizer;
    this.registry = registry;
    this.physicalItems = physicalItems;
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

  identity(type, idValue) {
    const definition = definitions.get(type);
    if (!definition) throw new OrganizerInputError("Object type is not available in the object network.");
    const id = positiveId(idValue);
    const identity = exactIdentity({
      type,
      source: definition.source,
      id,
      ref: `${definition.refPrefix}${encodeURIComponent(String(id))}`,
    });
    const object = this.#readObject(identity);
    if (!object) throw new OrganizerInputError("Object not found.", 404);
    return { ...identity, display: object.display };
  }

  #readObject(identity) {
    const reader = objectReaderSql[identity.type];
    if (!reader) return null;
    const [idColumn, sql] = reader;
    const id = positiveId(identity.id);
    const row = this.database.prepare(`${sql} WHERE ${idColumn} = ?`).get(id);
    if (!row) return null;
    const methods = identity.type === "contacts.contact"
      ? this.database.prepare(`SELECT method_kind, label, value FROM contact_methods
        WHERE contact_id = ? ORDER BY is_primary DESC, contact_method_id`).all(id)
      : [];
    return this.#objectFromRow(identity.type, row, methods);
  }

  #readObjects(identities) {
    const grouped = new Map();
    for (const identity of identities) {
      if (!grouped.has(identity.type)) grouped.set(identity.type, []);
      grouped.get(identity.type).push(identity);
    }
    const objects = new Map();
    for (const [type, selected] of grouped) {
      const reader = objectReaderSql[type];
      if (!reader) continue;
      const [idColumn, sql] = reader;
      const ids = [...new Set(selected.map(({ id }) => positiveId(id)))];
      const placeholders = ids.map(() => "?").join(", ");
      const rows = this.database.prepare(`${sql} WHERE ${idColumn} IN (${placeholders})`).all(...ids);
      let methodsByContact = new Map();
      if (type === "contacts.contact" && rows.length) {
        methodsByContact = new Map(rows.map(({ contact_id }) => [Number(contact_id), []]));
        const methods = this.database.prepare(`SELECT contact_id, method_kind, label, value
          FROM contact_methods WHERE contact_id IN (${placeholders})
          ORDER BY contact_id, is_primary DESC, contact_method_id`).all(...ids);
        for (const method of methods) methodsByContact.get(Number(method.contact_id))?.push(method);
      }
      for (const row of rows) {
        const object = this.#objectFromRow(type, row, methodsByContact.get(Number(row[idColumn])) ?? []);
        if (object) objects.set(object.ref, object);
      }
    }
    return objects;
  }

  #objectFromRow(type, row, methods = []) {
    const idColumn = objectReaderSql[type]?.[0];
    const id = Number(row?.[idColumn]);
    const definition = definitions.get(type);
    if (!definition || !Number.isSafeInteger(id)) return null;
    if (type === "contacts.contact") {
      const methodSummary = methods
        .map((method) => [method.label, method.value].filter(Boolean).join(": ")).join(" · ");
      return this.#card(definition, id, row.display_name, { body: row.notes, attributes: [
        attribute("Kind", row.contact_kind), attribute("Organization", row.organization_name),
        attribute("Status", row.status), attribute("Birthday", row.birth_date),
        attribute("Contact", methodSummary),
      ], links: contactLinks(methods) });
    }
    if (type === "todos.todo_group") {
      return this.#card(definition, id, row.name, { attributes: [
        attribute("Numbered", row.uses_sequence ? "Yes" : "No"),
        attribute("Daily paper", row.daily_paper_pinned ? "Pinned" : null),
        attribute("Status", row.archived_at_utc ? "Archived" : "Active"),
      ] });
    }
    if (type === "todos.personal_task") {
      return this.#card(definition, id, row.text, { attributes: [
        attribute("Status", row.status), attribute("Sequence", row.sequence),
        attribute("Billable", money(row.billable_amount_minor, row.billable_currency)),
      ] });
    }
    if (type === "things.physical_item_group") {
      return this.#card(definition, id, row.name, { attributes: [
        attribute("Position", row.sort_position),
        attribute("Status", row.archived_at_utc ? "Archived" : "Active"),
      ] });
    }
    if (type === "things.physical_item") {
      return this.#card(definition, id, row.name, { body: row.description || row.personal_notes, attributes: [
        attribute("Quantity", row.quantity), attribute("Location", row.location_text),
        attribute("Condition", row.item_condition), attribute("Status", row.status),
        attribute("Manufacturer", row.manufacturer), attribute("Model", row.model_number),
        attribute("Serial number", row.serial_number), attribute("Acquired", row.acquired_on),
      ] });
    }
    if (type === "payments.invoice") {
      return this.#card(definition, id, `Invoice ${id} · ${money(row.amount_minor, row.currency)}`, {
        body: row.description, attributes: [attribute("Status", row.status), attribute("Due", row.due_on)],
      });
    }
    if (type === "journal.group") {
      return this.#card(definition, id, row.name, { attributes: [
        attribute("Status", row.archived_at_utc ? "Archived" : "Active"),
      ] });
    }
    if (type === "journal.tracker") {
      return this.#card(definition, id, row.name, { attributes: [
        attribute("Unit", row.unit), attribute("Schedule", row.asking_recurrence_rule),
        attribute("Starts", row.asking_starts_at_utc),
        attribute("Status", row.archived_at_utc ? "Archived" : "Active"),
      ] });
    }
    if (type === "journal.entry") {
      return this.#card(definition, id, row.content_text, { attributes: [
        attribute("Occurred", row.occurred_at_utc), attribute("Value", row.number_value),
      ] });
    }
    if (type === "calendar.event") {
      return this.#card(definition, id, row.title, { body: row.description, attributes: [
        attribute("Starts", row.starts_at_utc), attribute("Ends", row.ends_at_utc),
        attribute("Time zone", row.time_zone), attribute("Where", row.location_text),
        attribute("Status", row.status), attribute("Repeats", row.recurrence_rule),
      ] });
    }
    if (type === "calendar.routine") {
      return this.#card(definition, id, row.title, { body: row.description, attributes: [
        attribute("Starts", row.first_starts_at_utc), attribute("Ends", row.first_ends_at_utc),
        attribute("Time zone", row.time_zone), attribute("Where", row.location_text),
        attribute("Repeats", row.recurrence_rule),
        attribute("Status", row.disabled_at_utc ? "Disabled" : "Active"),
      ] });
    }
    if (type === "files.file") {
      return this.#card(definition, id, row.display, { body: row.description, attributes: [
        attribute("Filename", row.original_filename), attribute("Kind", row.media_kind),
        attribute("Type", row.mime_type), attribute("Bytes", row.byte_size),
      ] });
    }
    if (type === "profile.fact") {
      return this.#card(definition, id, row.fact_text, { attributes: [
        attribute("Kind", row.fact_type), attribute("Status", row.fact_status),
      ] });
    }
    if (type === "correspondence.item") {
      return this.#card(definition, id, row.subject || `${row.medium} ${row.direction}`, { body: row.body, attributes: [
        attribute("Medium", row.medium), attribute("Direction", row.direction),
        attribute("Call disposition", row.call_disposition),
        attribute("Status", row.delivery_status), attribute("When", row.occurred_at_utc),
      ] });
    }
    if (type === "video.script") {
      return this.#card(definition, id, row.title, { attributes: [
        attribute("Status", row.status), attribute("Version", row.version),
      ] });
    }
    if (type === "video.content_group") {
      return this.#card(definition, id, row.name, { attributes: [
        attribute("Position", row.sort_position),
        attribute("Status", row.archived_at_utc ? "Archived" : "Active"),
      ] });
    }
    if (type === "video.content_item") {
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
    const left = objectRelationshipTypes.filter(({ leftType, rightType }) => leftType === type && supportedTypes.has(rightType));
    const right = objectRelationshipTypes.filter(({ rightType, leftType }) => rightType === type && supportedTypes.has(leftType));
    const selections = [];
    const parameters = [];
    if (left.length) {
      selections.push(`SELECT relationship_type, right_id AS related_id, 0 AS is_reverse
        FROM object_relationship_edges WHERE left_id = ?
          AND relationship_type IN (${left.map(() => "?").join(", ")})`);
      parameters.push(id, ...left.map(({ name }) => name));
    }
    if (right.length) {
      selections.push(`SELECT relationship_type, left_id AS related_id, 1 AS is_reverse
        FROM object_relationship_edges WHERE right_id = ?
          AND relationship_type IN (${right.map(() => "?").join(", ")})`);
      parameters.push(id, ...right.map(({ name }) => name));
    }
    if (!selections.length) return [];
    const rows = this.database.prepare(`${selections.join("\nUNION ALL\n")}
      ORDER BY relationship_type, related_id LIMIT ?`)
      .all(...parameters, (maximumConnections * 2) + 1);
    return rows.flatMap((row) => {
      const relationship = objectRelationshipTypeByName.get(row.relationship_type);
      if (!relationship) return [];
      const relatedType = Number(row.is_reverse) ? relationship.leftType : relationship.rightType;
      return [edge(relatedType, row.related_id, relationship.publicName, relationship.removable)];
    }).sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id);
  }

  #relationshipsBetween(first, second) {
    const matches = objectRelationshipTypes.filter(({ leftType, rightType }) =>
      (leftType === first.type && rightType === second.type)
      || (leftType === second.type && rightType === first.type));
    if (!matches.length) return [];
    const forward = matches[0].leftType === first.type;
    const leftId = forward ? first.id : second.id;
    const rightId = forward ? second.id : first.id;
    const rows = this.database.prepare(`SELECT relationship_type FROM object_relationship_edges
      WHERE left_id = ? AND right_id = ?
        AND relationship_type IN (${matches.map(() => "?").join(", ")})`)
      .all(leftId, rightId, ...matches.map(({ name }) => name));
    return rows.flatMap((row) => {
      const definition = objectRelationshipTypeByName.get(row.relationship_type);
      return definition ? [definition] : [];
    });
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
    const bounded = all.slice(0, maximumConnections);
    const identities = bounded.map((connection) => exactIdentity({
        type: connection.type,
        source: definitions.get(connection.type)?.source,
        id: connection.id,
        ref: `${definitions.get(connection.type)?.refPrefix}${connection.id}`,
      }));
    const hydrated = this.#readObjects(identities);
    const connections = bounded.flatMap((connection, index) => {
      const object = hydrated.get(identities[index].ref);
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
        links: [{ personal_task_id: todo.id, content_id: content.id, linked }],
      }, { ...context, channel: context.channel ?? "web" });
    } else if (selected.key === "correspondence.item|todos.personal_task") {
      const correspondence = selected.left.type === "correspondence.item" ? selected.left : selected.right;
      const todo = selected.left.type === "todos.personal_task" ? selected.left : selected.right;
      await this.registry.execute("correspondence_todo_link_set", {
        links: [{ correspondence_id: correspondence.id, todo_id: todo.id, linked }],
      }, { ...context, channel: context.channel ?? "web" });
    } else if (selected.key === "calendar.event|correspondence.item") {
      const event = selected.left.type === "calendar.event" ? selected.left : selected.right;
      const correspondence = selected.left.type === "correspondence.item" ? selected.left : selected.right;
      await this.registry.execute("correspondence_calendar_event_link_set", {
        links: [{ correspondence_id: correspondence.id, calendar_event_id: event.id, linked }],
      }, { ...context, channel: context.channel ?? "web" });
    } else if ([
      "contacts.contact|things.physical_item",
      "files.file|things.physical_item",
      "things.physical_item|todos.personal_task",
      "things.physical_item|video.content_item",
    ].includes(selected.key)) {
      const physicalItem = selected.left.type === "things.physical_item" ? selected.left : selected.right;
      const target = selected.left.type === "things.physical_item" ? selected.right : selected.left;
      const targetType = {
        "contacts.contact": "contact", "files.file": "file",
        "todos.personal_task": "todo", "video.content_item": "content",
      }[target.type];
      const existing = this.#relationshipsBetween(physicalItem, target);
      if (linked && existing.length) return this.graph(first);
      if (!linked && !existing.length) throw new OrganizerInputError("That exact physical-item connection does not exist.", 404);
      if (!linked && existing.some(({ removable }) => !removable)) {
        throw new OrganizerInputError("Use the Things relationship editor to remove a specialized physical-item connection.", 409);
      }
      this.physicalItems.setLinks([{
        physical_item_id: physicalItem.id,
        target_type: targetType,
        target_id: target.id,
        linked,
      }], context);
    } else {
      throw new OrganizerInputError("Those object types do not have a simple direct connection.", 409);
    }
    return this.graph(first);
  }

  async setConnections(connections, context = {}) {
    if (!Array.isArray(connections) || connections.length < 1 || connections.length > 50) {
      throw new OrganizerInputError("connections must contain 1 through 50 object pairs.");
    }
    const keys = connections.map(({ from, to }) => {
      const first = exactIdentity(from, "from object");
      const second = exactIdentity(to, "to object");
      return [first.ref, second.ref].sort().join("|");
    });
    if (new Set(keys).size !== keys.length) {
      throw new OrganizerInputError("connections cannot contain the same object pair more than once.");
    }
    const results = [];
    for (const connection of connections) {
      const from = exactIdentity(connection.from, "from object");
      const to = exactIdentity(connection.to, "to object");
      const before = this.graph(from);
      const wasLinked = before.connections.some(({ object }) => object.ref === to.ref);
      const after = await this.setConnection(connection, context);
      const isLinked = after.connections.some(({ object }) => object.ref === to.ref);
      results.push({
        from: { ...from, display: before.focus.display },
        to: {
          ...to,
          display: (after.connections.find(({ object }) => object.ref === to.ref)?.object
            ?? before.connections.find(({ object }) => object.ref === to.ref)?.object
            ?? this.graph(to).focus).display,
        },
        linked: isLinked,
        changed: wasLinked !== isLinked,
      });
    }
    return {
      selected_count: results.length,
      changed_count: results.filter(({ changed }) => changed).length,
      unchanged_count: results.filter(({ changed }) => !changed).length,
      results,
    };
  }
}
