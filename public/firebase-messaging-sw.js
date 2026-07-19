/*
 * Firebase Cloud Messaging — background service worker.
 * Runs at scope /firebase-cloud-messaging-push-scope so it coexists with the
 * offline/caching worker (sw.js) that controls the app at scope "/".
 *
 * Uses the compat SDK because service workers can't import the modular SDK.
 * Config values below are the public Firebase web keys (safe to expose).
 * The server sends DATA-ONLY messages, so this worker renders every push —
 * that prevents the double-notification you get with a `notification` payload.
 */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyD3ZVvbqrYQJd7XPNWG6WJWvlYRcHX8960',
  authDomain: 'mountain-bakes.firebaseapp.com',
  projectId: 'mountain-bakes',
  storageBucket: 'mountain-bakes.firebasestorage.app',
  messagingSenderId: '1080689856918',
  appId: '1:1080689856918:web:764653944d99f4f8298db7',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const title = d.title || 'Mountain Bakes ERP';
  const options = {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-32.png',
    tag: d.notificationId || d.type || 'mb-notification',
    data: { url: d.url || '/', ...d },
    vibrate: [100, 50, 100],
    renotify: true,
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Focus an existing tab if one is already open, else open a new one.
      for (const client of all) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(target).catch(() => {});
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })(),
  );
});
