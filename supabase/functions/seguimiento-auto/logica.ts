// Reglas del seguimiento automático por SendPulse. Sin dependencias de Deno para testearlas con Vitest.
//
// El reloj de cada lead es bot_ultimo_evento_at: la última vez que el bot nos avisó que el cliente respondió.
// Meta solo deja mandar mensajes libres dentro de las 24 h desde el último mensaje del cliente:
//   * Pasos "texto" (Instagram y WhatsApp): solo dentro de esa ventana.
//   * Pasos "flujo" (solo WhatsApp): después de 24 h, con un flujo de SendPulse que empieza con una
//     PLANTILLA aprobada por Meta. Si el flujo no está configurado, el paso no se manda.
//   * p0_rescate (WhatsApp e Instagram, dentro de las 24 h): al que quedó rechazado (BCRA no apto o
//     Credicuotas) y no siguió la charla se le vuelve a abrir el flujo "DNI rechazado", que lleva al
//     agente de IA de cierre (tarjeta, anticipo, familiar, visita). Es el único paso que se manda a
//     leads en prioridad baja: justamente son los rechazados.
// Instagram no permite mensajes automáticos después de 24 h.

export type Canal = 'instagram' | 'whatsapp'

export interface LeadSeguimiento {
  id: string
  nombre: string | null
  origen: string
  estado: string
  prioridad: string | null
  forma_pago: string | null
  estado_dni: string | null
  bcra_resultado: string | null
  modelo_interes: string | null
  sendpulse_contact_id: string | null
  bot_ultimo_evento_at: string | null
  notas?: string | null
}

export interface EnvioPrevio { paso: string; created_at: string }

export interface ConfigSeguimiento {
  horaDesde: number // hora de Córdoba desde la que se puede mandar (incluida)
  horaHasta: number // hasta (excluida)
  textos: Record<string, string>
  // paso -> flow_id. Para p0_rescate va por canal: p0_rescate_whatsapp / p0_rescate_instagram.
  flujos: Record<string, string | undefined>
  separacionMinHoras: number
}

export type Decision =
  | { paso: string; canal: Canal; tipo: 'texto'; texto: string }
  | { paso: string; canal: Canal; tipo: 'flujo'; flowId: string }

interface Paso {
  clave: string
  desdeHoras: number
  hastaHoras: number
  canales: Canal[]
  tipo: 'texto' | 'flujo'
  aplica: (l: LeadSeguimiento) => boolean
}

const ESTADOS_FINALES = new Set(['venta_cerrada', 'perdido', 'en_negociacion'])

// Lead con chances reales: dijo contado o anticipo, DNI aprobado o precalificado apto.
export function esCaliente(l: LeadSeguimiento): boolean {
  return l.forma_pago === 'contado' || l.forma_pago === 'tarjeta' || l.forma_pago === 'anticipo_cuotas' ||
    l.estado_dni === 'aprobado' || l.bcra_resultado === 'apto'
}

// Rechazado por el BCRA o por Credicuotas.
export function esRechazado(l: LeadSeguimiento): boolean {
  return l.bcra_resultado === 'no_apto' || l.estado_dni === 'rechazado'
}

// Ya habló con el agente de cierre, pidió una persona, dijo que no le interesa o ya se lo rescató.
const YA_ATENDIDO = /agente IA|pidió hablar con un asesor|no le interesa|Seguimiento automático: rescate/i
export function yaAtendido(l: LeadSeguimiento): boolean {
  return YA_ATENDIDO.test(l.notas ?? '')
}

const ABANDONO = /sin terminar la calificación/i

export const PASOS: Paso[] = [
  {
    // Rechazado que no siguió: se le reabre el flujo de rechazo con el agente de cierre.
    clave: 'p0_rescate', desdeHoras: 3, hastaHoras: 23, canales: ['instagram', 'whatsapp'], tipo: 'flujo',
    aplica: (l) => esRechazado(l) && !yaAtendido(l),
  },
  {
    // Empezó a hablar y no dijo cómo paga: se le recuerda a la hora.
    clave: 'p1_sin_respuesta', desdeHoras: 1, hastaHoras: 23, canales: ['instagram', 'whatsapp'], tipo: 'texto',
    aplica: (l) => !l.forma_pago && (l.estado === 'nuevo' || l.estado === 'contactado'),
  },
  {
    // Antes de que cierre la ventana de 24 h: último mensaje libre.
    clave: 'p2_antes_24h', desdeHoras: 18, hastaHoras: 23.5, canales: ['instagram', 'whatsapp'], tipo: 'texto',
    aplica: (l) => l.estado === 'nuevo' || l.estado === 'contactado',
  },
  {
    // Día 2, solo WhatsApp y solo leads con chances (plantilla aprobada).
    clave: 'p3_dia_2', desdeHoras: 48, hastaHoras: 96, canales: ['whatsapp'], tipo: 'flujo',
    aplica: (l) => esCaliente(l),
  },
  {
    // Día 5, último intento.
    clave: 'p4_dia_5', desdeHoras: 120, hastaHoras: 168, canales: ['whatsapp'], tipo: 'flujo',
    aplica: (l) => esCaliente(l),
  },
]

export const TEXTOS_POR_DEFECTO: Record<string, string> = {
  p1_sin_respuesta: '¿Seguís por ahí? 🙌 Te cuento que podés sacarla con tarjeta de crédito (aceptamos todas), con anticipo + cuotas o de contado. ¿Cómo la pensás pagar?',
  p2_antes_24h: 'Hola {nombre}! Te escribo de Motobox por {moto}. ¿Querés que te pase el precio y las formas de pago? Aceptamos todas las tarjetas de crédito, anticipo + cuotas o contado.',
}

export function horaCordoba(fecha: Date): number {
  // Córdoba es UTC-3 todo el año (sin horario de verano).
  return (fecha.getUTCHours() + 21) % 24
}

export function canalDe(l: LeadSeguimiento): Canal | null {
  if (l.origen === 'instagram') return 'instagram'
  if (l.origen === 'whatsapp') return 'whatsapp'
  return null
}

function primerNombre(n: string | null): string {
  const limpio = (n ?? '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/)[0] ?? ''
  if (!limpio || /^sin$/i.test(limpio)) return ''
  return limpio[0].toUpperCase() + limpio.slice(1).toLowerCase()
}

export function completarTexto(plantilla: string, l: LeadSeguimiento): string {
  const nombre = primerNombre(l.nombre)
  const modelo = (l.modelo_interes ?? '').trim()
  const moto = modelo && !/^\d+$/.test(modelo) ? `la ${modelo}` : 'la moto que consultaste'
  return plantilla
    .replace(/\{nombre\}/g, nombre)
    .replace(/\{moto\}/g, moto)
    .replace(/Hola\s+!/g, 'Hola!')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function decidir(l: LeadSeguimiento, previos: EnvioPrevio[], ahora: Date, cfg: ConfigSeguimiento): Decision | null {
  if (!l.sendpulse_contact_id || !l.bot_ultimo_evento_at) return null
  if (ESTADOS_FINALES.has(l.estado)) return null
  // Baja = dijo que no le interesa o no califica: solo se le manda el rescate de rechazados.
  // Excepción: el que dejó la calificación a medias queda en baja solo por no tener teléfono; ese sí recibe
  // los recordatorios (p1/p2) para retomar la charla.
  const esBaja = l.prioridad === 'baja' && !ABANDONO.test(l.notas ?? '')
  const canal = canalDe(l)
  if (!canal) return null

  const hora = horaCordoba(ahora)
  if (hora < cfg.horaDesde || hora >= cfg.horaHasta) return null

  // No dos mensajes seguidos: separación mínima desde el último envío.
  const ultimo = previos.reduce<number>((max, p) => Math.max(max, Date.parse(p.created_at) || 0), 0)
  if (ultimo && (ahora.getTime() - ultimo) / 36e5 < cfg.separacionMinHoras) return null

  const horas = (ahora.getTime() - Date.parse(l.bot_ultimo_evento_at)) / 36e5
  const enviados = new Set(previos.map((p) => p.paso))

  for (const paso of PASOS) {
    if (enviados.has(paso.clave)) continue
    if (esBaja && paso.clave !== 'p0_rescate') continue
    if (horas < paso.desdeHoras || horas >= paso.hastaHoras) continue
    if (!paso.canales.includes(canal)) continue
    if (!paso.aplica(l)) continue
    if (paso.tipo === 'texto') {
      const plantilla = cfg.textos[paso.clave] ?? TEXTOS_POR_DEFECTO[paso.clave]
      if (!plantilla) continue
      return { paso: paso.clave, canal, tipo: 'texto', texto: completarTexto(plantilla, l) }
    }
    const flowId = cfg.flujos[`${paso.clave}_${canal}`] ?? cfg.flujos[paso.clave]
    if (!flowId) continue
    return { paso: paso.clave, canal, tipo: 'flujo', flowId }
  }
  return null
}
