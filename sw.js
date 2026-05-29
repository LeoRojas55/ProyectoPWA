const CACHE_NAME    = 'censo-mascotas-v4';
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
  './assets/icons/chuchu.jpeg',
  './assets/icons/app-icon.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-72.png',
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

  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { titulo: '¡Nuevo censo!', cuerpo: event.data?.text() || '' };
  }

  // Soporta tanto formato {titulo, cuerpo, url, censoId}  (propio)
  // como formato {notification: {title, body, data}} (web-push genérico)
  const notif  = payload.notification || {};
  const titulo = payload.titulo  || notif.title  || '¡Nuevo censo registrado!';
  const cuerpo = payload.cuerpo  || notif.body   || 'Se registró un nuevo censo de mascotas';
  const icon   = payload.icon    || notif.icon   || 'assets/icons/icon-192x192.svg';
  const badge  = payload.badge   || notif.badge  || 'assets/icons/icon-72x72.svg';

  // Construir URL destino: preferir la que viene en el payload
  const censoId   = payload.censoId || notif.data?.censoId || '';
  const urlDestino = payload.url || notif.data?.url
    || (censoId ? `pages/mapa.html?censoId=${censoId}` : 'pages/mapa.html');

  event.waitUntil(
    self.registration.showNotification(titulo, {
      body:    cuerpo,
      icon,
      badge,
    self.registration.showNotification(notif.title || 'Censo de Mascotas', {
      body:    notif.body   || 'Se registró un nuevo censo',
      icon:    notif.icon   || 'assets/icons/app-icon.png',
      badge:   notif.badge  || 'assets/icons/icon-72.png',
      vibrate: [200, 100, 200],
      data:    { url: urlDestino, censoId },
      actions: [
        { action: 'ver',    title: 'Ver censo' },
        { action: 'cerrar', title: 'Cerrar'    },
      ],
    })
  );
});

// ── NOTIFICATION CLICK: abrir/navegar a la info del censo ───────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'cerrar') return;

  // Extraer censoId del payload (si viene del backend al crear el censo)
  const censoId = event.notification.data?.censoId || '';

  // Construir URL SIEMPRE desde el scope del SW para que funcione en
  // localhost, producción o cualquier subdominio sin cambiar nada.
  const base    = self.registration.scope;           // ej: http://localhost:8080/
  const destino = censoId
    ? `${base}pages/mapa.html?censoId=${censoId}`
    : `${base}pages/mapa.html`;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una pestaña de la PWA abierta → navegar dentro de ella
      for (const client of clientList) {
        if (client.url.startsWith(base) && 'navigate' in client) {
          client.navigate(destino);
          return client.focus();
        }
      }
      // Si no hay pestaña abierta → abrir una nueva
      return clients.openWindow(destino);
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
