const CACHE_NAME = "epic-go-v1";
const ASSETS = ["/index.html", "/styles.css", "/app.js", "/manifest.json"];

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener("activate", (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (e) => {
    // Network-first for API calls, cache-first for assets
    const u = e.request.url;
    if (u.includes("queue-times.com") || u.includes("corsproxy.io") || u.includes("allorigins.win") || u.includes("cors.lol") || u.includes("thingproxy") || u.includes("workers.dev")) {
        e.respondWith(
            fetch(e.request)
                .then((r) => r)
                .catch(() => caches.match(e.request))
        );
    } else {
        e.respondWith(
            caches.match(e.request).then((r) => r || fetch(e.request))
        );
    }
});
