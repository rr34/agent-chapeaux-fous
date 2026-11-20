import fsp from "node:fs/promises";
import path from "node:path";

// Only these public files bypass API authentication.
export function createStaticHandler(config) {
  const uiRoot = path.join(config.publicRoot, "ui");
  const brandRoot = path.join(config.publicRoot, "brand");
  const staticFiles = new Map([
    ["/", [path.join(config.repositoryRoot, "landing", "index.html"), "text/html; charset=utf-8"]],
    ["/app", [path.join(uiRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/app/", [path.join(uiRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/login", [path.join(uiRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/register", [path.join(uiRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/verify", [path.join(uiRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/forgot-password", [path.join(uiRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/reset-password", [path.join(uiRoot, "index.html"), "text/html; charset=utf-8"]],
    ["/ai-usage.js", ["ai-usage.js", "text/javascript; charset=utf-8"]],
    ["/event-date-time.js", ["event-date-time.js", "text/javascript; charset=utf-8"]],
    ["/presentation-format.js", ["presentation-format.js", "text/javascript; charset=utf-8"]],
    ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json"]],
    ["/service-worker.js", ["service-worker.js", "text/javascript; charset=utf-8"]],
    ["/hats.svg", ["hats.svg", "image/svg+xml"]],
    ["/logo-outline-hat.svg", ["logo-outline-hat.svg", "image/svg+xml"]],
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

  function publicBrandAsset(pathname) {
    if (!pathname.startsWith("/brand/")) return null;
    let relative;
    try {
      relative = decodeURIComponent(pathname.slice("/brand/".length));
    } catch {
      return null;
    }
    const filename = path.resolve(brandRoot, relative);
    if (filename === brandRoot || !filename.startsWith(`${brandRoot}${path.sep}`)) return null;
    const contentType = contentTypes.get(path.extname(filename).toLowerCase());
    return contentType ? [filename, contentType] : null;
  }

  return async function serveStatic(request, response) {
    if (request.method !== "GET") return false;
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    const selected = staticFiles.get(pathname) || publicBrandAsset(pathname) || builtUiAsset(pathname);
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
