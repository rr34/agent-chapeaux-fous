export function countSqlParameters(sql) {
  let count = 0;
  let quote = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote) {
        if (sql[index + 1] === quote) index += 1;
        else quote = null;
      } else if (character === "\\") index += 1;
    } else if (character === "'" || character === '"' || character === "`") quote = character;
    else if (character === "?") count += 1;
  }
  return count;
}

export function parseUpdateReturning(sql) {
  const match = String(sql).trim().match(
    /^UPDATE\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+?)\s+RETURNING\s+([\s\S]+?)\s*;?$/iu,
  );
  if (!match) return null;
  return {
    table: match[1],
    setSql: match[2].trim(),
    whereSql: match[3].trim(),
    returningSql: match[4].trim(),
    setParameterCount: countSqlParameters(match[2]),
  };
}
