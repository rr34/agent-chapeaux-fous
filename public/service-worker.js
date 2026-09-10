const cacheName = "agent-slayer-shell-v55";
const shell = [
  "/", "/app", "/app/", "/app.js", "/ai-usage.js", "/calendar-grid.js", "/event-date-time.js", "/presentation-format.js", "/timing-editor.js", "/markdown.js", "/vendor/dompurify.js", "/vendor/marked.js",
  "/styles.css", "/favicon.png", "/icon.svg", "/hats.svg", "/manifest.webmanifest",
  "/logo-chapeaux-fous-1200-square-transparent.png",
];

self.addEventListener("install", (event) => event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shell))));
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))),
));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only the application shell has an offline copy. Health, APIs, and other
  // origins must keep their real network status instead of using a cache.
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !shell.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    try {
      const cache = await caches.open(cacheName);
      return await cache.match(url.pathname) || Response.error();
    } catch {
      return Response.error();
    }
  }));
});
