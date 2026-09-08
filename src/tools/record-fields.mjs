export function selectedFields(row, fields) {
  if (!row) return null;
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]]),
  );
}
