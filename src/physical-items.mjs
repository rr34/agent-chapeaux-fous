import { OrganizerInputError } from "./organizer-store.mjs";

export const physicalItemStatuses = ["active", "loaned", "lost", "disposed", "archived"];
export const physicalItemConditions = ["unknown", "new", "good", "fair", "poor", "broken"];

const linkTargets = Object.freeze({
  todo: { table: "physical_items_todo_join", column: "personal_task_id", target: "todo_personal", targetColumn: "personal_task_id", qualifier: "relationship_kind" },
  content: { table: "physical_items_content_join", column: "content_id", target: "content_items", targetColumn: "content_id", qualifier: "relationship_kind" },
  file: { table: "physical_items_files_join", column: "file_id", target: "files", targetColumn: "file_id", qualifier: "file_role" },
  contact: { table: "physical_items_contacts_join", column: "contact_id", target: "contacts", targetColumn: "contact_id", qualifier: "relationship_kind" },
});

function positiveInteger(value, label) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new OrganizerInputError(`${label} must be a positive integer.`);
  return parsed;
}

function boundedText(value, label, maximum, { required = false } = {}) {
  const text = value == null ? "" : String(value).trim();
  if (required && !text) throw new OrganizerInputError(`${label} is required.`);
  if (text.length > maximum) throw new OrganizerInputError(`${label} must be at most ${maximum} characters.`);
  return text || null;
}

function enumValue(value, values, label, fallback) {
  const selected = value == null || value === "" ? fallback : String(value);
  if (!values.includes(selected)) throw new OrganizerInputError(`${label} must be one of ${values.join(", ")}.`);
  return selected;
}

function publicGroup(row) {
  return row ? {
    id: Number(row.physical_item_group_id),
    name: row.name,
    sortPosition: Number(row.sort_position),
    archivedAtUtc: row.archived_at_utc,
    itemCount: Number(row.item_count ?? 0),
  } : null;
}

function publicItem(row, links = {}) {
  return row ? {
    id: Number(row.physical_item_id),
    groupId: Number(row.physical_item_group_id),
    groupName: row.group_name,
    name: row.name,
    description: row.description,
    personalNotes: row.personal_notes,
    quantity: Number(row.quantity),
    location: row.location_text,
    condition: row.item_condition,
    status: row.status,
    manufacturer: row.manufacturer,
    modelNumber: row.model_number,
    serialNumber: row.serial_number,
    acquiredOn: row.acquired_on,
    sortPosition: Number(row.sort_position),
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    version: Number(row.version),
    linkedTodos: links.todos ?? [],
    linkedContent: links.content ?? [],
    linkedFiles: links.files ?? [],
    linkedContacts: links.contacts ?? [],
  } : null;
}

function linkedByItemIds(database, itemIds) {
  const ids = [...new Set(itemIds.map(Number))];
  const result = new Map(ids.map((id) => [id, { todos: [], content: [], files: [], contacts: [] }]));
  if (!ids.length) return result;
  const placeholders = ids.map(() => "?").join(", ");
  for (const row of database.prepare(`SELECT link.physical_item_id, task.personal_task_id AS id,
      task.text AS display, task.status, link.relationship_kind, link.created_at_utc
    FROM physical_items_todo_join AS link JOIN todo_personal AS task USING (personal_task_id)
    WHERE link.physical_item_id IN (${placeholders}) ORDER BY link.physical_item_id, task.personal_task_id`).all(...ids)) {
    result.get(Number(row.physical_item_id)).todos.push({ id: Number(row.id), display: row.display,
      status: row.status, relationshipKind: row.relationship_kind, linkedAtUtc: row.created_at_utc,
      ref: `agent-slayer://todos/${Number(row.id)}` });
  }
  for (const row of database.prepare(`SELECT link.physical_item_id, content.content_id AS id,
      content.title AS display, content.content_status AS status, link.relationship_kind, link.created_at_utc
    FROM physical_items_content_join AS link JOIN content_items AS content USING (content_id)
    WHERE link.physical_item_id IN (${placeholders}) ORDER BY link.physical_item_id, content.content_id`).all(...ids)) {
    result.get(Number(row.physical_item_id)).content.push({ id: Number(row.id), display: row.display,
      status: row.status, relationshipKind: row.relationship_kind, linkedAtUtc: row.created_at_utc,
      ref: `agent-slayer://content-items/${Number(row.id)}` });
  }
  for (const row of database.prepare(`SELECT link.physical_item_id, file.file_id AS id,
      COALESCE(file.title, file.original_filename) AS display, file.mime_type AS status,
      link.file_role AS relationship_kind, link.created_at_utc
    FROM physical_items_files_join AS link JOIN files AS file USING (file_id)
    WHERE link.physical_item_id IN (${placeholders}) ORDER BY link.physical_item_id, link.sort_order, file.file_id`).all(...ids)) {
    result.get(Number(row.physical_item_id)).files.push({ id: Number(row.id), display: row.display,
      mimeType: row.status, relationshipKind: row.relationship_kind, linkedAtUtc: row.created_at_utc,
      ref: `agent-slayer://files/${Number(row.id)}` });
  }
  for (const row of database.prepare(`SELECT link.physical_item_id, contact.contact_id AS id,
      contact.display_name AS display, contact.status, link.relationship_kind, link.created_at_utc
    FROM physical_items_contacts_join AS link JOIN contacts AS contact USING (contact_id)
    WHERE link.physical_item_id IN (${placeholders}) ORDER BY link.physical_item_id, contact.display_name, contact.contact_id`).all(...ids)) {
    result.get(Number(row.physical_item_id)).contacts.push({ id: Number(row.id), display: row.display,
      status: row.status, relationshipKind: row.relationship_kind, linkedAtUtc: row.created_at_utc,
      ref: `agent-slayer://contacts/${Number(row.id)}` });
  }
  return result;
}

function databaseItem(database, id) {
  return database.prepare(`SELECT item.*, physical_group.name AS group_name
    FROM physical_items AS item
    JOIN physical_item_groups AS physical_group USING (physical_item_group_id)
    WHERE item.physical_item_id = ?`).get(id);
}

function activity(ledger, context, input) {
  if (!ledger) return null;
  return ledger.append({
    status: "complete",
    actorType: context.actorType ?? "user",
    actorName: context.actorName ?? "web",
    channel: context.channel ?? "web",
    turnId: context.requestId,
    operationId: context.callId,
    ...input,
  });
}

export class PhysicalItems {
  constructor({ store, ledger }) {
    this.store = store;
    this.ledger = ledger;
  }

  listGroups({ includeArchived = false } = {}) {
    const database = this.store.requireReady();
    return database.prepare(`SELECT physical_group.*, COUNT(item.physical_item_id) AS item_count
      FROM physical_item_groups AS physical_group
      LEFT JOIN physical_items AS item USING (physical_item_group_id)
      ${includeArchived ? "" : "WHERE physical_group.archived_at_utc IS NULL"}
      GROUP BY physical_group.physical_item_group_id
      ORDER BY physical_group.sort_position, physical_group.physical_item_group_id`).all().map(publicGroup);
  }

  createGroup(input, context = {}) {
    const database = this.store.requireReady();
    const name = boundedText(input?.name, "Group name", 200, { required: true });
    const existing = database.prepare("SELECT * FROM physical_item_groups WHERE name = ?").get(name);
    const now = new Date().toISOString();
    let row;
    if (existing) {
      if (existing.archived_at_utc == null) throw new OrganizerInputError("A Things group with that name already exists.", 409);
      row = database.prepare(`UPDATE physical_item_groups
        SET archived_at_utc = NULL, updated_at_utc = ? WHERE physical_item_group_id = ? RETURNING *`)
        .get(now, existing.physical_item_group_id);
    } else {
      const sortPosition = Number(database.prepare("SELECT COALESCE(MAX(sort_position), 0) + 10 AS value FROM physical_item_groups").get().value);
      row = database.prepare(`INSERT INTO physical_item_groups (name, sort_position)
        VALUES (?, ?) RETURNING *`).get(name, sortPosition);
    }
    const group = publicGroup(row);
    activity(this.ledger, context, { type: "physical_item_group.created", name: "Things group created",
      content: group.name, payload: { group }, subjectType: "physical_item_group", subjectId: String(group.id) });
    return group;
  }

  updateGroup(idValue, input, context = {}) {
    const database = this.store.requireReady();
    const id = positiveInteger(idValue, "Physical-item group id");
    const before = database.prepare("SELECT * FROM physical_item_groups WHERE physical_item_group_id = ?").get(id);
    if (!before) throw new OrganizerInputError("Things group not found.", 404);
    const name = input?.name === undefined ? before.name : boundedText(input.name, "Group name", 200, { required: true });
    const archivedAt = input?.archived === undefined ? before.archived_at_utc : input.archived ? new Date().toISOString() : null;
    if (input?.archived === true) {
      const count = Number(database.prepare("SELECT COUNT(*) AS count FROM physical_items WHERE physical_item_group_id = ? AND status <> 'archived'").get(id).count);
      if (count) throw new OrganizerInputError("Move or archive every item before archiving this Things group.", 409);
    }
    try {
      const row = database.prepare(`UPDATE physical_item_groups SET name = ?, archived_at_utc = ?, updated_at_utc = ?
        WHERE physical_item_group_id = ? RETURNING *`).get(name, archivedAt, new Date().toISOString(), id);
      const group = publicGroup(row);
      activity(this.ledger, context, { type: "physical_item_group.updated", name: "Things group updated",
        content: group.name, payload: { group }, subjectType: "physical_item_group", subjectId: String(id) });
      return group;
    } catch (error) {
      if (String(error?.message).includes("physical_item_groups_name")) {
        throw new OrganizerInputError("A Things group with that name already exists.", 409);
      }
      throw error;
    }
  }

  list({ groupId = null, status = null, query = null, limit = 1000 } = {}) {
    const database = this.store.requireReady();
    const conditions = ["physical_group.archived_at_utc IS NULL"];
    const values = [];
    if (groupId != null && groupId !== "") {
      conditions.push("item.physical_item_group_id = ?");
      values.push(positiveInteger(groupId, "Physical-item group id"));
    }
    if (status) {
      conditions.push("item.status = ?");
      values.push(enumValue(status, physicalItemStatuses, "Status"));
    } else conditions.push("item.status NOT IN ('disposed', 'archived')");
    const search = boundedText(query, "Query", 500);
    if (search) {
      conditions.push(`(LOWER(item.name) LIKE ? OR LOWER(COALESCE(item.description, '')) LIKE ?
        OR LOWER(COALESCE(item.personal_notes, '')) LIKE ? OR LOWER(COALESCE(item.location_text, '')) LIKE ?
        OR LOWER(COALESCE(item.manufacturer, '')) LIKE ? OR LOWER(COALESCE(item.model_number, '')) LIKE ?
        OR LOWER(COALESCE(item.serial_number, '')) LIKE ? OR LOWER(physical_group.name) LIKE ?)`);
      values.push(...Array(8).fill(`%${search.toLocaleLowerCase()}%`));
    }
    const boundedLimit = Math.min(5000, positiveInteger(limit, "Limit"));
    const rows = database.prepare(`SELECT item.*, physical_group.name AS group_name
      FROM physical_items AS item
      JOIN physical_item_groups AS physical_group USING (physical_item_group_id)
      WHERE ${conditions.join(" AND ")}
      ORDER BY physical_group.sort_position, item.sort_position, item.physical_item_id
      LIMIT ?`).all(...values, boundedLimit);
    const links = linkedByItemIds(database, rows.map((row) => row.physical_item_id));
    return rows.map((row) => publicItem(row, links.get(Number(row.physical_item_id))));
  }

  get(idValue) {
    const database = this.store.requireReady();
    const id = positiveInteger(idValue, "Physical item id");
    return publicItem(databaseItem(database, id), linkedByItemIds(database, [id]).get(id));
  }

  create(input, context = {}) {
    const database = this.store.requireReady();
    const groupId = positiveInteger(input?.groupId ?? input?.physical_item_group_id, "Physical-item group id");
    if (!database.prepare("SELECT 1 FROM physical_item_groups WHERE physical_item_group_id = ? AND archived_at_utc IS NULL").get(groupId)) {
      throw new OrganizerInputError("Active Things group not found.", 404);
    }
    const name = boundedText(input?.name, "Name", 500, { required: true });
    const quantity = positiveInteger(input?.quantity ?? 1, "Quantity");
    const sortPosition = Number(database.prepare(`SELECT COALESCE(MAX(sort_position), 0) + 10 AS value
      FROM physical_items WHERE physical_item_group_id = ?`).get(groupId).value);
    const inserted = database.prepare(`INSERT INTO physical_items (
      physical_item_group_id, name, description, personal_notes, quantity, location_text,
      item_condition, status, manufacturer, model_number, serial_number, acquired_on,
      sort_position, source_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING physical_item_id`).get(
      groupId, name, boundedText(input.description, "Description", 100_000),
      boundedText(input.personalNotes ?? input.personal_notes, "Personal notes", 100_000), quantity,
      boundedText(input.location ?? input.location_text, "Location", 1000),
      enumValue(input.condition ?? input.item_condition, physicalItemConditions, "Condition", "unknown"),
      enumValue(input.status, physicalItemStatuses, "Status", "active"),
      boundedText(input.manufacturer, "Manufacturer", 500), boundedText(input.modelNumber ?? input.model_number, "Model number", 500),
      boundedText(input.serialNumber ?? input.serial_number, "Serial number", 1000), input.acquiredOn ?? input.acquired_on ?? null,
      sortPosition, context.requestEventId ?? null,
    );
    const item = this.get(inserted.physical_item_id);
    activity(this.ledger, context, { type: "physical_item.created", name: "Physical item created",
      content: item.name, payload: { item }, subjectType: "physical_item", subjectId: String(item.id) });
    return item;
  }

  update(idValue, input, context = {}) {
    const database = this.store.requireReady();
    const id = positiveInteger(idValue, "Physical item id");
    const before = databaseItem(database, id);
    if (!before) throw new OrganizerInputError("Physical item not found.", 404);
    if (input?.version != null && positiveInteger(input.version, "Version") !== Number(before.version)) {
      throw new OrganizerInputError("This physical item changed after it was opened. Refresh and try again.", 409);
    }
    const groupId = input?.groupId === undefined && input?.physical_item_group_id === undefined
      ? Number(before.physical_item_group_id)
      : positiveInteger(input.groupId ?? input.physical_item_group_id, "Physical-item group id");
    if (!database.prepare("SELECT 1 FROM physical_item_groups WHERE physical_item_group_id = ? AND archived_at_utc IS NULL").get(groupId)) {
      throw new OrganizerInputError("Active Things group not found.", 404);
    }
    const value = (camel, snake, previous, label, maximum) => input?.[camel] === undefined && input?.[snake] === undefined
      ? previous : boundedText(input[camel] ?? input[snake], label, maximum);
    const row = database.prepare(`UPDATE physical_items SET
      physical_item_group_id = ?, name = ?, description = ?, personal_notes = ?, quantity = ?,
      location_text = ?, item_condition = ?, status = ?, manufacturer = ?, model_number = ?,
      serial_number = ?, acquired_on = ?, updated_at_utc = ?, version = version + 1
      WHERE physical_item_id = ? AND version = ? RETURNING physical_item_id`).get(
      groupId, input?.name === undefined ? before.name : boundedText(input.name, "Name", 500, { required: true }),
      value("description", "description", before.description, "Description", 100_000),
      value("personalNotes", "personal_notes", before.personal_notes, "Personal notes", 100_000),
      input?.quantity === undefined ? Number(before.quantity) : positiveInteger(input.quantity, "Quantity"),
      value("location", "location_text", before.location_text, "Location", 1000),
      input?.condition === undefined && input?.item_condition === undefined ? before.item_condition
        : enumValue(input.condition ?? input.item_condition, physicalItemConditions, "Condition"),
      input?.status === undefined ? before.status : enumValue(input.status, physicalItemStatuses, "Status"),
      value("manufacturer", "manufacturer", before.manufacturer, "Manufacturer", 500),
      value("modelNumber", "model_number", before.model_number, "Model number", 500),
      value("serialNumber", "serial_number", before.serial_number, "Serial number", 1000),
      input?.acquiredOn === undefined && input?.acquired_on === undefined ? before.acquired_on : input.acquiredOn ?? input.acquired_on ?? null,
      new Date().toISOString(), id, before.version,
    );
    if (!row) throw new OrganizerInputError("This physical item changed while it was being saved.", 409);
    const item = this.get(id);
    activity(this.ledger, context, { type: "physical_item.updated", name: "Physical item updated",
      content: item.name, payload: { item }, subjectType: "physical_item", subjectId: String(id) });
    return item;
  }

  setLinks(links, context = {}) {
    if (!Array.isArray(links) || links.length < 1 || links.length > 500) {
      throw new OrganizerInputError("links must contain 1 through 500 relationships.");
    }
    const database = this.store.requireReady();
    const prepared = links.map((link, index) => {
      const kind = String(link?.target_type ?? "");
      const definition = linkTargets[kind];
      if (!definition) throw new OrganizerInputError(`links[${index}].target_type is invalid.`);
      const physicalItemId = positiveInteger(link.physical_item_id, `links[${index}].physical_item_id`);
      const targetId = positiveInteger(link.target_id, `links[${index}].target_id`);
      if (typeof link.linked !== "boolean") throw new OrganizerInputError(`links[${index}].linked must be a boolean.`);
      const relationshipKind = boundedText(link.relationship_kind, `links[${index}].relationship_kind`, 100);
      return { kind, definition, physicalItemId, targetId, linked: link.linked, relationshipKind };
    });
    const keys = prepared.map((link) => `${link.kind}:${link.physicalItemId}:${link.targetId}`);
    if (new Set(keys).size !== keys.length) throw new OrganizerInputError("The link batch contains a duplicate relationship.");
    database.exec("START TRANSACTION");
    try {
      const results = [];
      for (const link of prepared) {
        const { definition } = link;
        if (!database.prepare("SELECT 1 FROM physical_items WHERE physical_item_id = ?").get(link.physicalItemId)) {
          throw new OrganizerInputError(`Physical item ${link.physicalItemId} does not exist.`, 404);
        }
        if (!database.prepare(`SELECT 1 FROM ${definition.target} WHERE ${definition.targetColumn} = ?`).get(link.targetId)) {
          throw new OrganizerInputError(`${link.kind} target ${link.targetId} does not exist.`, 404);
        }
        const existing = database.prepare(`SELECT ${definition.qualifier} AS qualifier FROM ${definition.table}
          WHERE physical_item_id = ? AND ${definition.column} = ?`).get(link.physicalItemId, link.targetId);
        const relationshipKind = link.relationshipKind ?? existing?.qualifier ?? (link.kind === "file" ? "attachment" : "related");
        const changed = link.linked ? !existing || existing.qualifier !== relationshipKind : Boolean(existing);
        if (changed && link.linked) {
          const extraColumn = link.kind === "file" ? ", sort_order" : "";
          const extraValue = link.kind === "file" ? ", 0" : "";
          database.prepare(`INSERT INTO ${definition.table} (physical_item_id, ${definition.column}, ${definition.qualifier}${extraColumn})
            VALUES (?, ?, ?${extraValue}) ON DUPLICATE KEY UPDATE ${definition.qualifier} = VALUES(${definition.qualifier})`)
            .run(link.physicalItemId, link.targetId, relationshipKind);
        } else if (changed) {
          database.prepare(`DELETE FROM ${definition.table} WHERE physical_item_id = ? AND ${definition.column} = ?`)
            .run(link.physicalItemId, link.targetId);
        }
        results.push({ target_type: link.kind, physical_item_id: link.physicalItemId, target_id: link.targetId,
          relationship_kind: relationshipKind, linked: link.linked, changed });
      }
      const result = { selected_count: results.length, changed_count: results.filter((item) => item.changed).length,
        unchanged_count: results.filter((item) => !item.changed).length, results };
      activity(this.ledger, context, { type: "physical_item.links_set", name: "Physical-item links set",
        content: `${result.changed_count} of ${result.selected_count} requested links changed`, payload: result,
        subjectType: "physical_item_batch", subjectId: String(new Set(results.map((item) => item.physical_item_id)).size) });
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
