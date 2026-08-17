import {
  archiveEmptyTodoGroup, renameTodoGroup, setTodoGroupSequenceMode,
} from "../todo-group-operations.mjs";
import { generateNextRoutineTask } from "../organizer-store.mjs";
import { moveOverdueTodosToToday } from "../todo-schedule-operations.mjs";
import {
  buildTodoRecurrenceRule, todoRecurrenceSchema, validateTimeZone,
} from "../todo-recurrence.mjs";
import { selectedFields, withSchemaProjection } from "./schema-result.mjs";

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

const todoGroupFields = [
  "todo_group_id", "name", "sort_position", "uses_sequence",
  "archived_at_utc", "created_at_utc", "updated_at_utc",
];
const personalTaskFields = [
  "personal_task_id", "todo_group_id", "todo_routine_id", "sequence", "related_contact_id",
  "text", "status", "sort_position",
  "scheduled_at_utc", "is_all_day", "due_at_utc", "completed_at_utc", "created_at_utc", "updated_at_utc",
];
const todoRoutineFields = ["todo_routine_id", "recurrence_rule", "time_zone"];

const todoGroupProjection = {
  schemaObjects: ["todo_groups"],
  fields: { todo_groups: todoGroupFields },
};
const activeTodoGroupProjection = {
  schemaObjects: ["todo_groups"],
  fields: { todo_groups: ["todo_group_id", "name", "uses_sequence", "archived_at_utc"] },
};
const todoTaskProjection = {
  schemaObjects: ["personal_tasks", "todo_groups", "todo_routines"],
  fields: {
    personal_tasks: personalTaskFields,
    todo_groups: ["todo_group_id", "name"],
    todo_routines: todoRoutineFields,
  },
};

function databaseGroup(row) {
  return selectedFields(row, todoGroupFields);
}

function databaseTask(row) {
  if (!row) return null;
  return {
    ...selectedFields(row, personalTaskFields),
    todo_groups: {
      todo_group_id: row.todo_group_id,
      name: row.group_name ?? null,
    },
    todo_routines: row.todo_routine_id == null ? null : {
      todo_routine_id: row.todo_routine_id,
      recurrence_rule: row.routine_recurrence_rule ?? null,
      time_zone: row.routine_time_zone ?? null,
    },
  };
}

function todoResult(schemaSemantics, context, result, {
  name, purpose, groupOnly = false, projection = null,
}) {
  const selected = projection ?? (groupOnly ? todoGroupProjection : todoTaskProjection);
  return withSchemaProjection(schemaSemantics, context, result, {
    name,
    purpose,
    ...selected,
  });
}

const optionalText = { type: ["string", "null"] };

export function registerTodoTools(registry, store, ledger, schemaSemantics = null) {
  registry.register({
    name: "todo_group_list",
    description: "List active native to-do groups and their open task counts. Before adding a to-do without an explicitly named group, use this to choose the best clear existing group from the task's subject and context. Use Inbox only when no existing group is a reasonable match.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
    async execute(_argumentsObject, context) {
      const rows = store.requireReady().prepare(`
        SELECT todo_group.todo_group_id, todo_group.name, todo_group.uses_sequence,
               todo_group.archived_at_utc,
               COUNT(task.personal_task_id) AS open_task_count
        FROM todo_groups AS todo_group
        LEFT JOIN personal_tasks AS task
          ON task.todo_group_id = todo_group.todo_group_id
         AND task.status NOT IN ('complete', 'ignore', 'archive')
        WHERE todo_group.archived_at_utc IS NULL
        GROUP BY todo_group.todo_group_id
        ORDER BY todo_group.name COLLATE NOCASE, todo_group.todo_group_id
      `).all();
      return todoResult(schemaSemantics, context, {
        count: rows.length,
        groups: rows.map((row) => ({
          ...databaseGroup(row),
          open_task_count: Number(row.open_task_count),
        })),
      }, {
        name: "todo_group_list",
        purpose: "List active to-do groups and the computed count of open tasks in each group.",
        projection: activeTodoGroupProjection,
      });
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
    async execute({ group: groupName, status, limit }, context) {
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
      `).all(...values, Math.min(200, Math.max(1, Number(limit) || 50))).map(databaseTask);
      return todoResult(schemaSemantics, context, { count: rows.length, tasks: rows }, {
        name: "todo_list",
        purpose: "List personal tasks together with their to-do group and optional routine fields.",
      });
    },
  });

  registry.register({
    name: "todo_add",
    description: "Add one native personal to-do item, optionally with an all-day schedule or structured recurrence. Set is_all_day=true when the user names a calendar day without an exact time; scheduled_at_utc should represent local midnight in the user's time zone. Never write RRULE syntax: express recurrence with frequency, interval, weekdays, count or until_date, and time_zone. A recurring todo requires scheduled_at_utc. Honor an explicitly named group. When no group is named, first use todo_group_list and choose the best clear existing match; use Inbox only when no group is reasonably implied. If the requested group does not exist, add it to Inbox and return group_resolution.used_inbox_fallback=true; then ask whether to create the requested group and move the task. Never create a requested group implicitly.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        group: optionalText,
        scheduled_at_utc: optionalText,
        is_all_day: { type: "boolean" },
        due_at_utc: optionalText,
        recurrence: todoRecurrenceSchema,
      },
      required: ["text", "group", "scheduled_at_utc", "due_at_utc"],
    },
    async execute({
      text, group: groupName, scheduled_at_utc: scheduledAtUtc,
      is_all_day: isAllDay = false, due_at_utc: dueAtUtc, recurrence = null,
    }, context) {
      const database = store.requireReady();
      const taskText = text.trim();
      if (!taskText) throw new Error("To-do text cannot be empty");
      if (recurrence && !scheduledAtUtc) throw new Error("A recurring to-do requires scheduled_at_utc");
      if (isAllDay && !scheduledAtUtc) throw new Error("An all-day to-do requires scheduled_at_utc");
      const recurrenceRule = recurrence ? buildTodoRecurrenceRule(recurrence) : null;
      const recurrenceTimeZone = recurrence ? validateTimeZone(recurrence.time_zone) : null;
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
        const inserted = database.prepare(`
          INSERT INTO personal_tasks (
            todo_group_id, todo_routine_id, text, status, sort_position, scheduled_at_utc,
            is_all_day, due_at_utc, source, source_event_id
          ) VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, 'agent-slayer', ?)
        `).run(
          selectedGroup.todo_group_id, routineId, taskText, sortPosition,
          scheduledAtUtc || null, isAllDay ? 1 : 0, dueAtUtc || null, sourceEventId,
        );
        const row = database.prepare("SELECT * FROM personal_tasks WHERE personal_task_id = ?")
          .get(Number(inserted.lastInsertRowid));
        const task = databaseTask({
          ...row,
          group_name: selectedGroup.name,
          routine_recurrence_rule: recurrenceRule,
          routine_time_zone: recurrenceTimeZone,
        });
        const groupResolution = {
          requested_group: requestedGroup,
          actual_group: selectedGroup.name,
          requested_group_found: Boolean(requestedGroupRow),
          used_inbox_fallback: usedInboxFallback,
          ask_to_create_requested_group: usedInboxFallback,
        };
        ledger.append({
          type: "personal_todo.created", status: "complete", actorType: "tool", actorName: "todo_add",
          turnId: context.requestId, operationId: context.callId, name: "Personal to-do created",
          content: task.text,
          payload: { task, groupResolution },
          subjectType: "personal_task", subjectId: String(task.personal_task_id),
        });
        const result = todoResult(schemaSemantics, context, {
          created: true,
          group_resolution: groupResolution,
          task,
        }, {
          name: "todo_add",
          purpose: "Return the personal task created by the native to-do tool and its selected group and routine fields.",
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
          group: databaseGroup(selectedGroup.row),
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
        const semanticResult = todoResult(schemaSemantics, context, result, {
          name: "todo_group_create",
          purpose: "Return the to-do group created, reactivated, or found unchanged.",
          groupOnly: true,
        });
        database.exec("COMMIT");
        return semanticResult;
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
        current_name: { type: "string", minLength: 1, maxLength: 200 },
        new_name: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["current_name", "new_name"],
    },
    async execute({ current_name: currentName, new_name: newName }, context) {
      const database = store.requireReady();
      database.exec("BEGIN IMMEDIATE");
      try {
        const operationResult = renameTodoGroup(database, { groupName: currentName, newName });
        const groupRow = database.prepare("SELECT * FROM todo_groups WHERE todo_group_id = ?")
          .get(operationResult.group.id);
        const result = {
          renamed: true,
          previous_name: operationResult.group.previousName,
          group: databaseGroup(groupRow),
        };
        ledger.append({
          type: "personal_todo_group.renamed",
          status: "complete", actorType: "tool", actorName: "todo_group_rename",
          turnId: context.requestId, operationId: context.callId,
          name: "Personal to-do group renamed",
          content: `${result.previous_name} → ${result.group.name}`,
          payload: result,
          subjectType: "todo_group", subjectId: String(result.group.todo_group_id),
        });
        const semanticResult = todoResult(schemaSemantics, context, result, {
          name: "todo_group_rename",
          purpose: "Return the renamed to-do group using its stored database fields.",
          groupOnly: true,
        });
        database.exec("COMMIT");
        return semanticResult;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "todo_group_sequence_set",
    description: "Turn automatic sequence assignment on or off for one active native to-do group. Enabling it assigns stable unique numbers to existing unnumbered tasks in their current order; future tasks added without a number receive max(sequence) + 1. Disabling it preserves existing numbers but stops automatic assignment.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
        uses_sequence: { type: "boolean" },
      },
      required: ["name", "uses_sequence"],
    },
    async execute({ name, uses_sequence: usesSequence }, context) {
      const database = store.requireReady();
      database.exec("BEGIN IMMEDIATE");
      try {
        const operationResult = setTodoGroupSequenceMode(database, {
          groupName: name,
          usesSequence,
        });
        const groupRow = database.prepare("SELECT * FROM todo_groups WHERE todo_group_id = ?")
          .get(operationResult.group.id);
        const result = {
          changed: operationResult.changed,
          assigned_task_count: operationResult.assignedTaskCount,
          group: databaseGroup(groupRow),
        };
        ledger.append({
          type: "personal_todo_group.sequence_mode_set",
          status: "complete", actorType: "tool", actorName: "todo_group_sequence_set",
          turnId: context.requestId, operationId: context.callId,
          name: "Personal to-do group sequence mode set",
          content: `${groupRow.name}: ${usesSequence ? "automatic sequence on" : "automatic sequence off"}`,
          payload: result,
          subjectType: "todo_group", subjectId: String(groupRow.todo_group_id),
        });
        const semanticResult = todoResult(schemaSemantics, context, result, {
          name: "todo_group_sequence_set",
          purpose: "Return the to-do group's automatic sequence setting and the number of existing tasks assigned a sequence.",
          groupOnly: true,
        });
        database.exec("COMMIT");
        return semanticResult;
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
        const operationResult = archiveEmptyTodoGroup(database, { groupName: name });
        const groupRow = database.prepare("SELECT * FROM todo_groups WHERE todo_group_id = ?")
          .get(operationResult.group.id);
        const result = {
          archived: true,
          retained_terminal_task_count: operationResult.retainedTerminalTaskCount,
          group: databaseGroup(groupRow),
        };
        ledger.append({
          type: "personal_todo_group.archived",
          status: "complete", actorType: "tool", actorName: "todo_group_archive",
          turnId: context.requestId, operationId: context.callId,
          name: "Personal to-do group archived", content: result.group.name, payload: result,
          subjectType: "todo_group", subjectId: String(result.group.todo_group_id),
        });
        const semanticResult = todoResult(schemaSemantics, context, result, {
          name: "todo_group_archive",
          purpose: "Return the archived to-do group using its stored database fields.",
          groupOnly: true,
        });
        database.exec("COMMIT");
        return semanticResult;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });

  registry.register({
    name: "todo_recurrence_set",
    description: "Add, change, or remove recurrence for an existing native to-do. Use structured recurrence fields; never compose RRULE syntax. The task must already have scheduled_at_utc before recurrence can be enabled. Set enabled=false and recurrence=null to make the current task one-time and disable future occurrences.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        personal_task_id: { type: "integer", minimum: 1 },
        enabled: { type: "boolean" },
        recurrence: todoRecurrenceSchema,
      },
      required: ["personal_task_id", "enabled", "recurrence"],
    },
    async execute({ personal_task_id: taskId, enabled, recurrence }, context) {
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
      const recurrenceTimeZone = enabled ? validateTimeZone(recurrence.time_zone) : null;
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
        const task = databaseTask(row);
        ledger.append({
          type: enabled ? "personal_todo.recurrence_set" : "personal_todo.recurrence_disabled",
          status: "complete", actorType: "tool", actorName: "todo_recurrence_set",
          turnId: context.requestId, operationId: context.callId,
          name: enabled ? "To-do recurrence set" : "To-do recurrence disabled",
          content: task.text,
          payload: { before: databaseTask(before), task },
          subjectType: "personal_task", subjectId: String(task.personal_task_id),
        });
        const result = todoResult(schemaSemantics, context, { updated: true, task }, {
          name: "todo_recurrence_set",
          purpose: "Return the personal task and stored routine fields after changing recurrence.",
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
    name: "todo_move_overdue_to_today",
    description: "Move every active native to-do scheduled before the specified local day onto that day in one batch. Use this when the user asks to move, roll, or stack overdue scheduled tasks onto today. The scheduled local time is preserved, and any due date moves by the same number of calendar days. Completed, ignored, archived, unscheduled, and already-current tasks are unchanged.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        local_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        time_zone: { type: "string", minLength: 1, maxLength: 100 },
      },
      required: ["local_date", "time_zone"],
    },
    async execute({ local_date: localDate, time_zone: timeZone }, context) {
      const database = store.requireReady();
      database.exec("BEGIN IMMEDIATE");
      try {
        const operation = moveOverdueTodosToToday(database, { localDate, timeZone });
        const movedTodoIds = operation.moves.map(({ id }) => id);
        const rows = movedTodoIds.length === 0 ? [] : database.prepare(`
          SELECT task.*, todo_group.name AS group_name,
                 routine.recurrence_rule AS routine_recurrence_rule,
                 routine.time_zone AS routine_time_zone
          FROM personal_tasks AS task
          JOIN todo_groups AS todo_group USING (todo_group_id)
          LEFT JOIN todo_routines AS routine USING (todo_routine_id)
          WHERE task.personal_task_id IN (${movedTodoIds.map(() => "?").join(", ")})
          ORDER BY task.personal_task_id
        `).all(...movedTodoIds).map(databaseTask);
        const result = {
          moved_count: rows.length,
          local_date: operation.localDate,
          time_zone: operation.timeZone,
          tasks: rows,
        };
        if (rows.length > 0) {
          ledger.append({
            type: "personal_todos.moved_to_today",
            status: "complete", actorType: "tool", actorName: "todo_move_overdue_to_today",
            turnId: context.requestId, operationId: context.callId,
            name: "Overdue tasks moved to today",
            content: `Moved ${rows.length} overdue ${rows.length === 1 ? "task" : "tasks"} to ${operation.localDate}`,
            payload: result,
            subjectType: "personal_task_batch", subjectId: operation.localDate,
          });
        }
        const semanticResult = todoResult(schemaSemantics, context, result, {
          name: "todo_move_overdue_to_today",
          purpose: "Return all active personal tasks moved from past scheduled days onto the requested local day.",
        });
        database.exec("COMMIT");
        return semanticResult;
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
        personal_task_id: { type: "integer", minimum: 1 },
        text: optionalText,
        group: optionalText,
        status: { type: ["string", "null"], enum: [...todoStatuses, null] },
        scheduled_at_utc: optionalText,
        is_all_day: { type: ["boolean", "null"] },
        due_at_utc: optionalText,
      },
      required: ["personal_task_id", "text", "group", "status", "scheduled_at_utc", "due_at_utc"],
    },
    async execute({
      personal_task_id: taskId, text, group: groupName, status,
      scheduled_at_utc: scheduledAtUtc, is_all_day: isAllDay, due_at_utc: dueAtUtc,
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
          throw new Error("An all-day to-do requires scheduled_at_utc");
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
        let generatedTask = null;
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
            payload: { task: databaseTask(generated), todo_routine_id: generated.todo_routine_id },
            subjectType: "personal_task", subjectId: String(generatedTaskId),
          });
          database.prepare(`
            UPDATE personal_tasks SET source_event_id = ? WHERE personal_task_id = ?
          `).run(generatedEventId, generatedTaskId);
          generatedTask = databaseTask({ ...generated, source_event_id: generatedEventId });
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
        const task = databaseTask(row);
        ledger.append({
          type: "personal_todo.updated", status: "complete", actorType: "tool", actorName: "todo_update",
          turnId: context.requestId, operationId: context.callId, name: "Personal to-do updated",
          content: task.text,
          payload: { before: databaseTask({ ...before, group_name: null }), task, generated_task: generatedTask },
        });
        const result = todoResult(schemaSemantics, context, {
          updated: true,
          task,
          generated_task: generatedTask,
        }, {
          name: "todo_update",
          purpose: "Return the updated personal task and any next routine occurrence generated by the update.",
        });
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  });
}
