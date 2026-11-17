// Datos para registrar una venta desde el lead: precio sugerido, forma de pago y lectura del monto.

// Precios de contado vigentes (los mismos que usa el agente). Sirven solo de sugerencia: el vendedor pone el real.
export const PRECIOS_CONTADO = [
  { patron: /crono.*full|full.*crono|keller full/i, modelo: 'Keller Crono Full', precio: 1600000 },
  { patron: /stratus/i, modelo: 'Keller Stratus 150', precio: 2180000 },
  { patron: /wave/i, modelo: 'Honda Wave S 110', precio: 3400000 },
]

export const METODOS_PAGO = {
  contado: 'Contado (efectivo)',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta de crédito',
  anticipo_tarjeta: 'Anticipo + tarjeta',
  financiacion: 'Financiación con DNI',
  mixto: 'Mixto',
}

export function modeloSugerido(modeloInteres) {
  const m = (modeloInteres ?? '').trim()
  const p = PRECIOS_CONTADO.find((x) => x.patron.test(m))
  return p ? p.modelo : m
}

export function precioSugerido(modelo, metodo) {
  // Solo se sugiere con contado o transferencia: con tarjeta el precio final depende de las cuotas.
  if (metodo && !['contado', 'transferencia'].includes(metodo)) return null
  const p = PRECIOS_CONTADO.find((x) => x.patron.test(modelo ?? ''))
  return p ? p.precio : null
}

export function metodoDesdeFormaPago(formaPago) {
  return { contado: 'contado', tarjeta: 'tarjeta', anticipo_cuotas: 'anticipo_tarjeta', cuotas: 'financiacion' }[formaPago] ?? 'contado'
}

// "1.600.000", "$ 1600000", "1,6 millones", "1.6M" → 1600000. null si no se entiende.
export function leerPrecio(texto) {
  const t = String(texto ?? '').toLowerCase().replace(/\$/g, '').trim()
  if (!t) return null
  const millones = t.match(/^(\d+(?:[.,]\d+)?)\s*(m|mill[oó]n|millones|palo|palos)$/)
  if (millones) return Math.round(parseFloat(millones[1].replace(',', '.')) * 1e6)
  const digitos = t.replace(/[.\s]/g, '').replace(/,\d{1,2}$/, '')
  if (!/^\d+$/.test(digitos)) return null
  const n = Number(digitos)
  return n > 0 ? n : null
}

export const formatoPesos = (n) => (n ? '$' + Number(n).toLocaleString('es-AR') : '')
