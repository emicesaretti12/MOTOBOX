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
export function mensajeCaliente(l, vendedor) {
  const nombre = primerNombre(l.nombre)
  const yo = primerNombre(vendedor)
  const modelo = String(l.modelo_interes || '').trim()
  const moto = modelo && !/^\d+$/.test(modelo) ? `la ${modelo}` : 'la moto'
  const saludo = `¡Hola${nombre ? ' ' + nombre : ''}! Soy ${yo || 'tu asesor'} de MotoBox Córdoba 🏍️`
  const pago = { contado: 'de contado', tarjeta: 'con tarjeta de crédito', anticipo_cuotas: 'con anticipo + cuotas' }[l.forma_pago]
  if (l.caliente_motivo === 'asesor' || !pago) {
    return `${saludo} Vi tu consulta y quiero ayudarte a que te lleves ${moto}. ¿Te puedo llamar ahora o preferís que sigamos por acá?`
  }
  return `${saludo} Vi que querés ${moto} ${pago}. La tenemos con entrega inmediata en Santa Rosa 4227 (BoxPoint). ¿Podés pasar hoy o mañana a verla? Decime a qué hora y te la tengo lista.`
}

export function linkCaliente(l, vendedor) {
  const t = telefonoWhatsApp(l.telefono)
  return t ? `https://wa.me/${t}?text=${encodeURIComponent(mensajeCaliente(l, vendedor))}` : null
}
