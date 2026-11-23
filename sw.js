/* BMSN — service worker: abre la app al instante y sin señal muestra lo último guardado.
   Nunca guarda nada de Supabase (datos y sesión siempre van directo a la red). */
const VERSION = "bmsn-v28";
const BASE = [
  "./", "./index.html", "./app.js?v=28", "./styles.css?v=28", "./config.js?v=28", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-64.png", "./icons/logo.png",
];

const LIBS = ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then(async (c) => {
    await c.addAll(BASE);
    await Promise.all(LIBS.map((u) => c.add(new Request(u, { mode: "cors" })).catch(() => {}))); // si falla, se guardará en la primera visita con red
  }).then(() => self.skipWaiting()));
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

// ---------- Avisos push ----------
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { cuerpo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || "BMSN", {
    body: d.cuerpo || "",
    icon: "icons/icon-192.png",
    badge: "icons/favicon-64.png",
    data: { url: d.url || "./" },
    tag: d.titulo || "bmsn",
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if (w.url.startsWith(self.registration.scope)) { w.focus(); return w.navigate(destino); }
    return self.clients.openWindow(destino);
  }));
});
