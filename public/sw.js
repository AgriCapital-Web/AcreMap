// AcreMap Service Worker — hors ligne complet (app shell + assets + tuiles) + notifications
const CACHE="acremap-v9";const TILE_CACHE="acremap-tiles-v1";const SHELL=["/","/login","/app","/app/measure","/app/parcelles","/app/parcelles/new","/app/morcellement","/app/hierarchie","/app/assistant","/app/releves","/app/validation","/app/users","/app/parametres","/app/import","/app/debug","/app/change-password","/app/traitement","/manifest.webmanifest","/favicon.png","/apple-touch-icon.png","/icon-192.png","/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil((async()=>{
    const c=await caches.open(CACHE);
    // Cache every compiled client chunk (including pages never opened by this user).
    // The build generates this manifest from the real Vite output; no hard-coded hashes.
    try {
      const mr=await fetch("/offline-assets.json",{cache:"reload"});
      if(mr.ok){
        const assets=await mr.json();
        await Promise.allSettled((Array.isArray(assets)?assets:[]).map(async u=>{
          try { const r=await fetch(u,{cache:"reload"}); if(r.ok&&r.status===200) await c.put(u,r); } catch {}
        }));
      }
    } catch {}
    await Promise.allSettled(SHELL.map(async u=>{
      try { const r=await fetch(u,{cache:"reload"}); if(r.ok&&r.status===200) await c.put(u,r); } catch {}
    }));
  })());
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k=>k.startsWith("acremap-")&&k!==CACHE&&k!==TILE_CACHE).map(k=>caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isTile(url) {
  return /tile\.openstreetmap|arcgisonline|tile\.thunderforest|stamen|esri|basemaps|googleapis\.com\/maps|mt[0-9]\.google/.test(url.hostname + url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 0) Jamais de cache pour les appels serveur / API / Supabase (auth, données live)
  if (
    url.pathname.startsWith("/_serverFn") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/.mcp") ||
    /supabase\.co$/.test(url.hostname)
  ) {
    return;
  }

  // 1) Tuiles cartographiques : cache-first, persistant (utilisation hors ligne sur le terrain)
  if (isTile(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
          return res;
        } catch {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // 2) Navigations : réseau puis repli sur l'app shell mise en cache
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const c=await caches.open(CACHE);
        const path=new URL(req.url).pathname;
        const cached=(await c.match(req,{ignoreSearch:true}))||(await c.match(path))||
          (path.startsWith("/app/measure")?(await c.match("/app/measure")):null)||
          (path.startsWith("/app")?(await c.match("/app")):null)||
          (await c.match("/app/measure"))||(await c.match("/app"))||(await c.match("/"));
        let timer;
        try {
          // Ne jamais laisser une navigation terrain attendre indéfiniment le réseau.
          const controller=new AbortController();
          timer=setTimeout(()=>controller.abort(),4500);
          const res=await fetch(req,{signal:controller.signal});
          clearTimeout(timer);
          if(res.ok&&res.status===200&&(res.headers.get("content-type")||"").includes("text/html")){
            c.put(req,res.clone()).catch(()=>{});
            c.put(path,res.clone()).catch(()=>{});
          }
          return res;
        } catch {
          if(timer) clearTimeout(timer);
          return cached || new Response(
            "<!doctype html><html lang=\"fr\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>AcreMap hors ligne</title><body style=\"font:16px system-ui;padding:24px;line-height:1.5\"><h1>AcreMap est hors ligne</h1><p>Aucun écran utilisable n’a été enregistré sur cet appareil. Reconnectez-vous une fois pour préparer l’application avant le terrain.</p><p>Si l’application a déjà été préparée, rouvrez-la depuis son icône installée.</p></body></html>",
            {status:503,headers:{"Content-Type":"text/html; charset=utf-8"}}
          );
        }
      })()
    );
    return;
  }

  // 3) Assets même origine (JS/CSS/images/polices) : stale-while-revalidate
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const c = await caches.open(CACHE);
        const cached = await c.match(req);
        const network = fetch(req)
          .then((res) => { if (res && res.ok) c.put(req, res.clone()).catch(() => {}); return res; })
          .catch(() => null);
        return cached || (await network) || Response.error();
      })()
    );
    return;
  }

  // 4) Polices / CDN externes : cache-first
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.jsdelivr\.net/.test(url.hostname)) {
    event.respondWith(
      (async () => {
        const c = await caches.open(CACHE);
        const cached = await c.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()).catch(() => {});
          return res;
        } catch {
          return Response.error();
        }
      })()
    );
  }
});

// Pré-chargement de tuiles demandé par la page (zone de travail → utilisation hors ligne)
self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type === "prefetch-tiles" && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(TILE_CACHE).then(async (cache) => {
        let done=0;const urls=data.urls.slice(0,4000);let cursor=0;const worker=async()=>{while(cursor<urls.length){const u=urls[cursor++];try{if(!(await cache.match(u))){const r=await fetch(u,{mode:"no-cors"});if(r&&(r.ok||r.type==="opaque"))await cache.put(u,r.clone());}done++;}catch{}}};await Promise.all(Array.from({length:3},()=>worker()));
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        clients.forEach((c) => c.postMessage({ type: "prefetch-tiles-done", done, total: data.urls.length }));
      })
    );
    return;
  }

  if (data.type === "show-notification") {
    self.registration.showNotification(data.title || "AcreMap", {
      body: data.body || "",
      tag: data.tag,
      icon: "/icon-192.png",
      badge: "/favicon.png",
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 500],
      data: data.data || {},
    });
  }
});

self.addEventListener("push", (event) => {
  let payload = { title: "AcreMap", body: "Nouvelle notification", tag: "acremap", data: {} };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/icon-192.png",
      badge: "/favicon.png",
      requireInteraction: true,
      vibrate: [300, 100, 300, 100, 500],
      data: payload.data,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ("focus" in c) { c.navigate(targetUrl); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
