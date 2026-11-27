// Se suma al service worker que genera vite-plugin-pwa: al tocar una notificación abre (o enfoca) la app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/hoy'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
      for (const v of ventanas) {
        if ('focus' in v) { v.navigate(url).catch(() => {}); return v.focus() }
      }
      return self.clients.openWindow(url)
    }),
  )
})

// Avisos push con la app cerrada (función enviar-push): muestra la notificación del lead.
self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { body: event.data && event.data.text() } }
  event.waitUntil(self.registration.showNotification(d.title || 'MotoBox CRM', {
    body: d.body || 'Tenés un lead nuevo para atender.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag || 'motobox',
    renotify: true,
    requireInteraction: true,
    data: { url: d.url || '/hoy' },
  }))
})
