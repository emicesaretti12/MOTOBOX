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
