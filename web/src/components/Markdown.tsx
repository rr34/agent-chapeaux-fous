import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState } from "react";
import { downloadAuthenticated } from "../api";

const markdownRenderer = new marked.Renderer();
const phoneNumberPattern = /(?:\+\d{8,15}|(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}[\s.-]\d{4}|\d{10,11})/g;
const emailAddressPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/gi;

type CopyFragmentKind = "phone number" | "email address";
type CopyFragmentMatch = { index: number; value: string; kind: CopyFragmentKind };

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

function authenticatedFileDownloadPath(href: string) {
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin
      || !/^\/api\/files\/\d+\/download$/u.test(url.pathname)) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function phoneNumberMatches(value: string) {
  return [...value.matchAll(phoneNumberPattern)].filter((match) => {
    const before = value[match.index - 1] || "";
    const after = value[match.index + match[0].length] || "";
    return !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after);
  }).map((match): CopyFragmentMatch => ({ index: match.index, value: match[0], kind: "phone number" }));
}

function emailAddressMatches(value: string) {
  return [...value.matchAll(emailAddressPattern)].filter((match) => {
    const before = value[match.index - 1] || "";
    const after = value[match.index + match[0].length] || "";
    return !/[A-Za-z0-9._%+-]/.test(before) && !/[A-Za-z0-9-]/.test(after);
  }).map((match): CopyFragmentMatch => ({ index: match.index, value: match[0], kind: "email address" }));
}

function automaticCopyMatches(value: string) {
  const matches = [...phoneNumberMatches(value), ...emailAddressMatches(value)]
    .sort((left, right) => left.index - right.index);
  return matches.filter((match, index) => (
    index === 0 || match.index >= matches[index - 1].index + matches[index - 1].value.length
  ));
}

function makeCopyButton(value: string, label: string) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "response-copy-fragment";
  button.dataset.copyValue = value;
  button.dataset.copyLabel = label;
  button.title = label;
  button.setAttribute("aria-label", `${label}: ${value}`);
  return button;
}

function addCopyableFragments(container: HTMLElement) {
  for (const code of container.querySelectorAll<HTMLElement>("code")) {
    if (code.closest("pre, button") || !code.textContent?.trim()) continue;
    const value = code.textContent;
    const button = makeCopyButton(value, "Copy value");
    button.classList.add("response-copy-fragment-code");
    code.replaceWith(button);
    button.append(code);
  }

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current.parentElement?.closest("a, button, code, pre")) continue;
    if (automaticCopyMatches(current.textContent || "").length) textNodes.push(current as Text);
  }

  for (const textNode of textNodes) {
    const source = textNode.textContent || "";
    const replacement = document.createDocumentFragment();
    let offset = 0;
    for (const match of automaticCopyMatches(source)) {
      const index = match.index;
      replacement.append(document.createTextNode(source.slice(offset, index)));
      const button = makeCopyButton(match.value, `Copy ${match.kind}`);
      button.textContent = match.value;
      replacement.append(button);
      offset = index + match.value.length;
    }
    replacement.append(document.createTextNode(source.slice(offset)));
    textNode.replaceWith(replacement);
  }
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Some browsers expose Clipboard in contexts where writes are blocked.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard is unavailable");
}

export function Markdown({
  source,
  className,
  copyableFragments = false,
}: {
  source: string;
  className?: string;
  copyableFragments?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const html = useMemo(() => sanitizedMarkdown(source), [source]);

  useEffect(() => {
    const listeners: Array<{ link: HTMLAnchorElement; handleClick: (event: MouseEvent) => void }> = [];
    const copiedTimers: number[] = [];
    if (copyableFragments && container.current) addCopyableFragments(container.current);
    const handleCopy = (event: MouseEvent) => {
      const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-copy-value]");
      if (!button || !container.current?.contains(button)) return;
      const copyValue = button.dataset.copyValue;
      const copyLabel = button.dataset.copyLabel || "Copy value";
      if (!copyValue) return;
      void copyText(copyValue).then(() => {
        button.dataset.copyState = "copied";
        button.title = "Copied";
        button.setAttribute("aria-label", `Copied: ${copyValue}`);
        copiedTimers.push(window.setTimeout(() => {
          button.removeAttribute("data-copy-state");
          button.title = copyLabel;
          button.setAttribute("aria-label", `${copyLabel}: ${copyValue}`);
        }, 1600));
      }).catch(() => {
        button.dataset.copyState = "error";
        button.title = "Could not copy";
      });
    };
    container.current?.addEventListener("click", handleCopy);
    for (const link of container.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []) {
      const downloadPath = authenticatedFileDownloadPath(link.getAttribute("href") || "");
      if (downloadPath) {
        link.removeAttribute("target");
        link.removeAttribute("rel");
        const handleClick = (event: MouseEvent) => {
          event.preventDefault();
          setDownloadError(null);
          void downloadAuthenticated(downloadPath, `file-${downloadPath.split("/")[3]}`)
            .catch((error: unknown) => setDownloadError(
              error instanceof Error ? error.message : "The file download failed.",
            ));
        };
        link.addEventListener("click", handleClick);
        listeners.push({ link, handleClick });
        continue;
      }
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    return () => {
      container.current?.removeEventListener("click", handleCopy);
      for (const timer of copiedTimers) window.clearTimeout(timer);
      for (const { link, handleClick } of listeners) link.removeEventListener("click", handleClick);
    };
  }, [copyableFragments, html]);

  return <>
    <div ref={container} className={className} dangerouslySetInnerHTML={{ __html: html }} />
    {downloadError && <p className="inline-error" role="alert">{downloadError}</p>}
  </>;
}
