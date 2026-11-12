import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decidir, completarTexto, charlaPideEsperar, modeloValido, horaCordoba, telefonoWhatsApp, aplicaRecupero, type LeadSeguimiento, type ConfigSeguimiento } from '../../supabase/functions/seguimiento-auto/logica.ts'

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
    // Rechazado sin flujo de rescate configurado: le toca el recordatorio general.
    const d = decidir(lead({ bot_ultimo_evento_at: hace(19), forma_pago: 'cuotas', bcra_resultado: 'no_apto' }), [], AHORA, CFG)
    expect(d).toEqual({ paso: 'p2_antes_24h', canal: 'instagram', tipo: 'texto', texto: 'Hola Juan! P2 la Honda Wave' })
    expect(decidir(lead({ bot_ultimo_evento_at: hace(23.6), forma_pago: 'cuotas', bcra_resultado: 'no_apto' }), [], AHORA, CFG)).toBeNull()
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
    // El que dejó la calificación a medias (baja por no tener teléfono) sí recibe el recordatorio.
    expect(decidir(lead({ prioridad: 'baja', notas: '[x] Bot: el cliente dejó la conversación sin terminar la calificación.' }), [], AHORA, CFG)).toMatchObject({ paso: 'p1_sin_respuesta' })
    expect(decidir(lead({ sendpulse_contact_id: null }), [], AHORA, CFG)).toBeNull()
    expect(decidir(lead({ bot_ultimo_evento_at: null }), [], AHORA, CFG)).toBeNull()
    expect(decidir(lead({ origen: 'presencial' }), [], AHORA, CFG)).toBeNull()
  })
})

describe('seguimiento por segmento', () => {
  it('al que dijo contado/tarjeta/anticipo se lo invita a ver la moto a las 5 h (una vez, si no tiene visita)', () => {
    const caliente = lead({ forma_pago: 'tarjeta', bot_ultimo_evento_at: hace(6) })
    const d = decidir(caliente, [], AHORA, CFG)
    expect(d).toMatchObject({ paso: 'p1v_visita', tipo: 'texto' })
    expect((d as { texto: string }).texto).toMatch(/Santa Rosa 4227/)
    expect(decidir({ ...caliente, fecha_agenda: hace(1) }, [], AHORA, CFG)).toBeNull()
    expect(decidir({ ...caliente, bot_ultimo_evento_at: hace(4) }, [], AHORA, CFG)).toBeNull()
  })

  it('el recordatorio de 18 h cambia según el cliente', () => {
    const previos = [{ paso: 'p1v_visita', created_at: hace(10) }, { paso: 'p1_sin_respuesta', created_at: hace(10) }]
    const sinTextoP2 = { ...CFG, textos: { p1_sin_respuesta: 'P1' } }
    const t = (l: LeadSeguimiento) => (decidir(l, previos, AHORA, sinTextoP2) as { texto: string }).texto
    expect(t(lead({ forma_pago: 'contado', bot_ultimo_evento_at: hace(19) }))).toMatch(/te la reservo/)
    expect(t(lead({ forma_pago: 'cuotas', estado_dni: 'pendiente', bot_ultimo_evento_at: hace(19) }))).toMatch(/Mientras revisamos tu DNI/)
    expect(t(lead({ forma_pago: null, bot_ultimo_evento_at: hace(19) }))).toMatch(/mejor forma de pago/)
  })

  it('a los duplicados no se les escribe', () => {
    expect(decidir(lead({ duplicado_de: 'otro' }), [], AHORA, CFG)).toBeNull()
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
    expect(completarTexto(t, lead({ nombre: 'Paula', modelo_interes: 'a consultar' }))).toBe('Hola Paula! Te escribo por la moto que consultaste.')
  })
})

describe('cliente SendPulse', () => {
  it('la copia de seguimiento-auto es igual a la de dni-resolver', () => {
    const a = readFileSync('supabase/functions/dni-resolver/sendpulse.ts', 'utf8')
    const b = readFileSync('supabase/functions/seguimiento-auto/sendpulse.ts', 'utf8')
    expect(b).toBe(a)
  })
})

describe('p5_recupero (plantilla por teléfono)', () => {
  const ahora = new Date('2026-11-02T15:00:00Z')
  const cfgR = { puntajeMinimo: 45, puntajeMinimoPerdidos: 30, diasDesde: 3, diasHasta: 90 }
  const base = {
    id: 'r1', telefono: '351 203-3710', estado: 'contactado', prioridad: 'media', notas: '', duplicado_de: null,
    puntaje_compra: 60, created_at: '2026-10-10T12:00:00Z', bot_ultimo_evento_at: null, primer_contacto_at: null,
  }

  it('normaliza teléfonos argentinos a 549…', () => {
    expect(telefonoWhatsApp('3512033710')).toBe('5493512033710')
    expect(telefonoWhatsApp('+54 9 351 203-3710')).toBe('5493512033710')
    expect(telefonoWhatsApp('543512294829')).toBe('5493512294829')
    expect(telefonoWhatsApp('03518072211')).toBe('5493518072211')
    expect(telefonoWhatsApp('351152033710')).toBe('5493512033710')
    expect(telefonoWhatsApp('1563074971')).toBeNull()
    expect(telefonoWhatsApp('12345')).toBeNull()
    expect(telefonoWhatsApp(null)).toBeNull()
  })

  it('manda a leads fríos con chances, una sola vez', () => {
    expect(aplicaRecupero(base, [], ahora, cfgR)).toBe(true)
    expect(aplicaRecupero(base, [{ paso: 'p5_recupero', created_at: '2026-10-20T12:00:00Z' }], ahora, cfgR)).toBe(false)
  })

  it('no manda a recientes, muy viejos, de bajo puntaje, cerrados, duplicados o que no quieren', () => {
    expect(aplicaRecupero({ ...base, created_at: '2026-11-01T12:00:00Z' }, [], ahora, cfgR)).toBe(false)
    expect(aplicaRecupero({ ...base, created_at: '2026-06-01T12:00:00Z' }, [], ahora, cfgR)).toBe(false)
    expect(aplicaRecupero({ ...base, puntaje_compra: 30 }, [], ahora, cfgR)).toBe(false)
    expect(aplicaRecupero({ ...base, estado: 'venta_cerrada' }, [], ahora, cfgR)).toBe(false)
    expect(aplicaRecupero({ ...base, estado: 'perdido', puntaje_compra: 35 }, [], ahora, cfgR)).toBe(true)
    expect(aplicaRecupero({ ...base, estado: 'perdido', puntaje_compra: 25 }, [], ahora, cfgR)).toBe(false)
    expect(aplicaRecupero({ ...base, estado: 'perdido', notas: 'Ya compró en otro lado' }, [], ahora, cfgR)).toBe(false)
    expect(aplicaRecupero({ ...base, duplicado_de: 'x' }, [], ahora, cfgR)).toBe(false)
    expect(aplicaRecupero({ ...base, notas: 'Dijo que no le interesa' }, [], ahora, cfgR)).toBe(false)
    expect(aplicaRecupero({ ...base, telefono: null }, [], ahora, cfgR)).toBe(false)
    // Un seguimiento hace menos de 48 h: espera.
    expect(aplicaRecupero(base, [{ paso: 'p2_antes_24h', created_at: '2026-11-01T20:00:00Z' }], ahora, cfgR)).toBe(false)
  })

  it('la actividad más reciente manda (bot o primer contacto)', () => {
    expect(aplicaRecupero({ ...base, bot_ultimo_evento_at: '2026-11-01T10:00:00Z' }, [], ahora, cfgR)).toBe(false)
  })
})

describe('canal después del recupero', () => {
  it('un lead de Instagram o presencial que recibió el recupero sigue por WhatsApp', async () => {
    const { canalDe } = await import('../../supabase/functions/seguimiento-auto/logica.ts')
    const nota = '[1/11/2026] Seguimiento automático: recupero por plantilla de WhatsApp enviado'
    expect(canalDe(lead({ origen: 'instagram', notas: nota }))).toBe('whatsapp')
    expect(canalDe(lead({ origen: 'presencial', notas: nota }))).toBe('whatsapp')
    expect(canalDe(lead({ origen: 'presencial' }))).toBeNull()
    expect(canalDe(lead({ origen: 'instagram' }))).toBe('instagram')
  })
})

describe('canal según el último bot que habló', () => {
  it('un lead de Instagram que siguió por WhatsApp va por WhatsApp', async () => {
    const { canalDe } = await import('../../supabase/functions/seguimiento-auto/logica.ts')
    expect(canalDe(lead({ origen: 'instagram', notas: '[1] Bot instagram: forma de pago cuotas\n[2] Bot whatsapp: forma de pago cuotas con DNI' }))).toBe('whatsapp')
    expect(canalDe(lead({ origen: 'instagram', notas: '[1] Bot whatsapp: x\n[2] Bot instagram: y' }))).toBe('instagram')
    expect(canalDe(lead({ origen: 'whatsapp', notas: '' }))).toBe('whatsapp')
  })
})

describe('pidió asesor', () => {
  it('no recibe seguimientos automáticos', () => {
    expect(decidir(lead(), [], AHORA, CFG)).not.toBeNull()
    expect(decidir(lead({ notas: '[x] Bot: el cliente pidió hablar con un asesor' }), [], AHORA, CFG)).toBeNull()
  })
})

describe('seguimiento según el chat', () => {
  const ahora = new Date('2026-11-12T18:00:00Z')
  const hace = (h: number) => new Date(ahora.getTime() - h * 36e5).toISOString()
  it('no recuerda nada si el cliente fue el último en escribir', () => {
    expect(charlaPideEsperar({ autor: 'cliente', created_at: hace(5) }, ahora)).toBe(true)
  })
  it('no empuja una charla de hace menos de una hora', () => {
    expect(charlaPideEsperar({ autor: 'agente', created_at: hace(0.5) }, ahora)).toBe(true)
  })
  it('sí recuerda si el bot habló último hace rato o no hay registro', () => {
    expect(charlaPideEsperar({ autor: 'agente', created_at: hace(3) }, ahora)).toBe(false)
    expect(charlaPideEsperar(null, ahora)).toBe(false)
  })
  it('"pendiente" no es una moto', () => {
    expect(modeloValido('pendiente')).toBe(false)
    expect(modeloValido('Keller Crono Full')).toBe(true)
    expect(completarTexto('¿Querés pasar a ver {moto}?', { nombre: 'Marta', modelo_interes: 'pendiente' } as never)).toBe('¿Querés pasar a ver la moto que consultaste?')
  })
})
