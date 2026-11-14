export type LcdLink = { label: string; target: string };

export const lcdColumns = 20;
export const lcdRows = 4;

function hardWrap(value: string, width: number) {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += width) chunks.push(value.slice(index, index + width));
  return chunks.length ? chunks : [""];
}

export function wrapLcdText(value: string, width = lcdColumns) {
  const rows: string[] = [];
  for (const sourceLine of String(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    const words = sourceLine.trim().split(/\s+/u).filter(Boolean);
    if (!words.length) {
      rows.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      if (word.length > width) {
        if (current) { rows.push(current); current = ""; }
        const chunks = hardWrap(word, width);
        rows.push(...chunks.slice(0, -1));
        current = chunks.at(-1) || "";
      } else if (!current) current = word;
      else if (current.length + 1 + word.length <= width) current += ` ${word}`;
      else { rows.push(current); current = word; }
    }
    if (current || !rows.length) rows.push(current);
  }
  return rows;
}

export function renderLcdDocument(text: string, links: LcdLink[] = []) {
  const rows = text ? wrapLcdText(text) : [];
  for (const link of links) rows.push(`${link.label.trim().slice(0, 19).padEnd(19, " ")}>`);
  return rows.length ? rows : [""];
}

export function lcdViewport(documentRows: string[], requestedOffset = 0) {
  const maximum = Math.max(0, documentRows.length - lcdRows);
  const offset = Math.min(maximum, Math.max(0, Math.trunc(requestedOffset)));
  return {
    offset,
    maximum,
    rows: Array.from({ length: lcdRows }, (_, index) => (documentRows[offset + index] || "").slice(0, lcdColumns).padEnd(lcdColumns, " ")),
  };
}
