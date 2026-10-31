import { describe, it, expect } from 'vitest'
import { interpretarVisita, esSinInteres } from '../../supabase/functions/sendpulse-whatsapp-webhook/agenda'

// Sábado 31/10/2026 11:00 en Córdoba = 14:00 UTC.
const AHORA = new Date('2026-10-31T14:00:00Z')
const iso = (d: Date | null) => d?.toISOString() ?? null

describe('interpretarVisita', () => {
  it('día de la semana y hora', () => {
    expect(iso(interpretarVisita('El lunes a las 10, con tarjeta Naranja, Keller Crono', AHORA))).toBe('2026-11-02T13:00:00.000Z')
    expect(iso(interpretarVisita('miércoles 15:30 hs', AHORA))).toBe('2026-11-04T18:30:00.000Z')
  })

  it('hoy, mañana y "a las 5" de la tarde', () => {
    expect(iso(interpretarVisita('hoy a las 5', AHORA))).toBe('2026-10-31T20:00:00.000Z')
    expect(iso(interpretarVisita('mañana a las 11', AHORA))).toBeNull() // mañana es domingo
    expect(iso(interpretarVisita('pasado mañana 9 hs', AHORA))).toBe('2026-11-02T12:00:00.000Z')
  })

  it('mismo día de la semana ya pasado va a la semana siguiente', () => {
    expect(iso(interpretarVisita('sábado a las 10', AHORA))).toBe('2026-11-07T13:00:00.000Z')
    expect(iso(interpretarVisita('sábado a las 16', AHORA))).toBe('2026-10-31T19:00:00.000Z')
  })

  it('fecha con barra', () => {
    expect(iso(interpretarVisita('el 5/11 a las 12', AHORA))).toBe('2026-11-05T15:00:00.000Z')
  })

  it('fuera de horario, domingo o sin hora clara devuelve null', () => {
    expect(interpretarVisita('lunes a las 21', AHORA)).toBeNull()
    expect(interpretarVisita('domingo a las 10', AHORA)).toBeNull()
    expect(interpretarVisita('el lunes a la mañana', AHORA)).toBeNull()
    expect(interpretarVisita('', AHORA)).toBeNull()
  })
})

describe('esSinInteres', () => {
  it('detecta falta de interés', () => {
    expect(esSinInteres('Ya no le interesa, compró en otro lado')).toBe(true)
    expect(esSinInteres('No está interesado')).toBe(true)
    expect(esSinInteres('Pide hablar con un asesor')).toBe(false)
  })
})
