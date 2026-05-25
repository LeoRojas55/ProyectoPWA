const CACHE_NAME    = 'censo-mascotas-v1';
const OFFLINE_QUEUE = 'offline-queue';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/auth.js',
  '/js/api.js',
  '/js/geo.js',
  '/js/camera.js',
  '/js/sync.js',
  '/pages/personas.html',
  '/pages/duenos.html',
  '/pages/mascotas.html',
  '/pages/censo.html',
  '/pages/mapa.html',
  '/pages/registro.html',
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

  // Peticiones a la API: intentar red, si falla retornar error offline
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request.clone()).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Sin conexión. Datos guardados localmente.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Assets estáticos: Cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('/index.html'));
    })
  );
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
      icon:    notif.icon   || '/assets/icons/icon-192x192.png',
      badge:   notif.badge  || '/assets/icons/icon-72x72.png',
      vibrate: [200, 100, 200],
      data:    notif.data   || { url: '/pages/mapa.html' },
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

  const url = event.notification.data?.url || '/pages/mapa.html';

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
