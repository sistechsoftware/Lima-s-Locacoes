/* Push-only worker: never cache authenticated HTML, customer records or API responses. */
self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function claimNotification(id) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("limas-push", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("seen", { keyPath: "id" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("seen", "readwrite");
      const store = tx.objectStore("seen");
      let fresh = false;
      const lookup = store.get(id);
      lookup.onsuccess = () => {
        if (!lookup.result) { fresh = true; store.put({ id, at: Date.now() }); }
        const cursor = store.openCursor();
        cursor.onsuccess = () => { const c = cursor.result; if (c) { if (c.value.at < Date.now()-7*86400000) c.delete(); c.continue(); } };
      };
      tx.oncomplete = () => { db.close(); resolve(fresh); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json(); } catch { return; }
    if (!data || !data.id) return;
    let fresh = true;
    try { fresh = await claimNotification(String(data.id)); } catch { /* Notification tag remains a second dedupe layer. */ }
    if (!fresh) return;
    const url = new URL(data.url || "/notificacoes", self.location.origin);
    await self.registration.showNotification(data.title || "Lima's Locacoes", {
      body: data.body || "Confira suas atividades.", icon:"/icones/icone-192.png", badge:"/icones/icone-192.png",
      tag:`limas-${data.id}`, renotify:false, vibrate:[150,80,150],
      data:{url:url.origin===self.location.origin?url.href:new URL("/notificacoes",self.location.origin).href},
    });
    if (self.navigator.setAppBadge) await self.navigator.setAppBadge().catch(() => {});
  })());
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(event.notification.data?.url || "/notificacoes", self.location.origin);
    if (url.origin !== self.location.origin) return;
    const windows = await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const client = windows.find(c => new URL(c.url).origin === url.origin);
    if (client) { await client.navigate(url.href); await client.focus(); }
    else await self.clients.openWindow(url.href);
  })());
});
