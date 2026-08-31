const cacheName = "agent-slayer-shell-v47";
const shell = [
  "/", "/app.js", "/event-date-time.js", "/markdown.js", "/vendor/dompurify.js", "/vendor/marked.js",
  "/styles.css", "/favicon.png", "/icon.svg", "/hats.svg", "/manifest.webmanifest",
];

self.addEventListener("install", (event) => event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shell))));
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))),
));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
