// Song Swap service worker: shows push notifications and opens the app when
// one is tapped. It deliberately doesn't cache anything (no fetch handler), so
// it can't serve stale pages after a deploy.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data;
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Song Swap', body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Song Swap', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag,
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (existing) {
      // Reuse an open Song Swap tab: tell it which swap to show
      existing.postMessage({ type: 'open-url', url: url.pathname + url.search });
      return existing.focus();
    }
    return self.clients.openWindow(url.href);
  })());
});
