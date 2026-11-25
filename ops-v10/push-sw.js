// #31 team alerts: the push carries no data, so the notice is generic and contains no client information.
if (typeof self.addEventListener === 'function') {
self.addEventListener('push', event => {
  event.waitUntil(self.registration.showNotification('ALLOSERVIX — nouvelle demande', {
    body: 'Une nouvelle demande client est arrivée. Ouvrez la console pour la consulter.',
    tag: 'allo-new-request', renotify: true, data: { url: '/ops-v10/index.html' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).pathname.startsWith('/ops-v10/'));
    return open ? open.focus() : clients.openWindow(event.notification.data.url);
  }));
});
}
