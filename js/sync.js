// ── sync.js — Cola offline e IndexedDB ──────────────────────────────────────

if (window.__SYNC_LOADED__) {
  console.warn('sync.js already loaded — skipping duplicate execution');
} else {
  (function () {
    window.__SYNC_LOADED__ = true;

    // Guardar variables globales en `window` para evitar errores si los scripts
    // se cargan más de una vez (dev reloads, cache-busting). Luego usar aliases.
    if (!window.CENSO_DB_CONFIG) {
      window.CENSO_DB_CONFIG = {
        DB_NAME: 'censoDB',
        DB_VERSION: 2,
        STORES: {
          PERSONAS: 'personas_pendientes',
          MASCOTAS: 'mascotas_pendientes',
          CENSOS:   'censos_pendientes',
        },
        CACHE_STORES: {
          PERSONAS: 'personas_cache',
          MASCOTAS: 'mascotas_cache',
          CENSOS:   'censos_cache',
        },
      };
    }

    const DB_NAME    = window.CENSO_DB_CONFIG.DB_NAME;
    const DB_VERSION = window.CENSO_DB_CONFIG.DB_VERSION;
    const STORES     = window.CENSO_DB_CONFIG.STORES;
    const CACHE_STORES = window.CENSO_DB_CONFIG.CACHE_STORES;

    window.STORES = window.STORES || STORES;
    window.CACHE_STORES = window.CACHE_STORES || CACHE_STORES;

    let db = null;

// ── Inicializar IndexedDB ────────────────────────────────────────────────────
function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const idb = e.target.result;
      Object.values(STORES).forEach((store) => {
        if (!idb.objectStoreNames.contains(store)) {
          idb.createObjectStore(store, { keyPath: 'id' });
        }
      });
      Object.values(CACHE_STORES).forEach((store) => {
        if (!idb.objectStoreNames.contains(store)) {
          idb.createObjectStore(store, { keyPath: 'id' });
        }
      });
    };

    request.onsuccess  = (e) => { db = e.target.result; resolve(db); };
    request.onerror    = (e) => reject(e.target.error);
  });
}

// ── Guardar en cola offline ──────────────────────────────────────────────────
function guardarEnCola(store, datos) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put({ ...datos, _guardadoEn: new Date().toISOString() });
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

// ── Leer todos los pendientes de un store ────────────────────────────────────
function leerPendientes(store) {
  return new Promise((resolve, reject) => {
    const tx     = db.transaction(store, 'readonly');
    const req    = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Guardar datos de cache para listado offline ─────────────────────────────
function guardarCache(store, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    const clearReq = objectStore.clear();
    clearReq.onsuccess = () => {
      items.forEach((item) => objectStore.put(item));
    };
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

// ── Leer datos cacheados para listado offline ───────────────────────────────
function leerCache(store) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

// ── Eliminar un registro de la cola ─────────────────────────────────────────
function eliminarDeCola(store, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = (e) => reject(e.target.error);
  });
}

// ── Contar pendientes totales ────────────────────────────────────────────────
async function contarPendientes() {
  let total = 0;
  for (const store of Object.values(STORES)) {
    const items = await leerPendientes(store);
    total += items.length;
  }
  return total;
}

// ── Sincronización completa cuando hay red ───────────────────────────────────
async function sincronizarTodo() {
  if (!navigator.onLine) return { sincronizados: 0, errores: 0 };

  let sincronizados = 0;
  let errores       = 0;

  // Sincronizar personas
  const personas = await leerPendientes(STORES.PERSONAS);
  for (const persona of personas) {
    try {
      const { _guardadoEn, ...datos } = persona;
      await crearPersona(datos);
      await eliminarDeCola(STORES.PERSONAS, persona.id);
      sincronizados++;
    } catch { errores++; }
  }

  // Sincronizar mascotas
  const mascotas = await leerPendientes(STORES.MASCOTAS);
  for (const mascota of mascotas) {
    try {
      const { _guardadoEn, ...datos } = mascota;
      await crearMascota(datos);
      await eliminarDeCola(STORES.MASCOTAS, mascota.id);
      sincronizados++;
    } catch { errores++; }
  }

  // Sincronizar censos
  const censos = await leerPendientes(STORES.CENSOS);
  for (const censo of censos) {
    try {
      const { _guardadoEn, ...datos } = censo;
      await crearCenso(datos);
      await eliminarDeCola(STORES.CENSOS, censo.id);
      sincronizados++;
    } catch { errores++; }
  }

  actualizarBadgePendientes();
  return { sincronizados, errores };
}

// ── Actualizar badge en la UI ────────────────────────────────────────────────
async function actualizarBadgePendientes() {
  const total = await contarPendientes();
  const badge = document.getElementById('badge-pendientes');
  if (!badge) return;
  if (total > 0) {
    badge.textContent = `${total} pendiente${total > 1 ? 's' : ''}`;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Comprobar si el backend remoto está accesible
async function comprobarConexionRemote() {
  if (!navigator.onLine) return false;
  const base = (typeof getApiBase === 'function' ? getApiBase() : window.__API_BASE__ || window.DEFAULT_API_BASE);
  if (!base) return false;

  const pruebaUrl = `${base.replace(/\/$/, '')}/personas?rol=DUENO`;
  try {
    const response = await fetch(pruebaUrl, { method: 'GET', mode: 'cors', cache: 'no-store' });
    console.debug('[SYNC] comprobarConexionRemote', pruebaUrl, response.status, response.type);
    if (response) return true;
    return false;
  } catch (e) {
    console.warn('[SYNC] comprobarConexionRemote CORS/error, fallback no-cors', e);
    try {
      const fallbackResponse = await fetch(base.replace(/\/$/, ''), { method: 'GET', mode: 'no-cors', cache: 'no-store' });
      console.debug('[SYNC] fallback no-cors', base, fallbackResponse && fallbackResponse.type);
      return !!fallbackResponse;
    } catch (fallbackError) {
      console.error('[SYNC] fallback no-cors failed', fallbackError);
      return false;
    }
  }
}

// ── Detectar cambios de conectividad
function inicializarMonitorRed() {
  const bar = document.getElementById('offline-bar');

  async function actualizar() {
    const conectado = await comprobarConexionRemote();
    if (bar) {
      if (!bar.dataset.originalHtml) {
        bar.dataset.originalHtml = bar.innerHTML;
      }
      bar.innerHTML = conectado
        ? bar.dataset.originalHtml
        : '<i class="fa-solid fa-wifi-slash"></i> Sin conexión con el servidor remoto — trabajando offline';
      bar.classList.toggle('visible', !conectado);
    }

    if (conectado && db) {
      sincronizarTodo().then(({ sincronizados }) => {
        if (sincronizados > 0) {
          mostrarAlerta(`${sincronizados} registro(s) sincronizados correctamente`, 'success');
        }
      }).catch(() => {});
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(sw => sw.sync.register('sync-censos'));
      }
    }
  }

  window.addEventListener('online',  actualizar);
  window.addEventListener('offline', actualizar);
  actualizar();
}

// ── Escuchar mensajes del Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.tipo === 'SYNC_REQUIRED' && db) {   // ← mismo guard
      sincronizarTodo().catch(console.error);
    }
  });
}

// ── Helper para mostrar alertas (usado en varios módulos) ───────────────────
function mostrarAlerta(mensaje, tipo = 'info', duracion = 4000) {
  const contenedor = document.getElementById('alert-container');
  if (!contenedor) return;

  const alert = document.createElement('div');
  alert.className = `alert alert-${tipo}`;
  alert.textContent = mensaje;
  contenedor.appendChild(alert);

  if (duracion > 0) {
    setTimeout(() => alert.remove(), duracion);
  }
}

    // Exponer API pública mínima
    window.initIndexedDB = initIndexedDB;
    window.inicializarMonitorRed = inicializarMonitorRed;
    window.comprobarConexionRemote = comprobarConexionRemote;
    window.guardarEnCola = guardarEnCola;
    window.leerPendientes = leerPendientes;
    window.leerCache = leerCache;
    window.guardarCache = guardarCache;
    window.eliminarDeCola = eliminarDeCola;
    window.actualizarBadgePendientes = actualizarBadgePendientes;
    window.sincronizarTodo = sincronizarTodo;
    window.mostrarAlerta = mostrarAlerta;

  })();
}
