import {
  archiveEmptyTodoGroup, renameTodoGroup, setTodoGroupSequenceMode,
} from "../todo-group-operations.mjs";
import { selectedFields } from "./record-fields.mjs";
import {
  listTodoQueryPages, todoListInputSchema, todoQueryFilterProperties, todoStatuses,
} from "../todo-list-queries.mjs";

const optionalText = { type: ["string", "null"] };
const todoFields = [
  "personal_task_id", "todo_group_id", "interaction_guide_id", "sequence",
  "related_contact_id", "text", "status", "sort_position", "completed_at_utc",
  "planning_prompt_text", "source", "external_id", "source_event_id",
  "created_at_utc", "updated_at_utc",
];
const groupFields = [
  "todo_group_id", "name", "sort_position", "uses_sequence", "archived_at_utc",
  "created_at_utc", "updated_at_utc",
];

const todoTaskRecordSchema = {
  type: ["object", "null"],
  description: "One non-temporal item in the user's authoritative personal to-do list. Calendar events own schedules and deadlines.",
  properties: {
    ...Object.fromEntries(todoFields.map((name) => [name, {}])),
    group_name: {},
    interaction_guide: { type: ["object", "null"], properties: {
      interaction_guide_id: {}, name: {}, status: {}, version: {},
    } },
  },
};
const todoGroupRecordSchema = {
  type: ["object", "null"],
  description: "A named group in the user's authoritative personal to-do list.",
  properties: Object.fromEntries(groupFields.map((name) => [name, {}])),
};

function taskWithContext(database, taskId) {
  return database.prepare(`
    SELECT task.*, todo_group.name AS group_name,
           interaction_guide.name AS interaction_guide_name,
           interaction_guide.status AS interaction_guide_status,
           interaction_guide.version AS interaction_guide_version
    FROM todo_personal AS task
    JOIN todo_groups AS todo_group USING (todo_group_id)
    LEFT JOIN interaction_guides AS interaction_guide
      ON interaction_guide.interaction_guide_id = task.interaction_guide_id
    WHERE task.personal_task_id = ?
  `).get(taskId);
}

function databaseTask(row) {
  if (!row) return null;
  return {
    ...selectedFields(row, todoFields),
    group_name: row.group_name,
    interaction_guide: row.interaction_guide_id == null ? null : {
      interaction_guide_id: Number(row.interaction_guide_id),
      name: row.interaction_guide_name,
      status: row.interaction_guide_status,
      version: row.interaction_guide_version == null ? null : Number(row.interaction_guide_version),
    },
  };
}

function databaseGroup(row) {
  return selectedFields(row, groupFields);
}

function activeTodoGroupRows(store) {
  return store.requireReady().prepare(`
    SELECT todo_group.*, COUNT(task.personal_task_id) AS open_task_count
    FROM todo_groups AS todo_group
    LEFT JOIN todo_personal AS task
      ON task.todo_group_id = todo_group.todo_group_id
     AND task.status NOT IN ('complete', 'ignore', 'archive')
    WHERE todo_group.archived_at_utc IS NULL
    GROUP BY todo_group.todo_group_id
    ORDER BY todo_group.name, todo_group.todo_group_id
  `).all();
}

function requireGroup(database, name) {
  const row = database.prepare(`
    SELECT * FROM todo_groups WHERE name = ? AND archived_at_utc IS NULL
  `).get(String(name || "Inbox").trim());
  if (!row) throw new Error(`Unknown active to-do group: ${name || "Inbox"}`);
  return row;
}

function requireActiveGuide(database, id) {
  if (id == null) return;
  if (!database.prepare(`
    SELECT 1 FROM interaction_guides WHERE interaction_guide_id = ? AND status = 'active'
  `).get(id)) throw new Error(`Active briefing ${id} does not exist`);
}

function appendLedger(ledger, context, input) {
  return ledger.append({
    status: "complete", actorType: "tool", turnId: context.requestId,
    operationId: context.callId, ...input,
  });
}

function setTodoPosition(database, taskId, position) {
  const task = database.prepare("SELECT todo_group_id FROM todo_personal WHERE personal_task_id = ?").get(taskId);
  if (!task) throw new Error(`To-do ${taskId} does not exist`);
  const ids = database.prepare(`
    SELECT personal_task_id FROM todo_personal WHERE todo_group_id = ?
    ORDER BY sort_position, personal_task_id
  `).all(task.todo_group_id).map(({ personal_task_id: id }) => Number(id));
  if (!Number.isSafeInteger(position) || position < 1 || position > ids.length) {
    throw new Error(`position must be between 1 and ${ids.length}`);
  }
  const previousPosition = ids.indexOf(Number(taskId)) + 1;
  ids.splice(previousPosition - 1, 1);
  ids.splice(position - 1, 0, Number(taskId));
  const update = database.prepare("UPDATE todo_personal SET sort_position = ?, updated_at_utc = ? WHERE personal_task_id = ?");
  const now = new Date().toISOString();
  ids.forEach((id, index) => update.run((index + 1) * 10, now, id));
  return { changed: previousPosition !== position, previous_position: previousPosition, position };
}

export function todoGroupContext(store, limit = 100) {
  const allRows = activeTodoGroupRows(store);
  const groups = allRows.slice(0, limit).map((row) => ({
    todoGroupId: Number(row.todo_group_id), name: row.name,
  }));
  return {
    heading: "Active to-do groups",
    text: groups.length
      ? ["Use these exact existing group names and IDs when they match the request.",
          ...groups.map(({ todoGroupId, name }) => `- [group ${todoGroupId}] ${name}`)].join("\n")
      : "No active to-do groups exist.",
    data: { groups, totalCount: allRows.length, omittedCount: allRows.length - groups.length },
  };
}

export function registerTodoTools(registry, store, ledger) {
  const rootRegistry = registry;
  registry = registry.withCapability?.("todos") ?? registry;
  rootRegistry.registerContextView?.("todos", {
    id: "todos.active_groups", title: "Active to-do groups",
    description: "Active to-do group names and IDs; no individual to-do items.",
    maximumItems: 100, execute: () => todoGroupContext(store),
  });

  registry.register({
    name: "todo_group_list",
    description: "List active native to-do groups and their open task counts.",
    outputSchema: { type: "object", properties: { groups: { type: "array", items: todoGroupRecordSchema } } },
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    async execute() {
      const groups = activeTodoGroupRows(store).map((row) => ({
        ...databaseGroup(row), open_task_count: Number(row.open_task_count),
      }));
      return { count: groups.length, groups };
    },
  });

  registry.register({
    name: "todo_list",
    description: "Read non-temporal native personal to-dos in one or more paginated queries. Schedules and deadlines are calendar events and are read with calendar tools.",
    outputSchema: { type: "object", properties: {
      has_more: { type: "boolean" }, results: { type: "array", items: { type: "object", properties: {
        query_id: { type: "string" }, filters: { type: "object", properties: todoQueryFilterProperties },
        tasks: { type: "array", items: todoTaskRecordSchema }, count: { type: "integer" },
        has_more: { type: "boolean" }, next_cursor: { type: ["string", "null"] },
      } } },
    } },
    parameters: todoListInputSchema,
    async execute({ queries }) {
      const result = listTodoQueryPages(store.requireReady(), queries);
      return { ...result, results: result.results.map((page) => ({
        ...page, tasks: page.tasks.map(databaseTask),
      })) };
    },
  });

  registry.register({
    name: "todo_add",
    description: "Add one non-temporal native personal to-do. To place work or a deadline on the calendar, create a calendar event and link it to the to-do.",
    outputSchema: { type: "object", properties: { task: todoTaskRecordSchema } },
    parameters: { type: "object", additionalProperties: false, properties: {
      text: { type: "string", minLength: 1, maxLength: 10000 },
      status: { type: "string", enum: todoStatuses }, group: optionalText,
      related_contact_id: { type: ["integer", "null"], minimum: 1 },
      interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
      planning_prompt_text: optionalText,
      position: { type: ["integer", "null"], minimum: 1, maximum: 1_000_000_000 },
    }, required: ["text", "group"] },
    async execute(input, context) {
      const database = store.requireReady();
      const text = input.text.trim();
      if (!text) throw new Error("To-do text cannot be empty");
      const group = requireGroup(database, input.group);
      requireActiveGuide(database, input.interaction_guide_id);
      if (input.related_contact_id != null && !database.prepare(
        "SELECT 1 FROM contacts WHERE contact_id = ?",
      ).get(input.related_contact_id)) throw new Error(`Related contact ${input.related_contact_id} does not exist`);
      database.exec("START TRANSACTION");
      try {
        const position = Number(database.prepare(`SELECT COALESCE(MAX(sort_position), 0) + 10 AS value
          FROM todo_personal WHERE todo_group_id = ?`).get(group.todo_group_id).value);
        const completed = input.status === "complete" ? new Date().toISOString() : null;
        const inserted = database.prepare(`
          INSERT INTO todo_personal (
            todo_group_id, related_contact_id, interaction_guide_id, text, status,
            sort_position, completed_at_utc, planning_prompt_text, source, source_event_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'agent-slayer', ?)
          RETURNING personal_task_id
        `).get(group.todo_group_id, input.related_contact_id ?? null,
          input.interaction_guide_id ?? null, text, input.status ?? "todo", position,
          completed, input.planning_prompt_text?.trim() || null, context.requestEventId || null);
        if (input.position != null) setTodoPosition(database, Number(inserted.personal_task_id), input.position);
        const task = databaseTask(taskWithContext(database, inserted.personal_task_id));
        appendLedger(ledger, context, { type: "personal_todo.created", actorName: "todo_add",
          name: "Personal to-do created", content: task.text, payload: { task },
          subjectType: "personal_task", subjectId: String(task.personal_task_id) });
        database.exec("COMMIT");
        return { created: true, task };
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  });

  registry.register({
    name: "todo_position_set",
    description: "Move one to-do to an exact 1-based position in its group.",
    outputSchema: { type: "object", properties: { task: todoTaskRecordSchema } },
    parameters: { type: "object", additionalProperties: false, properties: {
      personal_task_id: { type: "integer", minimum: 1 }, position: { type: "integer", minimum: 1 },
    }, required: ["personal_task_id", "position"] },
    async execute({ personal_task_id: id, position }, context) {
      const database = store.requireReady();
      database.exec("START TRANSACTION");
      try {
        const movement = setTodoPosition(database, id, position);
        const task = databaseTask(taskWithContext(database, id));
        appendLedger(ledger, context, { type: "personal_todo.repositioned", actorName: "todo_position_set",
          name: "Personal to-do repositioned", content: task.text, payload: { movement, task },
          subjectType: "personal_task", subjectId: String(id) });
        database.exec("COMMIT");
        return { ...movement, task };
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  });

  registry.register({
    name: "todo_group_create",
    description: "Create a native to-do group, or return the existing group with the same name.",
    outputSchema: { type: "object", properties: { group: todoGroupRecordSchema } },
    parameters: { type: "object", additionalProperties: false, properties: {
      name: { type: "string", minLength: 1, maxLength: 200 },
    }, required: ["name"] },
    async execute({ name }, context) {
      const database = store.requireReady();
      const clean = name.trim();
      let group = database.prepare("SELECT * FROM todo_groups WHERE name = ?").get(clean);
      let created = false;
      if (!group) {
        group = database.prepare("INSERT INTO todo_groups (name) VALUES (?) RETURNING *").get(clean);
        created = true;
        appendLedger(ledger, context, { type: "personal_todo_group.created", actorName: "todo_group_create",
          name: "Personal to-do group created", content: clean, payload: { group: databaseGroup(group) },
          subjectType: "todo_group", subjectId: String(group.todo_group_id) });
      }
      return { created, group: databaseGroup(group) };
    },
  });

  for (const definition of [
    { name: "todo_group_rename", description: "Rename an active to-do group.",
      properties: { todo_group_id: { type: "integer", minimum: 1 }, name: { type: "string", minLength: 1, maxLength: 200 } },
      required: ["todo_group_id", "name"], run: (db, input) => renameTodoGroup(db, { groupId: input.todo_group_id, newName: input.name }) },
    { name: "todo_group_sequence_set", description: "Enable or disable stable sequence numbers for a to-do group.",
      properties: { todo_group_id: { type: "integer", minimum: 1 }, uses_sequence: { type: "boolean" } },
      required: ["todo_group_id", "uses_sequence"], run: (db, input) => setTodoGroupSequenceMode(db, { groupId: input.todo_group_id, usesSequence: input.uses_sequence }) },
    { name: "todo_group_archive", description: "Archive an empty active to-do group.",
      properties: { todo_group_id: { type: "integer", minimum: 1 } }, required: ["todo_group_id"],
      run: (db, input) => archiveEmptyTodoGroup(db, { groupId: input.todo_group_id }) },
  ]) registry.register({
    name: definition.name, description: definition.description,
    outputSchema: { type: "object", properties: { group: todoGroupRecordSchema } },
    parameters: { type: "object", additionalProperties: false,
      properties: definition.properties, required: definition.required },
    async execute(input, context) {
      const database = store.requireReady();
      database.exec("START TRANSACTION");
      try {
        const result = definition.run(database, input);
        appendLedger(ledger, context, { type: definition.name.replaceAll("_", "."),
          actorName: definition.name, name: definition.description, content: result.group.name,
          payload: result, subjectType: "todo_group", subjectId: String(input.todo_group_id) });
        database.exec("COMMIT");
        return result;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  });

  registry.register({
    name: "todo_interaction_guide_set",
    description: "Link or unlink one active briefing on a personal to-do. This does not schedule either record.",
    outputSchema: { type: "object", properties: { task: todoTaskRecordSchema } },
    parameters: { type: "object", additionalProperties: false, properties: {
      personal_task_id: { type: "integer", minimum: 1 },
      interaction_guide_id: { type: ["integer", "null"], minimum: 1 },
    }, required: ["personal_task_id", "interaction_guide_id"] },
    async execute({ personal_task_id: id, interaction_guide_id: guideId }, context) {
      const database = store.requireReady();
      const before = databaseTask(taskWithContext(database, id));
      if (!before) throw new Error(`To-do ${id} does not exist`);
      requireActiveGuide(database, guideId);
      const now = new Date().toISOString();
      database.prepare(`UPDATE todo_personal SET interaction_guide_id = ?, updated_at_utc = ?
        WHERE personal_task_id = ?`).run(guideId, now, id);
      const task = databaseTask(taskWithContext(database, id));
      appendLedger(ledger, context, { type: "personal_todo.interaction_guide_set",
        actorName: "todo_interaction_guide_set", name: "To-do briefing link set",
        content: task.text, payload: { before, task }, subjectType: "personal_task", subjectId: String(id) });
      return { updated: before.interaction_guide_id !== guideId, task };
    },
  });

  registry.register({
    name: "todo_update",
    description: "Atomically update one or more non-temporal native personal to-dos. Calendar placement and deadlines must be changed through calendar events.",
    outputSchema: { type: "object", properties: { updated_count: { type: "integer" },
      items: { type: "array", items: { type: "object", properties: { task: todoTaskRecordSchema } } } } },
    parameters: { type: "object", additionalProperties: false, properties: {
      updates: { type: "array", minItems: 1, maxItems: 500, items: {
        type: "object", additionalProperties: false, properties: {
          personal_task_id: { type: "integer", minimum: 1 }, text: optionalText, group: optionalText,
          status: { type: ["string", "null"], enum: [...todoStatuses, null] },
          related_contact_id: { type: ["integer", "null"], minimum: 1 }, clear_related_contact: { type: "boolean" },
          interaction_guide_id: { type: ["integer", "null"], minimum: 1 }, clear_interaction_guide: { type: "boolean" },
          planning_prompt_text: optionalText, clear_planning_prompt: { type: "boolean" },
        }, required: ["personal_task_id"] },
      },
    }, required: ["updates"] },
    async execute({ updates }, context) {
      const database = store.requireReady();
      const ids = updates.map(({ personal_task_id: id }) => id);
      if (new Set(ids).size !== ids.length) throw new Error("Duplicate to-do ID in update batch");
      const now = new Date().toISOString();
      database.exec("START TRANSACTION");
      try {
        const items = updates.map((input) => {
          const before = databaseTask(taskWithContext(database, input.personal_task_id));
          if (!before) throw new Error(`To-do ${input.personal_task_id} does not exist`);
          const values = {};
          if (input.text != null) values.text = input.text.trim();
          if (input.group != null) values.todo_group_id = requireGroup(database, input.group).todo_group_id;
          if (input.status != null) {
            values.status = input.status;
            values.completed_at_utc = input.status === "complete" ? now : null;
          }
          if (input.clear_related_contact) values.related_contact_id = null;
          else if (input.related_contact_id != null) values.related_contact_id = input.related_contact_id;
          if (input.clear_interaction_guide) values.interaction_guide_id = null;
          else if (input.interaction_guide_id != null) {
            requireActiveGuide(database, input.interaction_guide_id);
            values.interaction_guide_id = input.interaction_guide_id;
          }
          if (input.clear_planning_prompt) values.planning_prompt_text = null;
          else if (input.planning_prompt_text != null) values.planning_prompt_text = input.planning_prompt_text.trim() || null;
          if (Object.keys(values).length === 0) throw new Error(`No changes supplied for to-do ${input.personal_task_id}`);
          values.updated_at_utc = now;
          database.prepare(`UPDATE todo_personal SET ${Object.keys(values).map((key) => `\`${key}\` = ?`).join(", ")}
            WHERE personal_task_id = ?`).run(...Object.values(values), input.personal_task_id);
          return { before, task: databaseTask(taskWithContext(database, input.personal_task_id)) };
        });
        appendLedger(ledger, context, { type: items.length === 1 ? "personal_todo.updated" : "personal_todos.updated",
          actorName: "todo_update", name: items.length === 1 ? "Personal to-do updated" : "Personal to-dos updated",
          content: items.length === 1 ? items[0].task.text : `Updated ${items.length} personal to-dos`,
          payload: { items }, subjectType: items.length === 1 ? "personal_task" : "personal_task_batch",
          subjectId: items.length === 1 ? String(items[0].task.personal_task_id) : String(items.length) });
        database.exec("COMMIT");
        return { updated_count: items.length, items };
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  });
}
