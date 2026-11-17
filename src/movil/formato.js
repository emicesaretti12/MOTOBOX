// Formatos de la app móvil (funciones puras).

export function iniciales(nombre) {
  const partes = String(nombre ?? '').replace(/sin nombre.*$/i, '').trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return '?'
  return (partes[0][0] + (partes[1]?.[0] ?? '')).toUpperCase()
}

// Color estable por persona (como los contactos del teléfono).
const COLORES = ['#ff9500', '#34c759', '#007aff', '#af52de', '#ff2d55', '#5ac8fa', '#ffcc00', '#5856d6']
export function colorDe(texto) {
  let h = 0
  for (const c of String(texto ?? '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORES[h % COLORES.length]
}

// "12:30", "Ayer", "lun", "12/11" según cuán viejo es.
export function cuandoCorto(fecha, ahora = new Date()) {
  if (!fecha) return ''
  const d = new Date(fecha)
  const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dias = Math.round((dia(ahora) - dia(d)) / 864e5)
  if (dias <= 0) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })
  if (dias === 1) return 'Ayer'
  if (dias < 7) return d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', '')
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Agrupa por día para listas: Hoy, Ayer, Esta semana, Este mes, Antes.
export function grupoFecha(fecha, ahora = new Date()) {
  if (!fecha) return 'Antes'
  const d = new Date(fecha)
  const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dias = Math.round((dia(ahora) - dia(d)) / 864e5)
  if (dias <= 0) return 'Hoy'
  if (dias === 1) return 'Ayer'
  if (dias < 7) return 'Esta semana'
  if (dias < 31) return 'Este mes'
  return 'Antes'
}

export function agruparPorFecha(items, campo, ahora = new Date()) {
  const orden = ['Hoy', 'Ayer', 'Esta semana', 'Este mes', 'Antes']
  const mapa = new Map(orden.map((k) => [k, []]))
  for (const it of items) mapa.get(grupoFecha(it[campo], ahora)).push(it)
  return orden.map((titulo) => ({ titulo, items: mapa.get(titulo) })).filter((g) => g.items.length)
}

export function telefonoWa(tel) {
  const d = String(tel ?? '').replace(/\D/g, '')
  if (d.length < 8) return null
  return d.startsWith('54') ? d : `54${d}`
}

export function buscar(lead, texto) {
  const q = String(texto ?? '').trim().toLowerCase()
  if (!q) return true
  const digitos = q.replace(/\D/g, '')
  return [lead.nombre, lead.modelo_interes].some((v) => String(v ?? '').toLowerCase().includes(q)) ||
    (digitos.length >= 3 && String(lead.telefono ?? '').replace(/\D/g, '').includes(digitos))
}

export function horaCorta(fecha) {
  const d = new Date(fecha)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Separador de día en el chat: "Hoy", "Ayer", "lunes 16/11".
export function diaSeparador(fecha, ahora = new Date()) {
  const d = new Date(fecha)
  const dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dias = Math.round((dia(ahora) - dia(d)) / 864e5)
  if (dias <= 0) return 'Hoy'
  if (dias === 1) return 'Ayer'
  const semana = d.toLocaleDateString('es-AR', { weekday: 'long' })
  return `${semana} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
