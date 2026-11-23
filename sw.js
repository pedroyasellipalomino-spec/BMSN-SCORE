/* BMSN — service worker: abre la app al instante y sin señal muestra lo último guardado.
   Nunca guarda nada de Supabase (datos y sesión siempre van directo a la red). */
const VERSION = "bmsn-v16";
const BASE = [
  "./", "./index.html", "./app.js?v=16", "./styles.css?v=16", "./config.js?v=16", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-64.png", "./icons/logo.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname.endsWith("supabase.co")) return; // datos en vivo, nunca en caché

  const propio = url.origin === self.location.origin;
  const cdn = /(^|\.)(jsdelivr\.net|googleapis\.com|gstatic\.com)$/.test(url.hostname);
  if (!propio && !cdn) return;

  if (propio) {
    // Red primero: siempre la última versión; sin señal, la guardada.
    e.respondWith(
      fetch(req).then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
        return r;
      }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then((r) => r || caches.match("./index.html")))
    );
  } else {
    // Librerías y fuentes: caché primero (no cambian).
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => {
        if (r.ok || r.type === "opaque") { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
        return r;
      }))
    );
  }
});
