const CACHE_NAME    = 'censo-mascotas-v2';
const OFFLINE_QUEUE = 'offline-queue';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/auth.js',
  './js/api.js',
  './js/geo.js',
  './js/camera.js',
  './js/sync.js',
  './pages/personas.html',
  './pages/duenos.html',
  './pages/mascotas.html',
  './pages/censo.html',
  './pages/mapa.html',
  './pages/registro.html',
];

// ── INSTALL: pre-cachear assets estáticos ───────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar cachés viejas ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activado');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia Cache-first para assets, Network-first para API ────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Peticiones API GET: intentar red, si falla intentar caché o devolver mensaje offline
  if (url.pathname.includes('/api/') && event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request.clone())
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            return response;
          }
          throw new Error('Respuesta no válida');
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          return new Response(
            JSON.stringify({ error: 'Sin conexión. Datos guardados localmente.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
    return;
  }

  // Recursos estáticos: servir desde caché primero, luego red
  const shouldCache = ['.html', '.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.woff2', '.woff'].some(ext => url.pathname.endsWith(ext));
  if (shouldCache) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(() => {
          if (event.request.destination === 'document' || url.pathname.endsWith('.html')) {
            return caches.match('./index.html');
          }
          return new Response('Sin conexión', { status: 503, statusText: 'Offline' });
        });
      })
    );
    return;
  }
});

// ── PUSH: recibir notificaciones push ────────────────────────────────────────
self.addEventListener('push', (event) => {
  console.log('[SW] Push recibido');

  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { notification: { title: '¡Nuevo censo!', body: event.data?.text() || '' } };
  }

  const notif = data.notification || {};

  event.waitUntil(
    self.registration.showNotification(notif.title || 'Censo de Mascotas', {
      body:    notif.body   || 'Se registró un nuevo censo',
      icon:    notif.icon   || 'assets/icons/icon-192x192.svg',
      badge:   notif.badge  || 'assets/icons/icon-72x72.svg',
      vibrate: [200, 100, 200],
      data:    notif.data   || { url: 'pages/censo.html' },
      actions: [
        { action: 'ver-mapa', title: 'Ver en mapa' },
        { action: 'cerrar',   title: 'Cerrar' },
      ],
    })
  );
});

// ── NOTIFICATION CLICK: redirigir al mapa ───────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'cerrar') return;

  const notificationUrl = event.notification.data?.url || 'pages/censo.html';
  const url = new URL(notificationUrl, self.registration.scope).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// ── SYNC: sincronización en background cuando vuelve la red ─────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-censos') {
    console.log('[SW] Background sync: enviando censos pendientes...');
    event.waitUntil(sincronizarPendientes());
  }
});

async function sincronizarPendientes() {
  // Notificar a todos los clientes abiertos para que hagan la sincronización
  const allClients = await clients.matchAll({ type: 'window' });
  for (const client of allClients) {
    client.postMessage({ tipo: 'SYNC_REQUIRED' });
  }
}
