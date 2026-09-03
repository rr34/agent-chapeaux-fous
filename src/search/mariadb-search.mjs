const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const wordPattern = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;

function inputError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function identifier(value) {
  if (typeof value !== "string" || !identifierPattern.test(value)) {
    throw new Error(`Invalid MariaDB search identifier: ${String(value)}`);
  }
  return `\`${value}\``;
}

function folded(value) {
  return String(value).normalize("NFKD").replaceAll(/\p{M}/gu, "").toLocaleLowerCase("en-US");
}

export function mariaDbSearchTokens(query, { unique = true } = {}) {
  const tokens = [...String(query).normalize("NFKC").matchAll(wordPattern)].map(([token]) => folded(token));
  if (!tokens.length) throw inputError("query must contain searchable words.");
  return unique ? [...new Set(tokens)] : tokens;
}

function booleanToken(token) {
  return `"${token.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function mariaDbBooleanExpression(query, mode) {
  const tokens = mariaDbSearchTokens(query, { unique: mode !== "phrase" });
  if (mode === "phrase") return `+"${tokens.join(" ").replaceAll('"', '\\"')}"`;
  return tokens.map((token) => `+${booleanToken(token)}`).join(" ");
}

function documentTokens(text) {
  return [...String(text).matchAll(wordPattern)].map((match) => ({
    raw: match[0],
    normalized: folded(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function phraseMatch(tokens, queryTokens) {
  for (let start = 0; start <= tokens.length - queryTokens.length; start += 1) {
    if (queryTokens.every((token, offset) => tokens[start + offset].normalized === token)) {
      return Array.from({ length: queryTokens.length }, (_, offset) => start + offset);
    }
  }
  return null;
}

function termsMatch(tokens, queryTokens) {
  const indexes = [];
  for (const token of queryTokens) {
    const index = tokens.findIndex((candidate) => candidate.normalized === token);
    if (index === -1) return null;
    indexes.push(index);
  }
  return indexes;
}

function nearMatch(tokens, queryTokens, maxDistance) {
  if (queryTokens.length < 2) return termsMatch(tokens, queryTokens);
  const required = new Set(queryTokens);
  const counts = new Map();
  let satisfied = 0;
  let left = 0;
  let best = null;
  for (let right = 0; right < tokens.length; right += 1) {
    const value = tokens[right].normalized;
    if (required.has(value)) {
      const count = (counts.get(value) ?? 0) + 1;
      counts.set(value, count);
      if (count === 1) satisfied += 1;
    }
    while (satisfied === required.size && left <= right) {
      const distance = (right - left + 1) - required.size;
      if (distance <= maxDistance && (!best || right - left < best.right - best.left)) {
        best = { left, right };
      }
      const leftValue = tokens[left].normalized;
      if (required.has(leftValue)) {
        const count = counts.get(leftValue) - 1;
        counts.set(leftValue, count);
        if (count === 0) satisfied -= 1;
      }
      left += 1;
    }
  }
  if (!best) return null;
  return queryTokens.map((queryToken) => {
    for (let index = best.left; index <= best.right; index += 1) {
      if (tokens[index].normalized === queryToken) return index;
    }
    return -1;
  });
}

export function mariaDbTextMatch(text, { query, mode = "terms", maxDistance = 12 } = {}) {
  const tokens = documentTokens(text);
  const queryTokens = mariaDbSearchTokens(query, { unique: mode !== "phrase" });
  let indexes;
  if (mode === "phrase") indexes = phraseMatch(tokens, queryTokens);
  else if (mode === "near") indexes = nearMatch(tokens, queryTokens, maxDistance);
  else indexes = termsMatch(tokens, queryTokens);
  return { matched: indexes !== null, indexes: indexes ?? [], tokens, queryTokens };
}

export function mariaDbSearchSnippet(text, match, contextTokens = 24) {
  if (!match?.matched || !match.tokens.length) return String(text ?? "").slice(0, 500);
  const matched = new Set(match.indexes);
  const first = Math.min(...match.indexes);
  const last = Math.max(...match.indexes);
  const desired = Math.max(last - first + 1, Number(contextTokens) || 24);
  const extra = desired - (last - first + 1);
  let startIndex = Math.max(0, first - Math.floor(extra / 2));
  let endIndex = Math.min(match.tokens.length - 1, startIndex + desired - 1);
  startIndex = Math.max(0, endIndex - desired + 1);
  const start = match.tokens[startIndex].start;
  const end = match.tokens[endIndex].end;
  let snippet = String(text).slice(start, end);
  const offsets = [...matched]
    .filter((index) => index >= startIndex && index <= endIndex)
    .map((index) => ({ start: match.tokens[index].start - start, end: match.tokens[index].end - start }))
    .sort((left, right) => right.start - left.start);
  for (const offset of offsets) {
    snippet = `${snippet.slice(0, offset.start)}[[${snippet.slice(offset.start, offset.end)}]]${snippet.slice(offset.end)}`;
  }
  return `${startIndex > 0 ? "…" : ""}${snippet}${endIndex < match.tokens.length - 1 ? "…" : ""}`;
}

export async function mariaDbHybridSearch({
  connection,
  table,
  idColumn,
  searchColumns,
  selectColumns,
  query,
  mode = "terms",
  maxDistance = 12,
  contextTokens = 24,
  limit = 20,
  whereSql = "",
  whereValues = [],
} = {}) {
  if (!connection?.execute) throw new Error("A MariaDB connection is required");
  if (!Array.isArray(searchColumns) || !searchColumns.length) throw new Error("searchColumns are required");
  const selectedLimit = Math.max(1, Math.min(200, Number(limit) || 20));
  const candidateLimit = Math.min(1000, Math.max(100, selectedLimit * 20));
  const tableSql = identifier(table);
  const idSql = identifier(idColumn);
  const searchSql = searchColumns.map(identifier).join(", ");
  const selected = [...new Set([idColumn, ...selectColumns, ...searchColumns])];
  const selectedSql = selected.map(identifier).join(", ");
  const restriction = whereSql.trim() ? ` AND (${whereSql})` : "";
  const expression = mariaDbBooleanExpression(query, mode);
  const [fullTextRows] = await connection.execute(
    `SELECT ${selectedSql}, MATCH(${searchSql}) AGAINST (? IN BOOLEAN MODE) AS search_rank
       FROM ${tableSql}
      WHERE MATCH(${searchSql}) AGAINST (? IN BOOLEAN MODE)${restriction}
      ORDER BY search_rank DESC, ${idSql} DESC
      LIMIT ${candidateLimit}`,
    [expression, expression, ...whereValues],
  );

  const queryTokens = mariaDbSearchTokens(query, { unique: true });
  const combinedText = `CONCAT_WS(' ', ${searchColumns.map((column) => `COALESCE(${identifier(column)}, '')`).join(", ")})`;
  const fallbackConditions = queryTokens.map(() => `LOCATE(LOWER(?), LOWER(${combinedText})) > 0`).join(" AND ");
  const [fallbackRows] = await connection.execute(
    `SELECT ${selectedSql}, 0 AS search_rank
       FROM ${tableSql}
      WHERE ${fallbackConditions}${restriction}
      ORDER BY ${idSql} DESC
      LIMIT ${candidateLimit}`,
    [...queryTokens, ...whereValues],
  );

  const candidates = new Map();
  for (const row of [...fullTextRows, ...fallbackRows]) {
    const key = String(row[idColumn]);
    const prior = candidates.get(key);
    if (!prior || Number(row.search_rank) > Number(prior.search_rank)) candidates.set(key, row);
  }
  const matched = [];
  for (const row of candidates.values()) {
    const text = searchColumns.map((column) => row[column] ?? "").join(" ");
    const match = mariaDbTextMatch(text, { query, mode, maxDistance });
    if (!match.matched) continue;
    matched.push({
      ...row,
      search_rank: Number(row.search_rank),
      search_snippet: mariaDbSearchSnippet(text, match, contextTokens),
    });
  }
  matched.sort((left, right) => (
    Number(right.search_rank) - Number(left.search_rank)
    || String(right[idColumn]).localeCompare(String(left[idColumn]), "en", { numeric: true })
  ));
  return {
    rows: matched.slice(0, selectedLimit),
    hasMore: matched.length > selectedLimit
      || fullTextRows.length === candidateLimit
      || fallbackRows.length === candidateLimit,
    candidateLimit,
    fullTextCandidateCount: fullTextRows.length,
    fallbackCandidateCount: fallbackRows.length,
  };
}
