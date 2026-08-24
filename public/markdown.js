import DOMPurify from "dompurify";
import { marked } from "marked";

const markdownRenderer = new marked.Renderer();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

// Model-authored HTML is displayed literally. Markdown remains fully formatted,
// while arbitrary HTML cannot add controls or active content to the application.
markdownRenderer.html = ({ text }) => escapeHtml(text);
markdownRenderer.image = ({ text, title }) => {
  const label = text ? `Image: ${text}` : "Image";
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  return `<span class="markdown-image-alt"${titleAttribute}>${escapeHtml(label)}</span>`;
};

const sanitizerOptions = {
  ALLOWED_TAGS: [
    "a", "b", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "i", "input", "li", "ol", "p", "pre", "s", "span", "strong", "table", "tbody", "td",
    "th", "thead", "tr", "ul",
  ],
  ALLOWED_ATTR: ["checked", "class", "disabled", "href", "start", "title", "type"],
  ALLOW_DATA_ATTR: false,
  RETURN_TRUSTED_TYPE: false,
};

export function renderMarkdown(container, markdown) {
  const source = String(markdown ?? "");
  try {
    const rendered = marked.parse(source, { gfm: true, breaks: false, renderer: markdownRenderer });
    container.innerHTML = DOMPurify.sanitize(rendered, sanitizerOptions);
    for (const link of container.querySelectorAll("a[href]")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  } catch {
    container.textContent = source;
  }
}

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: "\"" };
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity) => {
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
    const host = url.hostname.replace(/^www\./i, "").replaceAll(".", " dot ");
    const path = decodeURIComponent(url.pathname)
      .split("/")
      .filter(Boolean)
      .join(", path ")
      .replace(/[-_]+/g, " ");
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
    if (token.type === "html") return decodeEntities(token.text.replace(/<[^>]*>/g, " "));
    if (Array.isArray(token.tokens)) return inlineSpeech(token.tokens);
    return decodeEntities(token.text ?? "");
  }).join("");
}

function sentence(value) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return /[.!?…:]$/.test(cleaned) ? cleaned : `${cleaned}.`;
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
      const language = String(token.lang ?? "").trim().split(/\s+/, 1)[0];
      parts.push(`I included a${language ? ` ${language}` : ""} code block in the written response.`);
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
      parts.push(sentence(decodeEntities(token.text.replace(/<[^>]*>/g, " "))));
      continue;
    }
    if (Array.isArray(token.tokens)) parts.push(blockSpeech(token.tokens));
  }
  return parts.filter(Boolean).join(" ");
}

export function markdownToSpeech(markdown) {
  try {
    return blockSpeech(marked.lexer(String(markdown ?? ""), { gfm: true }))
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return String(markdown ?? "").replace(/\s+/g, " ").trim();
  }
}
