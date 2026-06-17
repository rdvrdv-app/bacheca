// Service worker Bacheca — incrementa CACHE per invalidare tutto dopo un deploy importante
const CACHE = "bacheca-v4";
const PRECACHE = ["./", "index.html", "manifest.json", "icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // Dati Supabase: sempre rete, mai cache (evita dati stantii)
  if (url.hostname.endsWith(".supabase.co")) return;

  // App shell (stessa origin): network-first con fallback cache → l'app resta aggiornata,
  // ma si apre anche offline
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return r; })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
    );
    return;
  }

  // CDN (react, babel, supabase-js): cache-first, gli URL sono versionati
  e.respondWith(
    caches.match(e.request).then(r =>
      r || fetch(e.request).then(resp => {
        const cp = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp));
        return resp;
      })
    )
  );
});

// ── Notifiche push (Web Push) ─────────────────────────────────
// Le notifiche sono "mute" (senza payload cifrato): mostriamo un messaggio
// generico. Se in futuro si invierà un payload JSON, viene usato qui.
self.addEventListener("push", e => {
  let title = "Bacheca";
  let body  = "💬 Nuovo commento su un evento";
  let data  = { url: "./" };
  try { if (e.data) { const d = e.data.json(); title = d.title || title; body = d.body || body; data = { url: d.url || "./", eventId: d.eventId || "" }; } } catch {}
  e.waitUntil(self.registration.showNotification(title, {
    body, icon: "icon.svg", badge: "icon.svg",
    tag: data.eventId ? `bacheca-${data.eventId}` : "bacheca-commenti",
    renotify: true, data,
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const data = e.notification.data || {};
  const url  = data.url || "./";
  const eid  = data.eventId || "";
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if ("focus" in c) { await c.focus(); if (eid) c.postMessage({ type: "open-event", eventId: eid }); return; }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
