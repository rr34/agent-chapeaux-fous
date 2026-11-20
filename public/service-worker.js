const cacheName = "agent-slayer-shell-v78";
const shell = [
  "/", "/app", "/app/", "/manifest.webmanifest",
  "/brand/favicon-16-transparent.png", "/brand/favicon-32-transparent.png", "/brand/favicon-48-transparent.png",
  "/brand/apple-touch-icon-180-opaque.png", "/brand/icon-192-opaque.png", "/brand/icon-512-opaque.png",
  "/brand/icon-master-1024-transparent.png",
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
