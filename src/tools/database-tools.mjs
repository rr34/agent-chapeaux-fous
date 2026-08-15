const nullableString = { type: ["string", "null"] };

export function registerDatabaseTools(registry, store, ledger) {
  registry.register({
    name: "database_schema",
    description: "Inspect the existing Slayer SQLite tables, views, columns, foreign keys, and CREATE statements. This never changes schema.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { objectName: nullableString },
      required: ["objectName"],
    },
    async execute({ objectName }) {
      if (objectName) return { objects: [store.objectInfo(objectName)] };
      return { objects: store.objects().map((object) => store.objectInfo(object.name)) };
    },
  });

  registry.register({
    name: "database_read",
    description: "Read bounded rows from one existing SQLite table or view. Equality filters only; no raw SQL is accepted.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["objectName"],
      properties: {
        objectName: { type: "string" },
        columns: { type: "array", items: { type: "string" } },
        where: { type: "object", additionalProperties: true },
        orderBy: { type: ["string", "null"] },
        orderDirection: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
    },
    async execute(argumentsObject) {
      return store.read(argumentsObject);
    },
  });

  registry.register({
    name: "database_write",
    description: "Insert, update, or delete rows in an approved existing domain table. Raw SQL, schema changes, and writes to the activity ledger are impossible. Update and delete require equality filters.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["action", "table"],
      properties: {
        action: { type: "string", enum: ["insert", "update", "delete"] },
        table: { type: "string" },
        values: { type: "object", additionalProperties: true },
        where: { type: "object", additionalProperties: true },
      },
    },
    async execute(argumentsObject, context) {
      const result = store.write(argumentsObject);
      ledger.append({
        type: "database.write", status: "complete", actorType: "tool", actorName: "database_write",
        turnId: context.requestId, operationId: context.callId, name: `${argumentsObject.action} ${argumentsObject.table}`,
        payload: result,
      });
      return result;
    },
  });

  registry.register({
    name: "history_recent",
    description: "Return recent user requests and Slayer responses from the application-owned global history.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { limit: { type: "integer", minimum: 1, maximum: 20 } },
      required: ["limit"],
    },
    async execute({ limit }) {
      const entries = ledger.recentConversation({ limit });
      return { count: entries.length, entries };
    },
  });

  registry.register({
    name: "history_search",
    description: "Search older user requests and Slayer responses by text.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["query", "limit"],
    },
    async execute({ query, limit }) {
      const entries = ledger.searchHistory(query, limit);
      return { count: entries.length, entries };
    },
  });
}
