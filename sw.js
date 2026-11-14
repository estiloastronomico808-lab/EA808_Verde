/* Service worker: la app funciona sin conexión.
 * Cambia VERSION cada vez que modifiques archivos para forzar la actualización. */
const VERSION = 'cabina-v1';
const CORE = [
  './', 'index.html', 'styles.css', 'app.js', 'chroma.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'fondos/fondos.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero para fondos.json (así ves cambios), caché primero para lo demás;
// las imágenes de fondo se guardan en caché la primera vez que se usan.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  if (req.url.endsWith('fondos/fondos.json')) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});
