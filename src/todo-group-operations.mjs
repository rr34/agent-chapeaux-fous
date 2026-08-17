export class TodoGroupOperationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "TodoGroupOperationError";
    this.statusCode = statusCode;
  }
}

function selectedActiveGroup(database, { groupId = null, groupName = null } = {}) {
  return groupId == null
    ? database.prepare(`
        SELECT * FROM todo_groups
        WHERE name = ? COLLATE NOCASE AND archived_at_utc IS NULL
      `).get(String(groupName || "").trim())
    : database.prepare(`
        SELECT * FROM todo_groups
        WHERE todo_group_id = ? AND archived_at_utc IS NULL
      `).get(Number(groupId));
}

export function renameTodoGroup(database, { groupId = null, groupName = null, newName } = {}) {
  const group = selectedActiveGroup(database, { groupId, groupName });
  if (!group) throw new TodoGroupOperationError("To-do group not found.", 404);
  if (group.name.toLowerCase() === "inbox") {
    throw new TodoGroupOperationError("Inbox is the permanent catchall and cannot be renamed.", 409);
  }
  const name = typeof newName === "string" ? newName.trim() : "";
  if (!name) throw new TodoGroupOperationError("A new group name is required.");
  if (name.length > 200) throw new TodoGroupOperationError("A group name cannot exceed 200 characters.");
  const conflict = database.prepare(`
    SELECT todo_group_id FROM todo_groups
    WHERE name = ? COLLATE NOCASE AND todo_group_id <> ?
  `).get(name, group.todo_group_id);
  if (conflict) throw new TodoGroupOperationError("A to-do group with that name already exists.", 409);

  const updatedAtUtc = new Date().toISOString();
  const renamed = database.prepare(`
    UPDATE todo_groups SET name = ?, updated_at_utc = ?
    WHERE todo_group_id = ? AND archived_at_utc IS NULL
  `).run(name, updatedAtUtc, group.todo_group_id);
  if (renamed.changes !== 1) throw new TodoGroupOperationError("To-do group could not be renamed.", 409);
  return {
    renamed: true,
    group: {
      id: Number(group.todo_group_id),
      name,
      previousName: group.name,
      archivedAtUtc: null,
      updatedAtUtc,
    },
  };
}

export function archiveEmptyTodoGroup(database, { groupId = null, groupName = null } = {}) {
  const group = selectedActiveGroup(database, { groupId, groupName });
  if (!group) throw new TodoGroupOperationError("To-do group not found.", 404);
  if (group.name.toLowerCase() === "inbox") {
    throw new TodoGroupOperationError("Inbox is the permanent catchall and cannot be archived.", 409);
  }

  const activeTaskCount = Number(database.prepare(`
    SELECT COUNT(*) AS count
    FROM personal_tasks
    WHERE todo_group_id = ? AND status IN ('todo', 'ai_suggested')
  `).get(group.todo_group_id).count);
  if (activeTaskCount > 0) {
    throw new TodoGroupOperationError(
      `Move, complete, ignore, or archive the group's ${activeTaskCount} active ${activeTaskCount === 1 ? "task" : "tasks"} before archiving it.`,
      409,
    );
  }

  const retainedTerminalTaskCount = Number(database.prepare(`
    SELECT COUNT(*) AS count FROM personal_tasks WHERE todo_group_id = ?
  `).get(group.todo_group_id).count);
  const archivedAtUtc = new Date().toISOString();
  const archived = database.prepare(`
    UPDATE todo_groups
    SET archived_at_utc = ?, updated_at_utc = ?
    WHERE todo_group_id = ? AND archived_at_utc IS NULL
  `).run(archivedAtUtc, archivedAtUtc, group.todo_group_id);
  if (archived.changes !== 1) throw new TodoGroupOperationError("To-do group could not be archived.", 409);
  return {
    archived: true,
    group: { id: Number(group.todo_group_id), name: group.name, archivedAtUtc },
    retainedTerminalTaskCount,
  };
}

export function setTodoGroupSequenceMode(database, {
  groupId = null, groupName = null, usesSequence,
} = {}) {
  const group = selectedActiveGroup(database, { groupId, groupName });
  if (!group) throw new TodoGroupOperationError("To-do group not found.", 404);
  if (typeof usesSequence !== "boolean") {
    throw new TodoGroupOperationError("usesSequence must be true or false.");
  }

  const updatedAtUtc = new Date().toISOString();
  let assignedTaskCount = 0;
  if (usesSequence) {
    const nextSequence = Number(database.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS value
      FROM personal_tasks
      WHERE todo_group_id = ?
    `).get(group.todo_group_id).value);
    const unnumbered = database.prepare(`
      SELECT personal_task_id
      FROM personal_tasks
      WHERE todo_group_id = ? AND sequence IS NULL
      ORDER BY sort_position, personal_task_id
    `).all(group.todo_group_id);
    const assign = database.prepare(`
      UPDATE personal_tasks
      SET sequence = ?, updated_at_utc = ?
      WHERE personal_task_id = ? AND sequence IS NULL
    `);
    unnumbered.forEach((task, index) => {
      assignedTaskCount += assign.run(
        nextSequence + index, updatedAtUtc, task.personal_task_id,
      ).changes;
    });
  }

  database.prepare(`
    UPDATE todo_groups
    SET uses_sequence = ?, updated_at_utc = ?
    WHERE todo_group_id = ? AND archived_at_utc IS NULL
  `).run(usesSequence ? 1 : 0, updatedAtUtc, group.todo_group_id);
  return {
    changed: Boolean(group.uses_sequence) !== usesSequence,
    assignedTaskCount,
    group: {
      id: Number(group.todo_group_id),
      name: group.name,
      usesSequence,
      archivedAtUtc: null,
      updatedAtUtc,
    },
  };
}
