// Agrupa la actividad del agente (tabla agente_eventos) en conversaciones y arma el resumen del día.
// Funciones puras para poder probarlas sin red.

export const ESPERA_MINUTOS = 5 // un cliente que escribió y no tuvo respuesta en este tiempo queda "esperando"

const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '')

export function claveConversacion(e) {
  if (e.contact_id) return `c:${e.contact_id}`
  const tel = soloDigitos(e.telefono).slice(-10)
  if (tel.length >= 8) return `t:${tel}`
  if (e.lead_id) return `l:${e.lead_id}`
  return `e:${e.id}`
}

const esMensaje = (e) => e.tipo === 'mensaje_entrante' || e.tipo === 'mensaje_saliente'

// eventos: cualquier orden. Devuelve conversaciones ordenadas por última actividad (la más reciente primero),
// cada una con sus eventos en orden cronológico.
export function agruparConversaciones(eventos, ahora = new Date()) {
  const mapa = new Map()
  const orden = [...eventos].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id)
  for (const e of orden) {
    const clave = claveConversacion(e)
    let c = mapa.get(clave)
    if (!c) {
      c = { clave, nombre: null, telefono: null, canal: null, lead_id: null, eventos: [], ultimo: null, ultimoMensaje: null }
      mapa.set(clave, c)
    }
    c.eventos.push(e)
    c.nombre = e.nombre || c.nombre
    c.telefono = e.telefono || c.telefono
    c.canal = e.canal || c.canal
    c.lead_id = e.lead_id || c.lead_id
    c.ultimo = e
    if (esMensaje(e)) c.ultimoMensaje = e
  }
  const lista = [...mapa.values()].map((c) => ({ ...c, estado: estadoConversacion(c, ahora) }))
  return lista.sort((a, b) => new Date(b.ultimo.created_at) - new Date(a.ultimo.created_at))
}

// 'esperando': el último mensaje es del cliente y nadie le contestó hace más de ESPERA_MINUTOS.
// 'humano': la última respuesta la dio una persona. 'derivado': el agente lo pasó a un asesor.
// 'activa': hubo movimiento en los últimos 15 minutos. 'quieta': el resto.
export function estadoConversacion(c, ahora = new Date()) {
  const m = c.ultimoMensaje
  const minutos = (fecha) => (ahora - new Date(fecha)) / 60000
  if (m && m.autor === 'cliente' && minutos(m.created_at) >= ESPERA_MINUTOS) return 'esperando'
  if (m && m.autor === 'humano') return 'humano'
  if (c.eventos.some((e) => e.tipo === 'dato' && /asesor|listo para comprar/i.test(e.texto ?? ''))) return 'derivado'
  if (c.ultimo && minutos(c.ultimo.created_at) < 15) return 'activa'
  return 'quieta'
}

// Resumen de los eventos desde `desde` (inicio del día).
export function resumenDelDia(eventos, desde) {
  const hoy = eventos.filter((e) => new Date(e.created_at) >= desde)
  const conversaciones = new Set(hoy.filter(esMensaje).map(claveConversacion))
  const datos = hoy.filter((e) => e.tipo === 'dato').map((e) => e.texto ?? '')
  return {
    conversaciones: conversaciones.size,
    respuestasAgente: hoy.filter((e) => e.tipo === 'mensaje_saliente' && e.autor === 'agente').length,
    nuevos: datos.filter((t) => /nuevo lead/i.test(t)).length,
    dnis: datos.filter((t) => /mandó dni/i.test(t)).length,
    listos: datos.filter((t) => /listo para comprar|pidió hablar con un asesor/i.test(t)).length,
  }
}

// Texto corto para la lista de conversaciones.
export function vistaPrevia(e) {
  if (!e) return ''
  const quien = e.autor === 'cliente' ? '' : e.autor === 'humano' ? 'Asesor: ' : e.autor === 'agente' ? 'Valen: ' : ''
  const texto = (e.texto ?? '').replace(/\s+/g, ' ').trim()
  return `${quien}${texto.length > 90 ? texto.slice(0, 90) + '…' : texto}`
}
