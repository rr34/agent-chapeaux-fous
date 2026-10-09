import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef } from "react";

const markdownRenderer = new marked.Renderer();

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

// Model-authored HTML is shown literally, and remote images become text labels.
// Markdown structure is still rendered after the result passes through DOMPurify.
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

function sanitizedMarkdown(source: string) {
  try {
    const rendered = marked.parse(source, {
      async: false,
      gfm: true,
      breaks: false,
      renderer: markdownRenderer,
    }) as string;
    return DOMPurify.sanitize(rendered, sanitizerOptions);
  } catch {
    return escapeHtml(source);
  }
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const html = useMemo(() => sanitizedMarkdown(source), [source]);

  useEffect(() => {
    for (const link of container.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  }, [html]);

  return <div ref={container} className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
