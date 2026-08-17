import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const TEXT_CONTENT_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "application/json",
  "application/ld+json",
  "application/xml",
  "text/xml",
  "application/rss+xml",
  "application/atom+xml",
]);

function stripIpv6Brackets(hostname) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isPublicIpv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address) {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.includes(".")) return false;
  const first = Number.parseInt(normalized.split(":", 1)[0] || "0", 16);
  if (!Number.isInteger(first) || first < 0x2000 || first > 0x3fff) return false;
  if (normalized.startsWith("2001:db8:") || normalized === "2001:db8::") return false;
  if (normalized.startsWith("2001:2:") || normalized === "2001:2::") return false;
  if (/^2001:0{0,3}1[0-9a-f]:/.test(normalized)) return false;
  return true;
}

export function isPublicIpAddress(address) {
  const normalized = stripIpv6Brackets(String(address));
  const family = net.isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

export function parseWebPageUrl(value, base = undefined) {
  let url;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    throw new Error("url must be an absolute HTTP or HTTPS URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("url must use HTTP or HTTPS");
  if (url.username || url.password) throw new Error("url must not contain credentials");
  url.hash = "";
  return url;
}

async function resolvePublicTarget(url, lookup) {
  const hostname = stripIpv6Brackets(url.hostname).replace(/\.$/, "").toLowerCase();
  if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname.endsWith(".internal")
  ) {
    throw new Error(`Refusing private or local web target: ${hostname}`);
  }
  const family = net.isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error(`No address was found for ${hostname}`);
  if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error(`Refusing private or non-public web target: ${hostname}`);
  }
  return { hostname, address: addresses[0].address, family: addresses[0].family };
}

function decodedBody(buffer, encoding, maximumBytes) {
  const normalized = String(encoding ?? "").trim().toLowerCase();
  const options = { maxOutputLength: maximumBytes };
  if (!normalized || normalized === "identity") return buffer;
  if (normalized === "gzip" || normalized === "x-gzip") return zlib.gunzipSync(buffer, options);
  if (normalized === "deflate") return zlib.inflateSync(buffer, options);
  if (normalized === "br") return zlib.brotliDecompressSync(buffer, options);
  throw new Error(`Unsupported Content-Encoding: ${normalized}`);
}

export function requestPinnedPage(url, target, { timeoutMs, maximumBytes }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request({
      protocol: url.protocol,
      hostname: target.address,
      family: target.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      servername: target.hostname,
      headers: {
        Host: url.host,
        Accept: "text/html,application/xhtml+xml,text/plain,application/json,application/xml,text/xml;q=0.9,*/*;q=0.1",
        "Accept-Encoding": "gzip, deflate, br",
        "User-Agent": "Agent-Slayer-Page-Reader/1.0",
      },
    }, (response) => {
      const chunks = [];
      let receivedBytes = 0;
      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maximumBytes) {
          response.destroy(new Error(`Web page exceeded the ${maximumBytes}-byte download limit`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try {
          const body = decodedBody(Buffer.concat(chunks), response.headers["content-encoding"], maximumBytes);
          if (body.length > maximumBytes) throw new Error(`Web page exceeded the ${maximumBytes}-byte decoded limit`);
          resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body });
        } catch (error) {
          reject(error);
        }
      });
      response.on("error", reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`Web page request timed out after ${timeoutMs}ms`)));
    request.on("error", reject);
    request.end();
  });
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", hellip: "…", laquo: "«", ldquo: "“", lsquo: "‘",
    lt: "<", mdash: "—", nbsp: " ", ndash: "–", quot: "\"", raquo: "»", rdquo: "”", rsquo: "’",
  };
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      try { return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match; } catch { return match; }
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

function textFromHtml(html) {
  return decodeHtmlEntities(String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|canvas|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:address|article|aside|blockquote|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function metadata(html) {
  const title = textFromHtml(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? "") || null;
  let description = null;
  let canonicalUrl = null;
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const name = (attribute(match[0], "name") ?? attribute(match[0], "property") ?? "").toLowerCase();
    if (!description && ["description", "og:description", "twitter:description"].includes(name)) {
      description = attribute(match[0], "content")?.trim() || null;
    }
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attribute(match[0], "rel") ?? "").toLowerCase().split(/\s+/);
    if (rel.includes("canonical")) canonicalUrl = attribute(match[0], "href")?.trim() || null;
  }
  return { title, description, canonicalUrl };
}

function pageLinks(html, pageUrl, maximumLinks = 250) {
  const links = [];
  const seen = new Set();
  let total = 0;
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attribute(match[1], "href");
    if (!href) continue;
    let url;
    try { url = parseWebPageUrl(href, pageUrl); } catch { continue; }
    const normalized = url.toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    total += 1;
    if (links.length >= maximumLinks) continue;
    links.push({
      text: textFromHtml(match[2]).slice(0, 500) || null,
      url: normalized,
      rel: attribute(match[1], "rel")?.trim() || null,
    });
  }
  return { links, total };
}

function mediaType(headers) {
  const raw = Array.isArray(headers["content-type"]) ? headers["content-type"][0] : headers["content-type"];
  return String(raw ?? "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
}

function bodyText(buffer, headers) {
  const contentType = Array.isArray(headers["content-type"]) ? headers["content-type"][0] : headers["content-type"];
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(String(contentType ?? ""))?.[1] ?? "utf-8";
  try { return new TextDecoder(charset).decode(buffer); } catch { return new TextDecoder("utf-8").decode(buffer); }
}

export class WebPageClient {
  constructor({
    timeoutMs = 15_000,
    maximumBytes = 2 * 1024 * 1024,
    maximumRedirects = 5,
    lookup = dns.lookup,
    requestPage = requestPinnedPage,
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.maximumBytes = maximumBytes;
    this.maximumRedirects = maximumRedirects;
    this.lookup = lookup;
    this.requestPage = requestPage;
  }

  async read(urlValue, maximumCharacters) {
    const requestedUrl = parseWebPageUrl(urlValue);
    let currentUrl = requestedUrl;
    let response;
    for (let redirectCount = 0; ; redirectCount += 1) {
      const target = await resolvePublicTarget(currentUrl, this.lookup);
      response = await this.requestPage(currentUrl, target, {
        timeoutMs: this.timeoutMs,
        maximumBytes: this.maximumBytes,
      });
      if (!REDIRECT_STATUSES.has(response.statusCode) || !response.headers.location) break;
      if (redirectCount >= this.maximumRedirects) throw new Error(`Web page exceeded ${this.maximumRedirects} redirects`);
      currentUrl = parseWebPageUrl(response.headers.location, currentUrl);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`Web page returned HTTP ${response.statusCode}`);
    const contentType = mediaType(response.headers);
    if (!HTML_CONTENT_TYPES.has(contentType) && !TEXT_CONTENT_TYPES.has(contentType)) {
      throw new Error(`Web page returned unsupported Content-Type: ${contentType}`);
    }
    const source = bodyText(response.body, response.headers);
    const html = HTML_CONTENT_TYPES.has(contentType);
    const meta = html ? metadata(source) : { title: null, description: null, canonicalUrl: null };
    const extracted = html ? textFromHtml(source) : source.trim();
    const linkResult = html ? pageLinks(source, currentUrl) : { links: [], total: 0 };
    let canonicalUrl = null;
    if (meta.canonicalUrl) {
      try { canonicalUrl = parseWebPageUrl(meta.canonicalUrl, currentUrl).toString(); } catch { canonicalUrl = null; }
    }
    return {
      requested_url: requestedUrl.toString(),
      url: currentUrl.toString(),
      status_code: response.statusCode,
      content_type: contentType,
      title: meta.title,
      description: meta.description,
      canonical_url: canonicalUrl,
      text: extracted.slice(0, maximumCharacters),
      text_characters: extracted.length,
      text_truncated: extracted.length > maximumCharacters,
      links: linkResult.links,
      link_count: linkResult.total,
      links_truncated: linkResult.total > linkResult.links.length,
    };
  }
}
