// scripts/build-sw.mjs fills these markers after Vite has emitted the complete app.
const CACHE_PREFIX = "stillfield-";
const CACHE = "stillfield-__BUILD_HASH__";
const PRECACHE_URLS = [/* __PRECACHE_URLS__ */];
const OFFLINE_SHELL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Installation succeeds only when the whole meadow is available offline.
      // Bypass HTTP cache so a deployment cannot mix old HTML with new bundles.
      await cache.addAll(
        PRECACHE_URLS.map((url) => new Request(url, { cache: "reload" })),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (
    request.method !== "GET" ||
    new URL(request.url).origin !== self.location.origin
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        // Keep the precached shell intact: it always matches this build's assets.
        // A newer online page may use different bundles, cached as they are fetched.
        try {
          const response = await fetch(request);
          if (response.ok) return response;
          const cache = await caches.open(CACHE);
          return (await cache.match(OFFLINE_SHELL)) || response;
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(OFFLINE_SHELL)) ||
            new Response(
              "Your meadow is not available offline yet. Reconnect once, then try again.",
              {
                status: 503,
                headers: { "Content-Type": "text/plain; charset=utf-8" },
              },
            )
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.status !== 206) {
        // Await the write so the worker cannot finish before the asset is saved.
        // A full browser cache should still allow an online response through.
        try {
          await cache.put(request, response.clone());
        } catch {
          /* Online still works. */
        }
      }
      return response;
    })(),
  );
});
