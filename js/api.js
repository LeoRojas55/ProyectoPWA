// ── api.js — Cliente para la API REST ──────────────────────────────────────

if (window.__API_LOADED__) {
  console.warn('api.js ya cargado — evitando ejecución duplicada');
} else {
  window.__API_LOADED__ = true;

  const DEFAULT_API_BASE = 'https://elprofehugo.online/api/v1';

  // API_BASE se puede inyectar desde `window.__API_BASE__` (index.html).
  // Por defecto usamos el endpoint remoto y evitamos depender de localStorage
  // para prevenir valores obsoletos que rompan la conexión.
  window.API_BASE = window.__API_BASE__ || DEFAULT_API_BASE;
  // Normalizar: quitar slash final si existe
  window.API_BASE = window.API_BASE.replace(/\/$/, '');
}

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
  return apiFetch(`/personas${rol ? `?rol=${encodeURIComponent(rol)}` : ''}`);
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
  return apiFetch('/mascotas');
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
  return apiFetch('/censos');
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
