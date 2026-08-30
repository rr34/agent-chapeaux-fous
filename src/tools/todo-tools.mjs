import {
  archiveEmptyTodoGroup, renameTodoGroup, setTodoGroupSequenceMode,
} from "../todo-group-operations.mjs";
import { generateNextRoutineTask } from "../organizer-store.mjs";
import { localDateUtcBounds, moveOverdueTodosToToday } from "../todo-schedule-operations.mjs";
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
const todoRoutineFields = [
  "todo_routine_id", "recurrence_rule", "time_zone", "interaction_guide_id",
];
const interactionGuideFields = ["interaction_guide_id", "name", "status", "version"];

const todoGroupProjection = {
  schemaObjects: ["todo_groups"],
  fields: { todo_groups: todoGroupFields },
};
const activeTodoGroupProjection = {
  schemaObjects: ["todo_groups"],
  fields: { todo_groups: ["todo_group_id", "name", "uses_sequence", "archived_at_utc"] },
};
const todoTaskProjection = {
  schemaObjects: ["personal_tasks", "todo_groups", "todo_routines", "interaction_guides"],
  fields: {
    personal_tasks: personalTaskFields,
    todo_groups: ["todo_group_id", "name"],
    todo_routines: todoRoutineFields,
    interaction_guides: interactionGuideFields,
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
      interaction_guide_id: row.interaction_guide_id ?? null,
    },
    interaction_guides: row.interaction_guide_id == null ? null : {
      interaction_guide_id: row.interaction_guide_id,
      name: row.interaction_guide_name ?? null,
      status: row.interaction_guide_status ?? null,
      version: row.interaction_guide_version == null ? null : Number(row.interaction_guide_version),
    },
  };
}

function taskWithContext(database, taskId) {
  return database.prepare(`
    SELECT task.*, todo_group.name AS group_name,
           routine.recurrence_rule AS routine_recurrence_rule,
           routine.time_zone AS routine_time_zone,
           routine.interaction_guide_id,
           interaction_guide.name AS interaction_guide_name,
           interaction_guide.status AS interaction_guide_status,
           interaction_guide.version AS interaction_guide_version
    FROM personal_tasks AS task
    JOIN todo_groups AS todo_group USING (todo_group_id)
    LEFT JOIN todo_routines AS routine USING (todo_routine_id)
    LEFT JOIN interaction_guides AS interaction_guide
      ON interaction_guide.interaction_guide_id = routine.interaction_guide_id
    WHERE task.personal_task_id = ?
  `).get(taskId);
}

function setTodoPosition(database, taskId, position) {
  const selected = database.prepare(`
    SELECT todo_group_id FROM personal_tasks WHERE personal_task_id = ?
  `).get(taskId);
  if (!selected) throw new Error(`To-do ${taskId} does not exist`);
  const rows = database.prepare(`
    SELECT personal_task_id
    FROM personal_tasks
    WHERE todo_group_id = ?
    ORDER BY sort_position, personal_task_id
  `).all(selected.todo_group_id);
  if (position > rows.length) {
    throw new Error(`position must be between 1 and ${rows.length} for this to-do group`);
  }
  const orderedTaskIds = rows.map(({ personal_task_id: id }) => Number(id));
  const previousPosition = orderedTaskIds.indexOf(taskId) + 1;
  if (previousPosition !== position) {
    orderedTaskIds.splice(previousPosition - 1, 1);
    orderedTaskIds.splice(position - 1, 0, taskId);
    const updatedAtUtc = new Date().toISOString();
    const update = database.prepare(`
      UPDATE personal_tasks
      SET sort_position = ?, updated_at_utc = ?
      WHERE personal_task_id = ? AND todo_group_id = ?
    `);
    orderedTaskIds.forEach((id, index) => {
      update.run((index + 1) * 10, updatedAtUtc, id, selected.todo_group_id);
    });
  }
  return {
    changed: previousPosition !== position,
    previousPosition,
    position,
    taskCount: orderedTaskIds.length,
    orderedTaskIds,
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

function activeTodoGroupRows(store) {
  return store.requireReady().prepare(`
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
}

export function todoGroupContext(store, limit = 100) {
  const allRows = activeTodoGroupRows(store);
  const rows = allRows.slice(0, limit).map((row) => ({
    todoGroupId: Number(row.todo_group_id),
    name: row.name,
  }));
  return {
    heading: "Active to-do groups",
    text: rows.length
      ? [
          "Use these exact existing group names and IDs when they plausibly match the request. Do not load or infer individual to-do items from this reference list.",
          ...rows.map((group) => `- [group ${group.todoGroupId}] ${group.name}`),
          ...(allRows.length > rows.length ? [`[${allRows.length - rows.length} additional active group(s) omitted]`] : []),
        ].join("\n")
      : "No active to-do groups exist.",
    data: { groups: rows, totalCount: allRows.length, omittedCount: allRows.length - rows.length },
  };
}

export function registerTodoTools(registry, store, ledger, schemaSemantics = null) {
  const rootRegistry = registry;
  registry = registry.withCapability?.("todos") ?? registry;
  rootRegistry.registerContextView?.("todos", {
    id: "todos.active_groups",
    title: "Active to-do groups",
    description: "Active to-do group names and IDs; no individual to-do items.",
    maximumItems: 100,
    execute: () => todoGroupContext(store),
  });
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
      const rows = activeTodoGroupRows(store);
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
    description: "List the user's native personal to-do items. Use completed_on_date to select tasks completed on one local calendar date and scheduled_on_date to select tasks scheduled on one local calendar date; these are query filters and do not add ranges to task records. Supply time_zone whenever either date filter is used. With no status and no completed date, terminal tasks remain excluded as before.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        group: optionalText,
        status: { type: ["string", "null"], enum: [...todoStatuses, null] },
        completed_on_date: { type: ["string", "null"], description: "Local completion date in YYYY-MM-DD form." },
        scheduled_on_date: { type: ["string", "null"], description: "Local scheduled date in YYYY-MM-DD form." },
        time_zone: { type: ["string", "null"], description: "IANA time zone used to interpret date filters." },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["group", "status", "limit"],
    },
    async execute({
      group: groupName,
      status,
      completed_on_date: completedOnDate = null,
      scheduled_on_date: scheduledOnDate = null,
      time_zone: timeZone = null,
      limit,
    }, context) {
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
      } else if (completedOnDate === null) {
        conditions.push("task.status NOT IN ('complete', 'ignore', 'archive')");
      }
      for (const [column, localDate] of [
        ["completed_at_utc", completedOnDate],
        ["scheduled_at_utc", scheduledOnDate],
      ]) {
        if (localDate === null) continue;
        const bounds = localDateUtcBounds({ localDate, timeZone });
        conditions.push(`task.${column} >= ? AND task.${column} < ?`);
        values.push(bounds.startsAtUtc, bounds.endsAtUtc);
      }
      const order = completedOnDate !== null
        ? "task.completed_at_utc DESC, task.personal_task_id DESC"
        : scheduledOnDate !== null
          ? "task.scheduled_at_utc, task.personal_task_id"
          : `todo_group.name COLLATE NOCASE,
                 task.sequence IS NULL, task.sequence DESC,
                 task.sort_position, task.personal_task_id`;
      const rows = database.prepare(`
        SELECT task.*, todo_group.name AS group_name,
               routine.recurrence_rule AS routine_recurrence_rule,
               routine.time_zone AS routine_time_zone,
               routine.interaction_guide_id,
               interaction_guide.name AS interaction_guide_name,
               interaction_guide.status AS interaction_guide_status,
               interaction_guide.version AS interaction_guide_version
        FROM personal_tasks AS task
        JOIN todo_groups AS todo_group USING (todo_group_id)
        LEFT JOIN todo_routines AS routine USING (todo_routine_id)
        LEFT JOIN interaction_guides AS interaction_guide
          ON interaction_guide.interaction_guide_id = routine.interaction_guide_id
        ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
        ORDER BY ${order}
        LIMIT ?
      `).all(...values, Math.min(200, Math.max(1, Number(limit) || 50))).map(databaseTask);
      return todoResult(schemaSemantics, context, {
        filters: {
          group: groupName ?? null,
          status: status ?? null,
          completed_on_date: completedOnDate,
          scheduled_on_date: scheduledOnDate,
          time_zone: completedOnDate !== null || scheduledOnDate !== null ? timeZone : null,
        },
        count: rows.length,
        tasks: rows,
      }, {
        name: "todo_list",
        purpose: "List personal tasks together with their to-do group and optional routine fields.",
      });
    },
  });

  registry.register({
    name: "todo_add",
    description: "Add one native personal to-do item, optionally at an exact 1-based position in its group's manual sort order, associated with the exact contact it concerns, or with an all-day schedule or structured recurrence. A recurring to-do may link to one active briefing by exact ID; the to-do owns recurrence and the briefing supplies only the conversation plan. Position 1 puts the new task at the top. When the request creates or resolves a contact for this task, pass that tool result's contact_id as related_contact_id. Set is_all_day=true when the user names a calendar day without an exact time; scheduled_at_utc should represent local midnight in the user's time zone. Never write RRULE syntax: express recurrence with frequency, interval, weekdays, count or until_date, and time_zone. A recurring todo requires scheduled_at_utc. Honor an explicitly named group. When no group is named, first use todo_group_list and choose the best clear existing match; use Inbox only when no group is reasonably implied. If the requested group does not exist, add it to Inbox and return group_resolution.used_inbox_fallback=true; then ask whether to create the requested group and move the task. Never create a requested group implicitly.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        group: optionalText,
        related_contact_id: { type: ["integer", "null"], minimum: 1 },
        interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
        scheduled_at_utc: optionalText,
        is_all_day: { type: "boolean" },
        due_at_utc: optionalText,
        recurrence: todoRecurrenceSchema,
        position: { type: ["integer", "null"], minimum: 1, maximum: 1_000_000_000 },
      },
      required: ["text", "group", "scheduled_at_utc", "due_at_utc"],
    },
    async execute({
      text, group: groupName, related_contact_id: relatedContactId = null,
      interaction_guide_id: interactionGuideId = null,
      scheduled_at_utc: scheduledAtUtc,
      is_all_day: isAllDay = false, due_at_utc: dueAtUtc, recurrence = null,
      position = null,
    }, context) {
      const database = store.requireReady();
      const taskText = text.trim();
      if (!taskText) throw new Error("To-do text cannot be empty");
      if (recurrence && !scheduledAtUtc) throw new Error("A recurring to-do requires scheduled_at_utc");
      if (interactionGuideId !== null && !recurrence) {
        throw new Error("interaction_guide_id can be linked only to a recurring to-do");
      }
      if (isAllDay && !scheduledAtUtc) throw new Error("An all-day to-do requires scheduled_at_utc");
      if (relatedContactId !== null && !database.prepare(`
        SELECT 1 FROM contacts WHERE contact_id = ?
      `).get(relatedContactId)) {
        throw new Error(`Related contact ${relatedContactId} does not exist`);
      }
      if (interactionGuideId !== null && !database.prepare(`
        SELECT 1 FROM interaction_guides
        WHERE interaction_guide_id = ? AND status = 'active'
      `).get(interactionGuideId)) {
        throw new Error(`Active briefing ${interactionGuideId} does not exist`);
      }
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
              time_zone, is_all_day, recurrence_rule, interaction_guide_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            selectedGroup.todo_group_id, taskText, scheduledAtUtc, dueAtUtc || null,
            recurrenceTimeZone, isAllDay ? 1 : 0, recurrenceRule, interactionGuideId,
          );
          routineId = Number(routine.lastInsertRowid);
        }
        const inserted = database.prepare(`
          INSERT INTO personal_tasks (
            todo_group_id, todo_routine_id, related_contact_id, text, status, sort_position,
            scheduled_at_utc, is_all_day, due_at_utc, source, source_event_id
          ) VALUES (?, ?, ?, ?, 'todo', ?, ?, ?, ?, 'agent-slayer', ?)
        `).run(
          selectedGroup.todo_group_id, routineId, relatedContactId, taskText, sortPosition,
          scheduledAtUtc || null, isAllDay ? 1 : 0, dueAtUtc || null, sourceEventId,
        );
        const taskId = Number(inserted.lastInsertRowid);
        if (position !== null) setTodoPosition(database, taskId, position);
        const row = database.prepare("SELECT * FROM personal_tasks WHERE personal_task_id = ?")
          .get(taskId);
        const task = databaseTask({
          ...row,
          group_name: selectedGroup.name,
          routine_recurrence_rule: recurrenceRule,
          routine_time_zone: recurrenceTimeZone,
          interaction_guide_id: interactionGuideId,
          interaction_guide_name: interactionGuideId === null ? null : database.prepare(`
            SELECT name FROM interaction_guides WHERE interaction_guide_id = ?
          `).get(interactionGuideId).name,
          interaction_guide_status: interactionGuideId === null ? null : "active",
          interaction_guide_version: interactionGuideId === null ? null : database.prepare(`
            SELECT version FROM interaction_guides WHERE interaction_guide_id = ?
          `).get(interactionGuideId).version,
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
    name: "todo_position_set",
    description: "Move one native personal to-do to an exact 1-based position in its group's manual sort order. Position 1 is the top. The group is atomically normalized to positions 10, 20, 30, and so on, matching the UI reorder controls. This does not change stable sequence numbers, which remain the primary display order in groups that use sequence numbering.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        personal_task_id: { type: "integer", minimum: 1 },
        position: { type: "integer", minimum: 1, maximum: 1_000_000_000 },
      },
      required: ["personal_task_id", "position"],
    },
    async execute({ personal_task_id: taskId, position }, context) {
      const database = store.requireReady();
      database.exec("BEGIN IMMEDIATE");
      try {
        const operation = setTodoPosition(database, taskId, position);
        const task = databaseTask(taskWithContext(database, taskId));
        const result = {
          changed: operation.changed,
          previous_position: operation.previousPosition,
          position: operation.position,
          task_count: operation.taskCount,
          task,
        };
        if (operation.changed) {
          ledger.append({
            type: "personal_todo.reordered", status: "complete",
            actorType: "tool", actorName: "todo_position_set",
            turnId: context.requestId, operationId: context.callId,
            name: "Personal to-do repositioned",
            content: `${task.text} moved from #${operation.previousPosition} to #${operation.position}`,
            payload: { ...result, ordered_task_ids: operation.orderedTaskIds },
            subjectType: "personal_task", subjectId: String(task.personal_task_id),
          });
        }
        const semanticResult = todoResult(schemaSemantics, context, result, {
          name: "todo_position_set",
          purpose: "Return the repositioned personal task and its exact old and new positions in the group.",
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
    name: "todo_interaction_guide_set",
    description: "Link or unlink one exact active briefing on an existing repeating native to-do without changing recurrence. The to-do owns its schedule and recurrence. Set interaction_guide_id to null to remove the briefing.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        personal_task_id: { type: "integer", minimum: 1 },
        interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
      },
      required: ["personal_task_id", "interaction_guide_id"],
    },
    async execute({ personal_task_id: taskId, interaction_guide_id: interactionGuideId }, context) {
      const database = store.requireReady();
      const before = taskWithContext(database, taskId);
      if (!before) throw new Error(`To-do ${taskId} does not exist`);
      if (before.todo_routine_id == null || !before.routine_recurrence_rule) {
        throw new Error("A briefing can be linked only to a repeating to-do");
      }
      if (interactionGuideId !== null && !database.prepare(`
        SELECT 1 FROM interaction_guides
        WHERE interaction_guide_id = ? AND status = 'active'
      `).get(interactionGuideId)) {
        throw new Error(`Active briefing ${interactionGuideId} does not exist`);
      }
      if ((before.interaction_guide_id ?? null) === interactionGuideId) {
        return todoResult(schemaSemantics, context, {
          updated: false,
          unchanged: true,
          task: databaseTask(before),
        }, {
          name: "todo_interaction_guide_set",
          purpose: "Return the unchanged repeating personal task and its briefing link.",
        });
      }
      const updatedAt = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        database.prepare(`
          UPDATE todo_routines SET interaction_guide_id = ?, updated_at_utc = ?
          WHERE todo_routine_id = ?
        `).run(interactionGuideId, updatedAt, before.todo_routine_id);
        database.prepare(`
          UPDATE personal_tasks SET updated_at_utc = ? WHERE personal_task_id = ?
        `).run(updatedAt, taskId);
        const task = databaseTask(taskWithContext(database, taskId));
        ledger.append({
          type: "personal_todo.interaction_guide_set", status: "complete",
          actorType: "tool", actorName: "todo_interaction_guide_set",
          turnId: context.requestId, operationId: context.callId,
          name: interactionGuideId === null
            ? "Briefing unlinked from repeating to-do"
            : "Briefing linked to repeating to-do",
          content: task.text,
          payload: { before: databaseTask(before), task },
          subjectType: "personal_task", subjectId: String(taskId),
        });
        const result = todoResult(schemaSemantics, context, {
          updated: true,
          unchanged: false,
          task,
        }, {
          name: "todo_interaction_guide_set",
          purpose: "Return the repeating personal task after linking or unlinking its briefing.",
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
    description: "Add, change, or remove recurrence for an existing native to-do and optionally link or unlink one active briefing by exact ID. Use structured recurrence fields; never compose RRULE syntax. Recurrence requires scheduled_at_utc. Set enabled=false and recurrence=null to make the task one-time.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        personal_task_id: { type: "integer", minimum: 1 },
        enabled: { type: "boolean" },
        recurrence: todoRecurrenceSchema,
        interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
      },
      required: ["personal_task_id", "enabled", "recurrence"],
    },
    async execute({
      personal_task_id: taskId, enabled, recurrence,
      interaction_guide_id: requestedInteractionGuideId,
    }, context) {
      const database = store.requireReady();
      const before = database.prepare(`
        SELECT task.*, todo_group.name AS group_name,
               routine.recurrence_rule AS routine_recurrence_rule,
               routine.time_zone AS routine_time_zone,
               routine.interaction_guide_id,
               interaction_guide.name AS interaction_guide_name,
               interaction_guide.status AS interaction_guide_status,
               interaction_guide.version AS interaction_guide_version
        FROM personal_tasks AS task
        JOIN todo_groups AS todo_group USING (todo_group_id)
        LEFT JOIN todo_routines AS routine USING (todo_routine_id)
        LEFT JOIN interaction_guides AS interaction_guide
          ON interaction_guide.interaction_guide_id = routine.interaction_guide_id
        WHERE task.personal_task_id = ?
      `).get(taskId);
      if (!before) throw new Error(`To-do ${taskId} does not exist`);
      if (enabled && !recurrence) throw new Error("recurrence is required when enabled is true");
      if (enabled && !before.scheduled_at_utc) throw new Error("Schedule the to-do before enabling recurrence");
      if (!enabled && requestedInteractionGuideId != null) {
        throw new Error("A briefing can be linked only while recurrence is enabled");
      }
      const interactionGuideId = enabled
        ? (requestedInteractionGuideId === undefined
          ? (before.interaction_guide_id ?? null)
          : requestedInteractionGuideId)
        : null;
      if (interactionGuideId !== null && !database.prepare(`
        SELECT 1 FROM interaction_guides
        WHERE interaction_guide_id = ? AND status = 'active'
      `).get(interactionGuideId)) {
        throw new Error(`Active briefing ${interactionGuideId} does not exist`);
      }
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
                time_zone = ?, is_all_day = ?, recurrence_rule = ?, interaction_guide_id = ?,
                disabled_at_utc = NULL, updated_at_utc = ?
            WHERE todo_routine_id = ?
          `).run(
            before.todo_group_id, before.text, before.scheduled_at_utc, before.due_at_utc,
            recurrenceTimeZone, before.is_all_day, recurrenceRule, interactionGuideId, updatedAt, routineId,
          );
        } else if (enabled) {
          const routine = database.prepare(`
            INSERT INTO todo_routines (
              todo_group_id, text, first_scheduled_at_utc, first_due_at_utc,
              time_zone, is_all_day, recurrence_rule, interaction_guide_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            before.todo_group_id, before.text, before.scheduled_at_utc, before.due_at_utc,
            recurrenceTimeZone, before.is_all_day, recurrenceRule, interactionGuideId,
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
                 routine.time_zone AS routine_time_zone,
                 routine.interaction_guide_id,
                 interaction_guide.name AS interaction_guide_name,
                 interaction_guide.status AS interaction_guide_status,
                 interaction_guide.version AS interaction_guide_version
          FROM personal_tasks AS task
          JOIN todo_groups AS todo_group USING (todo_group_id)
          LEFT JOIN todo_routines AS routine USING (todo_routine_id)
          LEFT JOIN interaction_guides AS interaction_guide
            ON interaction_guide.interaction_guide_id = routine.interaction_guide_id
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
                 routine.time_zone AS routine_time_zone,
                 routine.interaction_guide_id,
                 interaction_guide.name AS interaction_guide_name,
                 interaction_guide.status AS interaction_guide_status,
                 interaction_guide.version AS interaction_guide_version
          FROM personal_tasks AS task
          JOIN todo_groups AS todo_group USING (todo_group_id)
          LEFT JOIN todo_routines AS routine USING (todo_routine_id)
          LEFT JOIN interaction_guides AS interaction_guide
            ON interaction_guide.interaction_guide_id = routine.interaction_guide_id
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
    description: "Update one native personal to-do item by ID, including associating or clearing the exact contact it concerns, moving it to another group, changing its all-day scheduling flag, or completing it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        personal_task_id: { type: "integer", minimum: 1 },
        text: optionalText,
        group: optionalText,
        related_contact_id: { type: ["integer", "null"], minimum: 1 },
        status: { type: ["string", "null"], enum: [...todoStatuses, null] },
        scheduled_at_utc: optionalText,
        is_all_day: { type: ["boolean", "null"] },
        due_at_utc: optionalText,
      },
      required: ["personal_task_id", "text", "group", "status", "scheduled_at_utc", "due_at_utc"],
    },
    async execute({
      personal_task_id: taskId, text, group: groupName, related_contact_id: relatedContactId,
      status,
      scheduled_at_utc: scheduledAtUtc, is_all_day: isAllDay, due_at_utc: dueAtUtc,
    }, context) {
      const database = store.requireReady();
      const before = database.prepare("SELECT * FROM personal_tasks WHERE personal_task_id = ?").get(taskId);
      if (!before) throw new Error(`To-do ${taskId} does not exist`);
      const values = {};
      if (text !== null) values.text = text.trim();
      if (groupName !== null) values.todo_group_id = requireGroup(database, groupName).todo_group_id;
      if (relatedContactId !== undefined) {
        if (relatedContactId !== null && !database.prepare(`
          SELECT 1 FROM contacts WHERE contact_id = ?
        `).get(relatedContactId)) {
          throw new Error(`Related contact ${relatedContactId} does not exist`);
        }
        values.related_contact_id = relatedContactId;
      }
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
                   routine.time_zone AS routine_time_zone,
                   routine.interaction_guide_id,
                   interaction_guide.name AS interaction_guide_name,
                   interaction_guide.status AS interaction_guide_status,
                   interaction_guide.version AS interaction_guide_version
            FROM personal_tasks AS task
            JOIN todo_groups AS todo_group USING (todo_group_id)
            LEFT JOIN todo_routines AS routine USING (todo_routine_id)
            LEFT JOIN interaction_guides AS interaction_guide
              ON interaction_guide.interaction_guide_id = routine.interaction_guide_id
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
                 routine.time_zone AS routine_time_zone,
                 routine.interaction_guide_id,
                 interaction_guide.name AS interaction_guide_name,
                 interaction_guide.status AS interaction_guide_status,
                 interaction_guide.version AS interaction_guide_version
          FROM personal_tasks AS task
          JOIN todo_groups AS todo_group USING (todo_group_id)
          LEFT JOIN todo_routines AS routine USING (todo_routine_id)
          LEFT JOIN interaction_guides AS interaction_guide
            ON interaction_guide.interaction_guide_id = routine.interaction_guide_id
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
