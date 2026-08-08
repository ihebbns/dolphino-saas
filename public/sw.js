// Minimal service worker — its only job is receiving a push event and
// showing a notification. Registered from /moi/[slug] right before a
// customer subscribes; not a full offline-caching PWA service worker
// (that's still the deferred nice-to-have noted earlier this project).

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (e) {}
  const title = data.title || 'Commande prête !'
  const options = {
    body: data.body || 'Votre commande est prête à récupérer.',
    icon: data.icon || undefined,
    badge: data.badge || undefined,
    data: { url: data.url || '/' },
    tag: data.tag || 'order-ready',
    requireInteraction: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if (c.url.includes(url) && 'focus' in c) return c.focus() }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
