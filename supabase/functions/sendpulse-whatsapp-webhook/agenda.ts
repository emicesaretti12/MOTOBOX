// Interpreta el día y la hora de una visita escrita en lenguaje natural por el agente de IA
// ("el sábado a las 10", "mañana 15:30 hs", "lunes 2/11 a las 11"). Devuelve null si no hay una
// fecha y una hora claras: en ese caso el vendedor la confirma a mano (queda en la nota).
// Local: lunes a sábado de 9 a 19 (hora de Argentina, UTC-3, sin horario de verano).
// Sin dependencias de Deno para poder testearlo con Vitest.

const DIAS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
}
const OFFSET_AR_MS = 3 * 3600 * 1000

function normalizar(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// "Ahora" expresado como fecha/hora de Argentina (campos UTC del objeto = reloj de Córdoba).
function relojAR(ahora: Date): Date {
  return new Date(ahora.getTime() - OFFSET_AR_MS)
}

function extraerHora(t: string): { h: number; m: number } | null {
  const conMinutos = t.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/)
  if (conMinutos) return { h: Number(conMinutos[1]), m: Number(conMinutos[2]) }
  const simple = t.match(/\b(?:a las|alas|las|tipo|a eso de)\s+([01]?\d|2[0-3])\b/) ?? t.match(/\b([01]?\d|2[0-3])\s*(?:hs|h|horas)\b/)
  if (!simple) return null
  let h = Number(simple[1])
  // "a las 5 de la tarde" / "4 pm": el local abre de 9 a 19, así que 1 a 7 es de tarde.
  if (h >= 1 && h <= 7) h += 12
  return { h, m: 0 }
}

export function interpretarVisita(texto: string, ahora: Date = new Date()): Date | null {
  if (!texto) return null
  const t = normalizar(texto)
  const hora = extraerHora(t)
  if (!hora || hora.h < 9 || hora.h > 19 || (hora.h === 19 && hora.m > 0)) return null

  const hoy = relojAR(ahora)
  const base = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate())
  let dia: number | null = null // ms UTC de la medianoche del día elegido (en reloj AR)

  const fecha = t.match(/\b([0-2]?\d|3[01])\/(0?[1-9]|1[0-2])\b/)
  if (fecha) {
    let anio = hoy.getUTCFullYear()
    let d = Date.UTC(anio, Number(fecha[2]) - 1, Number(fecha[1]))
    if (d < base) d = Date.UTC(++anio, Number(fecha[2]) - 1, Number(fecha[1]))
    dia = d
  } else if (/\bpasado manana\b/.test(t)) {
    dia = base + 2 * 86400000
  } else if (/\bmanana\b/.test(t) && !/\b(de|a la|por la) manana\b/.test(t)) {
    dia = base + 86400000
  } else if (/\bhoy\b/.test(t)) {
    dia = base
  } else {
    const nombre = Object.keys(DIAS).find((n) => new RegExp(`\\b${n}\\b`).test(t))
    if (nombre) {
      let diff = (DIAS[nombre] - hoy.getUTCDay() + 7) % 7
      if (diff === 0 && hoy.getUTCHours() * 60 + hoy.getUTCMinutes() >= hora.h * 60 + hora.m) diff = 7
      dia = base + diff * 86400000
    }
  }
  if (dia === null) return null
  if (new Date(dia).getUTCDay() === 0) return null // domingo cerrado

  const resultado = new Date(dia + (hora.h * 60 + hora.m) * 60000 + OFFSET_AR_MS)
  return resultado.getTime() > ahora.getTime() ? resultado : null
}

const SIN_INTERES = /(no le interesa|ya no (le )?interesa|no (quiere|va a) comprar|desisti|no esta interesad|lo pensara|ya compro)/

// El agente deriva por varios motivos: si es falta de interés, el lead baja; si no, lo atiende una persona.
export function esSinInteres(motivo: string): boolean {
  return SIN_INTERES.test(normalizar(motivo ?? ''))
}
