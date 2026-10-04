import fsp from "node:fs/promises";
import path from "node:path";

// Only these public files bypass API authentication.
export function createStaticHandler(config) {
  const uiRoot = path.join(config.publicRoot, "ui");
  const staticFiles = new Map([
    ["/", [path.join(config.repositoryRoot, "landing", "index.html"), "text/html; charset=utf-8"]],
    ["/logo-chapeaux-fous-1200-square-transparent.png", ["logo-chapeaux-fous-1200-square-transparent.png", "image/png"]],
    ["/app", [path.join(uiRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/app/", [path.join(uiRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
    ["/catch-up-settings.js", ["catch-up-settings.js", "text/javascript; charset=utf-8"]],
    ["/ai-usage.js", ["ai-usage.js", "text/javascript; charset=utf-8"]],
    ["/calendar-grid.js", ["calendar-grid.js", "text/javascript; charset=utf-8"]],
    ["/event-date-time.js", ["event-date-time.js", "text/javascript; charset=utf-8"]],
    ["/presentation-format.js", ["presentation-format.js", "text/javascript; charset=utf-8"]],
    ["/timing-editor.js", ["timing-editor.js", "text/javascript; charset=utf-8"]],
    ["/markdown.js", ["markdown.js", "text/javascript; charset=utf-8"]],
    ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
    ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json"]],
    ["/service-worker.js", ["service-worker.js", "text/javascript; charset=utf-8"]],
    ["/favicon.png", ["favicon.png", "image/png"]],
    ["/icon.svg", ["icon.svg", "image/svg+xml"]],
    ["/hats.svg", ["hats.svg", "image/svg+xml"]],
    ["/vendor/dompurify.js", [path.join(config.repositoryRoot, "node_modules", "dompurify", "dist", "purify.es.mjs"), "text/javascript; charset=utf-8"]],
    ["/vendor/marked.js", [path.join(config.repositoryRoot, "node_modules", "marked", "lib", "marked.esm.js"), "text/javascript; charset=utf-8"]],
  ]);

  const contentTypes = new Map([
    [".css", "text/css; charset=utf-8"],
    [".gif", "image/gif"],
    [".ico", "image/x-icon"],
    [".jpeg", "image/jpeg"],
    [".jpg", "image/jpeg"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".map", "application/json; charset=utf-8"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".webp", "image/webp"],
    [".woff", "font/woff"],
    [".woff2", "font/woff2"],
  ]);

  function builtUiAsset(pathname) {
    if (!pathname.startsWith("/ui/")) return null;
    let relative;
    try {
      relative = decodeURIComponent(pathname.slice("/ui/".length));
    } catch {
      return null;
    }
    const filename = path.resolve(uiRoot, relative);
    if (filename === uiRoot || !filename.startsWith(`${uiRoot}${path.sep}`)) return null;
    return [filename, contentTypes.get(path.extname(filename).toLowerCase()) || "application/octet-stream"];
  }

  return async function serveStatic(request, response) {
    if (request.method !== "GET") return false;
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    const selected = staticFiles.get(pathname) || builtUiAsset(pathname);
    if (!selected) return false;
    const [filename, contentType] = selected;
    const body = await fsp.readFile(path.isAbsolute(filename) ? filename : path.join(config.publicRoot, filename));
    const revalidate = contentType.startsWith("text/html")
      || pathname === "/service-worker.js" || pathname === "/manifest.webmanifest";
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": body.length,
      "Cache-Control": revalidate ? "no-cache" : "public, max-age=300",
    });
    response.end(body);
    return true;
  };
}
