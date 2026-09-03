import {
  archiveEmptyTodoGroup, renameTodoGroup, setTodoGroupSequenceMode,
} from "../todo-group-operations.mjs";
import { generateNextRoutineTask, OrganizerStore } from "../organizer-store.mjs";
import { localDateUtcBounds, moveOverdueTodosToToday } from "../todo-schedule-operations.mjs";
import {
  buildTodoRecurrenceRule, todoRecurrenceSchema, validateTimeZone,
} from "../todo-recurrence.mjs";
import { localDateForInstant } from "../temporal-consistency.mjs";
import { selectedFields, withSchemaProjection } from "./schema-result.mjs";

const todoStatuses = ["unplanned", "todo", "complete", "ignore", "archive", "ai_suggested"];
const routineGroupName = "Routine";

function validateTemporalTarget(value, appliesTo, context, label) {
  if (value == null || value === "") return;
  const targets = Array.isArray(context?.temporalResolutions)
    ? context.temporalResolutions.filter((resolution) => (
        resolution.role === "target" && resolution.appliesTo === appliesTo
      ))
    : [];
  if (!targets.length) return;
  const matches = targets.some((target) => (
    localDateForInstant(value, target.timeZone) === target.localDate
  ));
  if (matches) return;
  const actual = [...new Set(targets.map((target) => (
    `${localDateForInstant(value, target.timeZone)} in ${target.timeZone}`
  )))].join("; ");
  const authorized = targets.map((target) => (
    `${target.weekday}, ${target.localDate} in ${target.timeZone}`
  )).join("; ");
  throw new Error(`${label} resolves to ${actual}, outside the source-authorized temporal target(s): ${authorized}`);
}

function validateTodoTemporalTargets(input, context, label = "To-do schedule") {
  validateTemporalTarget(input.scheduled_at_utc, "scheduled_at", context, `${label} scheduled_at_utc`);
  validateTemporalTarget(input.due_at_utc, "due_at", context, `${label} due_at_utc`);
}

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
  "scheduled_at_utc", "is_all_day", "duration_minutes", "due_at_utc", "completed_at_utc",
  "planning_prompt_text", "created_at_utc", "updated_at_utc",
];
const todoRoutineFields = [
  "todo_routine_id", "recurrence_rule", "time_zone", "interaction_guide_id",
  "planning_prompt_text",
];
const interactionGuideFields = ["interaction_guide_id", "name", "status", "version"];

const routineAddOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    created: { type: "boolean", const: true },
    routine_group: {
      type: "object", additionalProperties: false,
      properties: {
        todo_group_id: { type: "integer", minimum: 1 },
        name: { type: "string", const: "Routine" },
        created: { type: "boolean" },
        reactivated: { type: "boolean" },
      },
      required: ["todo_group_id", "name", "created", "reactivated"],
    },
    template: {
      type: "object", additionalProperties: false,
      properties: {
        personal_task_id: { type: "integer", minimum: 1 },
        todo_routine_id: { type: "integer", minimum: 1 },
        text: { type: "string" },
        status: { type: "string", enum: ["unplanned", "todo"] },
        planning_prompt_text: { type: ["string", "null"] },
        scheduled_at_utc: { type: "string" },
        is_all_day: { type: "integer", enum: [0, 1] },
        duration_minutes: { type: ["integer", "null"], minimum: 1 },
        due_at_utc: { type: ["string", "null"] },
        recurrence_rule: { type: "string" },
        time_zone: { type: "string" },
        related_contact_id: { type: ["integer", "null"], minimum: 1 },
        interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
      },
      required: [
        "personal_task_id", "todo_routine_id", "text", "status", "planning_prompt_text", "scheduled_at_utc",
        "is_all_day", "duration_minutes", "due_at_utc", "recurrence_rule",
        "time_zone", "related_contact_id", "interaction_guide_id",
      ],
    },
    next_occurrences: {
      type: "array", maxItems: 3, items: { type: "string" },
    },
    schemaProjection: { type: ["object", "null"] },
  },
  required: ["created", "routine_group", "template", "next_occurrences", "schemaProjection"],
};

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
      planning_prompt_text: row.routine_planning_prompt_text ?? row.planning_prompt_text ?? null,
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
           routine.planning_prompt_text AS routine_planning_prompt_text,
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

const todoUpdateProperties = {
  personal_task_id: { type: "integer", minimum: 1 },
  text: optionalText,
  group: optionalText,
  related_contact_id: { type: ["integer", "null"], minimum: 1 },
  status: { type: ["string", "null"], enum: [...todoStatuses, null] },
  scheduled_at_utc: optionalText,
  is_all_day: { type: ["boolean", "null"] },
  duration_minutes: { type: ["integer", "null"], minimum: 1 },
  due_at_utc: optionalText,
  planning_prompt_text: optionalText,
};

const todoUpdateRequired = [
  "personal_task_id", "text", "group", "status", "scheduled_at_utc", "due_at_utc",
];

function prepareTodoUpdate(database, input, { completedAtUtc, updatedAtUtc }) {
  const taskId = input.personal_task_id;
  const beforeRow = taskWithContext(database, taskId);
  if (!beforeRow) throw new Error(`To-do ${taskId} does not exist`);
  const before = databaseTask(beforeRow);
  const values = {};
  let targetGroupName = before.todo_groups.name;
  if (input.text !== null) values.text = input.text.trim();
  if (input.group !== null) {
    const group = requireGroup(database, input.group);
    values.todo_group_id = group.todo_group_id;
    targetGroupName = group.name;
  }
  if (input.related_contact_id !== undefined) {
    if (input.related_contact_id !== null && !database.prepare(`
      SELECT 1 FROM contacts WHERE contact_id = ?
    `).get(input.related_contact_id)) {
      throw new Error(`Related contact ${input.related_contact_id} does not exist`);
    }
    values.related_contact_id = input.related_contact_id;
  }
  if (input.status !== null) {
    values.status = input.status;
    values.completed_at_utc = input.status === "complete" ? completedAtUtc : null;
  }
  if (input.scheduled_at_utc !== null) {
    values.scheduled_at_utc = input.scheduled_at_utc || null;
  }
  if (input.is_all_day !== null && input.is_all_day !== undefined) {
    values.is_all_day = input.is_all_day ? 1 : 0;
  }
  if (input.duration_minutes !== undefined) {
    if (input.duration_minutes !== null
      && (!Number.isSafeInteger(input.duration_minutes) || input.duration_minutes < 1)) {
      throw new Error("duration_minutes must be a positive whole number or null");
    }
    values.duration_minutes = input.duration_minutes;
  }
  if (input.due_at_utc !== null) values.due_at_utc = input.due_at_utc || null;
  if (input.planning_prompt_text !== undefined) {
    values.planning_prompt_text = input.planning_prompt_text?.trim() || null;
  }
  if (Object.keys(values).length === 0) throw new Error(`No changes were supplied for to-do ${taskId}`);

  const prospective = { ...beforeRow, ...values };
  if (prospective.is_all_day && !prospective.scheduled_at_utc) {
    throw new Error(`An all-day to-do requires scheduled_at_utc (to-do ${taskId})`);
  }
  if (prospective.duration_minutes !== null
    && (!prospective.scheduled_at_utc || prospective.is_all_day)) {
    throw new Error(`duration_minutes requires a scheduled to-do with an exact time (to-do ${taskId})`);
  }
  if (targetGroupName.toLowerCase() === routineGroupName.toLowerCase()
    && (prospective.todo_routine_id == null
      || !["unplanned", "todo", "ai_suggested"].includes(prospective.status))) {
    throw new Error("Routine entries must remain active repeating templates; publish them to create completable to-dos.");
  }
  values.updated_at_utc = updatedAtUtc;
  return { taskId, before, beforeRow, values };
}

function applyTodoUpdate(database, ledger, context, plan) {
  const assignments = Object.keys(plan.values).map((column) => `"${column}" = ?`).join(", ");
  database.prepare(`UPDATE personal_tasks SET ${assignments} WHERE personal_task_id = ?`)
    .run(...Object.values(plan.values), plan.taskId);
  const current = taskWithContext(database, plan.taskId);
  if (current.todo_routine_id) {
    database.prepare(`
      UPDATE todo_routines
      SET todo_group_id = ?, text = ?, first_scheduled_at_utc = ?, first_due_at_utc = ?,
          is_all_day = ?, planning_prompt_text = ?, updated_at_utc = ?
      WHERE todo_routine_id = ?
    `).run(
      current.todo_group_id, current.text, current.scheduled_at_utc, current.due_at_utc,
      current.is_all_day, current.planning_prompt_text, plan.values.updated_at_utc,
      current.todo_routine_id,
    );
  }
  const becameTerminal = ["complete", "ignore"].includes(current.status)
    && !["complete", "ignore"].includes(plan.beforeRow.status);
  const generatedTaskId = becameTerminal
    ? generateNextRoutineTask(database, plan.taskId, { nextStatus: plan.beforeRow.status })
    : null;
  let generatedTask = null;
  if (generatedTaskId) {
    const generated = taskWithContext(database, generatedTaskId);
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
  return {
    before: plan.before,
    task: databaseTask(taskWithContext(database, plan.taskId)),
    generated_task: generatedTask,
  };
}

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
    description: "List the user's native personal to-do items. Set status to unplanned for the authoritative list of items that still need planning. Use completed_on_date to select tasks completed on one local calendar date and scheduled_on_date to select tasks scheduled on one local calendar date; these are query filters and do not add ranges to task records. Supply time_zone whenever either date filter is used. With no status and no completed date, terminal tasks remain excluded as before.",
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
               routine.planning_prompt_text AS routine_planning_prompt_text,
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
    name: "routine_add",
    title: "Add a reusable routine",
    description: "Create one reusable Routine template backed by a repeating native to-do. Use status unplanned when each occurrence still needs a concrete plan, and preserve the exact question in planning_prompt_text. Use this instead of todo_add when the user is defining a standing routine or habit: it atomically ensures the reserved Routine group, requires structured recurrence, and returns the saved template with its next three hypothetical occurrences. It creates no calendar event and publishes no real to-do occurrences.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        status: { type: "string", enum: ["unplanned", "todo"] },
        planning_prompt_text: optionalText,
        related_contact_id: { type: ["integer", "null"], minimum: 1 },
        interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
        scheduled_at_utc: {
          type: "string", minLength: 1,
          description: "First scheduled occurrence as an ISO 8601 timestamp.",
        },
        is_all_day: { type: "boolean" },
        duration_minutes: {
          type: ["integer", "null"], minimum: 1,
          description: "Planned work duration from the scheduled start; null for all-day routines.",
        },
        due_at_utc: {
          type: ["string", "null"],
          description: "Optional deadline for the first occurrence, separate from planned duration.",
        },
        recurrence: { ...todoRecurrenceSchema, type: "object" },
      },
      required: [
        "text", "related_contact_id", "interaction_guide_id", "scheduled_at_utc",
        "is_all_day", "duration_minutes", "due_at_utc", "recurrence",
      ],
    },
    outputSchema: routineAddOutputSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    metadata: {
      "agent-slayer/selection": {
        summary: "Create one reusable Routine template when the user defines a standing routine or habit. Unlike todo_add, this always targets the reserved Routine group and requires recurrence.",
        actionClasses: ["CREATE"],
        effectClassifications: ["MUTATING"],
      },
    },
    async execute({
      text, related_contact_id: relatedContactId,
      status = "todo", planning_prompt_text: planningPromptText = null,
      interaction_guide_id: interactionGuideId,
      scheduled_at_utc: scheduledAtUtc, is_all_day: isAllDay,
      duration_minutes: durationMinutes, due_at_utc: dueAtUtc, recurrence,
    }, context) {
      const recurrenceRule = buildTodoRecurrenceRule(recurrence);
      const recurrenceTimeZone = validateTimeZone(recurrence.time_zone);
      const organizer = new OrganizerStore(store.filename);
      try {
        const result = organizer.createRoutine({
          text,
          status,
          planningPromptText,
          relatedContactId,
          interactionGuideId,
          scheduledAtUtc,
          isAllDay,
          durationMinutes,
          dueAtUtc,
          recurrenceRule,
          recurrenceTimeZone,
        }, {
          requestId: context.requestId,
          callId: context.callId,
          actorType: "tool",
          actorName: "routine_add",
          source: "agent-slayer",
          channel: "model_tool",
        });
        const template = {
          personal_task_id: result.template.id,
          todo_routine_id: result.template.routineId,
          text: result.template.text,
          status: result.template.status,
          planning_prompt_text: result.template.planningPromptText,
          scheduled_at_utc: result.template.scheduledAtUtc,
          is_all_day: result.template.isAllDay ? 1 : 0,
          duration_minutes: result.template.durationMinutes,
          due_at_utc: result.template.dueAtUtc,
          recurrence_rule: result.template.recurrenceRule,
          time_zone: result.template.recurrenceTimeZone,
          related_contact_id: result.template.relatedContactId,
          interaction_guide_id: result.template.interactionGuideId,
        };
        return todoResult(schemaSemantics, context, {
          created: true,
          routine_group: {
            todo_group_id: result.group.id,
            name: result.group.name,
            created: result.groupCreated,
            reactivated: result.groupReactivated,
          },
          template,
          next_occurrences: result.nextOccurrences,
        }, {
          name: "routine_add",
          purpose: "Return the reusable Routine template created atomically in the reserved Routine group and its next hypothetical occurrences.",
        });
      } finally {
        organizer.close();
      }
    },
  });

  registry.register({
    name: "todo_add",
    description: "Add one native personal to-do item. Use status unplanned when the item still needs a concrete plan and preserve the exact question in planning_prompt_text. The item may also have an exact 1-based group position, contact, all-day schedule, duration, due date, or structured recurrence. duration_minutes is the positive planned work length from scheduled_at_utc and is separate from due_at_utc, which remains a deadline; use it only for an exact-time, non-all-day task. A recurring to-do may link to one active briefing by exact ID; the to-do owns recurrence and the briefing supplies only the conversation plan. Position 1 puts the new task at the top. When the request creates or resolves a contact for this task, pass that tool result's contact_id as related_contact_id. Set is_all_day=true when the user names a calendar day without an exact time; scheduled_at_utc should represent local midnight in the user's time zone. Never write RRULE syntax: express recurrence with frequency, interval, weekdays, month, month_day or ordinal_weekday, count or until_date, and time_zone. A recurring todo requires scheduled_at_utc. The reserved Routine group accepts only repeating templates; published real instances belong in Inbox. Honor an explicitly named group. When no group is named, first use todo_group_list and choose the best clear existing match; use Inbox only when no group is reasonably implied. If the requested group does not exist, add it to Inbox and return group_resolution.used_inbox_fallback=true; then ask whether to create the requested group and move the task. Never create a requested group implicitly.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string", minLength: 1, maxLength: 10000 },
        status: { type: "string", enum: todoStatuses },
        planning_prompt_text: optionalText,
        group: optionalText,
        related_contact_id: { type: ["integer", "null"], minimum: 1 },
        interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
        scheduled_at_utc: optionalText,
        is_all_day: { type: "boolean" },
        duration_minutes: { type: ["integer", "null"], minimum: 1 },
        due_at_utc: optionalText,
        recurrence: todoRecurrenceSchema,
        position: { type: ["integer", "null"], minimum: 1, maximum: 1_000_000_000 },
      },
      required: ["text", "group", "scheduled_at_utc", "due_at_utc"],
    },
    async execute({
      text, status = "todo", planning_prompt_text: planningPromptText = null,
      group: groupName, related_contact_id: relatedContactId = null,
      interaction_guide_id: interactionGuideId = null,
      scheduled_at_utc: scheduledAtUtc,
      is_all_day: isAllDay = false, duration_minutes: durationMinutes = null,
      due_at_utc: dueAtUtc, recurrence = null,
      position = null,
    }, context) {
      const database = store.requireReady();
      const taskText = text.trim();
      validateTodoTemporalTargets({
        scheduled_at_utc: scheduledAtUtc,
        due_at_utc: dueAtUtc,
      }, context, "New to-do");
      if (!taskText) throw new Error("To-do text cannot be empty");
      if (recurrence && !scheduledAtUtc) throw new Error("A recurring to-do requires scheduled_at_utc");
      if (interactionGuideId !== null && !recurrence) {
        throw new Error("interaction_guide_id can be linked only to a recurring to-do");
      }
      if (isAllDay && !scheduledAtUtc) throw new Error("An all-day to-do requires scheduled_at_utc");
      if (durationMinutes !== null && (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1)) {
        throw new Error("duration_minutes must be a positive whole number or null");
      }
      if (durationMinutes !== null && (!scheduledAtUtc || isAllDay)) {
        throw new Error("duration_minutes requires a scheduled to-do with an exact time");
      }
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
        if (selectedGroup.name.toLowerCase() === routineGroupName.toLowerCase() && !recurrenceRule) {
          throw new Error("Items in Routine must repeat. Put one-time to-dos in another group.");
        }
        if (selectedGroup.name.toLowerCase() === routineGroupName.toLowerCase()
          && !["unplanned", "todo", "ai_suggested"].includes(status)) {
          throw new Error("Routine templates must keep an active to-do status.");
        }
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
              time_zone, is_all_day, recurrence_rule, interaction_guide_id,
              planning_prompt_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            selectedGroup.todo_group_id, taskText, scheduledAtUtc, dueAtUtc || null,
            recurrenceTimeZone, isAllDay ? 1 : 0, recurrenceRule, interactionGuideId,
            planningPromptText?.trim() || null,
          );
          routineId = Number(routine.lastInsertRowid);
        }
        const inserted = database.prepare(`
          INSERT INTO personal_tasks (
            todo_group_id, todo_routine_id, related_contact_id, text, status, sort_position,
            scheduled_at_utc, is_all_day, duration_minutes, due_at_utc,
            planning_prompt_text, source, source_event_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agent-slayer', ?)
        `).run(
          selectedGroup.todo_group_id, routineId, relatedContactId, taskText, status, sortPosition,
          scheduledAtUtc || null, isAllDay ? 1 : 0, durationMinutes, dueAtUtc || null,
          planningPromptText?.trim() || null, sourceEventId,
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
          routine_planning_prompt_text: planningPromptText?.trim() || null,
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
    description: "Rename one active native to-do group. Tasks and routines remain in the same group because its stable ID does not change. Inbox and the reserved Routine template group cannot be renamed.",
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
    description: "Archive one native to-do group by name so it leaves active group lists. This fails while the group contains active unplanned, todo, or ai_suggested tasks. Completed, ignored, and archived tasks retain their historical group. Inbox and the reserved Routine template group cannot be archived.",
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
               routine.planning_prompt_text AS routine_planning_prompt_text,
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
      if (before.group_name.toLowerCase() === routineGroupName.toLowerCase() && !enabled) {
        throw new Error("Routine templates must repeat. Move the task to another group before removing recurrence.");
      }
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
                planning_prompt_text = ?, disabled_at_utc = NULL, updated_at_utc = ?
            WHERE todo_routine_id = ?
          `).run(
            before.todo_group_id, before.text, before.scheduled_at_utc, before.due_at_utc,
            recurrenceTimeZone, before.is_all_day, recurrenceRule, interactionGuideId,
            before.planning_prompt_text, updatedAt, routineId,
          );
        } else if (enabled) {
          const routine = database.prepare(`
            INSERT INTO todo_routines (
              todo_group_id, text, first_scheduled_at_utc, first_due_at_utc,
              time_zone, is_all_day, recurrence_rule, interaction_guide_id,
              planning_prompt_text
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            before.todo_group_id, before.text, before.scheduled_at_utc, before.due_at_utc,
            recurrenceTimeZone, before.is_all_day, recurrenceRule, interactionGuideId,
            before.planning_prompt_text,
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
                 routine.planning_prompt_text AS routine_planning_prompt_text,
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
    description: "Move every active one-time native to-do scheduled before the specified local day onto that day in one batch. Use this when the user asks to move, roll, or stack overdue ordinary tasks onto today. The scheduled local time is preserved, and any due date moves by the same number of calendar days. Routine templates and routine-managed or routine-published occurrences keep their recurrence-defined dates. Completed, ignored, archived, unscheduled, and already-current tasks are also unchanged. The result records each moved task's exact previous and resulting schedule and due timestamps so a later correction can restore it without guessing.",
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
                 routine.planning_prompt_text AS routine_planning_prompt_text,
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
        const moves = operation.moves.map((move) => ({
          personal_task_id: move.id,
          previous_scheduled_at_utc: move.previousScheduledAtUtc,
          scheduled_at_utc: move.scheduledAtUtc,
          previous_due_at_utc: move.previousDueAtUtc,
          due_at_utc: move.dueAtUtc,
        }));
        const result = {
          moved_count: rows.length,
          local_date: operation.localDate,
          time_zone: operation.timeZone,
          moves,
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
          purpose: "Return all active one-time personal tasks moved from past scheduled days onto the requested local day, including exact before-and-after timestamps for correction evidence.",
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
    description: "Atomically update 1 through 500 native personal to-dos by ID in one call. A one-item request uses the same updates array. Every target and change is validated before any update is retained; duplicate IDs or one invalid item roll back the complete batch. Each item may associate or clear its exact contact, move groups, change scheduling, planned duration_minutes, status including unplanned, or planning_prompt_text. For planning_prompt_text, omit the property to leave it unchanged and use null or an empty string to clear it. duration_minutes is measured from scheduled_at_utc and requires an exact-time, non-all-day schedule.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        updates: {
          type: "array", minItems: 1, maxItems: 500,
          items: {
            type: "object",
            additionalProperties: false,
            properties: todoUpdateProperties,
            required: todoUpdateRequired,
          },
        },
      },
      required: ["updates"],
    },
    async execute({ updates }, context) {
      const database = store.requireReady();
      if (!Array.isArray(updates) || updates.length < 1 || updates.length > 500) {
        throw new Error("todo_update requires between 1 and 500 updates");
      }
      const taskIds = updates.map(({ personal_task_id: taskId }) => taskId);
      const duplicateTaskId = taskIds.find((taskId, index) => taskIds.indexOf(taskId) !== index);
      if (duplicateTaskId !== undefined) {
        throw new Error(`Duplicate to-do ID in update batch: ${duplicateTaskId}`);
      }
      updates.forEach((update) => validateTodoTemporalTargets(
        update,
        context,
        `To-do ${update.personal_task_id}`,
      ));
      const now = new Date().toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        const plans = updates.map((update) => prepareTodoUpdate(database, update, {
          completedAtUtc: now,
          updatedAtUtc: now,
        }));
        const items = plans.map((plan) => applyTodoUpdate(database, ledger, context, plan));
        ledger.append({
          type: items.length === 1 ? "personal_todo.updated" : "personal_todos.updated",
          status: "complete", actorType: "tool", actorName: "todo_update",
          turnId: context.requestId, operationId: context.callId,
          name: items.length === 1 ? "Personal to-do updated" : "Personal to-dos updated",
          content: items.length === 1 ? items[0].task.text : `Updated ${items.length} personal to-dos`,
          payload: { updated_count: items.length, items },
          subjectType: items.length === 1 ? "personal_task" : "personal_task_batch",
          subjectId: items.length === 1 ? String(items[0].task.personal_task_id) : String(items.length),
        });
        const result = todoResult(schemaSemantics, context, {
          updated_count: items.length,
          items,
        }, {
          name: "todo_update",
          purpose: "Return every atomically updated personal task and any next routine occurrences generated by the batch.",
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
