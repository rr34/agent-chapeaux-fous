import { marked } from "marked";

const machineReferenceKeys = new Set([
  "file_id", "title", "original_filename", "media_kind",
  "video_script_id", "video_job_id", "output_file_id", "content_id",
  "briefing_name", "interaction_guide_id", "interaction_guide_step_id",
  "exchange_number", "opening_text",
]);

const machineIdentityKeys = new Set([
  "file_id", "video_script_id", "video_job_id", "output_file_id",
  "interaction_guide_id", "interaction_guide_step_id",
]);

const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const longDigitPattern = /\b\d{16,}\b/gu;
const longTokenPattern = /[A-Za-z0-9_-]{24,}/gu;

function machineIdentityObject(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const keys = Object.keys(value);
  return keys.length > 0
    && keys.every((key) => machineReferenceKeys.has(key))
    && keys.some((key) => machineIdentityKeys.has(key));
}

function withoutMachineReferenceBlocks(value) {
  const lines = String(value ?? "").replaceAll("\r\n", "\n").split("\n");
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const withoutReferenceCode = lines[index].replace(/\s*Reference code:\s*.*$/iu, "").trimEnd();
    if (withoutReferenceCode !== lines[index]) {
      if (withoutReferenceCode) kept.push(withoutReferenceCode);
      continue;
    }
    if (lines[index].trim() !== "{") {
      kept.push(lines[index]);
      continue;
    }
    const closingOffset = lines.slice(index + 1, index + 32)
      .findIndex((line) => line.trim() === "}");
    if (closingOffset === -1) {
      kept.push(lines[index]);
      continue;
    }
    const closingIndex = index + closingOffset + 1;
    let parsed = null;
    try { parsed = JSON.parse(lines.slice(index, closingIndex + 1).join("\n")); } catch { /* Keep ordinary JSON. */ }
    if (!machineIdentityObject(parsed)) {
      kept.push(lines[index]);
      continue;
    }
    index = closingIndex;
  }
  return kept.join("\n");
}

function withoutOpaqueTokens(value) {
  return value
    .replace(uuidPattern, "")
    .replace(longDigitPattern, "")
    .replace(longTokenPattern, (token, offset, source) => {
      const previous = source[offset - 1] ?? "";
      const next = source[offset + token.length] ?? "";
      const looksLikeUrlOrAddress = ":/@".includes(previous) || ":/@".includes(next);
      const mixesLettersAndNumbers = /[A-Za-z]/u.test(token) && /\d/u.test(token);
      return !looksLikeUrlOrAddress && mixesLettersAndNumbers ? "" : token;
    });
}

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"" };
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/giu, (match, entity) => {
    if (entity.startsWith("#")) {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      try { return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match; } catch { return match; }
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function urlForSpeech(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./iu, "").replaceAll(".", " dot ");
    const path = decodeURIComponent(url.pathname)
      .split("/")
      .filter(Boolean)
      .join(", path ")
      .replace(/[-_]+/gu, " ");
    return path ? `${host}, path ${path}` : host;
  } catch {
    return String(value ?? "").replaceAll(".", " dot ").replaceAll("/", " slash ");
  }
}

function inlineSpeech(tokens = []) {
  return tokens.map((token) => {
    if (token.type === "br") return ". ";
    if (token.type === "checkbox") return token.checked ? "Completed. " : "Not completed. ";
    if (token.type === "image") return token.text ? `Image: ${token.text}` : "Image";
    if (token.type === "link") {
      const label = inlineSpeech(token.tokens);
      return label && label !== token.href ? label : urlForSpeech(token.href);
    }
    if (token.type === "html") return decodeEntities(token.text.replace(/<[^>]*>/gu, " "));
    if (Array.isArray(token.tokens)) return inlineSpeech(token.tokens);
    return decodeEntities(token.text ?? "");
  }).join("");
}

function sentence(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

function joinedSpeechParts(parts) {
  return parts.filter(Boolean).reduce((result, part) => {
    if (!result) return part;
    return `${result}${/[.!?…:]$/u.test(result) ? " " : ". "}${part}`;
  }, "");
}

function blockSpeech(tokens = []) {
  const parts = [];
  for (const token of tokens) {
    if (["space", "def", "hr"].includes(token.type)) continue;
    if (["heading", "paragraph", "text"].includes(token.type)) {
      parts.push(sentence(Array.isArray(token.tokens) ? inlineSpeech(token.tokens) : token.text));
      continue;
    }
    if (token.type === "blockquote") {
      parts.push(blockSpeech(token.tokens));
      continue;
    }
    if (token.type === "list") {
      token.items.forEach((item, index) => {
        const prefix = item.task
          ? (item.checked ? "Completed item: " : "Not completed item: ")
          : (token.ordered ? `Item ${Number(token.start || 1) + index}: ` : "");
        parts.push(sentence(`${prefix}${blockSpeech(item.tokens)}`));
      });
      continue;
    }
    if (token.type === "code") {
      const language = String(token.lang ?? "").trim().split(/\s+/u, 1)[0];
      if (String(token.text ?? "").trim()) {
        parts.push(`The response included a${language ? ` ${language}` : ""} code block.`);
      }
      continue;
    }
    if (token.type === "table") {
      const headings = token.header.map((cell) => inlineSpeech(cell.tokens)).filter(Boolean);
      parts.push(sentence(`Table${headings.length ? ` with columns ${headings.join(", ")}` : ""}`));
      token.rows.forEach((row, index) => {
        const values = row.map((cell) => inlineSpeech(cell.tokens)).filter(Boolean);
        parts.push(sentence(`Row ${index + 1}: ${values.join("; ")}`));
      });
      continue;
    }
    if (token.type === "html") {
      parts.push(sentence(decodeEntities(token.text.replace(/<[^>]*>/gu, " "))));
      continue;
    }
    if (Array.isArray(token.tokens)) parts.push(blockSpeech(token.tokens));
  }
  return joinedSpeechParts(parts);
}

export function videoSpeechText(value) {
  try {
    return blockSpeech(marked.lexer(String(value ?? ""), { gfm: true }))
      .replace(/\s+/gu, " ")
      .trim();
  } catch {
    return String(value ?? "")
      .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/[*_~`]+/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
  }
}

export function videoDialogueText(value, fallback = "Technical reference omitted from this video.") {
  const projected = videoSpeechText(withoutOpaqueTokens(withoutMachineReferenceBlocks(value)))
    .replace(/[ \t]+([,.;:!?])/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/\n[ \t]+/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return projected || fallback;
}
