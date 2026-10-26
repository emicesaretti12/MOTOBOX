// Precalificación automática de un DNI contra la Central de Deudores del BCRA (API pública, sin clave).
//
// No reemplaza la aprobación de Credicuotas: filtra a quien tiene deudas en mala situación ANTES de que
// el DNI llegue a la cola de un vendedor. Si el BCRA no responde, el resultado es "sin_verificar" y el
// lead sigue el camino de siempre (nunca se pierde un lead por una falla externa).
//
//   GET https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/{cuil}
//   GET https://api.bcra.gob.ar/CentralDeDeudores/v1.0/Deudas/ChequesRechazados/{cuil}
//   404 = la persona no tiene deudas informadas.
//
// El CUIL se arma con el DNI. Como el bot no pide el sexo, se consultan los dos prefijos posibles
// (20 y 27): solo uno existe como persona, así que si alguno informa deudas, es esa persona.
// Sin dependencias de Deno para poder testearlo con Vitest.

export type ResultadoPrecalificacion = 'apto' | 'no_apto' | 'sin_verificar'

export interface Precalificacion {
  resultado: ResultadoPrecalificacion
  // Peor situación informada en el último período (1 normal … 5 irrecuperable). null = sin deudas o sin datos.
  peorSituacion: number | null
  // Cantidad de entidades con deuda en el último período.
  entidades: number
  // Deuda total informada en el último período, en pesos.
  montoTotal: number
  chequesRechazados: number
  motivo: string
}

export interface ConfigPrecalificacion {
  // Situación máxima aceptada (por defecto 2: "riesgo bajo"). 3 en adelante = no apto.
  situacionMaxima?: number
  apiUrl?: string
  timeoutMs?: number
}

interface Dependencias {
  fetch: typeof fetch
}

const API_POR_DEFECTO = 'https://api.bcra.gob.ar/CentralDeDeudores/v1.0'

// Pesos del dígito verificador de CUIT/CUIL.
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

export function armarCuil(prefijo: '20' | '27' | '23', dni: string): string {
  const base = prefijo + dni.padStart(8, '0')
  const suma = base.split('').reduce((acc, d, i) => acc + Number(d) * PESOS[i], 0)
  const resto = 11 - (suma % 11)
  const verificador = resto === 11 ? 0 : resto
  return base + String(verificador)
}

// CUIL posibles para un DNI: hombre (20) y mujer (27). Cuando el verificador da 10, AFIP usa
// el prefijo 23 con verificador 9 (hombre) o 4 (mujer).
export function cuilesPosibles(dni: string): string[] {
  const limpio = dni.replace(/\D/g, '')
  if (!/^\d{7,8}$/.test(limpio)) return []
  const resultado: string[] = []
  for (const [prefijo, alternativo] of [['20', '9'], ['27', '4']] as const) {
    const cuil = armarCuil(prefijo, limpio)
    resultado.push(cuil.length === 12 ? `23${limpio.padStart(8, '0')}${alternativo}` : cuil)
  }
  return resultado
}

type Consulta =
  | { estado: 'ok'; cuerpo: any }
  | { estado: 'sin_datos' }
  | { estado: 'error' }

async function consultar(url: string, d: Dependencias, timeoutMs: number): Promise<Consulta> {
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), timeoutMs)
  try {
    const res = await d.fetch(url, { headers: { Accept: 'application/json' }, signal: control.signal })
    if (res.status === 404) return { estado: 'sin_datos' }
    if (!res.ok) return { estado: 'error' }
    return { estado: 'ok', cuerpo: await res.json() }
  } catch {
    return { estado: 'error' }
  } finally {
    clearTimeout(reloj)
  }
}

interface ResumenDeudas { peorSituacion: number | null; entidades: number; montoTotal: number; procesoJudicial: boolean }

// Solo el período más reciente: es lo que mira una financiera hoy.
export function resumirDeudas(cuerpo: any): ResumenDeudas {
  const periodos: any[] = cuerpo?.results?.periodos ?? []
  if (!periodos.length) return { peorSituacion: null, entidades: 0, montoTotal: 0, procesoJudicial: false }
  const ultimo = [...periodos].sort((a, b) => String(b.periodo).localeCompare(String(a.periodo)))[0]
  const entidades: any[] = ultimo?.entidades ?? []
  let peor: number | null = null
  let monto = 0
  let judicial = false
  for (const e of entidades) {
    const s = Number(e.situacion)
    if (Number.isFinite(s)) peor = peor === null ? s : Math.max(peor, s)
    monto += (Number(e.monto) || 0) * 1000 // el BCRA informa en miles de pesos
    if (e.procesoJud === true || e.situacionJuridica === true) judicial = true
  }
  return { peorSituacion: peor, entidades: entidades.length, montoTotal: monto, procesoJudicial: judicial }
}

// Cheques rechazados que todavía no se pagaron.
export function contarChequesImpagos(cuerpo: any): number {
  let n = 0
  for (const causal of cuerpo?.results?.causales ?? []) {
    for (const entidad of causal?.entidades ?? []) {
      for (const cheque of entidad?.detalle ?? []) {
        if (!cheque?.fechaPago) n++
      }
    }
  }
  return n
}

export async function precalificar(
  dni: string,
  cfg: ConfigPrecalificacion = {},
  deps: Partial<Dependencias> = {}
): Promise<Precalificacion> {
  const d: Dependencias = { fetch: deps.fetch ?? fetch }
  const base = (cfg.apiUrl ?? API_POR_DEFECTO).replace(/\/+$/, '')
  const timeoutMs = cfg.timeoutMs ?? 5000
  const maxima = cfg.situacionMaxima ?? 2
  const vacio = { peorSituacion: null, entidades: 0, montoTotal: 0, chequesRechazados: 0 }

  const cuiles = cuilesPosibles(dni)
  if (!cuiles.length) return { resultado: 'sin_verificar', ...vacio, motivo: 'DNI inválido' }

  const consultas = await Promise.all(cuiles.map((c) => consultar(`${base}/Deudas/${c}`, d, timeoutMs)))
  const conDatos = consultas
    .map((c, i) => ({ c, cuil: cuiles[i] }))
    .filter((x): x is { c: { estado: 'ok'; cuerpo: any }; cuil: string } => x.c.estado === 'ok')

  if (!conDatos.length) {
    // Si alguna consulta falló no se puede afirmar que no tiene deudas.
    if (consultas.some((c) => c.estado === 'error')) {
      return { resultado: 'sin_verificar', ...vacio, motivo: 'El BCRA no respondió' }
    }
    return { resultado: 'apto', ...vacio, motivo: 'Sin deudas informadas en el BCRA' }
  }

  // Si por algún motivo los dos CUIL traen datos, se toma el peor.
  const resumenes = conDatos.map((x) => ({ cuil: x.cuil, ...resumirDeudas(x.c.cuerpo) }))
  const peor = resumenes.reduce((a, b) => ((b.peorSituacion ?? 0) > (a.peorSituacion ?? 0) ? b : a))

  const cheques = await consultar(`${base}/Deudas/ChequesRechazados/${peor.cuil}`, d, timeoutMs)
  const chequesImpagos = cheques.estado === 'ok' ? contarChequesImpagos(cheques.cuerpo) : 0

  const datos = {
    peorSituacion: peor.peorSituacion,
    entidades: peor.entidades,
    montoTotal: peor.montoTotal,
    chequesRechazados: chequesImpagos,
  }

  if (peor.procesoJudicial) return { resultado: 'no_apto', ...datos, motivo: 'Deuda en proceso judicial' }
  if (chequesImpagos > 0) return { resultado: 'no_apto', ...datos, motivo: `${chequesImpagos} cheque(s) rechazado(s) sin pagar` }
  if (peor.peorSituacion !== null && peor.peorSituacion > maxima) {
    return { resultado: 'no_apto', ...datos, motivo: `Situación ${peor.peorSituacion} en el BCRA` }
  }
  return {
    resultado: 'apto',
    ...datos,
    motivo: peor.peorSituacion === null ? 'Sin deudas informadas en el BCRA' : `Situación ${peor.peorSituacion} en el BCRA`,
  }
}

// Texto corto para la nota del lead (sin DNI ni CUIL).
export function notaPrecalificacion(p: Precalificacion, intento: number, relacion: string): string {
  const etiqueta = p.resultado === 'apto' ? 'APTO' : p.resultado === 'no_apto' ? 'NO APTO' : 'sin verificar'
  const detalle = p.entidades > 0
    ? ` — ${p.entidades} entidad(es), deuda $${Math.round(p.montoTotal).toLocaleString('es-AR')}`
    : ''
  return `Precalificación BCRA intento ${intento} (${relacion}): ${etiqueta}. ${p.motivo}${detalle}`
}
