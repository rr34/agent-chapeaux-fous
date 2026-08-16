export function withSchemaProjection(schemaSemantics, context, result, operation) {
  return {
    ...result,
    schemaProjection: schemaSemantics?.compile(operation, context) ?? null,
  };
}

export function selectedFields(row, fields) {
  if (!row) return null;
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]]),
  );
}
