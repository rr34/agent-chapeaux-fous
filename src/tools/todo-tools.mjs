import {
  archiveEmptyTodoGroup, renameTodoGroup, setTodoGroupDailyPaperPinned,
  setTodoGroupSequenceMode,
} from "../todo-group-operations.mjs";
import { selectedFields } from "./record-fields.mjs";
import {
  listTodoQueryPages, todoListInputSchema, todoQueryFilterProperties, todoStatuses,
} from "../todo-list-queries.mjs";

const toolDescriptions = Object.freeze({
  "todo_add": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Create one non-temporal native personal to-do in an exact stable-ID group, with optional planning prompt, position, contact, and fixed billable price.",
    "actionClasses": [
      "CREATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "todo_content_link_set": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Link or unlink one exact personal to-do and one exact content-library item.",
    "actionClasses": [
      "UPDATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "todo_group_archive": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Archive one active native to-do group after all of its tasks are terminal.",
    "actionClasses": [
      "UPDATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "todo_group_create": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Create or reactivate one native to-do group after the user has confirmed it.",
    "actionClasses": [
      "CREATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "todo_group_daily_paper_pin_set": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Pin or unpin one or more exact native to-do groups on every daily-paper PDF.",
    "actionClasses": [
      "UPDATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "todo_group_list": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "List active native to-do groups and their open counts so a new task can use the best existing group.",
    "actionClasses": [
      "READ"
    ],
    "effectClassifications": [
      "READ-ONLY"
    ]
  },
  "todo_group_rename": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Rename one active native to-do group without changing its stable identity or contained tasks.",
    "actionClasses": [
      "UPDATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "todo_group_sequence_set": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Enable or disable automatic stable sequence numbering for one active native to-do group.",
    "actionClasses": [
      "UPDATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "todo_list": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Read paginated batches of non-temporal native personal to-dos and their linked content-library items by task IDs, group, status, or completion date.",
    "actionClasses": [
      "READ"
    ],
    "effectClassifications": [
      "READ-ONLY"
    ]
  },
  "todo_position_set": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Move one native personal to-do to an exact position in its group's manual sort order.",
    "actionClasses": [
      "UPDATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  },
  "todo_update": {
    "protocol": "agent-slayer.tool-description",
    "version": 1,
    "summary": "Atomically update up to 500 non-temporal native personal to-dos, including optional fixed billable prices, by stable ID.",
    "actionClasses": [
      "UPDATE"
    ],
    "effectClassifications": [
      "MUTATING"
    ]
  }
});

const optionalText = { type: ["string", "null"] };
const todoFields = [
  "personal_task_id", "todo_group_id", "sequence",
  "related_contact_id", "text", "status", "sort_position", "completed_at_utc",
  "planning_prompt_text", "billable_amount_minor", "billable_currency",
  "source", "external_id", "source_event_id",
  "created_at_utc", "updated_at_utc",
];
const groupFields = [
  "todo_group_id", "name", "sort_position", "uses_sequence", "daily_paper_pinned", "archived_at_utc",
  "created_at_utc", "updated_at_utc",
];
const linkedContentFields = [
  "content_id", "content_group_id", "sequence", "content_type", "content_status",
  "title", "group_name", "linked_at_utc",
];

const linkedContentRecordSchema = {
  type: "object",
  description: "One exact content-library item associated with a personal to-do.",
  properties: {
    ...Object.fromEntries(linkedContentFields.map((name) => [name, {}])),
    content_ref: { description: "Stable Agent Slayer reference for this exact content item." },
    content_title: { description: "Human-facing title for this exact content item." },
  },
};

const todoTaskRecordSchema = {
  type: ["object", "null"],
  description: "One non-temporal item in the user's authoritative personal to-do list. Calendar events own schedules and deadlines.",
  properties: {
    ...Object.fromEntries(todoFields.map((name) => [name, {}])),
    ref: { description: "Stable Agent Slayer reference for this exact personal to-do." },
    group_name: {},
    linked_content: { type: "array", items: linkedContentRecordSchema },
  },
};
const todoGroupRecordSchema = {
  type: ["object", "null"],
  description: "A named group in the user's authoritative personal to-do list.",
  properties: {
    ...Object.fromEntries(groupFields.map((name) => [name, {}])),
    ref: { description: "Stable Agent Slayer reference for this exact to-do group." },
  },
};

function taskWithContext(database, taskId) {
  return database.prepare(`
    SELECT task.*, todo_group.name AS group_name
    FROM todo_personal AS task
    JOIN todo_groups AS todo_group USING (todo_group_id)
    WHERE task.personal_task_id = ?
  `).get(taskId);
}

function linkedContentByTaskIds(database, taskIds) {
  const ids = [...new Set(taskIds.map(Number))];
  if (!ids.length) return new Map();
  const rows = database.prepare(`
    SELECT relation.personal_task_id, content.content_id, content.content_group_id,
           content.sequence, content.content_type, content.content_status,
           content.title, relation.created_at_utc AS linked_at_utc,
           content_group.name AS group_name
    FROM todo_content_join AS relation
    JOIN content_items AS content USING (content_id)
    JOIN content_groups AS content_group USING (content_group_id)
    WHERE relation.personal_task_id IN (${ids.map(() => "?").join(", ")})
    ORDER BY relation.personal_task_id, content_group.sort_position,
             content.sequence IS NULL, content.sequence, content.content_id
  `).all(...ids);
  const byTask = new Map(ids.map((id) => [id, []]));
  for (const row of rows) byTask.get(Number(row.personal_task_id)).push({
    ...selectedFields(row, linkedContentFields),
    content_id: Number(row.content_id),
    content_ref: `agent-slayer://content-items/${Number(row.content_id)}`,
    content_title: row.title,
  });
  return byTask;
}

function databaseTask(row, linkedContent = []) {
  if (!row) return null;
  return {
    ...selectedFields(row, todoFields),
    ref: `agent-slayer://todos/${Number(row.personal_task_id)}`,
    group_name: row.group_name,
    linked_content: linkedContent,
  };
}

function databaseTaskWithContent(database, row) {
  if (!row) return null;
  return databaseTask(row, linkedContentByTaskIds(database, [row.personal_task_id])
    .get(Number(row.personal_task_id)) ?? []);
}

function contentWithContext(database, contentId) {
  const row = database.prepare(`
    SELECT content.content_id, content.content_group_id, content.sequence,
           content.content_type, content.content_status, content.title,
           content_group.name AS group_name
    FROM content_items AS content
    JOIN content_groups AS content_group USING (content_group_id)
    WHERE content.content_id = ?
  `).get(contentId);
  if (!row) return null;
  return {
    ...selectedFields(row, linkedContentFields),
    content_id: Number(row.content_id),
    content_ref: `agent-slayer://content-items/${Number(row.content_id)}`,
    content_title: row.title,
  };
}

function databaseGroup(row) {
  if (!row) return null;
  return {
    ...selectedFields(row, groupFields),
    ref: `agent-slayer://todo-groups/${Number(row.todo_group_id)}`,
  };
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

function requireGroup(database, id) {
  const row = database.prepare(`
    SELECT * FROM todo_groups WHERE todo_group_id = ? AND archived_at_utc IS NULL
  `).get(id);
  if (!row) throw new Error(`Active to-do group ${id} does not exist`);
  return row;
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
    dailyPaperPinned: Boolean(row.daily_paper_pinned),
  }));
  return {
    heading: "Active to-do groups",
    text: groups.length
      ? ["Use these exact existing group names and IDs when they match the request.",
          ...groups.map(({ todoGroupId, name, dailyPaperPinned }) => (
            `- [group ${todoGroupId}] ${name}${dailyPaperPinned ? " (pinned to daily paper)" : ""}`
          ))].join("\n")
      : "No active to-do groups exist.",
    data: { groups, totalCount: allRows.length, omittedCount: allRows.length - groups.length },
  };
}

const nativeToolContracts = Object.freeze({
  todo_group_list: { objectTypes: ["todos.todo_group"] },
  todo_list: { objectTypes: ["todos.personal_task"], allowUnboundInputs: true },
});

export function registerTodoTools(registry, store, ledger) {
  const rootRegistry = registry;
  registry = registry.withCapability?.("todos", toolDescriptions, nativeToolContracts) ?? registry;
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
    description: "Read non-temporal native personal to-dos and their linked content-library items in one or more paginated queries. Schedules and deadlines are calendar events and are read with calendar tools.",
    outputSchema: { type: "object", properties: {
      has_more: { type: "boolean" }, results: { type: "array", items: { type: "object", properties: {
        query_id: { type: "string" }, filters: { type: "object", properties: todoQueryFilterProperties },
        tasks: { type: "array", items: todoTaskRecordSchema }, count: { type: "integer" },
        has_more: { type: "boolean" }, next_cursor: { type: ["string", "null"] },
      } } },
    } },
    parameters: todoListInputSchema,
    async execute({ queries }) {
      const database = store.requireReady();
      const result = listTodoQueryPages(database, queries);
      const linkedByTask = linkedContentByTaskIds(database, result.results
        .flatMap((page) => page.tasks.map((task) => task.personal_task_id)));
      return { ...result, results: result.results.map((page) => ({
        ...page, tasks: page.tasks.map((task) => databaseTask(
          task, linkedByTask.get(Number(task.personal_task_id)) ?? [],
        )),
      })) };
    },
  });

  registry.register({
    name: "todo_add",
    description: "Add one non-temporal native personal to-do to an exact group selected by stable ID. It may carry a fixed billable amount in minor currency units. To place work or a deadline on the calendar, create a calendar event and link it to the to-do.",
    outputSchema: { type: "object", properties: { task: todoTaskRecordSchema } },
    parameters: { type: "object", additionalProperties: false, properties: {
      text: { type: "string", minLength: 1, maxLength: 10000 },
      status: { type: "string", enum: todoStatuses },
      todo_group_id: { type: "integer", minimum: 1 },
      related_contact_id: { type: ["integer", "null"], minimum: 1 },
      planning_prompt_text: optionalText,
      billable_amount_minor: { type: ["integer", "null"], minimum: 1 },
      billable_currency: { type: ["string", "null"], pattern: "^[A-Z]{3}$" },
      position: { type: ["integer", "null"], minimum: 1, maximum: 1_000_000_000 },
    }, required: ["text", "todo_group_id"] },
    async execute(input, context) {
      const database = store.requireReady();
      const text = input.text.trim();
      if (!text) throw new Error("To-do text cannot be empty");
      const group = requireGroup(database, input.todo_group_id);
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
            todo_group_id, related_contact_id, text, status,
            sort_position, completed_at_utc, planning_prompt_text, source, source_event_id,
            billable_amount_minor, billable_currency
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'agent-slayer', ?, ?, ?)
          RETURNING personal_task_id
        `).get(group.todo_group_id, input.related_contact_id ?? null,
          text, input.status ?? "todo", position,
          completed, input.planning_prompt_text?.trim() || null, context.requestEventId || null,
          input.billable_amount_minor ?? null, input.billable_currency ?? null);
        if (input.position != null) setTodoPosition(database, Number(inserted.personal_task_id), input.position);
        const task = databaseTaskWithContent(database, taskWithContext(database, inserted.personal_task_id));
        appendLedger(ledger, context, { type: "personal_todo.created", actorName: "todo_add",
          name: "Personal to-do created", content: task.text, payload: { task },
          subjectType: "personal_task", subjectId: String(task.personal_task_id) });
        database.exec("COMMIT");
        return { created: true, task };
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
  });

  registry.register({
    name: "todo_content_link_set",
    description: "Link or unlink one exact existing personal to-do and one exact existing content-library item. This changes only their association; it does not modify, move, complete, or delete either parent record.",
    outputSchema: { type: "object", properties: {
      changed: { type: "boolean", description: "False when this exact association was already in the requested state." },
      linked: { type: "boolean" },
      task: todoTaskRecordSchema,
      content: linkedContentRecordSchema,
    }, required: ["changed", "linked", "task", "content"] },
    parameters: { type: "object", additionalProperties: false, properties: {
      personal_task_id: { type: "integer", minimum: 1, description: "Existing personal to-do ID from an authoritative to-do read." },
      content_id: { type: "integer", minimum: 1, description: "Existing content-library item ID from an authoritative content read." },
      linked: { type: "boolean", description: "True creates the association; false removes only this exact association." },
    }, required: ["personal_task_id", "content_id", "linked"] },
    async execute({ personal_task_id: taskId, content_id: contentId, linked }, context) {
      const database = store.requireReady();
      database.exec("START TRANSACTION");
      try {
        const taskRow = taskWithContext(database, taskId);
        if (!taskRow) throw new Error(`To-do ${taskId} does not exist`);
        const content = contentWithContext(database, contentId);
        if (!content) throw new Error(`Content item ${contentId} does not exist`);
        let changed = false;
        if (linked) {
          changed = database.prepare(`
            INSERT IGNORE INTO todo_content_join (personal_task_id, content_id)
            VALUES (?, ?)
          `).run(taskId, contentId).changes > 0;
        } else {
          changed = database.prepare(`
            DELETE FROM todo_content_join
            WHERE personal_task_id = ? AND content_id = ?
          `).run(taskId, contentId).changes > 0;
        }
        if (changed) database.prepare(`
          UPDATE todo_personal SET updated_at_utc = ? WHERE personal_task_id = ?
        `).run(new Date().toISOString(), taskId);
        const task = databaseTaskWithContent(database, taskWithContext(database, taskId));
        appendLedger(ledger, context, {
          type: linked ? "personal_todo.content_linked" : "personal_todo.content_unlinked",
          actorName: "todo_content_link_set",
          name: linked ? "Content linked to personal to-do" : "Content unlinked from personal to-do",
          content: `${task.text}: ${content.content_title}`,
          payload: { changed, linked, task, content },
          subjectType: "personal_task", subjectId: String(taskId),
        });
        database.exec("COMMIT");
        return { changed, linked, task, content };
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
        const task = databaseTaskWithContent(database, taskWithContext(database, id));
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

  registry.register({
    name: "todo_group_daily_paper_pin_set",
    description: "Atomically pin or unpin one or more exact active to-do groups on the daily paper. A pinned group and all of its open tasks appear on every generated paper, including when the group is empty. Pinning never changes an individual task or its calendar links.",
    outputSchema: { type: "object", additionalProperties: false, properties: {
      updated_count: { type: "integer", minimum: 1 },
      items: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false,
        properties: { changed: { type: "boolean" }, group: todoGroupRecordSchema },
        required: ["changed", "group"] } },
    }, required: ["updated_count", "items"] },
    parameters: { type: "object", additionalProperties: false, properties: {
      updates: { type: "array", minItems: 1, maxItems: 100, items: {
        type: "object", additionalProperties: false, properties: {
          todo_group_id: { type: "integer", minimum: 1 },
          daily_paper_pinned: { type: "boolean" },
        }, required: ["todo_group_id", "daily_paper_pinned"],
      } },
    }, required: ["updates"] },
    async execute({ updates }, context) {
      const database = store.requireReady();
      const ids = updates.map(({ todo_group_id: id }) => id);
      if (new Set(ids).size !== ids.length) {
        throw new Error("Duplicate to-do group ID in daily-paper pin batch");
      }
      database.exec("START TRANSACTION");
      try {
        const items = updates.map(({ todo_group_id: id, daily_paper_pinned: pinned }) => {
          const result = setTodoGroupDailyPaperPinned(database, {
            groupId: id, dailyPaperPinned: pinned,
          });
          return {
            changed: result.changed,
            group: databaseGroup(database.prepare(
              "SELECT * FROM todo_groups WHERE todo_group_id = ?",
            ).get(id)),
          };
        });
        appendLedger(ledger, context, {
          type: "personal_todo_group.daily_paper_pin_set",
          actorName: "todo_group_daily_paper_pin_set",
          name: "To-do group daily-paper pins set",
          content: `${items.length} ${items.length === 1 ? "group" : "groups"} updated`,
          payload: { updated_count: items.length, items },
          subjectType: "todo_group_set",
          subjectId: ids.join(","),
        });
        database.exec("COMMIT");
        return { updated_count: items.length, items };
      } catch (error) { database.exec("ROLLBACK"); throw error; }
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
    name: "todo_update",
    description: "Atomically update one or more non-temporal native personal to-dos. Calendar placement and deadlines must be changed through calendar events.",
    outputSchema: { type: "object", properties: { updated_count: { type: "integer" },
      items: { type: "array", items: { type: "object", properties: { task: todoTaskRecordSchema } } } } },
    parameters: { type: "object", additionalProperties: false, properties: {
      updates: { type: "array", minItems: 1, maxItems: 500, items: {
        type: "object", additionalProperties: false, properties: {
          personal_task_id: { type: "integer", minimum: 1 }, text: optionalText,
          todo_group_id: { type: ["integer", "null"], minimum: 1 },
          status: { type: ["string", "null"], enum: [...todoStatuses, null] },
          related_contact_id: { type: ["integer", "null"], minimum: 1 }, clear_related_contact: { type: "boolean" },
          planning_prompt_text: optionalText, clear_planning_prompt: { type: "boolean" },
          billable_amount_minor: { type: ["integer", "null"], minimum: 1 },
          billable_currency: { type: ["string", "null"], pattern: "^[A-Z]{3}$" },
          clear_billable_price: { type: "boolean" },
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
          const before = databaseTaskWithContent(database, taskWithContext(database, input.personal_task_id));
          if (!before) throw new Error(`To-do ${input.personal_task_id} does not exist`);
          const values = {};
          if (input.text != null) values.text = input.text.trim();
          if (input.todo_group_id != null) values.todo_group_id = requireGroup(database, input.todo_group_id).todo_group_id;
          if (input.status != null) {
            values.status = input.status;
            values.completed_at_utc = input.status === "complete" ? now : null;
          }
          if (input.clear_related_contact) values.related_contact_id = null;
          else if (input.related_contact_id != null) values.related_contact_id = input.related_contact_id;
          if (input.clear_planning_prompt) values.planning_prompt_text = null;
          else if (input.planning_prompt_text != null) values.planning_prompt_text = input.planning_prompt_text.trim() || null;
          if (input.clear_billable_price) {
            values.billable_amount_minor = null;
            values.billable_currency = null;
          } else if (input.billable_amount_minor != null || input.billable_currency != null) {
            if (input.billable_amount_minor == null || input.billable_currency == null) {
              throw new Error("billable_amount_minor and billable_currency must be supplied together");
            }
            values.billable_amount_minor = input.billable_amount_minor;
            values.billable_currency = input.billable_currency;
          }
          if (Object.keys(values).length === 0) throw new Error(`No changes supplied for to-do ${input.personal_task_id}`);
          values.updated_at_utc = now;
          database.prepare(`UPDATE todo_personal SET ${Object.keys(values).map((key) => `\`${key}\` = ?`).join(", ")}
            WHERE personal_task_id = ?`).run(...Object.values(values), input.personal_task_id);
          return { before, task: databaseTaskWithContent(
            database, taskWithContext(database, input.personal_task_id),
          ) };
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
