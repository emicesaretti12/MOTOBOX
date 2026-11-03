// Lista "Para recuperar": leads fríos o perdidos con chances de compra, para que el vendedor les escriba
// a mano desde su WhatsApp (gratis). Usa las mismas reglas que el recupero automático (p5_recupero).
import { aplicaRecupero, telefonoWhatsApp } from '../../supabase/functions/seguimiento-auto/logica.ts'

export const CFG_RECUPERO = { puntajeMinimo: 45, puntajeMinimoPerdidos: 30, diasDesde: 3, diasHasta: 90 }
const YA_RECUPERADO_A_MANO = /Recuperación manual/i

export function leadsParaRecuperar(leads, ahora = new Date()) {
  const vistos = new Set()
  return (leads || [])
    .filter(l => !YA_RECUPERADO_A_MANO.test(l.notas || '') && aplicaRecupero(l, [], ahora, CFG_RECUPERO))
    .sort((a, b) => (b.puntaje_compra ?? 0) - (a.puntaje_compra ?? 0) || new Date(b.created_at) - new Date(a.created_at))
    .filter(l => { const t = telefonoWhatsApp(l.telefono); if (vistos.has(t)) return false; vistos.add(t); return true })
}

function primerNombre(n) {
  const p = String(n || '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/)[0] || ''
  if (!p || /^sin$/i.test(p)) return ''
  return p[0].toUpperCase() + p.slice(1).toLowerCase()
}

export function mensajeRecupero(l) {
  const nombre = primerNombre(l.nombre)
  const modelo = String(l.modelo_interes || '').trim()
  const moto = modelo && !/^\d+$/.test(modelo) && !/consultar|no sabe|ningun|^-$/i.test(modelo) ? `la ${modelo}` : 'una moto 0km'
  return `¡Hola${nombre ? ' ' + nombre : ''}! Te escribo de MotoBox Córdoba 🏍️ Hace unos días consultaste por ${moto}. ` +
    'Ahora podés llevártela con tarjeta de crédito (aceptamos todas, con Naranja hay cuotas bajas), con un anticipo + cuotas o de contado. ¿Querés que te pase las opciones?'
}

export function linkRecupero(l) {
  const t = telefonoWhatsApp(l.telefono)
  return t ? `https://wa.me/${t}?text=${encodeURIComponent(mensajeRecupero(l))}` : null
}
