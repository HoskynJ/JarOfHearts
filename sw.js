/* Niamh's Jar - service worker.
   Network-first for the app + content (so updates always arrive), cache fallback when offline.
   Encrypted photos/videos are cached as they're viewed. */
const VERSION = 'jar-v2-3';
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'jar.js', 'physics.js', 'fx.js',
  'vault.js', 'manifest.webmanifest', 'vault.json', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.headers.has('range')) return;
  if (url.pathname.endsWith('/admin.html') || url.pathname.endsWith('/admin.js')) return;

  const isMedia = /\/media\//.test(url.pathname);  // encrypted .bin blobs: cache-first
  if (isMedia) {
    // photos: cache-first, they never change
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // everything else: network-first, fall back to cache
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
