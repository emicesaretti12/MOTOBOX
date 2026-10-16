/**
 * Funciones puras de la cola de verificación de DNI (sin Supabase, para poder testearlas).
 */

export const ESTADO_DNI_LABELS = {
  pendiente: 'Pendiente',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
}

const RELACION_LABELS = { titular: 'Titular', familiar: 'Familiar' }

export function etiquetaRelacion(relacion) {
  if (!relacion) return 'Titular'
  return RELACION_LABELS[relacion] || relacion.charAt(0).toUpperCase() + relacion.slice(1)
}

// Para mostrar DNIs viejos (intentos anteriores) sin exponerlos completos.
export function enmascararDni(dni) {
  if (!dni) return '-'
  return '***' + String(dni).slice(-3)
}

export function segundosDesde(fecha, ahoraMs = Date.now()) {
  const t = new Date(fecha).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((ahoraMs - t) / 1000))
}

export function formatEspera(segundos) {
  if (segundos < 60) return `${segundos} s`
  const minutos = Math.floor(segundos / 60)
  if (minutos < 60) return `${minutos} min`
  const horas = Math.floor(minutos / 60)
  const restoMin = minutos % 60
  if (horas < 24) return restoMin ? `${horas} h ${restoMin} min` : `${horas} h`
  const dias = Math.floor(horas / 24)
  const restoHoras = horas % 24
  return restoHoras ? `${dias} d ${restoHoras} h` : `${dias} d`
}

// Monto en pesos sin centavos. Acepta "1500000", "1.500.000" o "$ 1.500.000". Vacío = sin monto.
export function parseMonto(texto) {
  const t = String(texto ?? '').trim()
  if (!t) return { ok: true, valor: null }
  const limpio = t.replace(/^\$\s*/, '').replace(/[.\s]/g, '')
  if (!/^\d+$/.test(limpio)) return { ok: false, error: 'Ingresá solo números, por ejemplo 1.500.000' }
  const valor = Number(limpio)
  if (valor > 999999999) return { ok: false, error: 'El monto es demasiado alto' }
  return { ok: true, valor }
}

export function formatMonto(valor) {
  if (valor === null || valor === undefined || valor === '') return '-'
  return '$' + Math.round(Number(valor)).toLocaleString('es-AR')
}

// Valores de la tabla crm_config. Si la tabla no existe o no se pudo leer, todo queda apagado.
export function leerConfig(filas) {
  const mapa = Object.fromEntries((filas || []).map(f => [f.clave, f.valor]))
  const numero = (v, defecto) => (typeof v === 'number' && v > 0 ? v : defecto)
  return {
    // false si la tabla no existe todavía (migraciones sin aplicar): se ocultan las pantallas nuevas.
    disponible: Array.isArray(filas) && filas.length > 0,
    colaDniActiva: mapa.cola_dni_activa === true,
    avisoSendpulseActivo: mapa.aviso_sendpulse_activo === true,
    alertaEsperaMinutos: numero(mapa.alerta_espera_minutos, 15),
    tomaExpiraMinutos: numero(mapa.toma_expira_minutos, 5),
  }
}

const DIAS_REINGRESO = 7

// Leads que el vendedor tiene que contactar ya: DNI aprobado y todavía en "nuevo",
// y los perdidos que volvieron a escribir en los últimos días. Los más viejos primero.
export function leadsParaContactar(leads, ahoraMs = Date.now()) {
  const nuevos = (leads || []).filter(l => l.estado === 'nuevo')
  const fecha = v => new Date(v || 0).getTime()
  const aprobados = nuevos
    .filter(l => l.estado_dni === 'aprobado')
    .sort((a, b) => fecha(a.dni_actualizado_at) - fecha(b.dni_actualizado_at))
  const limite = ahoraMs - DIAS_REINGRESO * 86400000
  const volvieron = nuevos
    .filter(l => l.reingreso_at && fecha(l.reingreso_at) >= limite && l.estado_dni !== 'aprobado')
    .sort((a, b) => fecha(a.reingreso_at) - fecha(b.reingreso_at))
  return { aprobados, volvieron }
}

export function puedeVerificar(profile) {
  return profile?.role === 'admin' || profile?.verifica_dni === true
}

const MOTIVOS = {
  YA_RESUELTO: d => {
    const quien = d.por ? ` por ${d.por}` : d.origen === 'sendpulse' ? ' desde SendPulse' : ''
    return `Ya estaba resuelto${quien}${d.resultado ? ` (${d.resultado})` : ''}.`
  },
  INTENTO_CAMBIO: () => 'El cliente mandó otro DNI mientras lo revisabas. La lista se actualizó.',
  TOMADO_POR_OTRO: d => `Lo está revisando ${d.por || 'otro operador'}.`,
  SIN_PERMISO: () => 'No tenés permiso para verificar DNIs.',
  COLA_DESACTIVADA: () => 'La verificación desde el CRM está desactivada.',
  NO_AUTORIZADO: () => 'Tu sesión venció. Volvé a iniciar sesión.',
  MONTO_INVALIDO: () => 'El monto no es válido.',
  LEAD_NO_ENCONTRADO: () => 'Ese lead ya no existe.',
  DESACTUALIZADO: () => 'Ese resultado ya no es el vigente: el cliente mandó otro DNI.',
  NO_REINTENTABLE: () => 'Ese aviso ya no se puede reintentar.',
  SIN_CONTACTO: () => 'El lead no tiene contacto de SendPulse: avisale por WhatsApp.',
  AVISO_DESACTIVADO: () => 'El aviso automático por SendPulse está apagado.',
}

export function mensajeMotivo(datos) {
  const f = MOTIVOS[datos?.motivo]
  return f ? f(datos) : 'No se pudo completar. Probá de nuevo en unos segundos.'
}

// Motivo a partir del error de una llamada .rpc() de Supabase (el mensaje trae el código que lanzó la base).
export function motivoDeErrorRpc(error) {
  const mensaje = error?.message || ''
  return Object.keys(MOTIVOS).find(m => mensaje.includes(m)) || null
}

// Cuerpo JSON de un error de supabase.functions.invoke (la edge function responde { ok: false, motivo }).
export async function datosDeErrorFuncion(error) {
  try {
    if (error?.context && typeof error.context.json === 'function') return await error.context.json()
  } catch {
    // respuesta sin JSON
  }
  return { motivo: null }
}

export function mensajeResultado(resultado, aviso) {
  const r = resultado === 'aprobado' ? 'DNI aprobado' : 'DNI rechazado'
  switch (aviso?.estado) {
    case 'enviado':
      return { tipo: 'success', texto: `${r}. El cliente fue avisado por WhatsApp.` }
    case 'fallido':
      return { tipo: 'warning', texto: `${r}, pero el cliente NO fue avisado${aviso.error ? ` (${aviso.error})` : ''}. Quedó en "Sin avisar".` }
    case 'sin_contacto':
      return { tipo: 'warning', texto: `${r}. El lead no tiene contacto de SendPulse: avisale por WhatsApp.` }
    case 'desactivado':
      return { tipo: 'warning', texto: `${r}. El aviso automático está apagado: avisale por WhatsApp.` }
    default:
      return { tipo: 'success', texto: `${r}.` }
  }
}

export const AVISO_LABELS = {
  enviado: 'Aviso enviado al cliente',
  manual: 'Avisado a mano',
  pendiente: 'Aviso en curso o sin confirmar',
  fallido: 'No se pudo avisar al cliente',
  sin_contacto: 'Sin contacto de SendPulse: avisar a mano',
  desactivado: 'Aviso automático apagado: avisar a mano',
}

export const ORIGEN_LABELS = { whatsapp: 'WhatsApp', instagram: 'Instagram', facebook: 'Facebook' }
