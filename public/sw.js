// Saloni's service worker.
//
// It exists for one reason: a push message can only be delivered to a page
// that has one, and only a page with one can be installed to a home screen.
// There is no offline caching here on purpose — the app is useless without the
// database anyway, and a stale cached bundle is a support problem nobody needs.
//
// Plain JavaScript, served straight from public/ without going through Vite,
// so it must not import anything or use syntax an older mobile browser would
// choke on before it can register.

// Take over as soon as a new version is deployed rather than waiting for every
// tab to close. Nothing is cached, so there is no stale state to be careful of.
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

// The worker sends the notification ready to display, in the customer's own
// language, because it is the only side that knows which language they chose.
// Nothing is composed here — a translation living in a service worker is a
// translation that drifts from src/i18n.
self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  var title = data.title || 'Saloni';
  var options = {
    body: data.body || '',
    icon: data.icon || './icon-192.png',
    badge: data.badge || './icon-192.png',
    lang: data.lang || 'en',
    dir: data.lang === 'ar' ? 'rtl' : 'ltr',
    // One notification per offer: a re-send replaces rather than stacks.
    tag: data.tag || 'saloni',
    renotify: Boolean(data.tag),
    requireInteraction: false,
    data: { url: data.url || './' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping it should land on the held seat, and should reuse a tab that is
// already open rather than piling up new ones.
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      var absolute = new URL(target, self.registration.scope).href;
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        // Same app already open: point it at the seat instead of opening a
        // second copy of Saloni beside the first.
        if (client.url.indexOf(self.registration.scope) === 0 && 'navigate' in client) {
          return client.navigate(absolute).then(function (c) {
            return c && c.focus();
          });
        }
      }
      return self.clients.openWindow(absolute);
    }),
  );
});
