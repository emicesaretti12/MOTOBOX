// "Para vender hoy": la cola de trabajo del vendedor.
// Regla del sistema: ningún lead abierto queda sin próximo paso. Cada contacto se cierra con un
// resultado (le escribí / no contesta / agendó visita / posponer / perdido) y el CRM decide cuándo
// vuelve a aparecer. Funciones puras: la pantalla solo las dibuja y guarda lo que devuelven.
import { ordenarCalientes } from './calientes'

const HORA = 36e5
const DIA = 24 * HORA
const ABIERTOS = ['nuevo', 'contactado', 'en_negociacion']
const ZONA_UTC = -3 // Argentina no tiene horario de verano

export const MOTIVOS_PERDIDO = ['Compró en otro lado', 'No le interesa', 'No le alcanza la plata', 'No responde', 'Otro']
export const INTENTOS_MAXIMOS = 4

const ms = (f) => (f ? new Date(f).getTime() : null)

// Medianoche local (Argentina) del día de `ahora`, en milisegundos UTC.
export function inicioDelDia(ahora = new Date()) {
  const local = new Date(new Date(ahora).getTime() + ZONA_UTC * HORA)
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - ZONA_UTC * HORA
}

// Próximo contacto: dentro de `dias` días a las 10:00 (hora local). El local abre de lunes a sábado.
export function proximoContacto(ahora = new Date(), dias = 1) {
  let t = inicioDelDia(ahora) + dias * DIA + 10 * HORA
  if (new Date(t + ZONA_UTC * HORA).getUTCDay() === 0) t += DIA
  return new Date(t).toISOString()
}

export function esCaliente(l) {
  return !!l.caliente_at || ['contado', 'tarjeta', 'anticipo_cuotas'].includes(l.forma_pago) || l.bcra_resultado === 'apto' || l.estado_dni === 'aprobado'
}

// Arma la cola. Cada lead aparece una sola vez, en el grupo de mayor prioridad que le toque.
export function colaDeHoy(leads, ahora = new Date()) {
  const t = new Date(ahora).getTime()
  const hoy0 = inicioDelDia(ahora)
  const finHoy = hoy0 + DIA
  const abiertos = (leads || []).filter((l) => ABIERTOS.includes(l.estado) && !l.duplicado_de)
  const pospuesto = (l) => ms(l.proximo_contacto_at) != null && ms(l.proximo_contacto_at) >= finHoy
  const usados = new Set()
  const tomar = (filtro, orden) => {
    const r = abiertos.filter((l) => !usados.has(l.id) && filtro(l))
    r.forEach((l) => usados.add(l.id))
    return orden ? orden(r) : r
  }
  const porPuntaje = (r) => r.sort((a, b) => (b.puntaje_compra ?? 0) - (a.puntaje_compra ?? 0))

  const citas = tomar(
    // Si ya lo contactaste hoy, sale de la cola (la cita sigue en la Agenda).
    (l) => ms(l.fecha_agenda) != null && ms(l.fecha_agenda) >= hoy0 - 2 * DIA && ms(l.fecha_agenda) < finHoy && !(ms(l.ultimo_contacto_at) >= hoy0),
    (r) => r.sort((a, b) => ms(a.fecha_agenda) - ms(b.fecha_agenda)),
  )
  const calientes = tomar(
    (l) => l.caliente_at && !l.caliente_atendido_at && l.estado !== 'en_negociacion' && t - ms(l.caliente_at) < 14 * DIA && !pospuesto(l),
    ordenarCalientes,
  )
  const aprobados = tomar(
    (l) => l.estado === 'nuevo' && (l.estado_dni === 'aprobado' || l.bcra_resultado === 'apto') && !pospuesto(l),
    porPuntaje,
  )
  const volver = tomar(
    (l) => ms(l.proximo_contacto_at) != null && ms(l.proximo_contacto_at) < finHoy,
    (r) => r.sort((a, b) => Number(esCaliente(b)) - Number(esCaliente(a)) || ms(a.proximo_contacto_at) - ms(b.proximo_contacto_at)),
  )
  // Calientes ya contactados que quedaron sin próximo paso: se enfrían si nadie insiste.
  const enfriando = tomar((l) => {
    if (!esCaliente(l) || l.estado === 'nuevo' || l.proximo_contacto_at) return false
    if (ms(l.fecha_agenda) != null && ms(l.fecha_agenda) >= finHoy) return false
    const ultimo = Math.max(ms(l.ultimo_contacto_at) ?? 0, ms(l.caliente_atendido_at) ?? 0, ms(l.caliente_at) ?? 0, ms(l.dni_actualizado_at) ?? 0)
    return ultimo > 0 && t - ultimo > 2 * DIA && t - ultimo < 30 * DIA
  }, porPuntaje)

  const grupos = [
    { clave: 'citas', titulo: 'Citas', ayuda: 'Citas de hoy y de los últimos 2 días. Confirmá que vienen; si no vinieron, reagendá.', leads: citas },
    { clave: 'calientes', titulo: 'Listos para comprar', ayuda: 'Pagan de contado, con tarjeta o anticipo, o pidieron un asesor. Nadie los contactó todavía.', leads: calientes },
    { clave: 'aprobados', titulo: 'Crédito aprobado', ayuda: 'Ya pueden sacar la moto en cuotas y nadie los contactó.', leads: aprobados },
    { clave: 'volver', titulo: 'Seguimientos de hoy', ayuda: 'Quedaste en escribirles de nuevo hoy.', leads: volver },
    { clave: 'enfriando', titulo: 'Se enfrían', ayuda: 'Interesados que ya contactaste y llevan más de 2 días sin novedades.', leads: enfriando },
  ].filter((g) => g.leads.length > 0)

  return { grupos, total: grupos.reduce((n, g) => n + g.leads.length, 0) }
}

// Lo que el vendedor ya hizo hoy (para la barra de avance).
export function avanceDeHoy(leads, ahora = new Date()) {
  const hoy0 = inicioDelDia(ahora)
  const deHoy = (f) => ms(f) != null && ms(f) >= hoy0 && ms(f) < hoy0 + DIA
  const todos = leads || []
  return {
    contactados: todos.filter((l) => deHoy(l.ultimo_contacto_at)).length,
    citasFuturas: todos.filter((l) => ABIERTOS.includes(l.estado) && ms(l.fecha_agenda) != null && ms(l.fecha_agenda) >= new Date(ahora).getTime()).length,
  }
}

function fechaLocal(iso) {
  return new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

// Traduce el resultado de un contacto en los cambios a guardar en el lead.
// tipo: 'escribi' | 'no_contesta' | 'visita' | 'posponer' | 'perdido'. datos: { fecha } o { motivo }.
export function resultadoContacto(lead, tipo, datos = {}, ahora = new Date(), vendedor = '') {
  const ahoraIso = new Date(ahora).toISOString()
  const quien = vendedor || 'vendedor'
  const intentos = (lead.contacto_intentos ?? 0) + 1
  const cambios = { ultimo_contacto_at: ahoraIso }
  if (lead.caliente_at && !lead.caliente_atendido_at) cambios.caliente_atendido_at = ahoraIso
  let nota

  if (tipo === 'escribi') {
    if (lead.estado === 'nuevo') cambios.estado = 'contactado'
    cambios.contacto_intentos = intentos
    cambios.proximo_contacto_at = proximoContacto(ahora, 1)
    nota = `le escribió ${quien}`
  } else if (tipo === 'no_contesta') {
    if (lead.estado === 'nuevo') cambios.estado = 'contactado'
    cambios.contacto_intentos = intentos
    cambios.proximo_contacto_at = proximoContacto(ahora, 2)
    nota = `no contesta (intento ${intentos}) — ${quien}`
  } else if (tipo === 'visita') {
    if (!datos.fecha || Number.isNaN(new Date(datos.fecha).getTime())) throw new Error('Falta el día y la hora de la visita')
    cambios.fecha_agenda = new Date(datos.fecha).toISOString()
    cambios.estado = 'en_negociacion'
    cambios.proximo_contacto_at = null
    cambios.contacto_intentos = 0
    nota = `agendó visita para ${fechaLocal(cambios.fecha_agenda)} — ${quien}`
  } else if (tipo === 'posponer') {
    if (!datos.fecha || Number.isNaN(new Date(datos.fecha).getTime())) throw new Error('Falta la fecha')
    if (lead.estado === 'nuevo') cambios.estado = 'contactado'
    cambios.proximo_contacto_at = new Date(datos.fecha).toISOString()
    nota = `volver a contactar el ${fechaLocal(cambios.proximo_contacto_at)} — ${quien}`
  } else if (tipo === 'perdido') {
    if (!datos.motivo) throw new Error('Falta el motivo')
    cambios.estado = 'perdido'
    cambios.proximo_contacto_at = null
    nota = `perdido — ${String(datos.motivo).toLowerCase()} — ${quien}`
  } else {
    throw new Error(`Resultado desconocido: ${tipo}`)
  }

  const marca = new Date(ahora).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })
  cambios.notas = [lead.notas, `[${marca}] CRM: ${nota}`].filter(Boolean).join('\n')
  return cambios
}
