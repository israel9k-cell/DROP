const CACHE_NAME = "universal-go-v2";
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
    if (e.request.url.includes("queue-times.com") || e.request.url.includes("corsproxy.io") || e.request.url.includes("allorigins.win")) {
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
