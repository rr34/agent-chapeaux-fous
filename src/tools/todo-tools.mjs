const todoStatuses = ["todo", "complete", "ignore", "archive", "ai_suggested"];

function findGroup(database, name) {
  const requested = name?.trim() || "Inbox";
  return database.prepare(`
    SELECT * FROM todo_groups
    WHERE name = ? COLLATE NOCASE AND archived_at_utc IS NULL
  `).get(requested);
}

function requireGroup(database, name) {
  const requested = name?.trim() || "Inbox";
  const row = findGroup(database, requested);
  if (row) return row;
  const available = database.prepare(`
    SELECT name FROM todo_groups WHERE archived_at_utc IS NULL ORDER BY name COLLATE NOCASE
  `).all().map((item) => item.name);
  throw new Error(`Unknown to-do group "${requested}". Available groups: ${available.join(", ") || "none"}`);
}

function ensureGroup(database, name) {
  const requested = name?.trim() || "Inbox";
  const existing = database.prepare(`
    SELECT * FROM todo_groups WHERE name = ? COLLATE NOCASE
  `).get(requested);
  if (!existing) {
    return {
      row: database.prepare("INSERT INTO todo_groups (name) VALUES (?) RETURNING *").get(requested),
      created: true,
      reactivated: false,
    };
  }
  if (existing.archived_at_utc === null) {
    return { row: existing, created: false, reactivated: false };
  }
  const row = database.prepare(`
    UPDATE todo_groups SET archived_at_utc = NULL
    WHERE todo_group_id = ?
    RETURNING *
  `).get(existing.todo_group_id);
  return { row, created: false, reactivated: true };
}

function publicGroup(row) {
  return {
    id: Number(row.todo_group_id),
    name: row.name,
    archivedAtUtc: row.archived_at_utc,
  };
}

function publicTask(row) {
  if (!row) return null;
  return {
    id: Number(row.personal_task_id),
    groupId: Number(row.todo_group_id),
    groupName: row.group_name,
    text: row.text,
    status: row.status,
    sortPosition: Number(row.sort_position),
    scheduledAtUtc: row.scheduled_at_utc,
    dueAtUtc: row.due_at_utc,
    completedAtUtc: row.completed_at_utc,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
  };
}

const optionalText = { type: ["string", "null"] };

export function registerTodoTools(registry, store, ledger) {
  registry.register({
    name: "todo_list",
    description: "List the user's native personal to-do items. Use this whenever they ask about their personal to-dos or development to-do list.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        group: optionalText,
        status: { type: ["string", "null"], enum: [...todoStatuses, null] },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["group", "status", "limit"],
    },
    async execute({ group: groupName, status, limit }) {
      const database = store.requireReady();
      const conditions = [];
      const values = [];
      if (groupName) {
        conditions.push("todo_group.name = ? COLLATE NOCASE");
        values.push(groupName.trim());
      }
      if (status) {
        conditions.push("task.status = ?");
        values.push(status);
      } else {
        conditions.push("task.status NOT IN ('complete', 'ignore', 'archive')");
      }
      const rows = database.prepare(`
        SELECT task.*, todo_group.name AS group_name
        FROM personal_tasks AS task
        JOIN todo_groups AS todo_group USING (todo_group_id)
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY todo_group.name COLLATE NOCASE, task.sort_position, task.personal_task_id
        LIMIT ?
      `).all(...values, Math.min(200, Math.max(1, Number(limit) || 50))).map(publicTask);
      return { count: rows.length, tasks: rows };
    },
  });

  registry.register({
    name: "todo_add",
    description: "Add one native personal to-do item. If the requested group does not exist, add it to Inbox and return usedInboxFallback=true; then ask whether to create the requested group and move the task. Never create a requested group implicitly. This is the authoritative path for requests such as 'add this as a development to-do'.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        group: optionalText,
        scheduledAtUtc: optionalText,
        dueAtUtc: optionalText,
      },
      required: ["text", "group", "scheduledAtUtc", "dueAtUtc"],
    },
    async execute({ text, group: groupName, scheduledAtUtc, dueAtUtc }, context) {
      const database = store.requireReady();
      const taskText = text.trim();
      if (!taskText) throw new Error("To-do text cannot be empty");
      database.exec("BEGIN IMMEDIATE");
      try {
        const requestedGroup = groupName?.trim() || "Inbox";
        const requestedGroupRow = findGroup(database, requestedGroup);
        const inbox = requestedGroupRow
          ? null
          : ensureGroup(database, "Inbox");
        const selectedGroup = requestedGroupRow ?? inbox.row;
        const usedInboxFallback = !requestedGroupRow && requestedGroup.toLowerCase() !== "inbox";
        const sortPosition = Number(database.prepare(`
          SELECT COALESCE(MAX(sort_position), 0) + 10 AS value
          FROM personal_tasks WHERE todo_group_id = ?
        `).get(selectedGroup.todo_group_id).value);
        const sourceEventId = context.requestEventId || null;
        const row = database.prepare(`
          INSERT INTO personal_tasks (
            todo_group_id, text, status, sort_position, scheduled_at_utc,
            due_at_utc, source, source_event_id
          ) VALUES (?, ?, 'todo', ?, ?, ?, 'agent-slayer', ?)
          RETURNING *
        `).get(
          selectedGroup.todo_group_id, taskText, sortPosition,
          scheduledAtUtc || null, dueAtUtc || null, sourceEventId,
        );
        const task = publicTask({ ...row, group_name: selectedGroup.name });
        const groupResolution = {
          requestedGroup,
          actualGroup: selectedGroup.name,
          requestedGroupFound: Boolean(requestedGroupRow),
          usedInboxFallback,
          askToCreateRequestedGroup: usedInboxFallback,
        };
        ledger.append({
          type: "personal_todo.created", status: "complete", actorType: "tool", actorName: "todo_add",
          turnId: context.requestId, operationId: context.callId, name: "Personal to-do created",
          content: task.text,
          payload: { task, groupResolution },
          subjectType: "personal_task", subjectId: String(task.id),
        });
        database.exec("COMMIT");
        return {
          created: true,
          groupResolution,
          task,
        };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "todo_group_create",
    description: "Create or reactivate a native personal to-do group after the user has confirmed that they want it. Use todo_update afterward to move an Inbox task into the new group.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["name"],
    },
    async execute({ name }, context) {
      const groupName = name.trim();
      if (!groupName) throw new Error("To-do group name cannot be empty");
      const database = store.requireReady();
      database.exec("BEGIN IMMEDIATE");
      try {
        const selectedGroup = ensureGroup(database, groupName);
        const result = {
          created: selectedGroup.created,
          reactivated: selectedGroup.reactivated,
          group: publicGroup(selectedGroup.row),
        };
        ledger.append({
          type: selectedGroup.created
            ? "personal_todo_group.created"
            : selectedGroup.reactivated
              ? "personal_todo_group.reactivated"
              : "personal_todo_group.unchanged",
          status: "complete", actorType: "tool", actorName: "todo_group_create",
          turnId: context.requestId, operationId: context.callId, name: "Personal to-do group resolved",
          content: selectedGroup.row.name, payload: result,
          subjectType: "todo_group", subjectId: String(selectedGroup.row.todo_group_id),
        });
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "todo_update",
    description: "Update one native personal to-do item by ID, including moving it to another group or completing it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskId: { type: "integer", minimum: 1 },
        text: optionalText,
        group: optionalText,
        status: { type: ["string", "null"], enum: [...todoStatuses, null] },
        scheduledAtUtc: optionalText,
        dueAtUtc: optionalText,
      },
      required: ["taskId", "text", "group", "status", "scheduledAtUtc", "dueAtUtc"],
    },
    async execute({ taskId, text, group: groupName, status, scheduledAtUtc, dueAtUtc }, context) {
      const database = store.requireReady();
      const before = database.prepare("SELECT * FROM personal_tasks WHERE personal_task_id = ?").get(taskId);
      if (!before) throw new Error(`To-do ${taskId} does not exist`);
      const values = {};
      if (text !== null) values.text = text.trim();
      if (groupName !== null) values.todo_group_id = requireGroup(database, groupName).todo_group_id;
      if (status !== null) {
        values.status = status;
        values.completed_at_utc = status === "complete" ? new Date().toISOString() : null;
      }
      if (scheduledAtUtc !== null) values.scheduled_at_utc = scheduledAtUtc || null;
      if (dueAtUtc !== null) values.due_at_utc = dueAtUtc || null;
      if (Object.keys(values).length === 0) throw new Error("No to-do changes were supplied");
      values.updated_at_utc = new Date().toISOString();
      const assignments = Object.keys(values).map((column) => `"${column}" = ?`).join(", ");
      database.prepare(`UPDATE personal_tasks SET ${assignments} WHERE personal_task_id = ?`)
        .run(...Object.values(values), taskId);
      const row = database.prepare(`
        SELECT task.*, todo_group.name AS group_name
        FROM personal_tasks AS task JOIN todo_groups AS todo_group USING (todo_group_id)
        WHERE task.personal_task_id = ?
      `).get(taskId);
      const task = publicTask(row);
      ledger.append({
        type: "personal_todo.updated", status: "complete", actorType: "tool", actorName: "todo_update",
        turnId: context.requestId, operationId: context.callId, name: "Personal to-do updated",
        content: task.text, payload: { before: publicTask({ ...before, group_name: null }), task },
      });
      return { updated: true, task };
    },
  });
}
