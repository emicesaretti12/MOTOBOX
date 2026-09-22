import { supabase } from './supabase'

/**
 * Centro de Integraciones del CRM.
 *
 * IMPORTANTE SOBRE LA BASE DE DATOS:
 * La configuración se guarda en la tabla opcional `crm_integraciones`.
 * Si esa tabla NO existe, todo sigue funcionando usando localStorage como
 * respaldo. Ninguna función de este archivo modifica, migra ni borra tablas
 * existentes (leads, profiles, ventas, inventario_motos, etc.).
 */

const LOCAL_CONFIG_KEY = 'motobox.integrations.config'
const LOCAL_LOG_KEY = 'motobox.integrations.log'
const CONFIG_ROW_ID = 1
const MAX_LOG_ENTRIES = 60

/** Eventos que el CRM puede emitir hacia herramientas externas. */
export const CRM_EVENTS = {
  LEAD_CREATED: 'lead.created',
  LEAD_UPDATED: 'lead.updated',
  LEAD_STATUS_CHANGED: 'lead.status_changed',
  LEAD_ASSIGNED: 'lead.assigned',
  INTERACTION_CREATED: 'interaction.created',
  SALE_CREATED: 'sale.created',
  MOTO_PUBLISHED: 'moto.published',
}

export const CRM_EVENT_LABELS = {
  'lead.created': 'Lead nuevo creado',
  'lead.updated': 'Lead editado',
  'lead.status_changed': 'Lead cambió de estado',
  'lead.assigned': 'Lead asignado a un vendedor',
  'interaction.created': 'Interacción registrada',
  'sale.created': 'Venta cerrada',
  'moto.published': 'Moto publicada en la web',
}

export const DEFAULT_CONFIG = {
  webhooks: [],      // { id, nombre, url, eventos: [], activo, proveedor }
  telegram: { activo: false, botToken: '', chatId: '', eventos: [] },
  slack: { activo: false, webhookUrl: '', eventos: [] },
  discord: { activo: false, webhookUrl: '', eventos: [] },
  email: { activo: false, destinatario: '', firma: '' },
  whatsapp: {
    numeroNegocio: '',
    prefijoPais: '54',
    plantillas: [
      { id: 'bienvenida', nombre: 'Bienvenida', texto: 'Hola {nombre}! Soy {vendedor} de MotoBox. Vi tu consulta por la {modelo}. ¿Cuándo te queda cómodo que hablemos?' },
      { id: 'seguimiento', nombre: 'Seguimiento', texto: 'Hola {nombre}, ¿pudiste ver la info de la {modelo}? Cualquier duda quedo a disposición.' },
      { id: 'cita', nombre: 'Confirmar cita', texto: 'Hola {nombre}! Te confirmo la visita al showroom. Te esperamos. Cualquier cambio avisame.' },
      { id: 'cierre', nombre: 'Cierre', texto: 'Hola {nombre}, tengo la {modelo} reservada para vos. ¿Avanzamos con la operación?' },
    ],
  },
  calendario: { activo: true, duracionCitaMin: 45 },
  analytics: { metaPixelId: '', gaMeasurementId: '' },
  captacion: { origenPorDefecto: 'otro', asignacionAutomatica: false },
}

/* ------------------------------------------------------------------ */
/* Persistencia                                                        */
/* ------------------------------------------------------------------ */

function readLocal(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage lleno o bloqueado */
  }
}

/** Mezcla profunda contra DEFAULT_CONFIG para tolerar configs viejas. */
export function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  return {
    ...DEFAULT_CONFIG,
    ...cfg,
    webhooks: Array.isArray(cfg.webhooks) ? cfg.webhooks : [],
    telegram: { ...DEFAULT_CONFIG.telegram, ...(cfg.telegram || {}) },
    slack: { ...DEFAULT_CONFIG.slack, ...(cfg.slack || {}) },
    discord: { ...DEFAULT_CONFIG.discord, ...(cfg.discord || {}) },
    email: { ...DEFAULT_CONFIG.email, ...(cfg.email || {}) },
    whatsapp: {
      ...DEFAULT_CONFIG.whatsapp,
      ...(cfg.whatsapp || {}),
      plantillas:
        Array.isArray(cfg.whatsapp?.plantillas) && cfg.whatsapp.plantillas.length > 0
          ? cfg.whatsapp.plantillas
          : DEFAULT_CONFIG.whatsapp.plantillas,
    },
    calendario: { ...DEFAULT_CONFIG.calendario, ...(cfg.calendario || {}) },
    analytics: { ...DEFAULT_CONFIG.analytics, ...(cfg.analytics || {}) },
    captacion: { ...DEFAULT_CONFIG.captacion, ...(cfg.captacion || {}) },
  }
}

let cachedConfig = null

/** Rechaza si la promesa tarda más de `ms`, para no dejar la UI colgada. */
function withTimeout(promise, ms, etiqueta = 'operación') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Tiempo agotado en ${etiqueta}`)), ms)),
  ])
}

/**
 * Lee la configuración. Intenta Supabase y cae a localStorage si la tabla
 * opcional no existe, si el usuario no tiene permisos o si la red no responde.
 * @returns {Promise<{config: object, origen: 'supabase'|'local'}>}
 */
export async function loadIntegrationConfig({ force = false, timeoutMs = 6000 } = {}) {
  if (cachedConfig && !force) return cachedConfig

  const local = normalizeConfig(readLocal(LOCAL_CONFIG_KEY, null))
  try {
    const { data, error } = await withTimeout(
      supabase.from('crm_integraciones').select('config').eq('id', CONFIG_ROW_ID).maybeSingle(),
      timeoutMs,
      'la lectura de integraciones'
    )

    if (error) throw error
    if (data?.config) {
      cachedConfig = { config: normalizeConfig(data.config), origen: 'supabase' }
      writeLocal(LOCAL_CONFIG_KEY, cachedConfig.config)
      return cachedConfig
    }
    // La tabla existe pero está vacía: seguimos con lo local hasta el primer guardado.
    cachedConfig = { config: local, origen: 'supabase' }
    return cachedConfig
  } catch {
    cachedConfig = { config: local, origen: 'local' }
    return cachedConfig
  }
}

/**
 * Guarda la configuración. Siempre escribe en localStorage (garantía de no
 * perder nada) y adicionalmente en Supabase si la tabla opcional existe.
 * @returns {Promise<{origen: 'supabase'|'local', error: Error|null}>}
 */
export async function saveIntegrationConfig(config) {
  const normalized = normalizeConfig(config)
  writeLocal(LOCAL_CONFIG_KEY, normalized)
  cachedConfig = { config: normalized, origen: 'local' }

  try {
    const { error } = await withTimeout(
      supabase
        .from('crm_integraciones')
        .upsert({ id: CONFIG_ROW_ID, config: normalized, updated_at: new Date().toISOString() }),
      8000,
      'el guardado de integraciones'
    )
    if (error) throw error
    cachedConfig = { config: normalized, origen: 'supabase' }
    return { origen: 'supabase', error: null }
  } catch (err) {
    return { origen: 'local', error: err }
  }
}

export function clearConfigCache() {
  cachedConfig = null
}

/* ------------------------------------------------------------------ */
/* Bitácora de envíos                                                  */
/* ------------------------------------------------------------------ */

export function getDeliveryLog() {
  return readLocal(LOCAL_LOG_KEY, [])
}

export function clearDeliveryLog() {
  writeLocal(LOCAL_LOG_KEY, [])
}

function logDelivery(entry) {
  const log = getDeliveryLog()
  log.unshift({ ...entry, ts: new Date().toISOString() })
  writeLocal(LOCAL_LOG_KEY, log.slice(0, MAX_LOG_ENTRIES))
  try {
    window.dispatchEvent(new CustomEvent('crm-integration-log'))
  } catch {
    /* SSR / entorno sin window */
  }
}

/* ------------------------------------------------------------------ */
/* Envío HTTP tolerante a CORS                                         */
/* ------------------------------------------------------------------ */

/**
 * POST a un endpoint externo. Primero intenta una request normal (para poder
 * leer el status); si el navegador la bloquea por CORS reintenta en modo
 * `no-cors` con content-type simple, que es lo que aceptan Zapier, Make y n8n.
 */
async function postJson(url, body, { timeoutMs = 12000 } = {}) {
  const payload = JSON.stringify(body)
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: controller?.signal,
    })
    if (timer) clearTimeout(timer)
    return { ok: res.ok, status: res.status, modo: 'cors' }
  } catch (err) {
    if (timer) clearTimeout(timer)
    // Reintento opaco: no podemos leer la respuesta pero el envío sí sale.
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: payload,
      })
      return { ok: true, status: 0, modo: 'no-cors' }
    } catch (err2) {
      return { ok: false, status: 0, modo: 'fallido', error: err2?.message || err?.message }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Formateo de mensajes                                                */
/* ------------------------------------------------------------------ */

function money(v) {
  return v || v === 0 ? '$' + Number(v).toLocaleString('es-AR') : '—'
}

/** Texto plano legible del evento, usado por Telegram / Slack / Discord. */
export function describeEvent(evento, payload = {}) {
  const label = CRM_EVENT_LABELS[evento] || evento
  const lineas = [`🏍️ MotoBox CRM — ${label}`]

  if (payload.nombre) lineas.push(`Cliente: ${payload.nombre}`)
  if (payload.telefono) lineas.push(`Teléfono: ${payload.telefono}`)
  if (payload.modelo_interes) lineas.push(`Modelo: ${payload.modelo_interes}`)
  if (payload.estado) lineas.push(`Estado: ${payload.estado}`)
  if (payload.estado_anterior && payload.estado_anterior !== payload.estado) {
    lineas.push(`Cambio: ${payload.estado_anterior} → ${payload.estado}`)
  }
  if (payload.origen) lineas.push(`Origen: ${payload.origen}`)
  if (payload.presupuesto_estimado) lineas.push(`Presupuesto: ${money(payload.presupuesto_estimado)}`)
  if (payload.precio_venta) lineas.push(`Monto: ${money(payload.precio_venta)}`)
  if (payload.vendedor) lineas.push(`Vendedor: ${payload.vendedor}`)
  if (payload.detalle) lineas.push(`Detalle: ${payload.detalle}`)

  return lineas.join('\n')
}

function buildEnvelope(evento, payload, meta) {
  return {
    evento,
    etiqueta: CRM_EVENT_LABELS[evento] || evento,
    ocurrido_en: new Date().toISOString(),
    origen: 'motobox-crm',
    datos: payload,
    meta: meta || {},
  }
}

/* ------------------------------------------------------------------ */
/* Emisión de eventos                                                  */
/* ------------------------------------------------------------------ */

function wants(destino, evento) {
  if (!destino?.activo) return false
  const lista = destino.eventos
  // Sin lista configurada = escucha todos los eventos.
  if (!Array.isArray(lista) || lista.length === 0) return true
  return lista.includes(evento)
}

/**
 * Emite un evento del CRM hacia todos los destinos configurados.
 * Nunca lanza: los fallos se registran en la bitácora y la app sigue andando.
 * @param {string} evento  clave de CRM_EVENTS
 * @param {object} payload datos del lead / venta / interacción
 * @param {object} meta    info extra (usuario que disparó el evento, etc.)
 */
export async function emitCrmEvent(evento, payload = {}, meta = {}) {
  let config
  try {
    ;({ config } = await loadIntegrationConfig())
  } catch {
    return []
  }

  const envelope = buildEnvelope(evento, payload, meta)
  const texto = describeEvent(evento, payload)
  const tareas = []

  for (const hook of config.webhooks || []) {
    if (!wants(hook, evento) || !hook.url) continue
    tareas.push(
      postJson(hook.url, envelope).then(r =>
        logDelivery({ destino: hook.nombre || 'Webhook', evento, ok: r.ok, detalle: r.modo, status: r.status })
      )
    )
  }

  if (wants(config.telegram, evento) && config.telegram.botToken && config.telegram.chatId) {
    const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`
    tareas.push(
      postJson(url, { chat_id: config.telegram.chatId, text: texto, disable_web_page_preview: true }).then(r =>
        logDelivery({ destino: 'Telegram', evento, ok: r.ok, detalle: r.modo, status: r.status })
      )
    )
  }

  if (wants(config.slack, evento) && config.slack.webhookUrl) {
    tareas.push(
      postJson(config.slack.webhookUrl, { text: texto }).then(r =>
        logDelivery({ destino: 'Slack', evento, ok: r.ok, detalle: r.modo, status: r.status })
      )
    )
  }

  if (wants(config.discord, evento) && config.discord.webhookUrl) {
    tareas.push(
      postJson(config.discord.webhookUrl, { content: texto }).then(r =>
        logDelivery({ destino: 'Discord', evento, ok: r.ok, detalle: r.modo, status: r.status })
      )
    )
  }

  if (tareas.length === 0) return []
  return Promise.allSettled(tareas)
}

/** Dispara un evento sin bloquear la UI (fire and forget seguro). */
export function emitCrmEventSafe(evento, payload, meta) {
  try {
    const p = emitCrmEvent(evento, payload, meta)
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch {
    /* nunca romper el flujo del CRM por una integración */
  }
}

/** Envía un evento de prueba a un único destino y devuelve el resultado. */
export async function testDestination(tipo, destino) {
  const demo = {
    nombre: 'Lead de prueba',
    telefono: '+54 9 11 5555-5555',
    modelo_interes: 'Honda Wave 110',
    estado: 'nuevo',
    origen: 'whatsapp',
    presupuesto_estimado: 2500000,
  }
  const envelope = buildEnvelope('lead.created', demo, { prueba: true })
  const texto = `✅ Prueba de conexión desde MotoBox CRM\n${describeEvent('lead.created', demo)}`

  let resultado
  if (tipo === 'telegram') {
    if (!destino.botToken || !destino.chatId) return { ok: false, detalle: 'Falta el token del bot o el Chat ID' }
    resultado = await postJson(`https://api.telegram.org/bot${destino.botToken}/sendMessage`, {
      chat_id: destino.chatId,
      text: texto,
    })
  } else if (tipo === 'slack') {
    if (!destino.webhookUrl) return { ok: false, detalle: 'Falta la URL del webhook' }
    resultado = await postJson(destino.webhookUrl, { text: texto })
  } else if (tipo === 'discord') {
    if (!destino.webhookUrl) return { ok: false, detalle: 'Falta la URL del webhook' }
    resultado = await postJson(destino.webhookUrl, { content: texto })
  } else {
    if (!destino.url) return { ok: false, detalle: 'Falta la URL del webhook' }
    resultado = await postJson(destino.url, envelope)
  }

  logDelivery({
    destino: destino.nombre || tipo,
    evento: 'prueba',
    ok: resultado.ok,
    detalle: resultado.modo,
    status: resultado.status,
  })
  return {
    ok: resultado.ok,
    detalle:
      resultado.modo === 'no-cors'
        ? 'Enviado (el navegador no permite leer la respuesta: revisá la herramienta destino)'
        : resultado.ok
          ? `Enviado correctamente (HTTP ${resultado.status})`
          : `Falló el envío${resultado.status ? ` (HTTP ${resultado.status})` : ''}`,
  }
}
