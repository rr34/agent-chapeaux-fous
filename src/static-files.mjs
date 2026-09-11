import fsp from "node:fs/promises";
import path from "node:path";

// Only these public files bypass API authentication.
export function createStaticHandler(config) {
  const staticFiles = new Map([
    ["/", [path.join(config.repositoryRoot, "landing", "index.html"), "text/html; charset=utf-8"]],
    ["/logo-chapeaux-fous-1200-square-transparent.png", [path.join(config.repositoryRoot, "logo-chapeaux-fous-1200-square-transparent.png"), "image/png"]],
    ["/app", ["index.html", "text/html; charset=utf-8"]],
    ["/app/", ["index.html", "text/html; charset=utf-8"]],
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

  return async function serveStatic(request, response) {
    if (request.method !== "GET") return false;
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    const selected = staticFiles.get(pathname);
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
