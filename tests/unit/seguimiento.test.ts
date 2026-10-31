import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decidir, completarTexto, horaCordoba, type LeadSeguimiento, type ConfigSeguimiento } from '../../supabase/functions/seguimiento-auto/logica.ts'

const CFG: ConfigSeguimiento = {
  horaDesde: 9, horaHasta: 21, separacionMinHoras: 6,
  textos: { p1_sin_respuesta: 'P1 {nombre}', p2_antes_24h: 'Hola {nombre}! P2 {moto}' },
  flujos: { p3_dia_2: 'flujo-d2', p4_dia_5: 'flujo-d5' },
}

// 15:00 de Córdoba = 18:00 UTC
const AHORA = new Date('2026-10-26T18:00:00Z')
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 36e5).toISOString()

function lead(p: Partial<LeadSeguimiento> = {}): LeadSeguimiento {
  return {
    id: 'L1', nombre: 'juan pérez', origen: 'instagram', estado: 'contactado', prioridad: 'media',
    forma_pago: null, estado_dni: null, bcra_resultado: null, modelo_interes: 'Honda Wave',
    sendpulse_contact_id: 'sp-1', bot_ultimo_evento_at: hace(2), ...p,
  }
}

describe('reloj', () => {
  it('Córdoba es UTC-3', () => {
    expect(horaCordoba(new Date('2026-10-26T18:00:00Z'))).toBe(15)
    expect(horaCordoba(new Date('2026-10-26T02:00:00Z'))).toBe(23)
  })
})

describe('pasos', () => {
  it('p1: a la hora, si no dijo cómo paga', () => {
    expect(decidir(lead({ bot_ultimo_evento_at: hace(0.5) }), [], AHORA, CFG)).toBeNull()
    expect(decidir(lead(), [], AHORA, CFG)).toEqual({ paso: 'p1_sin_respuesta', canal: 'instagram', tipo: 'texto', texto: 'P1 Juan' })
    // Si ya dijo la forma de pago, no hay p1.
    expect(decidir(lead({ forma_pago: 'cuotas' }), [], AHORA, CFG)).toBeNull()
  })

  it('p2: entre las 18 y 23,5 h, por cualquier canal', () => {
    const d = decidir(lead({ bot_ultimo_evento_at: hace(19), forma_pago: 'cuotas' }), [], AHORA, CFG)
    expect(d).toEqual({ paso: 'p2_antes_24h', canal: 'instagram', tipo: 'texto', texto: 'Hola Juan! P2 la Honda Wave' })
    expect(decidir(lead({ bot_ultimo_evento_at: hace(23.6), forma_pago: 'cuotas' }), [], AHORA, CFG)).toBeNull()
  })

  it('después de 24 h, Instagram no recibe nada', () => {
    expect(decidir(lead({ bot_ultimo_evento_at: hace(50), forma_pago: 'contado' }), [], AHORA, CFG)).toBeNull()
  })

  it('p3 y p4: solo WhatsApp, solo leads con chances y con flujo de plantilla configurado', () => {
    const caliente = lead({ origen: 'whatsapp', forma_pago: 'contado', bot_ultimo_evento_at: hace(50) })
    expect(decidir(caliente, [], AHORA, CFG)).toEqual({ paso: 'p3_dia_2', canal: 'whatsapp', tipo: 'flujo', flowId: 'flujo-d2' })
    expect(decidir({ ...caliente, bot_ultimo_evento_at: hace(130) }, [], AHORA, CFG)).toMatchObject({ paso: 'p4_dia_5', flowId: 'flujo-d5' })
    // Frío (cuotas con DNI sin precalificar): no.
    expect(decidir({ ...caliente, forma_pago: 'cuotas' }, [], AHORA, CFG)).toBeNull()
    // Apto en BCRA o DNI aprobado: sí.
    expect(decidir({ ...caliente, forma_pago: 'cuotas', bcra_resultado: 'apto' }, [], AHORA, CFG)).toMatchObject({ paso: 'p3_dia_2' })
    expect(decidir({ ...caliente, forma_pago: 'cuotas', estado_dni: 'aprobado' }, [], AHORA, CFG)).toMatchObject({ paso: 'p3_dia_2' })
    // Sin flujo configurado: no se manda.
    expect(decidir(caliente, [], AHORA, { ...CFG, flujos: {} })).toBeNull()
  })

  it('cada paso una sola vez y con separación mínima', () => {
    const l = lead({ bot_ultimo_evento_at: hace(19), forma_pago: null })
    // p1 ya enviado hace 2 h: todavía no toca p2 (separación de 6 h).
    expect(decidir(l, [{ paso: 'p1_sin_respuesta', created_at: hace(2) }], AHORA, CFG)).toBeNull()
    // p1 enviado hace 10 h: ahora sí p2.
    expect(decidir(l, [{ paso: 'p1_sin_respuesta', created_at: hace(10) }], AHORA, CFG)).toMatchObject({ paso: 'p2_antes_24h' })
    expect(decidir(l, [{ paso: 'p1_sin_respuesta', created_at: hace(10) }, { paso: 'p2_antes_24h', created_at: hace(9) }], AHORA, CFG)).toBeNull()
  })

  it('no escribe de noche, ni a leads cerrados, en negociación, de baja o sin contacto de SendPulse', () => {
    const noche = new Date('2026-10-27T02:00:00Z') // 23 h en Córdoba
    expect(decidir(lead({ bot_ultimo_evento_at: new Date(noche.getTime() - 2 * 36e5).toISOString() }), [], noche, CFG)).toBeNull()
    for (const estado of ['venta_cerrada', 'perdido', 'en_negociacion']) {
      expect(decidir(lead({ estado }), [], AHORA, CFG)).toBeNull()
    }
    expect(decidir(lead({ prioridad: 'baja' }), [], AHORA, CFG)).toBeNull()
    expect(decidir(lead({ sendpulse_contact_id: null }), [], AHORA, CFG)).toBeNull()
    expect(decidir(lead({ bot_ultimo_evento_at: null }), [], AHORA, CFG)).toBeNull()
    expect(decidir(lead({ origen: 'presencial' }), [], AHORA, CFG)).toBeNull()
  })
})

describe('textos', () => {
  it('p0: al rechazado que no siguió le reabre el flujo de rechazo de su canal, aunque esté en baja', () => {
    const cfg = { ...CFG, flujos: { ...CFG.flujos, p0_rescate_whatsapp: 'rech-wa', p0_rescate_instagram: 'rech-ig' } }
    const rechazado = lead({ prioridad: 'baja', forma_pago: 'cuotas', bcra_resultado: 'no_apto', bot_ultimo_evento_at: hace(4) })
    expect(decidir(rechazado, [], AHORA, cfg)).toEqual({ paso: 'p0_rescate', canal: 'instagram', tipo: 'flujo', flowId: 'rech-ig' })
    expect(decidir({ ...rechazado, origen: 'whatsapp' }, [], AHORA, cfg)).toMatchObject({ flowId: 'rech-wa' })
    expect(decidir(lead({ forma_pago: 'cuotas', estado_dni: 'rechazado', bot_ultimo_evento_at: hace(4) }), [], AHORA, cfg)).toMatchObject({ paso: 'p0_rescate' })
    // Antes de las 3 h no (puede seguir hablando con el agente), y nunca si ya pasó por el agente o pidió una persona.
    expect(decidir({ ...rechazado, bot_ultimo_evento_at: hace(2) }, [], AHORA, cfg)).toBeNull()
    expect(decidir({ ...rechazado, notas: '[x] VISITA AGENDADA por el agente IA' }, [], AHORA, cfg)).toBeNull()
    expect(decidir({ ...rechazado, notas: '[x] Bot: el cliente pidió hablar con un asesor' }, [], AHORA, cfg)).toBeNull()
    // Sin flujo configurado no se manda; un baja que no es rechazado sigue sin recibir nada.
    expect(decidir(rechazado, [], AHORA, CFG)).toBeNull()
    expect(decidir(lead({ prioridad: 'baja', forma_pago: 'cuotas', bot_ultimo_evento_at: hace(19) }), [], AHORA, cfg)).toBeNull()
  })

  it('limpia el nombre y la moto', () => {
    const t = 'Hola {nombre}! Te escribo por {moto}.'
    expect(completarTexto(t, lead({ nombre: 'Maite HABLAR URGENTE!', modelo_interes: 'Keller 110' }))).toBe('Hola Maite! Te escribo por la Keller 110.')
    expect(completarTexto(t, lead({ nombre: 'Sin nombre (instagram)', modelo_interes: '110' }))).toBe('Hola! Te escribo por la moto que consultaste.')
    expect(completarTexto(t, lead({ nombre: null, modelo_interes: null }))).toBe('Hola! Te escribo por la moto que consultaste.')
  })
})

describe('cliente SendPulse', () => {
  it('la copia de seguimiento-auto es igual a la de dni-resolver', () => {
    const a = readFileSync('supabase/functions/dni-resolver/sendpulse.ts', 'utf8')
    const b = readFileSync('supabase/functions/seguimiento-auto/sendpulse.ts', 'utf8')
    expect(b).toBe(a)
  })
})
