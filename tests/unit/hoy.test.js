import { describe, it, expect } from 'vitest'
import { colaDeHoy, resultadoContacto, proximoContacto, inicioDelDia, avanceDeHoy, comoPaga, asunto, formatoPlata } from '../../src/lib/hoy'

// Martes 10/11/2026 15:00 en Córdoba (18:00 UTC).
const AHORA = new Date('2026-11-10T18:00:00Z')
const hace = (h) => new Date(AHORA.getTime() - h * 36e5).toISOString()
const en = (h) => new Date(AHORA.getTime() + h * 36e5).toISOString()
let n = 0
const L = (o = {}) => ({ id: `l${++n}`, nombre: 'Ana', estado: 'nuevo', prioridad: 'alta', telefono: '3511234567', ...o })
const claves = (leads) => Object.fromEntries(colaDeHoy(leads, AHORA).grupos.map((g) => [g.clave, g.leads.map((l) => l.id)]))

describe('fechas en hora de Argentina', () => {
  it('el día empieza a las 00:00 locales', () => {
    expect(new Date(inicioDelDia(AHORA)).toISOString()).toBe('2026-11-10T03:00:00.000Z')
    expect(new Date(inicioDelDia(new Date('2026-11-11T01:30:00Z'))).toISOString()).toBe('2026-11-10T03:00:00.000Z')
  })
  it('el próximo contacto es a las 10:00 y saltea el domingo', () => {
    expect(proximoContacto(AHORA, 1)).toBe('2026-11-11T13:00:00.000Z')
    const sabado = new Date('2026-11-14T18:00:00Z')
    expect(proximoContacto(sabado, 1)).toBe('2026-11-16T13:00:00.000Z')
  })
})

describe('cola de hoy', () => {
  it('pone cada lead en un solo grupo, por prioridad', () => {
    const cita = L({ estado: 'en_negociacion', fecha_agenda: en(2), caliente_at: hace(50), caliente_atendido_at: hace(40) })
    const caliente = L({ forma_pago: 'contado', caliente_at: hace(5) })
    const aprobado = L({ estado_dni: 'aprobado' })
    const volver = L({ estado: 'contactado', proximo_contacto_at: hace(1) })
    const frio = L({ estado: 'contactado', forma_pago: 'tarjeta', caliente_at: hace(100), caliente_atendido_at: hace(80) })
    expect(claves([frio, volver, aprobado, caliente, cita])).toEqual({
      citas: [cita.id], calientes: [caliente.id], aprobados: [aprobado.id], volver: [volver.id], enfriando: [frio.id],
    })
  })

  it('solo entran leads de prioridad alta', () => {
    const alta = L({ forma_pago: 'contado', caliente_at: hace(5) })
    const media = L({ prioridad: 'media', estado: 'contactado', proximo_contacto_at: hace(1) })
    const baja = L({ prioridad: 'baja', fecha_agenda: en(1) })
    const sin = L({ prioridad: null, estado: 'contactado', proximo_contacto_at: hace(1) })
    expect(claves([alta, media, baja, sin])).toEqual({ calientes: [alta.id] })
  })

  it('un lead de prioridad alta contactado y sin novedades figura como enfriándose', () => {
    const l = L({ estado: 'contactado', updated_at: hace(24 * 5) })
    const reciente = L({ estado: 'contactado', updated_at: hace(10) })
    expect(claves([l, reciente])).toEqual({ enfriando: [l.id] })
  })

  it('no muestra cerrados, duplicados ni leads sin motivo para contactar', () => {
    expect(colaDeHoy([
      L({ estado: 'perdido', caliente_at: hace(2) }),
      L({ estado: 'venta_cerrada', proximo_contacto_at: hace(2) }),
      L({ duplicado_de: 'x', caliente_at: hace(2) }),
      L({ estado: 'contactado' }),
    ], AHORA).total).toBe(0)
  })

  it('un lead pospuesto para otro día no aparece hasta ese día', () => {
    const l = L({ forma_pago: 'contado', caliente_at: hace(5), proximo_contacto_at: en(30) })
    expect(colaDeHoy([l], AHORA).total).toBe(0)
    expect(claves([l].map((x) => ({ ...x, proximo_contacto_at: en(3) })))).toEqual({ calientes: [l.id] })
  })

  it('las citas viejas no inundan la cola: solo hoy y los 2 días anteriores', () => {
    const vieja = L({ estado: 'contactado', fecha_agenda: hace(24 * 20) })
    const ayer = L({ estado: 'contactado', fecha_agenda: hace(26) })
    expect(claves([vieja, ayer])).toEqual({ citas: [ayer.id] })
  })

  it('una cita ya confirmada hoy sale de la cola', () => {
    const cita = L({ estado: 'en_negociacion', fecha_agenda: en(2) })
    expect(claves([cita])).toEqual({ citas: [cita.id] })
    expect(colaDeHoy([{ ...cita, ...resultadoContacto(cita, 'escribi', {}, AHORA) }], AHORA).total).toBe(0)
  })

  it('calientes: contado primero; los de más de 14 días ya no entran', () => {
    const tarjeta = L({ forma_pago: 'tarjeta', caliente_at: hace(1) })
    const contado = L({ forma_pago: 'contado', caliente_at: hace(30) })
    const viejo = L({ forma_pago: 'contado', caliente_at: hace(24 * 15) })
    expect(claves([tarjeta, contado, viejo]).calientes).toEqual([contado.id, tarjeta.id])
  })

  it('un caliente contactado con próximo paso no figura como enfriándose', () => {
    const l = L({ estado: 'contactado', forma_pago: 'tarjeta', caliente_at: hace(100), caliente_atendido_at: hace(80), proximo_contacto_at: en(40) })
    expect(colaDeHoy([l], AHORA).total).toBe(0)
  })
})

describe('resultado de un contacto', () => {
  const base = { id: 'a', estado: 'nuevo', notas: 'antes', caliente_at: hace(3), caliente_atendido_at: null, contacto_intentos: 0 }

  it('le escribí: pasa a contactado, marca atendido y vuelve mañana', () => {
    const c = resultadoContacto(base, 'escribi', {}, AHORA, 'Mauricio')
    expect(c).toMatchObject({ estado: 'contactado', contacto_intentos: 1, proximo_contacto_at: '2026-11-11T13:00:00.000Z', caliente_atendido_at: AHORA.toISOString(), ultimo_contacto_at: AHORA.toISOString() })
    expect(c.notas).toMatch(/^antes\n\[.*\] CRM: le escribió Mauricio$/)
  })

  it('no contesta: suma el intento y vuelve en 2 días', () => {
    const c = resultadoContacto({ ...base, estado: 'contactado', contacto_intentos: 2 }, 'no_contesta', {}, AHORA, 'Mauricio')
    expect(c.contacto_intentos).toBe(3)
    expect(c.proximo_contacto_at).toBe('2026-11-12T13:00:00.000Z')
    expect(c.estado).toBeUndefined()
    expect(c.notas).toContain('no contesta (intento 3)')
  })

  it('agendó visita: guarda la cita, pasa a negociación y limpia el próximo contacto', () => {
    const c = resultadoContacto(base, 'visita', { fecha: '2026-11-12T20:00:00Z' }, AHORA, 'Mauricio')
    expect(c).toMatchObject({ estado: 'en_negociacion', fecha_agenda: '2026-11-12T20:00:00.000Z', proximo_contacto_at: null, contacto_intentos: 0 })
    expect(c.notas).toContain('agendó visita para')
    expect(() => resultadoContacto(base, 'visita', {}, AHORA)).toThrow(/día y la hora/)
  })

  it('perdido: exige motivo y deja la nota que frena el recupero automático cuando corresponde', () => {
    const c = resultadoContacto(base, 'perdido', { motivo: 'Compró en otro lado' }, AHORA, 'Mauricio')
    expect(c).toMatchObject({ estado: 'perdido', proximo_contacto_at: null })
    expect(c.notas).toMatch(/compró en otro/)
    expect(() => resultadoContacto(base, 'perdido', {}, AHORA)).toThrow(/motivo/)
  })

  it('posponer: guarda la fecha elegida', () => {
    const c = resultadoContacto(base, 'posponer', { fecha: '2026-11-20T13:00:00Z' }, AHORA)
    expect(c.proximo_contacto_at).toBe('2026-11-20T13:00:00.000Z')
    expect(c.estado).toBe('contactado')
  })

  it('después de registrar el contacto, el lead sale de la cola de hoy', () => {
    const lead = L({ forma_pago: 'contado', caliente_at: hace(3) })
    const despues = { ...lead, ...resultadoContacto(lead, 'escribi', {}, AHORA) }
    expect(colaDeHoy([despues], AHORA).total).toBe(0)
    expect(avanceDeHoy([despues], AHORA).contactados).toBe(1)
  })
})

describe('cómo paga y asunto', () => {
  it('muestra la forma de pago o avisa que no la dijo', () => {
    expect(comoPaga({ forma_pago: 'contado' }).texto).toBe('Contado')
    expect(comoPaga({ forma_pago: 'anticipo_cuotas' }).texto).toBe('Anticipo + cuotas')
    expect(comoPaga({}).texto).toBe('No dijo cómo paga')
  })
  it('formatea montos escritos de cualquier forma', () => {
    expect(formatoPlata('$2.500.000')).toBe('$2.500.000')
    expect(formatoPlata('600000')).toBe('$600.000')
    expect(formatoPlata(1000000)).toBe('$1.000.000')
    expect(formatoPlata('no sé')).toBe('')
  })
  it('arma el asunto con moto, anticipo, usada, crédito y pedido de asesor', () => {
    expect(asunto({ modelo_interes: 'Honda Wave S', anticipo: '600000', usada_detalle: 'Honda Tornado 300' }))
      .toBe('Quiere Honda Wave S · anticipo $600.000 · entrega usada: Honda Tornado 300')
    expect(asunto({ estado_dni: 'aprobado', monto_aprobado: 1500000 })).toBe('No dijo qué moto quiere · crédito aprobado por $1.500.000')
    expect(asunto({ caliente_motivo: 'asesor', notas: 'x\n[6/11] Bot: el cliente pidió hablar con un asesor (El DNI del familiar tampoco pasó: ofrecerle tarjeta)' }))
      .toBe('No dijo qué moto quiere · pidió un asesor (El DNI del familiar tampoco pasó: ofrecerle tarjeta)')
  })
})
