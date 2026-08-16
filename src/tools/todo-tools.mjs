import { archiveEmptyTodoGroup, renameTodoGroup } from "../todo-group-operations.mjs";
import { generateNextRoutineTask } from "../organizer-store.mjs";
import {
  buildTodoRecurrenceRule, todoRecurrenceSchema, validateTimeZone,
} from "../todo-recurrence.mjs";

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
    routineId: row.todo_routine_id == null ? null : Number(row.todo_routine_id),
    text: row.text,
    status: row.status,
    sortPosition: Number(row.sort_position),
    scheduledAtUtc: row.scheduled_at_utc,
    isAllDay: Boolean(row.is_all_day),
    dueAtUtc: row.due_at_utc,
    completedAtUtc: row.completed_at_utc,
    createdAtUtc: row.created_at_utc,
    updatedAtUtc: row.updated_at_utc,
    recurrenceRule: row.routine_recurrence_rule ?? null,
    recurrenceTimeZone: row.routine_time_zone ?? null,
  };
}

const optionalText = { type: ["string", "null"] };

export function registerTodoTools(registry, store, ledger) {
  registry.register({
    name: "todo_group_list",
    description: "List active native to-do groups and their open task counts. Before adding a to-do without an explicitly named group, use this to choose the best clear existing group from the task's subject and context. Use Inbox only when no existing group is a reasonable match.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
    async execute() {
      const rows = store.requireReady().prepare(`
        SELECT todo_group.todo_group_id, todo_group.name, todo_group.archived_at_utc,
               COUNT(task.personal_task_id) AS open_task_count
        FROM todo_groups AS todo_group
        LEFT JOIN personal_tasks AS task
          ON task.todo_group_id = todo_group.todo_group_id
         AND task.status NOT IN ('complete', 'ignore', 'archive')
        WHERE todo_group.archived_at_utc IS NULL
        GROUP BY todo_group.todo_group_id
        ORDER BY todo_group.name COLLATE NOCASE, todo_group.todo_group_id
      `).all();
      return {
        count: rows.length,
        groups: rows.map((row) => ({
          ...publicGroup(row),
          openTaskCount: Number(row.open_task_count),
        })),
      };
    },
  });

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
        SELECT task.*, todo_group.name AS group_name,
               routine.recurrence_rule AS routine_recurrence_rule,
               routine.time_zone AS routine_time_zone
        FROM personal_tasks AS task
        JOIN todo_groups AS todo_group USING (todo_group_id)
        LEFT JOIN todo_routines AS routine USING (todo_routine_id)
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY todo_group.name COLLATE NOCASE, task.sort_position, task.personal_task_id
        LIMIT ?
      `).all(...values, Math.min(200, Math.max(1, Number(limit) || 50))).map(publicTask);
      return { count: rows.length, tasks: rows };
    },
  });

  registry.register({
    name: "todo_add",
    description: "Add one native personal to-do item, optionally with an all-day schedule or structured recurrence. Set isAllDay=true when the user names a calendar day without an exact time; scheduledAtUtc should represent local midnight in the user's time zone. Never write RRULE syntax: express recurrence with frequency, interval, weekdays, count or untilDate, and timeZone. A recurring todo requires scheduledAtUtc. Honor an explicitly named group. When no group is named, first use todo_group_list and choose the best clear existing match; use Inbox only when no group is reasonably implied. If the requested group does not exist, add it to Inbox and return usedInboxFallback=true; then ask whether to create the requested group and move the task. Never create a requested group implicitly.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        group: optionalText,
        scheduledAtUtc: optionalText,
        isAllDay: { type: "boolean" },
        dueAtUtc: optionalText,
        recurrence: todoRecurrenceSchema,
      },
      required: ["text", "group", "scheduledAtUtc", "dueAtUtc"],
    },
    async execute({
      text, group: groupName, scheduledAtUtc, isAllDay = false, dueAtUtc, recurrence = null,
    }, context) {
      const database = store.requireReady();
      const taskText = text.trim();
      if (!taskText) throw new Error("To-do text cannot be empty");
      if (recurrence && !scheduledAtUtc) throw new Error("A recurring to-do requires scheduledAtUtc");
      if (isAllDay && !scheduledAtUtc) throw new Error("An all-day to-do requires scheduledAtUtc");
      const recurrenceRule = recurrence ? buildTodoRecurrenceRule(recurrence) : null;
      const recurrenceTimeZone = recurrence ? validateTimeZone(recurrence.timeZone) : null;
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
        let routineId = null;
        if (recurrenceRule) {
          const routine = database.prepare(`
            INSERT INTO todo_routines (
              todo_group_id, text, first_scheduled_at_utc, first_due_at_utc,
              time_zone, is_all_day, recurrence_rule
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            selectedGroup.todo_group_id, taskText, scheduledAtUtc, dueAtUtc || null,
            recurrenceTimeZone, isAllDay ? 1 : 0, recurrenceRule,
          );
          routineId = Number(routine.lastInsertRowid);
        }
        const row = database.prepare(`
          INSERT INTO personal_tasks (
            todo_group_id, todo_routine_id, text, status, sort_position, scheduled_at_utc,
            is_all_day, due_at_utc, source, source_event_id
          ) VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, 'agent-slayer', ?)
          RETURNING *
        `).get(
          selectedGroup.todo_group_id, routineId, taskText, sortPosition,
          scheduledAtUtc || null, isAllDay ? 1 : 0, dueAtUtc || null, sourceEventId,
        );
        const task = publicTask({
          ...row,
          group_name: selectedGroup.name,
          routine_recurrence_rule: recurrenceRule,
          routine_time_zone: recurrenceTimeZone,
        });
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
    name: "todo_group_rename",
    description: "Rename one active native to-do group. Tasks and routines remain in the same group because its stable ID does not change. Inbox is the permanent catchall and cannot be renamed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        currentName: { type: "string", minLength: 1, maxLength: 200 },
        newName: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["currentName", "newName"],
    },
    async execute({ currentName, newName }, context) {
      const database = store.requireReady();
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = renameTodoGroup(database, { groupName: currentName, newName });
        ledger.append({
          type: "personal_todo_group.renamed",
          status: "complete", actorType: "tool", actorName: "todo_group_rename",
          turnId: context.requestId, operationId: context.callId,
          name: "Personal to-do group renamed",
          content: `${result.group.previousName} → ${result.group.name}`,
          payload: result,
          subjectType: "todo_group", subjectId: String(result.group.id),
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
    name: "todo_group_archive",
    description: "Archive one native to-do group by name so it leaves active group lists. This fails while the group contains active todo or ai_suggested tasks. Completed, ignored, and archived tasks retain their historical group. Inbox cannot be archived.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["name"],
    },
    async execute({ name }, context) {
      const database = store.requireReady();
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = archiveEmptyTodoGroup(database, { groupName: name });
        ledger.append({
          type: "personal_todo_group.archived",
          status: "complete", actorType: "tool", actorName: "todo_group_archive",
          turnId: context.requestId, operationId: context.callId,
          name: "Personal to-do group archived", content: result.group.name, payload: result,
          subjectType: "todo_group", subjectId: String(result.group.id),
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
    name: "todo_recurrence_set",
    description: "Add, change, or remove recurrence for an existing native to-do. Use structured recurrence fields; never compose RRULE syntax. The task must already have scheduledAtUtc before recurrence can be enabled. Set enabled=false and recurrence=null to make the current task one-time and disable future occurrences.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskId: { type: "integer", minimum: 1 },
        enabled: { type: "boolean" },
        recurrence: todoRecurrenceSchema,
      },
      required: ["taskId", "enabled", "recurrence"],
    },
    async execute({ taskId, enabled, recurrence }, context) {
      const database = store.requireReady();
      const before = database.prepare(`
        SELECT task.*, todo_group.name AS group_name,
               routine.recurrence_rule AS routine_recurrence_rule,
               routine.time_zone AS routine_time_zone
        FROM personal_tasks AS task
        JOIN todo_groups AS todo_group USING (todo_group_id)
        LEFT JOIN todo_routines AS routine USING (todo_routine_id)
        WHERE task.personal_task_id = ?
      `).get(taskId);
      if (!before) throw new Error(`To-do ${taskId} does not exist`);
      if (enabled && !recurrence) throw new Error("recurrence is required when enabled is true");
      if (enabled && !before.scheduled_at_utc) throw new Error("Schedule the to-do before enabling recurrence");
      const recurrenceRule = enabled ? buildTodoRecurrenceRule(recurrence) : null;
      const recurrenceTimeZone = enabled ? validateTimeZone(recurrence.timeZone) : null;
      const updatedAt = new Date().toISOString();

      database.exec("BEGIN IMMEDIATE");
      try {
        let routineId = before.todo_routine_id == null ? null : Number(before.todo_routine_id);
        if (enabled && routineId) {
          database.prepare(`
            UPDATE todo_routines
            SET todo_group_id = ?, text = ?, first_scheduled_at_utc = ?, first_due_at_utc = ?,
                time_zone = ?, is_all_day = ?, recurrence_rule = ?, disabled_at_utc = NULL, updated_at_utc = ?
            WHERE todo_routine_id = ?
          `).run(
            before.todo_group_id, before.text, before.scheduled_at_utc, before.due_at_utc,
            recurrenceTimeZone, before.is_all_day, recurrenceRule, updatedAt, routineId,
          );
        } else if (enabled) {
          const routine = database.prepare(`
            INSERT INTO todo_routines (
              todo_group_id, text, first_scheduled_at_utc, first_due_at_utc,
              time_zone, is_all_day, recurrence_rule
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            before.todo_group_id, before.text, before.scheduled_at_utc, before.due_at_utc,
            recurrenceTimeZone, before.is_all_day, recurrenceRule,
          );
          routineId = Number(routine.lastInsertRowid);
        } else if (routineId) {
          database.prepare(`
            UPDATE todo_routines SET disabled_at_utc = ?, updated_at_utc = ?
            WHERE todo_routine_id = ?
          `).run(updatedAt, updatedAt, routineId);
          routineId = null;
        }
        database.prepare(`
          UPDATE personal_tasks SET todo_routine_id = ?, updated_at_utc = ?
          WHERE personal_task_id = ?
        `).run(routineId, updatedAt, taskId);
        const row = database.prepare(`
          SELECT task.*, todo_group.name AS group_name,
                 routine.recurrence_rule AS routine_recurrence_rule,
                 routine.time_zone AS routine_time_zone
          FROM personal_tasks AS task
          JOIN todo_groups AS todo_group USING (todo_group_id)
          LEFT JOIN todo_routines AS routine USING (todo_routine_id)
          WHERE task.personal_task_id = ?
        `).get(taskId);
        const task = publicTask(row);
        ledger.append({
          type: enabled ? "personal_todo.recurrence_set" : "personal_todo.recurrence_disabled",
          status: "complete", actorType: "tool", actorName: "todo_recurrence_set",
          turnId: context.requestId, operationId: context.callId,
          name: enabled ? "To-do recurrence set" : "To-do recurrence disabled",
          content: task.text,
          payload: { before: publicTask(before), task },
          subjectType: "personal_task", subjectId: String(task.id),
        });
        database.exec("COMMIT");
        return { updated: true, task };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "todo_update",
    description: "Update one native personal to-do item by ID, including moving it to another group, changing its all-day scheduling flag, or completing it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskId: { type: "integer", minimum: 1 },
        text: optionalText,
        group: optionalText,
        status: { type: ["string", "null"], enum: [...todoStatuses, null] },
        scheduledAtUtc: optionalText,
        isAllDay: { type: ["boolean", "null"] },
        dueAtUtc: optionalText,
      },
      required: ["taskId", "text", "group", "status", "scheduledAtUtc", "dueAtUtc"],
    },
    async execute({
      taskId, text, group: groupName, status, scheduledAtUtc, isAllDay, dueAtUtc,
    }, context) {
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
      if (isAllDay !== null && isAllDay !== undefined) values.is_all_day = isAllDay ? 1 : 0;
      if (dueAtUtc !== null) values.due_at_utc = dueAtUtc || null;
      if (Object.keys(values).length === 0) throw new Error("No to-do changes were supplied");
      values.updated_at_utc = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const assignments = Object.keys(values).map((column) => `"${column}" = ?`).join(", ");
        database.prepare(`UPDATE personal_tasks SET ${assignments} WHERE personal_task_id = ?`)
          .run(...Object.values(values), taskId);
        const current = database.prepare("SELECT * FROM personal_tasks WHERE personal_task_id = ?").get(taskId);
        if (current.is_all_day && !current.scheduled_at_utc) {
          throw new Error("An all-day to-do requires scheduledAtUtc");
        }
        if (current.todo_routine_id) {
          database.prepare(`
            UPDATE todo_routines
            SET todo_group_id = ?, text = ?, first_scheduled_at_utc = ?, first_due_at_utc = ?,
                is_all_day = ?, updated_at_utc = ?
            WHERE todo_routine_id = ?
          `).run(
            current.todo_group_id, current.text, current.scheduled_at_utc, current.due_at_utc,
            current.is_all_day, values.updated_at_utc, current.todo_routine_id,
          );
        }
        const becameTerminal = ["complete", "ignore"].includes(current.status)
          && !["complete", "ignore"].includes(before.status);
        const generatedTaskId = becameTerminal ? generateNextRoutineTask(database, taskId) : null;
        if (generatedTaskId) {
          const generated = database.prepare(`
            SELECT task.*, todo_group.name AS group_name,
                   routine.recurrence_rule AS routine_recurrence_rule,
                   routine.time_zone AS routine_time_zone
            FROM personal_tasks AS task
            JOIN todo_groups AS todo_group USING (todo_group_id)
            LEFT JOIN todo_routines AS routine USING (todo_routine_id)
            WHERE task.personal_task_id = ?
          `).get(generatedTaskId);
          const generatedEventId = ledger.append({
            type: "personal_todo.generated", status: "complete",
            actorType: "system", actorName: "Slayer routine scheduler",
            turnId: context.requestId, operationId: context.callId,
            name: "Routine task generated", content: generated.text,
            payload: { task: publicTask(generated), routineId: generated.todo_routine_id },
            subjectType: "personal_task", subjectId: String(generatedTaskId),
          });
          database.prepare(`
            UPDATE personal_tasks SET source_event_id = ? WHERE personal_task_id = ?
          `).run(generatedEventId, generatedTaskId);
        }
        const row = database.prepare(`
          SELECT task.*, todo_group.name AS group_name,
                 routine.recurrence_rule AS routine_recurrence_rule,
                 routine.time_zone AS routine_time_zone
          FROM personal_tasks AS task
          JOIN todo_groups AS todo_group USING (todo_group_id)
          LEFT JOIN todo_routines AS routine USING (todo_routine_id)
          WHERE task.personal_task_id = ?
        `).get(taskId);
        const task = publicTask(row);
        ledger.append({
          type: "personal_todo.updated", status: "complete", actorType: "tool", actorName: "todo_update",
          turnId: context.requestId, operationId: context.callId, name: "Personal to-do updated",
          content: task.text,
          payload: { before: publicTask({ ...before, group_name: null }), task, generatedTaskId },
        });
        database.exec("COMMIT");
        return { updated: true, task, generatedTaskId };
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });
}
