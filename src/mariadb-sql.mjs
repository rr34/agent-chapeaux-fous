const utcTimestampSql = "CONCAT(LEFT(DATE_FORMAT(UTC_TIMESTAMP(3), '%Y-%m-%dT%H:%i:%s.%f'), 23), 'Z')";

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

export function translateSqliteSql(sql) {
  let translated = String(sql).trim();
  if (/^BEGIN\s+IMMEDIATE\s*;?$/iu.test(translated)) return "START TRANSACTION";
  if (/^PRAGMA\b/iu.test(translated)) return null;
  translated = translated
    .replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/giu, "INSERT IGNORE INTO")
    .replace(/\s+COLLATE\s+NOCASE\b/giu, " COLLATE utf8mb4_general_ci")
    .replace(/strftime\('%Y-%m-%dT%H:%M:%fZ',\s*'now'\)/giu, utcTimestampSql)
    .replace(/"([A-Za-z_][A-Za-z0-9_]*)"/gu, "`$1`")
    .replaceAll("ESCAPE '\\'", "ESCAPE '\\\\'");
  if (/\bON\s+CONFLICT\b[\s\S]*\bDO\s+NOTHING\s*;?$/iu.test(translated)) {
    translated = translated.replace(/^INSERT\s+INTO\b/iu, "INSERT IGNORE INTO");
    translated = translated.replace(/\s+ON\s+CONFLICT\b[\s\S]*\bDO\s+NOTHING\s*;?$/iu, "");
  }
  return translated;
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
