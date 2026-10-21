/* Dayline offline helper (service worker). build.ps1 writes site\sw.js from this file and stamps the version.
   - The app itself (page, settings, library, icons) is kept on the device, so Dayline opens instantly and offline.
   - Your data never goes through here: Supabase requests always go straight to the network.
   - A new upload gets a new version, and the page offers "New version, tap to refresh". */
const VERSION = "20261021-04a39b46";
const APP = "dayline-app-" + VERSION, FONTS = "dayline-fonts";
const PRECACHE = ["./","./index.html","./config.js","./manifest.webmanifest","./icons/apple-touch-icon.png","./icons/favicon-32.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4/dist/umd/supabase.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: "reload" })))));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("dayline-app-") && k !== APP).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || /supabase\.co$/.test(url.hostname)) return; /* data: always live */
  /* Opening the app: the saved copy straight away; the network only if it's missing. */
  if (req.mode === "navigate") {
    e.respondWith(caches.match("./index.html", { ignoreSearch: true }).then(r => r || fetch(req)));
    return;
  }
  /* Fonts: use the saved copy, refresh it in the background. */
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  /* Everything else the app ships with: saved copy first. */
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
