/* InkFlow service worker: offline app shell.
 *
 * - Navigations: network first, falling back to the cached index.html (offline).
 * - /assets/* (content-hashed): cache first.
 * - /api/*: never cached. Recognition needs the network; the app queues it while offline.
 * - On PRECACHE messages (sent by the app on each load) every file listed in
 *   /precache-manifest.json for the current build is cached, and files from
 *   older builds are removed.
 */
const SHELL_CACHE = 'inkflow-shell-v1';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_FILES.map((u) => new Request(u, { cache: 'reload' })));
      await precacheBuild(cache);
      await self.skipWaiting();
    })().catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('inkflow-') && k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function precacheBuild(cache) {
  const res = await fetch('/precache-manifest.json', { cache: 'no-store' });
  if (!res.ok) return;
  const { files } = await res.json();
  const wanted = new Set(files.filter((f) => f.startsWith('/assets/')));
  // Drop assets from previous builds.
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/assets/') && !wanted.has(path)) await cache.delete(req);
  }
  for (const f of wanted) {
    if (!(await cache.match(f))) {
      try {
        await cache.add(f);
      } catch {
        /* keep going; it will be cached on first use */
      }
    }
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PRECACHE') {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const index = await fetch('/index.html', { cache: 'no-store' });
          if (index.ok) {
            await cache.put('/index.html', index.clone());
            await cache.put('/', index);
          }
        } catch {
          /* offline */
        }
        await precacheBuild(cache).catch(() => undefined);
      })(),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put('/index.html', fresh.clone());
          }
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // Other same-origin files: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const hit = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => undefined);
      return hit || (await network) || Response.error();
    })(),
  );
});
