// Leads calientes: orden de la alerta y mensaje de WhatsApp ya escrito para el vendedor.
import { telefonoWhatsApp } from '../../supabase/functions/seguimiento-auto/logica.ts'

// Primero los que pueden comprar hoy sin crédito; dentro de cada grupo, el más nuevo arriba.
const ORDEN_PAGO = { contado: 0, tarjeta: 1, anticipo_cuotas: 2 }
export function prioridadCaliente(l) {
  if (l.forma_pago in ORDEN_PAGO) return ORDEN_PAGO[l.forma_pago]
  if (l.bcra_resultado === 'apto') return 3
  return 4
}
export function ordenarCalientes(leads) {
  return [...leads].sort((a, b) => prioridadCaliente(a) - prioridadCaliente(b) || new Date(b.caliente_at) - new Date(a.caliente_at))
}

function primerNombre(n) {
  const p = String(n || '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/)[0] || ''
  if (!p || p.length < 2 || /^sin$/i.test(p)) return ''
  return p[0].toUpperCase() + p.slice(1).toLowerCase()
}

// Mensaje ya escrito para que el vendedor solo tenga que tocar "enviar".
export function primerMensaje(nombreCliente, vendedor) {
  const nombre = primerNombre(nombreCliente)
  const yo = primerNombre(vendedor)
  const quien = yo ? `Soy ${yo} del equipo de MotoBox Córdoba` : 'Te escribo del equipo de MotoBox Córdoba'
  return `¡Hola${nombre ? ' ' + nombre : ''}! ${quien} 🏍️ Con nosotros te podés llevar tu próxima moto financiada solo con tu DNI.`
}

export function mensajeCaliente(l, vendedor) {
  return primerMensaje(l?.nombre, vendedor)
}

export function linkCaliente(l, vendedor) {
  const t = telefonoWhatsApp(l.telefono)
  return t ? `https://wa.me/${t}?text=${encodeURIComponent(mensajeCaliente(l, vendedor))}` : null
}
