// Calculadora de precios: lista de motos, planes de pago y presupuesto listo para mandar por WhatsApp.
// La configuración vive en crm_config (clave 'calculadora') y solo la cambia un admin.

export const CLAVE_CONFIG = 'calculadora'

// Estructura inicial: los planes existen pero sin recargo cargado, así no se cotiza con números inventados.
export const CONFIG_INICIAL = {
  motos: [],
  contado: { descuento_pct: 0 },
  tarjetas: [
    { id: 'naranja', nombre: 'Naranja', opciones: [3, 6, 12].map((cuotas) => ({ cuotas, recargo_pct: null })) },
    { id: 'bancarias', nombre: 'Visa / Mastercard bancarias', opciones: [3, 6, 12, 18].map((cuotas) => ({ cuotas, recargo_pct: null })) },
  ],
  credito: {
    nombre: 'Crédito con DNI',
    anticipo_min_pct: 0,
    gastos_pct: 0,
    opciones: [6, 12, 18, 24].map((cuotas) => ({ cuotas, recargo_pct: null })),
  },
  extras: { patentamiento: 0, formulario: 0, flete: 0 },
  validez_dias: 1,
}

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const pct = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// Une lo guardado con la estructura inicial (por si falta algo o viene de una versión vieja).
export function normalizarConfig(guardada) {
  const g = guardada && typeof guardada === 'object' ? guardada : {}
  const opciones = (lista) => (Array.isArray(lista) ? lista : [])
    .map((o) => ({ cuotas: Math.round(num(o?.cuotas) ?? 0), recargo_pct: pct(o?.recargo_pct) }))
    .filter((o) => o.cuotas >= 1)
    .sort((a, b) => a.cuotas - b.cuotas)
  return {
    motos: (Array.isArray(g.motos) ? g.motos : [])
      .map((m) => ({ modelo: String(m?.modelo ?? '').trim(), precio: num(m?.precio) }))
      .filter((m) => m.modelo),
    contado: { descuento_pct: pct(g.contado?.descuento_pct) ?? 0 },
    tarjetas: (Array.isArray(g.tarjetas) ? g.tarjetas : CONFIG_INICIAL.tarjetas).map((t, i) => ({
      id: String(t?.id || `tarjeta-${i}`),
      nombre: String(t?.nombre || 'Tarjeta').trim(),
      opciones: opciones(t?.opciones),
    })),
    credito: {
      nombre: String(g.credito?.nombre || CONFIG_INICIAL.credito.nombre),
      anticipo_min_pct: pct(g.credito?.anticipo_min_pct) ?? 0,
      gastos_pct: pct(g.credito?.gastos_pct) ?? 0,
      opciones: g.credito ? opciones(g.credito.opciones) : CONFIG_INICIAL.credito.opciones,
    },
    extras: {
      patentamiento: num(g.extras?.patentamiento) ?? 0,
      formulario: num(g.extras?.formulario) ?? 0,
      flete: num(g.extras?.flete) ?? 0,
    },
    validez_dias: Math.max(1, Math.round(num(g.validez_dias) ?? 1)),
    actualizado_at: g.actualizado_at ?? null,
    actualizado_por: g.actualizado_por ?? null,
  }
}

// Las cuotas se redondean hacia arriba a la centena, como en las concesionarias.
export const redondear = (n) => Math.ceil(n / 100) * 100

export function totalExtras(config) {
  const e = config?.extras ?? {}
  return (num(e.patentamiento) ?? 0) + (num(e.formulario) ?? 0) + (num(e.flete) ?? 0)
}

// Cotiza una moto con todos los planes que tienen recargo cargado.
//   precio: precio de lista de contado
//   anticipo: lo que entrega el cliente (se descuenta antes de financiar)
//   conExtras: suma patentamiento, formulario y flete
export function cotizar(config, { precio, anticipo = 0, conExtras = false }) {
  const P = num(precio)
  if (!P || P <= 0) return null
  const extras = conExtras ? totalExtras(config) : 0
  const base = P + extras
  const A = Math.min(Math.max(num(anticipo) ?? 0, 0), base)
  const aFinanciar = base - A

  const contadoDesc = config.contado?.descuento_pct ?? 0
  const contado = {
    precio: Math.round(P * (1 - contadoDesc / 100)) + extras,
    descuento_pct: contadoDesc,
  }

  const plan = (opciones, monto) => opciones
    .filter((o) => o.recargo_pct != null)
    .map((o) => {
      const total = monto * (1 + o.recargo_pct / 100)
      const cuota = redondear(total / o.cuotas)
      return { cuotas: o.cuotas, recargo_pct: o.recargo_pct, cuota, total: cuota * o.cuotas }
    })

  const tarjetas = config.tarjetas
    .map((t) => ({ id: t.id, nombre: t.nombre, opciones: aFinanciar > 0 ? plan(t.opciones, aFinanciar) : [] }))
    .filter((t) => t.opciones.length)

  const c = config.credito
  const anticipoMin = Math.ceil((base * (c.anticipo_min_pct ?? 0)) / 100)
  const creditoMonto = aFinanciar * (1 + (c.gastos_pct ?? 0) / 100)
  const credito = {
    nombre: c.nombre,
    anticipo_min: anticipoMin,
    falta_anticipo: A < anticipoMin ? anticipoMin - A : 0,
    gastos_pct: c.gastos_pct ?? 0,
    opciones: aFinanciar > 0 && A >= anticipoMin ? plan(c.opciones, creditoMonto) : [],
  }

  return { precio: P, extras, base, anticipo: A, aFinanciar, contado, tarjetas, credito }
}

export const pesos = (n) => `$${Math.round(n).toLocaleString('es-AR')}`

// ¿Hay algo para cotizar además del contado?
export function planesCargados(config) {
  return config.tarjetas.some((t) => t.opciones.some((o) => o.recargo_pct != null))
    || config.credito.opciones.some((o) => o.recargo_pct != null)
}

// Texto del presupuesto para WhatsApp. `elegidas` es un Set de claves ("contado", "naranja-6", "credito-12"); vacío = todo.
export function textoPresupuesto({ cot, modelo, cliente, vendedor, validezDias = 1, elegidas, hoy = new Date() }) {
  if (!cot) return ''
  const incluye = (k) => !elegidas || elegidas.size === 0 || elegidas.has(k)
  const primero = (x) => {
    const p = String(x ?? '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/)[0] || ''
    return p.length < 2 || /^sin$/i.test(p) ? '' : p[0].toUpperCase() + p.slice(1).toLowerCase()
  }
  const nombre = primero(cliente)
  const yo = primero(vendedor)
  const l = []
  l.push(`¡Hola${nombre ? ' ' + nombre : ''}! Te paso el presupuesto${yo ? `, soy ${yo} de MotoBox Córdoba` : ' de MotoBox Córdoba'} 🏍️`)
  l.push('')
  l.push(`*${modelo || 'Moto 0 km'}*`)
  if (cot.extras > 0) l.push(`(incluye patentamiento, formulario y flete: ${pesos(cot.extras)})`)
  l.push('')
  if (incluye('contado')) l.push(`💵 *Contado:* ${pesos(cot.contado.precio)}`)
  if (cot.anticipo > 0) l.push(`📥 *Entregando:* ${pesos(cot.anticipo)}`)
  for (const t of cot.tarjetas) {
    const ops = t.opciones.filter((o) => incluye(`${t.id}-${o.cuotas}`))
    if (!ops.length) continue
    l.push('')
    l.push(`💳 *${t.nombre}*`)
    for (const o of ops) l.push(`• ${o.cuotas} cuotas de ${pesos(o.cuota)}`)
  }
  const cr = cot.credito.opciones.filter((o) => incluye(`credito-${o.cuotas}`))
  if (cr.length) {
    l.push('')
    l.push(`🪪 *${cot.credito.nombre}* (solo con tu DNI)`)
    for (const o of cr) l.push(`• ${o.cuotas} cuotas de ${pesos(o.cuota)}`)
  }
  const hasta = new Date(hoy)
  hasta.setDate(hasta.getDate() + Math.max(1, validezDias) - 1)
  l.push('')
  l.push(validezDias <= 1
    ? `Precios válidos por hoy, ${hasta.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })}.`
    : `Precios válidos hasta el ${hasta.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })}.`)
  l.push('📍 Santa Rosa 4227 – Complejo BoxPoint. ¿Te la reservo?')
  return l.join('\n')
}

// Elige la moto de la lista que mejor coincide con lo que pidió el lead.
export function motoParaLead(config, modeloInteres) {
  const q = String(modeloInteres ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2)
  if (!q.length) return null
  let mejor = null
  let puntos = 0
  for (const m of config.motos) {
    const nombre = m.modelo.toLowerCase()
    const p = q.filter((w) => nombre.includes(w)).length
    if (p > puntos) { mejor = m; puntos = p }
  }
  return mejor
}
