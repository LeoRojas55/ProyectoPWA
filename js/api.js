// ── api.js — Cliente para la API REST ──────────────────────────────────────

if (!window.DEFAULT_API_BASE) {
  window.DEFAULT_API_BASE = 'https://elprofehugo.online/api/v1';
}
if (!window.CACHE_STORES) {
  window.CACHE_STORES = {
    PERSONAS: 'personas_cache',
    MASCOTAS: 'mascotas_cache',
    CENSOS:   'censos_cache',
  };
}

if (!window.__API_LOADED__) {
  window.__API_LOADED__ = true;
  window.API_BASE = window.__API_BASE__ || window.DEFAULT_API_BASE;
  window.API_BASE = window.API_BASE.replace(/\/$/, '');
}

const CACHE_STORES = window.CACHE_STORES;

// ── Función base de fetch con JWT ────────────────────────────────────────────
async function apiFetch(endpoint, options = {}) {
  const token = obtenerToken();
  const url = `${window.API_BASE}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  try {
    console.log('[API] fetch', { url, options, headers });
    const response = await fetch(url, {
      ...options,
      headers,
    });

    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      console.error(`[API] Error parsing JSON from ${url}:`, parseErr);
      throw new Error(`Error al procesar respuesta del servidor: ${parseErr.message}`);
    }

    if (!response.ok) {
      if (response.status === 401) {
        cerrarSesion();
      }
      let errMsg = data?.error || data?.message || `Error ${response.status}`;
      if (Array.isArray(data?.message)) {
        errMsg = data.message.join('. ');
      }
      console.error(`[API] ${response.status} ${url}:`, errMsg);
      console.error(`[API] Respuesta completa:`, data);
      throw new Error(errMsg);
    }

    return data;
  } catch (fetchErr) {
    // Captura errores de red, CORS, etc.
    if (fetchErr instanceof TypeError && fetchErr.message.includes('Failed to fetch')) {
      console.error(`[API] CORS o error de red en ${url}:`, fetchErr);
      throw new Error(`Error de conexión: verifica que el servidor esté disponible y permita CORS desde ${window.location.origin}`);
    }
    throw fetchErr;
  }
}

// ═══ PERSONAS ════════════════════════════════════════════════════════════════
async function crearPersona(datos) {
  // Endpoint de registro del backend espera el objeto de persona sin id generado por el cliente
  const { id, ...payload } = datos || {};
  return apiFetch('/personas/registro', {
    method: 'POST',
    body:   JSON.stringify(payload),
  });
}

async function obtenerPersonas(rol = '') {
  const endpoint = `/personas${rol ? `?rol=${encodeURIComponent(rol)}` : ''}`;
  try {
    const personas = await apiFetch(endpoint);
    if (typeof guardarCache === 'function') {
      guardarCache(CACHE_STORES.PERSONAS, Array.isArray(personas) ? personas : []);
    }
    return personas;
  } catch (err) {
    console.warn('[API] obtenerPersonas fallback offline:', err.message);
    if (typeof leerCache === 'function') {
      const cache = await leerCache(CACHE_STORES.PERSONAS);
      const pendientes = await leerPendientes(STORES.PERSONAS).catch(() => []);
      return [...cache, ...pendientes];
    }
    throw err;
  }
}

// ═══ MASCOTAS ════════════════════════════════════════════════════════════════
async function crearMascota(datos) {
  // No enviar la propiedad `id` al backend (el servidor la genera).
  // Filtrar campos undefined/null para enviar solo lo necesario.
  const { id, ...payload } = datos || {};
  const payloadLimpio = Object.fromEntries(
    Object.entries(payload).filter(([_, v]) => v !== undefined && v !== null)
  );
  console.log('[API] crearMascota payload:', payloadLimpio);
  return apiFetch('/mascotas', {
    method: 'POST',
    body:   JSON.stringify(payloadLimpio),
  });
}

async function obtenerMascotas() {
  try {
    const mascotas = await apiFetch('/mascotas');
    if (typeof guardarCache === 'function') {
      guardarCache(CACHE_STORES.MASCOTAS, Array.isArray(mascotas) ? mascotas : []);
    }
    return mascotas;
  } catch (err) {
    console.warn('[API] obtenerMascotas fallback offline:', err.message);
    if (typeof leerCache === 'function') {
      const cache = await leerCache(CACHE_STORES.MASCOTAS);
      const pendientes = await leerPendientes(STORES.MASCOTAS).catch(() => []);
      return [...cache, ...pendientes];
    }
    throw err;
  }
}

// ═══ CENSOS ══════════════════════════════════════════════════════════════════
async function crearCenso(datos) {
  // No enviar `id` generado localmente; incluir idProyecto y color según la configuración del proyecto.
  const config = getProyectoConfig();
  const { id, ...payload } = datos || {};
  return apiFetch('/censos', {
    method: 'POST',
    body:   JSON.stringify({
      idProyecto: config.idProyecto,
      color:      config.color,
      ...payload,
    }),
  });
}

async function obtenerCensos() {
  try {
    const censos = await apiFetch('/censos');
    if (typeof guardarCache === 'function') {
      guardarCache(CACHE_STORES.CENSOS, Array.isArray(censos) ? censos : []);
    }
    return censos;
  } catch (err) {
    console.warn('[API] obtenerCensos fallback offline:', err.message);
    if (typeof leerCache === 'function') {
      const cache = await leerCache(CACHE_STORES.CENSOS);
      const pendientes = await leerPendientes(STORES.CENSOS).catch(() => []);
      return [...cache, ...pendientes];
    }
    throw err;
  }
}

// ═══ PUSH NOTIFICATIONS ══════════════════════════════════════════════════════
async function suscribirPush(suscripcion) {
  return apiFetch('/censos/suscribir', {
    method: 'POST',
    body:   JSON.stringify(suscripcion),
  });
}

async function obtenerVapidPublicKey() {
  const data = await apiFetch('/vapid-public-key');
  return data.publicKey;
}

// ── Convertir base64url a Uint8Array para VAPID ──────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}
