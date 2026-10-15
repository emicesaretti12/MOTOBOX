/**
 * Cálculos de la pantalla de métricas a partir de las filas de metricas_dni (día × origen).
 */

const CAMPOS = [
  'leads_nuevos', 'dnis_enviados', 'aprobados', 'rechazados', 'aprobados_primer_intento',
  'aprobados_con_familiar', 'verificacion_segundos', 'verificaciones_medidas', 'asignados', 'ventas_cerradas',
]

function vacio() {
  return Object.fromEntries(CAMPOS.map(c => [c, 0]))
}

function acumular(destino, fila) {
  for (const c of CAMPOS) destino[c] += Number(fila[c]) || 0
  return destino
}

// Promedio ponderado: suma de segundos / cantidad de verificaciones medidas.
export function tiempoPromedio(t) {
  return t.verificaciones_medidas > 0 ? t.verificacion_segundos / t.verificaciones_medidas : null
}

export function tasaAprobacion(t) {
  const resueltos = t.aprobados + t.rechazados
  return resueltos > 0 ? Math.round((t.aprobados / resueltos) * 100) : null
}

export function filtrarOrigen(filas, origen) {
  return origen ? (filas || []).filter(f => f.origen === origen) : filas || []
}

export function totales(filas) {
  return (filas || []).reduce(acumular, vacio())
}

function agrupar(filas, clave) {
  const mapa = new Map()
  for (const f of filas || []) {
    const k = clave(f)
    mapa.set(k, acumular(mapa.get(k) || vacio(), f))
  }
  return mapa
}

const diaTexto = d => (typeof d === 'string' ? d : new Date(d).toISOString()).slice(0, 10)

export function porDia(filas) {
  return [...agrupar(filas, f => diaTexto(f.dia)).entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([dia, t]) => ({ dia, ...t }))
}

export function porOrigen(filas) {
  return [...agrupar(filas, f => f.origen).entries()]
    .sort((a, b) => b[1].leads_nuevos - a[1].leads_nuevos || (a[0] < b[0] ? -1 : 1))
    .map(([origen, t]) => ({ origen, ...t }))
}

export function origenesPresentes(filas) {
  return [...new Set((filas || []).map(f => f.origen))].sort()
}

export function formatDuracion(segundos) {
  if (segundos === null || segundos === undefined) return '-'
  const s = Math.round(segundos)
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

// Rango de fechas en hora de Argentina (UTC-3): desde hace (dias - 1) días hasta hoy, inclusive.
export function rangoUltimosDias(dias, ahoraMs = Date.now()) {
  const hoy = new Date(ahoraMs - 3 * 3600 * 1000)
  const desde = new Date(hoy.getTime() - (dias - 1) * 86400000)
  return { desde: desde.toISOString().slice(0, 10), hasta: hoy.toISOString().slice(0, 10) }
}

const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

// "vie 16/10" (armado a mano: el formato de toLocaleDateString cambia según el navegador).
export function formatDia(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  const dia = DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]
  return `${dia} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}
