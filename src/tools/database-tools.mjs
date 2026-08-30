const nullableString = { type: ["string", "null"] };

function fieldsForRead(argumentsObject) {
  const fields = new Set(argumentsObject.columns ?? []);
  for (const key of Object.keys(argumentsObject.where ?? {})) fields.add(key);
  if (argumentsObject.orderBy) fields.add(argumentsObject.orderBy);
  return fields.size ? [...fields] : null;
}

function fieldsForWrite(argumentsObject) {
  const fields = new Set([
    ...Object.keys(argumentsObject.values ?? {}),
    ...Object.keys(argumentsObject.where ?? {}),
  ]);
  return fields.size ? [...fields] : null;
}

function projection(schemaSemantics, operation, context) {
  return schemaSemantics?.compile(operation, context) ?? null;
}

export function registerDatabaseTools(
  registry, store, ledger, schemaSemantics = null, searchCoordinator = null,
) {
  const databaseRegistry = registry.withCapability?.("database") ?? registry;
  const writeRegistry = registry.withCapability?.("database-write") ?? registry;
  const historyRegistry = registry.withCapability?.("history") ?? registry;
  databaseRegistry.register({
    name: "database_schema",
    description: "Inspect the existing Slayer SQLite tables, views, columns, foreign keys, and CREATE statements. This never changes schema.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { objectName: nullableString },
      required: ["objectName"],
    },
    async execute({ objectName }, context) {
      const objects = objectName
        ? [store.objectInfo(objectName)]
        : store.objects().map((object) => store.objectInfo(object.name));
      const schemaProjection = objectName
        ? projection(schemaSemantics, {
            name: "inspect_database_object",
            purpose: "Inspect one database object's mechanics and meaning.",
            schemaObjects: [objectName],
          }, context)
        : null;
      return { objects, schemaProjection };
    },
  });

  databaseRegistry.register({
    name: "database_read",
    description: "Read bounded rows from one existing SQLite table or view. Equality filters only; no raw SQL is accepted. When hasMore is true, repeat the same read with nextOffset to continue.",
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
        offset: { type: "integer", minimum: 0, maximum: 1000000 },
      },
    },
    async execute(argumentsObject, context) {
      if (["interaction_guides", "interaction_guide_steps"].includes(argumentsObject.objectName)) {
        throw new Error("Use the focused briefing tools for one explicitly requested briefing; generic database reads do not load private briefing or answer rows");
      }
      const schemaProjection = projection(schemaSemantics, {
        name: "bounded_database_read",
        purpose: "Read bounded rows through Agent Slayer's structured database interface.",
        schemaObjects: [argumentsObject.objectName],
        ...(fieldsForRead(argumentsObject)
          ? { fields: { [argumentsObject.objectName]: fieldsForRead(argumentsObject) } }
          : {}),
      }, context);
      return { ...store.read(argumentsObject), schemaProjection };
    },
  });

  writeRegistry.register({
    name: "database_write",
    description: "Insert, update, or delete rows in an explicitly allowlisted transitional native table that has no focused model mutation tool. Raw SQL, schema changes, and writes to tool-owned domain tables or the activity ledger are impossible. Update and delete require equality filters.",
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
      const schemaProjection = projection(schemaSemantics, {
        name: `bounded_database_${argumentsObject.action}`,
        purpose: `${argumentsObject.action} rows through Agent Slayer's structured database interface.`,
        schemaObjects: [argumentsObject.table],
        ...(fieldsForWrite(argumentsObject)
          ? { fields: { [argumentsObject.table]: fieldsForWrite(argumentsObject) } }
          : {}),
      }, context);
      const result = store.write(argumentsObject);
      ledger.append({
        type: "database.write", status: "complete", actorType: "tool", actorName: "database_write",
        turnId: context.requestId, operationId: context.callId, name: `${argumentsObject.action} ${argumentsObject.table}`,
        payload: { ...result, schemaProjection },
      });
      return { ...result, schemaProjection };
    },
  });

  databaseRegistry.register({
    name: "tool_receipt_list",
    description: "List durable historical tool-result receipts without loading their full payloads. Use requestId to inspect one request, or null for the newest global receipts. Continue with nextBeforeEventSeq when hasMore is true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        requestId: { type: ["string", "null"] },
        beforeEventSeq: { type: ["integer", "null"], minimum: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["requestId", "beforeEventSeq", "limit"],
    },
    async execute(argumentsObject) {
      return ledger.toolReceiptList(argumentsObject);
    },
  });

  databaseRegistry.register({
    name: "tool_receipt_read",
    description: "Read one exact durable tool call/result receipt as bounded JSON text. Start at offset 0 and continue with nextOffset while hasMore is true. Use this instead of repeating a completed action whose large result was paged or whose native model thread was replaced.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        receiptEventSeq: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0, maximum: 10000000 },
        maxCharacters: { type: "integer", minimum: 1, maximum: 32768 },
      },
      required: ["receiptEventSeq", "offset", "maxCharacters"],
    },
    async execute(argumentsObject) {
      return ledger.toolReceiptRead(argumentsObject);
    },
  });

  historyRegistry.register({
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

  historyRegistry.register({
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
      const entries = searchCoordinator
        ? (await searchCoordinator.searchScope("history", { query, limit })).native.entries
        : ledger.searchHistory(query, limit);
      return { count: entries.length, entries };
    },
  });

  historyRegistry.register({
    name: "history_range",
    description: "Return paired user requests and Slayer responses submitted within an explicit UTC date-time range, optionally filtered to a topic in the same lookup. Use this for relative-time references such as earlier today, yesterday, last week, or last month after resolving the user's words and time zone into startAtUtc inclusive and endAtUtc exclusive. When the request also suggests a topic, pass 1-5 concise distinctive terms in query; every term must occur somewhere in the paired user request or response. Pass null when no topic is implied. Results are chronological. Continue with nextAfterRequestId when hasMore is true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        startAtUtc: { type: "string", description: "Inclusive ISO-8601 UTC boundary." },
        endAtUtc: { type: "string", description: "Exclusive ISO-8601 UTC boundary." },
        query: { type: ["string", "null"], minLength: 1, maxLength: 500, description: "Concise topical terms to match across each paired request and response, or null for date-only retrieval." },
        afterRequestId: { type: ["string", "null"], description: "Pagination cursor from nextAfterRequestId, or null for the first page." },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["startAtUtc", "endAtUtc", "query", "afterRequestId", "limit"],
    },
    async execute(argumentsObject, context) {
      return ledger.conversationRange({
        ...argumentsObject,
        excludeRequestId: context?.requestId ?? null,
      });
    },
  });

}
