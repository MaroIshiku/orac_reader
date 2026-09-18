const BUILD = "__APP_VERSION__";
const SHELL_CACHE = `oracle-shell-${BUILD}`;
const DATA_CACHE = "oracle-synchronized-archive-v1";
const MEDIA_CACHE = "oracle-read-media-v1";
const OFFLINE_LIBRARY = "/api/offline-library";
const SHELL = ["/", "/styles.css", "/app.js", "/library-view.js", "/markdown.js", "/markdown-config.js", "/vendor/marked.esm.js", "/navigation.js", "/read-status.js", "/manifest.webmanifest", "/oracle-logo.png", "/pwa-icon-192.png", "/pwa-icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map(async (path) => {
      const response = await fetch(new Request(path, { cache: "reload" }));
      if (!response.ok) throw new Error(`App-Datei konnte nicht aktualisiert werden: ${path}`);
      await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const obsoleteShells = keys.filter((key) => key.startsWith("oracle-shell-") && key !== SHELL_CACHE);
    await Promise.all(obsoleteShells.map((key) => caches.delete(key)));
    await self.clients.claim();
    if (!obsoleteShells.length) return;
    const clients = await self.clients.matchAll({ type: "window" });
    await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => undefined)));
  })());
});

const jsonResponse = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function synchronizedLibrary(request) {
  try {
    const network = await fetch(request);
    if (!network.ok) return network;
    const data = await network.clone().json();
    const offlineSyncedAt = new Date().toISOString();
    const publicCopy = { books: data.books || [], links: data.links || [], settings: data.settings || {}, version: data.version || BUILD, admin: false, offlineSyncedAt };
    await (await caches.open(DATA_CACHE)).put(OFFLINE_LIBRARY, jsonResponse(publicCopy));
    return jsonResponse({ ...data, offline: false, offlineSyncedAt });
  } catch {
    const cached = await (await caches.open(DATA_CACHE)).match(OFFLINE_LIBRARY);
    if (!cached) throw new Error("Noch kein Archivstand für die Offline-Nutzung gespeichert.");
    return jsonResponse({ ...(await cached.json()), admin: false, offline: true });
  }
}

async function shellResponse(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request.mode === "navigate" ? "/" : request, { ignoreSearch: true });
  if (cached) return cached;
  const network = await fetch(request); if (network.ok) cache.put(request, network.clone()); return network;
}

async function mediaResponse(request) {
  const cache = await caches.open(MEDIA_CACHE);
  try { const network = await fetch(request); if (network.ok) await cache.put(request, network.clone()); return network; } catch { return (await cache.match(request)) || Response.error(); }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname === "/api/library") return event.respondWith(synchronizedLibrary(event.request));
  if (url.pathname.startsWith("/api/")) return;
  if (["image", "audio", "video"].includes(event.request.destination)) return event.respondWith(mediaResponse(event.request));
  event.respondWith(shellResponse(event.request));
});
