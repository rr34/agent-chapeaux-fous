const cacheName = "agent-slayer-shell-v77";
const shell = [
  "/", "/app", "/app/", "/favicon.png", "/icon.svg", "/hats.svg", "/manifest.webmanifest",
  "/logo-chapeaux-fous-1200-square-transparent.png",
];

self.addEventListener("install", (event) => event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shell))));
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))),
));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only the application shell and its content-hashed React assets have an
  // offline copy. Health, APIs, and other origins keep their network status.
  const isShell = shell.includes(url.pathname);
  const isBuiltAsset = url.pathname.startsWith("/ui/");
  if (event.request.method !== "GET" || url.origin !== self.location.origin || (!isShell && !isBuiltAsset)) return;
  event.respondWith(fetch(event.request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(event.request, response.clone());
    }
    return response;
  }).catch(async () => {
    try {
      const cache = await caches.open(cacheName);
      return await cache.match(url.pathname) || Response.error();
    } catch {
      return Response.error();
    }
  }));
});
